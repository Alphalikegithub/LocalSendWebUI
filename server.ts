import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';
import https from 'https';
import dgram from 'dgram';
import crypto from 'crypto';
import { spawn, ChildProcess, execSync } from 'child_process';
import multer from 'multer';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const LOCALSEND_PORT = 53317;
const MULTICAST_GROUP = '224.0.0.167';

const app = express();
app.use(cors());
app.use(express.json());

// Directories for temp file uploads and downloaded files
const uploadDir = path.join(os.tmpdir(), 'localsend-gui-uploads');
const downloadDir = path.join(os.homedir(), 'Downloads', 'LocalSend');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
if (!fs.existsSync(downloadDir)) {
  fs.mkdirSync(downloadDir, { recursive: true });
}

// Multer storage for incoming files
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const safeName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    cb(null, `${Date.now()}-${safeName}`);
  },
});
const upload = multer({ storage });

interface DiscoveredDevice {
  id: string;
  alias: string;
  ip: string;
  port: number;
  deviceModel?: string;
  deviceType: 'desktop' | 'mobile' | 'server' | 'web';
  fingerprint: string;
  isOnline: boolean;
  lastSeen: number;
}

let activeSendProcess: ChildProcess | null = null;
let activeReceiveProcess: ChildProcess | null = null;
const discoveredDevices = new Map<string, DiscoveredDevice>();
let multicastSocket: dgram.Socket | null = null;

// Helper: resolve localsend-cli executable
function resolveCliPath(): { path: string; found: boolean } {
  const fromEnv = process.env.LOCALSEND_CLI;
  if (fromEnv && fs.existsSync(fromEnv)) {
    return { path: fromEnv, found: true };
  }

  const candidates = [
    '/data/QtProjects/localsend/target/debug/localsend-cli',
    '/data/QtProjects/localsend/target/release/localsend-cli',
    path.join(os.homedir(), '.local', 'bin', 'localsend-cli'),
    '/usr/local/bin/localsend-cli',
    '/usr/bin/localsend-cli',
    path.join(__dirname, 'localsend-cli'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return { path: candidate, found: true };
      } catch {}
    }
  }

  try {
    const whichOutput = execSync('which localsend-cli 2>/dev/null', { encoding: 'utf8' }).trim();
    if (whichOutput && fs.existsSync(whichOutput)) {
      return { path: whichOutput, found: true };
    }
  } catch {}

  return {
    path: candidates[0],
    found: false,
  };
}

// Helper: resolve TLS identity & fingerprint
function resolveIdentity(): { path: string; fingerprint: string; pem: string | null } {
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  const candidates = [
    process.env.LOCALSEND_IDENTITY,
    path.join(configHome, 'localsend-cli', 'identity.pem'),
    path.join(os.homedir(), '.localsend', 'identity.pem'),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        const pem = fs.readFileSync(candidate, 'utf8');
        const x509Match = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
        if (x509Match) {
          const cert = new crypto.X509Certificate(x509Match[0]);
          const fingerprint = cert.fingerprint256.replace(/:/g, '').toUpperCase();
          return { path: candidate, fingerprint, pem };
        }
      } catch (err) {
        console.error('Error reading identity certificate:', err);
      }
    }
  }

  const defaultFingerprint = crypto
    .createHash('sha256')
    .update(os.hostname() + 'localsend-gui')
    .digest('hex')
    .toUpperCase();

  return {
    path: path.join(configHome, 'localsend-cli', 'identity.pem'),
    fingerprint: defaultFingerprint,
    pem: null,
  };
}

// Helper: list local IPv4 network interfaces
function getLocalIPv4Addresses(): { ip: string; netmask: string; name: string }[] {
  const interfaces = os.networkInterfaces();
  const list: { ip: string; netmask: string; name: string }[] = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        list.push({ ip: addr.address, netmask: addr.netmask, name });
      }
    }
  }
  return list;
}

// Safely close and release UDP port 53317
function stopMulticastListener() {
  if (multicastSocket) {
    try {
      multicastSocket.leaveMembership(MULTICAST_GROUP);
    } catch {}
    try {
      multicastSocket.close();
    } catch {}
    multicastSocket = null;
  }
}

// Start temporary UDP listener for discovery
function startMulticastListener(onDeviceFound?: (dev: DiscoveredDevice) => void) {
  stopMulticastListener();

  try {
    multicastSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    multicastSocket.on('error', (err) => {
      console.warn('UDP Multicast socket error:', err.message);
      stopMulticastListener();
    });

    multicastSocket.on('message', (msg, rinfo) => {
      try {
        const json = JSON.parse(msg.toString('utf8'));
        const alias = json.alias || rinfo.address;
        const fingerprint = json.fingerprint || '';
        const ownIdentity = resolveIdentity();

        if (fingerprint && fingerprint.toUpperCase() === ownIdentity.fingerprint.toUpperCase()) {
          return;
        }

        const dev: DiscoveredDevice = {
          id: `${rinfo.address}-${json.port || LOCALSEND_PORT}`,
          alias,
          ip: rinfo.address,
          port: json.port || LOCALSEND_PORT,
          deviceModel: json.deviceModel || json.deviceType || 'LocalSend Peer',
          deviceType:
            json.deviceType === 'mobile' ? 'mobile' : json.deviceType === 'server' ? 'server' : 'desktop',
          fingerprint,
          isOnline: true,
          lastSeen: Date.now(),
        };

        discoveredDevices.set(rinfo.address, dev);
        if (onDeviceFound) {
          onDeviceFound(dev);
        }
      } catch {}
    });

    multicastSocket.bind(LOCALSEND_PORT, () => {
      try {
        multicastSocket?.addMembership(MULTICAST_GROUP);

        // Send multicast discovery announcement so peers on LAN reply
        const identity = resolveIdentity();
        const announceMsg = Buffer.from(
          JSON.stringify({
            alias: os.hostname(),
            version: '2.1',
            deviceModel: 'Linux Desktop',
            deviceType: 'desktop',
            fingerprint: identity.fingerprint,
            port: LOCALSEND_PORT,
            protocol: 'https',
            download: true,
            announce: true,
          })
        );
        multicastSocket?.send(announceMsg, 0, announceMsg.length, LOCALSEND_PORT, MULTICAST_GROUP);
      } catch (err: any) {
        console.warn('Multicast membership error:', err.message);
      }
    });
  } catch (err: any) {
    console.warn('Could not bind UDP discovery socket:', err.message);
  }
}

// ==========================================
// REST API ROUTES
// ==========================================

// 1. System status & identity
app.get('/api/system/status', (_req: Request, res: Response) => {
  const cli = resolveCliPath();
  const identity = resolveIdentity();
  const localIps = getLocalIPv4Addresses();

  res.json({
    cliPath: cli.path,
    cliFound: cli.found,
    identityPath: identity.path,
    identityFound: identity.pem !== null,
    fingerprint: identity.fingerprint,
    hostname: os.hostname(),
    localAddresses: localIps,
    port: LOCALSEND_PORT,
  });
});

// 2. Discover devices (mTLS HTTPS + HTTP probe + UDP announce)
app.get('/api/discover/stream', async (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const identity = resolveIdentity();
  sendEvent('log', { message: '开始发现设备（组播监听 + 本网段扫描）…', level: 'info' });

  // Get local interfaces
  const localAddresses = getLocalIPv4Addresses();
  if (localAddresses.length === 0) {
    sendEvent('log', { message: '未找到可扫描的 IPv4 局域网地址，仅监听组播广播。', level: 'warn' });
    sendEvent('status', { status: 'completed', count: discoveredDevices.size });
    res.end();
    return;
  }

  // Calculate subnet IPs to probe
  const ipsToProbe: string[] = [];
  for (const iface of localAddresses) {
    const parts = iface.ip.split('.').map(Number);
    if (parts.length === 4) {
      const prefix = `${parts[0]}.${parts[1]}.${parts[2]}`;
      for (let host = 1; host <= 254; host++) {
        if (host !== parts[3]) {
          ipsToProbe.push(`${prefix}.${host}`);
        }
      }
    }
  }

  sendEvent('log', { message: `正在探测 ${ipsToProbe.length} 个局域网地址…`, level: 'info' });

  // Start multicast listener during discovery
  startMulticastListener((dev) => {
    sendEvent('device', dev);
    sendEvent('log', { message: `发现设备：${dev.alias} (${dev.ip})`, level: 'success' });
  });

  // HTTPS agent with mTLS client certificate and key (CRITICAL for LocalSend v2 handshake)
  const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
    cert: identity.pem || undefined,
    key: identity.pem || undefined,
    timeout: 1200,
    keepAlive: false,
  });

  const httpAgent = new http.Agent({
    timeout: 1000,
    keepAlive: false,
  });

  const probeIp = async (ip: string): Promise<void> => {
    return new Promise((resolve) => {
      // Step A: Try HTTPS mTLS
      const reqHttps = https.get(
        `https://${ip}:${LOCALSEND_PORT}/api/localsend/v2/info`,
        { agent: httpsAgent, timeout: 1200 },
        (response) => {
          let body = '';
          response.on('data', (chunk) => (body += chunk));
          response.on('end', () => {
            try {
              const info = JSON.parse(body);
              if (info.alias) {
                const dev: DiscoveredDevice = {
                  id: `${ip}-${LOCALSEND_PORT}`,
                  alias: info.alias,
                  ip,
                  port: LOCALSEND_PORT,
                  deviceModel: info.deviceModel || 'LocalSend Peer',
                  deviceType: info.deviceType || 'desktop',
                  fingerprint: info.fingerprint || '',
                  isOnline: true,
                  lastSeen: Date.now(),
                };
                discoveredDevices.set(ip, dev);
                sendEvent('device', dev);
                sendEvent('log', { message: `发现设备：${dev.alias} (${ip})`, level: 'success' });
                return resolve();
              }
            } catch {}
            resolve();
          });
        }
      );

      reqHttps.on('error', () => {
        // Step B: Fallback to plain HTTP if peer has encryption disabled
        const reqHttp = http.get(
          `http://${ip}:${LOCALSEND_PORT}/api/localsend/v2/info`,
          { agent: httpAgent, timeout: 1000 },
          (response) => {
            let body = '';
            response.on('data', (chunk) => (body += chunk));
            response.on('end', () => {
              try {
                const info = JSON.parse(body);
                if (info.alias) {
                  const dev: DiscoveredDevice = {
                    id: `${ip}-${LOCALSEND_PORT}`,
                    alias: info.alias,
                    ip,
                    port: LOCALSEND_PORT,
                    deviceModel: info.deviceModel || 'LocalSend Peer',
                    deviceType: info.deviceType || 'desktop',
                    fingerprint: info.fingerprint || '',
                    isOnline: true,
                    lastSeen: Date.now(),
                  };
                  discoveredDevices.set(ip, dev);
                  sendEvent('device', dev);
                  sendEvent('log', { message: `发现设备：${dev.alias} (${ip})`, level: 'success' });
                }
              } catch {}
              resolve();
            });
          }
        );
        reqHttp.on('error', () => resolve());
        reqHttp.on('timeout', () => {
          reqHttp.destroy();
          resolve();
        });
      });

      reqHttps.on('timeout', () => {
        reqHttps.destroy();
        resolve();
      });
    });
  };

  // Run probes concurrently
  const concurrency = 40;
  let activeIndex = 0;

  const runWorker = async () => {
    while (activeIndex < ipsToProbe.length) {
      const ip = ipsToProbe[activeIndex++];
      await probeIp(ip);
    }
  };

  const workers = Array.from({ length: concurrency }, () => runWorker());
  await Promise.all(workers);

  // Discovery window finish: release UDP port 53317 immediately
  stopMulticastListener();

  const foundCount = discoveredDevices.size;
  if (foundCount === 0) {
    sendEvent('log', {
      message: '本轮未发现设备。请确认对方已打开 LocalSend，或直接输入对方 IP。',
      level: 'warn',
    });
  } else {
    sendEvent('log', {
      message: `本轮扫描结束，共发现 ${foundCount} 台设备。`,
      level: 'success',
    });
  }

  sendEvent('status', {
    status: 'completed',
    count: foundCount,
    devices: Array.from(discoveredDevices.values()),
  });

  res.end();
});

// 3. Upload files for sending
app.post('/api/send/upload', upload.array('files'), (req: Request, res: Response) => {
  const files = (req.files as Express.Multer.File[]) || [];
  const fileInfos = files.map((f) => ({
    path: f.path,
    name: Buffer.from(f.originalname, 'latin1').toString('utf8'),
    size: f.size,
  }));
  res.json({ success: true, files: fileInfos });
});

// 4. Send files via localsend-cli
app.post('/api/send/start', (req: Request, res: Response) => {
  let { target, filePaths, customCliPath } = req.body;

  if (!target) {
    return res.status(400).json({ error: '缺少目标设备或 IP 地址' });
  }

  // Sanitize target IP if user typed a malformed IP with duplicate octet (e.g. 192.168.1.118.115 -> 192.168.118.115)
  target = target.trim();
  const octets = target.split('.');
  if (octets.length > 4) {
    // If user accidentally typed 192.168.1.118.115, auto-fix to 192.168.118.115
    if (octets[0] === '192' && octets[1] === '168' && octets.length === 5) {
      target = `${octets[0]}.${octets[1]}.${octets[3]}.${octets[4]}`;
    }
  }

  if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
    return res.status(400).json({ error: '没有提供要发送的文件路径' });
  }

  // CRITICAL: Release port 53317 before spawning localsend-cli
  stopMulticastListener();

  const cli = customCliPath ? { path: customCliPath, found: fs.existsSync(customCliPath) } : resolveCliPath();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent('log', {
    message: `开始发送：目标 ${target}，共 ${filePaths.length} 项。`,
    level: 'info',
  });

  if (!cli.found && !fs.existsSync(cli.path)) {
    sendEvent('log', {
      message: `未找到 localsend-cli 可执行文件（${cli.path}），无法启动底层发送进程。请在“设置”中配置正确的 CLI 路径。`,
      level: 'error',
    });
    sendEvent('status', { status: 'error', error: 'CLI binary not found' });
    res.end();
    return;
  }

  const args = ['send', '--to', target, ...filePaths];
  sendEvent('log', {
    message: `启动 CLI: ${cli.path} ${args.join(' ')}`,
    level: 'info',
  });

  try {
    activeSendProcess = spawn(cli.path, args, {
      cwd: os.homedir(),
      env: { ...process.env },
    });

    activeSendProcess.stdout?.on('data', (data) => {
      const text = data.toString('utf8');
      const lines = text.split(/\r?\n/).filter(Boolean);

      for (const line of lines) {
        if (line.includes('ETA:') || line.includes('/')) {
          sendEvent('progress', { rawLine: line });
        } else {
          sendEvent('log', { message: line, level: 'info' });
        }
      }
    });

    activeSendProcess.stderr?.on('data', (data) => {
      const line = data.toString('utf8').trim();
      if (line) {
        sendEvent('log', { message: line, level: 'warn' });
      }
    });

    activeSendProcess.on('close', (code) => {
      activeSendProcess = null;
      if (code === 0) {
        sendEvent('log', { message: '发送完成。', level: 'success' });
        sendEvent('status', { status: 'completed' });
      } else {
        sendEvent('log', {
          message: `发送进程结束（退出码 ${code}）。`,
          level: 'error',
        });
        sendEvent('status', { status: 'error', code });
      }
      res.end();
    });

    activeSendProcess.on('error', (err) => {
      activeSendProcess = null;
      sendEvent('log', {
        message: `无法启动 CLI 进程：${err.message}`,
        level: 'error',
      });
      sendEvent('status', { status: 'error', error: err.message });
      res.end();
    });
  } catch (err: any) {
    sendEvent('log', { message: `发送异常：${err.message}`, level: 'error' });
    sendEvent('status', { status: 'error', error: err.message });
    res.end();
  }
});

// 5. Cancel send process
app.post('/api/send/cancel', (_req: Request, res: Response) => {
  if (activeSendProcess) {
    try {
      activeSendProcess.kill('SIGTERM');
      setTimeout(() => {
        if (activeSendProcess) {
          activeSendProcess.kill('SIGKILL');
          activeSendProcess = null;
        }
      }, 1500);
      return res.json({ success: true, message: '已发送取消信号' });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
  res.json({ success: true, message: '没有正在执行的发送任务' });
});

// 6. Launch CLI Receive mode
app.post('/api/receive/start', (req: Request, res: Response) => {
  // CRITICAL: Release port 53317 before spawning receive
  stopMulticastListener();

  const { customCliPath } = req.body;
  const cli = customCliPath ? { path: customCliPath, found: fs.existsSync(customCliPath) } : resolveCliPath();

  if (!cli.found && !fs.existsSync(cli.path)) {
    return res.status(404).json({
      error: `未找到 localsend-cli 可执行文件（${cli.path}），请在设置中指定。`,
    });
  }

  const terminalCandidates = [
    { program: 'x-terminal-emulator', flag: '-e' },
    { program: 'mate-terminal', flag: '-x' },
    { program: 'ukui-terminal', flag: '-e' },
    { program: 'deepin-terminal', flag: '-e' },
    { program: 'qterminal', flag: '-e' },
    { program: 'konsole', flag: '-e' },
    { program: 'xfce4-terminal', flag: '-x' },
    { program: 'gnome-terminal', flag: '--' },
    { program: 'xterm', flag: '-e' },
  ];

  let terminalPath = '';
  let terminalFlag = '';

  for (const t of terminalCandidates) {
    try {
      const out = execSync(`which ${t.program} 2>/dev/null`, { encoding: 'utf8' }).trim();
      if (out && fs.existsSync(out)) {
        terminalPath = out;
        terminalFlag = t.flag;
        break;
      }
    } catch {}
  }

  if (terminalPath) {
    const cmd = `${cli.path}; code=$?; echo; echo "LocalSend CLI 已退出（退出码 $code）"; read -r -p "按回车键关闭窗口…" _`;
    try {
      const p = spawn(terminalPath, [terminalFlag, '/bin/bash', '-c', cmd], {
        detached: true,
        stdio: 'ignore',
      });
      p.unref();
      return res.json({
        success: true,
        mode: 'terminal',
        terminal: terminalPath,
        cliPath: cli.path,
        message: `已在系统终端中启动接收模式（CLI: ${cli.path}）。`,
      });
    } catch (err: any) {
      console.warn('Failed to spawn terminal, falling back to background spawn:', err.message);
    }
  }

  try {
    if (activeReceiveProcess) {
      activeReceiveProcess.kill();
    }
    activeReceiveProcess = spawn(cli.path, [], {
      cwd: downloadDir,
      detached: true,
    });

    res.json({
      success: true,
      mode: 'background',
      cliPath: cli.path,
      message: `已在后台启动接收模式（CLI: ${cli.path}），文件将保存至 ${downloadDir}`,
    });
  } catch (err: any) {
    res.status(500).json({ error: `无法启动接收进程: ${err.message}` });
  }
});

// ==========================================
// VITE DEV SERVER OR STATIC PROD SERVING
// ==========================================

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, host: '0.0.0.0', port: PORT },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    const ips = getLocalIPv4Addresses();
    console.log('\n=============================================================');
    console.log('  LocalSend GUI 服务已启动！');
    console.log('  ');
    console.log(`  本机访问地址:       http://localhost:${PORT}`);
    if (ips.length > 0) {
      ips.forEach((iface) => {
        console.log(`  同局域网访问地址:   http://${iface.ip}:${PORT}  (${iface.name})`);
      });
    }
    console.log('=============================================================\n');
  });
}

startServer();
