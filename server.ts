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
    // Preserve original filename
    const safeName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    cb(null, `${Date.now()}-${safeName}`);
  },
});
const upload = multer({ storage });

// Active state
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
      } catch {
        // not executable
      }
    }
  }

  // Try `which localsend-cli`
  try {
    const whichOutput = execSync('which localsend-cli 2>/dev/null', { encoding: 'utf8' }).trim();
    if (whichOutput && fs.existsSync(whichOutput)) {
      return { path: whichOutput, found: true };
    }
  } catch {
    // not in PATH
  }

  return {
    path: candidates[0], // default path fallback
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
        // Extract certificate and compute SHA256 fingerprint
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

  // Fallback fingerprint
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

// Multicast discovery setup
function startMulticastListener(onDeviceFound?: (dev: DiscoveredDevice) => void) {
  if (multicastSocket) {
    try {
      multicastSocket.close();
    } catch {}
    multicastSocket = null;
  }

  try {
    multicastSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    multicastSocket.on('error', (err) => {
      console.warn('UDP Multicast socket error:', err.message);
    });

    multicastSocket.on('message', (msg, rinfo) => {
      try {
        const json = JSON.parse(msg.toString('utf8'));
        const alias = json.alias || rinfo.address;
        const fingerprint = json.fingerprint || '';
        const ownIdentity = resolveIdentity();

        if (fingerprint && fingerprint.toUpperCase() === ownIdentity.fingerprint.toUpperCase()) {
          // Own packet
          return;
        }

        const dev: DiscoveredDevice = {
          id: `${rinfo.address}-${json.port || LOCALSEND_PORT}`,
          alias,
          ip: rinfo.address,
          port: json.port || LOCALSEND_PORT,
          deviceModel: json.deviceModel || json.deviceType || 'LocalSend Peer',
          deviceType: json.deviceType === 'mobile' ? 'mobile' : json.deviceType === 'server' ? 'server' : 'desktop',
          fingerprint,
          isOnline: true,
          lastSeen: Date.now(),
        };

        discoveredDevices.set(rinfo.address, dev);
        if (onDeviceFound) {
          onDeviceFound(dev);
        }
      } catch {
        // Not a JSON packet or incompatible
      }
    });

    multicastSocket.bind(LOCALSEND_PORT, () => {
      try {
        multicastSocket?.addMembership(MULTICAST_GROUP);
      } catch (err: any) {
        console.warn('Failed to add multicast group membership:', err.message);
      }
    });
  } catch (err: any) {
    console.warn('Could not bind UDP discovery socket:', err.message);
  }
}

// Start multicast listener initially
startMulticastListener();

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

// 2. Discover devices (real UDP listener + subnet probe)
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

  // Reset or keep discovered devices
  startMulticastListener((dev) => {
    sendEvent('device', dev);
    sendEvent('log', { message: `发现设备：${dev.alias} (${dev.ip})`, level: 'success' });
  });

  // Concurrent HTTPS/HTTP Probing
  const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
    timeout: 900,
  });

  let completedProbes = 0;
  const concurrency = 40;
  let activeIndex = 0;

  const probeIp = async (ip: string): Promise<void> => {
    return new Promise((resolve) => {
      const reqProbe = https.get(
        `https://${ip}:${LOCALSEND_PORT}/api/localsend/v2/info`,
        { agent: httpsAgent, timeout: 900 },
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

      reqProbe.on('error', () => resolve());
      reqProbe.on('timeout', () => {
        reqProbe.destroy();
        resolve();
      });
    });
  };

  const runWorker = async () => {
    while (activeIndex < ipsToProbe.length) {
      const ip = ipsToProbe[activeIndex++];
      await probeIp(ip);
      completedProbes++;
    }
  };

  const workers = Array.from({ length: concurrency }, () => runWorker());
  await Promise.all(workers);

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
  const { target, filePaths, customCliPath } = req.body;

  if (!target) {
    return res.status(400).json({ error: '缺少目标设备或 IP 地址' });
  }
  if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
    return res.status(400).json({ error: '没有提供要发送的文件路径' });
  }

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

  // Verify CLI binary existence
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
        // Parse ETA or progress
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

// 6. Launch CLI Receive mode in system terminal or background
app.post('/api/receive/start', (req: Request, res: Response) => {
  const { customCliPath } = req.body;
  const cli = customCliPath ? { path: customCliPath, found: fs.existsSync(customCliPath) } : resolveCliPath();

  if (!cli.found && !fs.existsSync(cli.path)) {
    return res.status(404).json({
      error: `未找到 localsend-cli 可执行文件（${cli.path}），请在设置中指定。`,
    });
  }

  // Check available terminal programs on Linux
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

  // Fallback: spawn directly as background process
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

// 7. LocalSend v2 HTTP protocol endpoints (enabling direct peer uploads to this app)
app.get('/api/localsend/v2/info', (_req: Request, res: Response) => {
  const identity = resolveIdentity();
  res.json({
    alias: os.hostname(),
    version: '2.1',
    deviceModel: 'LocalSend GUI Web Server',
    deviceType: 'desktop',
    fingerprint: identity.fingerprint,
    download: true,
  });
});

app.post('/api/localsend/v2/prepare-upload', (req: Request, res: Response) => {
  const sessionId = crypto.randomUUID();
  const info = req.body.info;
  const files = req.body.files;

  console.log(`[LocalSend Protocol] Incoming upload session ${sessionId} from ${info?.alias || 'peer'}`);
  res.json({
    sessionId,
    files: files ? Object.keys(files).reduce((acc: any, key) => ({ ...acc, [key]: key }), {}) : {},
  });
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
    console.log(`[LocalSend GUI] Running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
