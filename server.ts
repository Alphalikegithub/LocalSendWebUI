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
let customDownloadDir = path.join(os.homedir(), 'Downloads', 'LocalSend');

function ensureDirectories() {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
  if (!fs.existsSync(customDownloadDir)) {
    try {
      fs.mkdirSync(customDownloadDir, { recursive: true });
    } catch {}
  }
}
ensureDirectories();

// Multer storage for files to send
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
let receiveAutoAccept = true;
let receiveStdoutBuffer = '';
const receiveSubscribers = new Set<(event: string, data: any) => void>();

const discoveredDevices = new Map<string, DiscoveredDevice>();
const knownIpsCache = new Set<string>(); // Cache for ultra-fast refreshes
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

// Release UDP socket on port 53317
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

// Force clean any zombie or stale process holding port 53317 on Linux
async function forceReleasePort53317(): Promise<void> {
  stopMulticastListener();

  if (activeReceiveProcess) {
    try {
      activeReceiveProcess.kill('SIGKILL');
    } catch {}
    activeReceiveProcess = null;
  }
  if (activeSendProcess) {
    try {
      activeSendProcess.kill('SIGKILL');
    } catch {}
    activeSendProcess = null;
  }

  // 1. Scan /proc for all localsend-cli or pty_runner processes and kill them directly
  try {
    if (fs.existsSync('/proc')) {
      const entries = fs.readdirSync('/proc');
      for (const entry of entries) {
        if (/^\d+$/.test(entry)) {
          const pid = parseInt(entry, 10);
          if (pid === process.pid) continue;
          try {
            const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
            if (cmdline.includes('localsend-cli') || cmdline.includes('pty_runner')) {
              try {
                process.kill(pid, 'SIGKILL');
              } catch {}
            }
          } catch {}
        }
      }
    }
  } catch {}

  // 2. Terminate all lingering processes via system fallbacks
  try {
    execSync('pkill -9 -f localsend-cli 2>/dev/null');
  } catch {}
  try {
    execSync('pkill -9 -f pty_runner 2>/dev/null');
  } catch {}

  // 3. Allow Linux network stack & socket TIME_WAIT state to clear completely
  await new Promise((resolve) => setTimeout(resolve, 350));
}

// Start temporary UDP listener during discovery
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
        knownIpsCache.add(rinfo.address);
        if (onDeviceFound) {
          onDeviceFound(dev);
        }
      } catch {}
    });

    multicastSocket.bind(LOCALSEND_PORT, () => {
      try {
        multicastSocket?.addMembership(MULTICAST_GROUP);

        // Send multicast announce packet
        const sendAnnounce = () => {
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
        };

        sendAnnounce();
        setTimeout(sendAnnounce, 250); // repeat once for Wi-Fi reliability
      } catch (err: any) {
        console.warn('Multicast membership error:', err.message);
      }
    });
  } catch (err: any) {
    console.warn('Could not bind UDP discovery socket:', err.message);
  }
}

// Broadcast helper for receive mode SSE subscribers
function broadcastReceive(event: string, data: any) {
  for (const subscriber of receiveSubscribers) {
    try {
      subscriber(event, data);
    } catch {}
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
    downloadDir: customDownloadDir,
    isReceiving: activeReceiveProcess !== null,
  });
});

// 2. Discover devices (High speed + mTLS client cert + UDP multicast)
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

  const localAddresses = getLocalIPv4Addresses();
  if (localAddresses.length === 0) {
    sendEvent('log', { message: '未找到可扫描的 IPv4 局域网地址，仅监听组播广播。', level: 'warn' });
    sendEvent('status', { status: 'completed', count: discoveredDevices.size });
    res.end();
    return;
  }

  // Calculate subnet IPs, prioritizing previously known cached IPs
  const ipsToProbeSet = new Set<string>();

  // Add cached IPs first so they are checked immediately
  for (const cachedIp of knownIpsCache) {
    ipsToProbeSet.add(cachedIp);
  }

  for (const iface of localAddresses) {
    const parts = iface.ip.split('.').map(Number);
    if (parts.length === 4) {
      const prefix = `${parts[0]}.${parts[1]}.${parts[2]}`;
      for (let host = 1; host <= 254; host++) {
        if (host !== parts[3]) {
          ipsToProbeSet.add(`${prefix}.${host}`);
        }
      }
    }
  }

  const ipsToProbe = Array.from(ipsToProbeSet);
  sendEvent('log', { message: `正在探测 ${ipsToProbe.length} 个局域网地址…`, level: 'info' });

  // Start temporary UDP listener
  startMulticastListener((dev) => {
    sendEvent('device', dev);
    sendEvent('log', { message: `发现设备：${dev.alias} (${dev.ip})`, level: 'success' });
  });

  // HTTPS agent with mTLS client certificate and key (strictly required by LocalSend v2)
  const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
    cert: identity.pem || undefined,
    key: identity.pem || undefined,
    timeout: 500, // Reduced from 1200ms to 500ms for fast LAN scanning
    keepAlive: false,
  });

  const httpAgent = new http.Agent({
    timeout: 400,
    keepAlive: false,
  });

  const probeIp = async (ip: string): Promise<void> => {
    return new Promise((resolve) => {
      // Step A: HTTPS with mTLS
      const reqHttps = https.get(
        `https://${ip}:${LOCALSEND_PORT}/api/localsend/v2/info`,
        { agent: httpsAgent, timeout: 500 },
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
                knownIpsCache.add(ip);
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
        // Step B: HTTP fallback
        const reqHttp = http.get(
          `http://${ip}:${LOCALSEND_PORT}/api/localsend/v2/info`,
          { agent: httpAgent, timeout: 400 },
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
                  knownIpsCache.add(ip);
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

  // Increased concurrency to 80 for rapid execution
  const concurrency = 80;
  let activeIndex = 0;

  const runWorker = async () => {
    while (activeIndex < ipsToProbe.length) {
      const ip = ipsToProbe[activeIndex++];
      await probeIp(ip);
    }
  };

  const workers = Array.from({ length: concurrency }, () => runWorker());
  await Promise.all(workers);

  // Close UDP port 53317 immediately so send/receive won't collide
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
app.post('/api/send/start', async (req: Request, res: Response) => {
  let { target, filePaths, customCliPath } = req.body;

  if (!target) {
    return res.status(400).json({ error: '缺少目标设备或 IP 地址' });
  }

  // Auto-clean malformed 5-segment IPs (e.g., 192.168.1.118.115 -> 192.168.118.115)
  target = target.trim();
  const octets = target.split('.');
  if (octets.length === 5 && octets[0] === '192' && octets[1] === '168') {
    target = `192.168.${octets[3]}.${octets[4]}`;
  }

  if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
    return res.status(400).json({ error: '没有提供要发送的文件路径' });
  }

  // Force clean port 53317 to ensure localsend-cli won't collide with previous processes
  await forceReleasePort53317();

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
      message: `未找到 localsend-cli 可执行文件（${cli.path}），无法启动底层发送进程。`,
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

// 6. Seamless Background Receive Mode (using PTY runner for Rust TTY terminal mode)
app.post('/api/receive/start', async (req: Request, res: Response) => {
  const { customCliPath, autoAccept, saveDir } = req.body;
  if (saveDir) {
    customDownloadDir = saveDir;
    ensureDirectories();
  }
  if (typeof autoAccept === 'boolean') {
    receiveAutoAccept = autoAccept;
  }

  // If already running and healthy, avoid spawning a duplicate process that causes port 53317 collision
  if (activeReceiveProcess && !activeReceiveProcess.killed) {
    return res.json({
      success: true,
      downloadDir: customDownloadDir,
      autoAccept: receiveAutoAccept,
      message: `接收模式正在运行中（端口 53317 监听就绪），保存至: ${customDownloadDir}`,
    });
  }

  await forceReleasePort53317();

  const cli = customCliPath ? { path: customCliPath, found: fs.existsSync(customCliPath) } : resolveCliPath();

  if (!cli.found && !fs.existsSync(cli.path)) {
    return res.status(404).json({
      error: `未找到 localsend-cli 可执行文件（${cli.path}），请在设置中指定。`,
    });
  }

  try {
    receiveStdoutBuffer = '';

    // If pty_runner.py is available on Linux, launch through genuine PTY so Rust crossterm/inquire accepts input!
    const ptyRunner = path.join(__dirname, 'pty_runner.py');
    let spawnCmd = cli.path;
    let spawnArgs: string[] = [];

    if (fs.existsSync(ptyRunner) && process.platform !== 'win32') {
      spawnCmd = 'python3';
      spawnArgs = [ptyRunner, cli.path];
    }

    activeReceiveProcess = spawn(spawnCmd, spawnArgs, {
      cwd: customDownloadDir,
      env: { ...process.env, TERM: 'xterm-256color', PYTHONUNBUFFERED: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    activeReceiveProcess.stdout?.on('data', (data) => {
      const text = data.toString('utf8');
      receiveStdoutBuffer += text;

      // Broadcast raw log lines to UI (stripping ANSI escapes for clean log view)
      // Split on BOTH \r and \n so progress carriage returns don't get swallowed!
      const cleanText = text.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '');
      const lines = cleanText.split(/[\r\n]+/).filter(Boolean);

      for (const line of lines) {
        // Detect progress bar output (indicatif / carriage return progress)
        // e.g. "Screenshot.jpg [====>   ] 340 KB / 698.9 KB (48%)  ETA 00:02"
        const percentMatch = line.match(/([0-9]{1,3})%/);
        const bytesMatch = line.match(/([0-9.]+)\s*(B|KB|MB|GB|TB)\s*\/\s*([0-9.]+)\s*(B|KB|MB|GB|TB)/i);

        if (percentMatch || bytesMatch) {
          const percent = percentMatch ? parseInt(percentMatch[1], 10) : undefined;
          broadcastReceive('progress', {
            rawLine: line,
            percent,
            downloadDir: customDownloadDir,
          });
        }

        broadcastReceive('log', { message: line, level: 'info' });
      }

      // Check for IPv6 link-local connection abort
      if (text.includes('os error 103') || text.includes('RsHttpClientError')) {
        broadcastReceive('log', {
          message: '【传输诊断提示】收到来自对端的连接中断 (os error 103)。这通常是因为发送端手机默认尝试了不可路由的 IPv6 地址。手机端无需特殊配置，只需在手机 LocalSend 的【发送】页点击【手动输入 / 添加 IP】，直接输入本机的 IPv4 地址即可秒连直达！',
          level: 'warn',
        });
      }

      // Check if CLI is prompting: "Accept? Y/N/P"
      const cleanAll = receiveStdoutBuffer.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '');
      if (cleanAll.includes('Accept? Y/N/P') || cleanAll.includes('Accept?')) {
        // Parse sender & file info
        const senderMatch = cleanAll.match(/R\s+([^\r\n]+)/);
        const filesMatch = cleanAll.match(/Files\s*\(([0-9]+)[^:]*\):/i);
        const senderName = senderMatch ? senderMatch[1].trim() : '局域网设备';
        const fileCount = filesMatch ? parseInt(filesMatch[1], 10) : 1;

        // Parse individual file names
        const fileList: { name: string; size: number }[] = [];
        const linesBuf = cleanAll.split(/[\r\n]+/);
        let inFilesSection = false;
        for (const line of linesBuf) {
          if (line.includes('Files (')) {
            inFilesSection = true;
            continue;
          }
          if (inFilesSection && line.includes('Accept?')) {
            break;
          }
          if (inFilesSection && line.trim()) {
            const trimmed = line.trim();
            fileList.push({ name: trimmed, size: 0 });
          }
        }

        const promptData = {
          id: `prompt-${Date.now()}`,
          sender: senderName,
          fileCount,
          files: fileList.length > 0 ? fileList : [{ name: `文件 (${fileCount} 项)`, size: 0 }],
          rawText: cleanAll,
          downloadDir: customDownloadDir,
        };

        if (receiveAutoAccept) {
          // Auto-accept: send 'p\r\n' (pair & accept) cleanly to PTY
          try {
            activeReceiveProcess?.stdin?.write('p\r\n');
          } catch (err: any) {
            console.error('Failed to write accept to stdin:', err);
          }

          broadcastReceive('log', {
            message: `【自动接收已触发】已自动向终端发送接受确认 (P) 并信任来自 ${senderName} 的传输请求。`,
            level: 'success',
          });
        } else {
          // Push popup prompt event to UI
          broadcastReceive('prompt', promptData);
        }

        receiveStdoutBuffer = '';
      }

      // Check for completed file transfer
      if (text.includes('You accepted') || text.includes('Completed') || text.includes('100%')) {
        broadcastReceive('completed', { downloadDir: customDownloadDir });
      }
    });

    activeReceiveProcess.stderr?.on('data', (data) => {
      const errLine = data.toString('utf8').trim();
      if (errLine) {
        broadcastReceive('log', { message: errLine, level: 'warn' });
      }
    });

    activeReceiveProcess.on('close', (code) => {
      activeReceiveProcess = null;
      broadcastReceive('log', {
        message: `接收服务已停止（退出码 ${code}）。`,
        level: code === 0 ? 'info' : 'warn',
      });
      broadcastReceive('status', { running: false });
    });

    res.json({
      success: true,
      downloadDir: customDownloadDir,
      autoAccept: receiveAutoAccept,
      message: `接收模式已无缝启动！接收文件将直接保存至: ${customDownloadDir}`,
    });
  } catch (err: any) {
    res.status(500).json({ error: `无法启动接收进程: ${err.message}` });
  }
});

// 7. User responds to incoming transfer prompt right in the web UI
app.post('/api/receive/respond', (req: Request, res: Response) => {
  const { action } = req.body; // 'p' (accept & pair), 'y' (accept once), 'n' (decline)
  if (!activeReceiveProcess || !activeReceiveProcess.stdin) {
    return res.status(400).json({ error: '当前没有正在运行的接收进程' });
  }

  const choice = (action || 'p').toLowerCase();
  try {
    activeReceiveProcess.stdin.write(`${choice}\r\n`);
  } catch (err: any) {
    console.error('Error writing to stdin:', err);
  }

  broadcastReceive('log', {
    message:
      choice === 'p'
        ? '已接受并永久配对信任该设备 (P)。'
        : choice === 'y'
        ? '已确认接受本次文件传输 (Y)。'
        : '已拒绝文件传输请求 (N)。',
    level: choice === 'n' ? 'warn' : 'success',
  });

  res.json({ success: true, action: choice });
});

// 7b. Launch in system desktop terminal (Optional alternative)
app.post('/api/system/terminal-receive', async (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  await forceReleasePort53317();
  const cli = resolveCliPath();
  ensureDirectories();

  const fallbackCmd = `cd "${customDownloadDir}" && "${cli.path}"`;

  const terminals = [
    { bin: 'x-terminal-emulator', args: ['-e', `${cli.path}`] },
    { bin: 'gnome-terminal', args: ['--', `${cli.path}`] },
    { bin: 'mate-terminal', args: ['-x', `${cli.path}`] },
    { bin: 'konsole', args: ['-e', `${cli.path}`] },
    { bin: 'xfce4-terminal', args: ['-x', `${cli.path}`] },
    { bin: 'deepin-terminal', args: ['-e', `${cli.path}`] },
    { bin: 'qterminal', args: ['-e', `${cli.path}`] },
    { bin: 'xterm', args: ['-e', `${cli.path}`] },
  ];

  for (const term of terminals) {
    try {
      const which = execSync(`which ${term.bin} 2>/dev/null`, { encoding: 'utf8' }).trim();
      if (which) {
        spawn(term.bin, term.args, {
          cwd: customDownloadDir,
          detached: true,
          stdio: 'ignore',
        });
        return res.json({
          success: true,
          hasGuiTerminal: true,
          terminal: term.bin,
          downloadDir: customDownloadDir,
          message: `已在系统终端 [${term.bin}] 中成功启动 LocalSend CLI。`,
        });
      }
    } catch {}
  }

  // Return status 200 with JSON payload so frontend JSON parsing NEVER crashes
  res.json({
    success: false,
    hasGuiTerminal: false,
    downloadDir: customDownloadDir,
    command: fallbackCmd,
    error: '系统当前未检测到图形终端模拟器（如 gnome-terminal / xterm 等）。您可在系统终端中手动执行下方命令直接运行接收模式。',
  });
});

// 8. Stop receiving
app.post('/api/receive/stop', (_req: Request, res: Response) => {
  if (activeReceiveProcess) {
    try {
      activeReceiveProcess.kill('SIGTERM');
    } catch {}
    activeReceiveProcess = null;
  }
  res.json({ success: true, message: '接收服务已停止' });
});

// 9. SSE stream for receive logs and prompts
app.get('/api/receive/stream', (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const subscriber = (event: string, data: any) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  receiveSubscribers.add(subscriber);

  // Initial status
  subscriber('status', {
    running: activeReceiveProcess !== null,
    downloadDir: customDownloadDir,
    autoAccept: receiveAutoAccept,
  });

  req.on('close', () => {
    receiveSubscribers.delete(subscriber);
  });
});

// 10. List downloaded files
app.get('/api/receive/files', (_req: Request, res: Response) => {
  ensureDirectories();
  try {
    const list = fs.readdirSync(customDownloadDir).filter((f) => !f.startsWith('.'));
    const files = list.map((f) => {
      const fullPath = path.join(customDownloadDir, f);
      const stat = fs.statSync(fullPath);
      return {
        name: f,
        size: stat.size,
        isDir: stat.isDirectory(),
        mtime: stat.mtimeMs,
        path: fullPath,
      };
    });
    files.sort((a, b) => b.mtime - a.mtime);
    res.json({ downloadDir: customDownloadDir, files });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 11. Open download directory in system file manager (xdg-open / explorer / open)
app.post('/api/open-folder', (req: Request, res: Response) => {
  ensureDirectories();
  const dirToOpen = req.body.dir || customDownloadDir;

  try {
    if (process.platform === 'win32') {
      spawn('explorer', [dirToOpen], { detached: true, stdio: 'ignore' });
    } else if (process.platform === 'darwin') {
      spawn('open', [dirToOpen], { detached: true, stdio: 'ignore' });
    } else {
      spawn('xdg-open', [dirToOpen], { detached: true, stdio: 'ignore' });
    }
    res.json({ success: true, opened: dirToOpen });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 12. Direct browser download of any received file
app.get('/api/download-file/:filename', (req: Request, res: Response) => {
  const filename = req.params.filename;
  const filePath = path.join(customDownloadDir, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '文件不存在' });
  }

  res.download(filePath, filename);
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
    console.log(`  接收文件保存目录:   ${customDownloadDir}`);
    console.log('=============================================================\n');
  });
}

startServer();
