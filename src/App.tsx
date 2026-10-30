import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { DevicePanel } from './components/DevicePanel';
import { FilePanel } from './components/FilePanel';
import { LogPanel } from './components/LogPanel';
import { BottomBar } from './components/BottomBar';
import { SettingsModal } from './components/SettingsModal';
import { ReceiveModal } from './components/ReceiveModal';
import { HistoryDrawer } from './components/HistoryDrawer';
import {
  Device,
  TransferFile,
  TransferProgress,
  LogEntry,
  AppSettings,
  ReceivedTransfer,
} from './types';
import { getCurrentTimestamp, generateFingerprint, formatBytes } from './utils/format';

const INITIAL_DEVICES: Device[] = [
  {
    id: 'dev-1',
    alias: 'Pixel 8 Pro',
    ip: '192.168.1.105',
    port: 53317,
    deviceModel: 'Google Pixel 8 Pro',
    deviceType: 'mobile',
    fingerprint: '3F88B042C7E542981FA79BD38221AC04A9B844E201B4B6C9086381',
    isOnline: true,
    lastSeen: Date.now(),
  },
  {
    id: 'dev-2',
    alias: 'MacBook-Air-M2',
    ip: '192.168.1.144',
    port: 53317,
    deviceModel: 'Apple MacBook Air',
    deviceType: 'desktop',
    fingerprint: '7A12DF94B80231920847CFB10283A49B88019C842B108942A87B41',
    isOnline: true,
    lastSeen: Date.now(),
  },
  {
    id: 'dev-3',
    alias: 'Ubuntu-Workstation',
    ip: '192.168.1.189',
    port: 53317,
    deviceModel: 'Linux x86_64',
    deviceType: 'server',
    fingerprint: 'E490918C44023791B7489A120389BB72948AC482910793108B7342',
    isOnline: true,
    lastSeen: Date.now(),
  },
];

export function App() {
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('localsend_settings');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // use default
      }
    }
    return {
      deviceAlias: 'LocalSend-Web-Client',
      port: 53317,
      multicastGroup: '224.0.0.167',
      fingerprint: generateFingerprint(),
      autoSaveToDownloads: true,
      cliPath: '/usr/local/bin/localsend-cli',
    };
  });

  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<string>(() => {
    return localStorage.getItem('localsend_lastTarget') || '';
  });

  const [files, setFiles] = useState<TransferFile[]>([
    {
      id: 'demo-file-1',
      name: 'Project_Design_Mockups.zip',
      size: 48920140, // ~46.6 MB
      type: 'application/zip',
      isDir: false,
    },
    {
      id: 'demo-file-2',
      name: 'Meeting_Notes_2026.pdf',
      size: 2841020, // ~2.7 MB
      type: 'application/pdf',
      isDir: false,
    },
  ]);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanStatusText, setScanStatusText] = useState('尚未扫描');

  const [progress, setProgress] = useState<TransferProgress>({
    status: 'idle',
    currentFileIndex: 0,
    totalFiles: 0,
    bytesTransferred: 0,
    totalBytes: 0,
    speedBytesPerSec: 0,
    etaSeconds: 0,
  });

  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);

  const [pendingTransfers, setPendingTransfers] = useState<ReceivedTransfer[]>([]);
  const [transferHistory, setTransferHistory] = useState<ReceivedTransfer[]>([
    {
      id: 'hist-1',
      senderAlias: 'MacBook-Air-M2',
      senderIp: '192.168.1.144',
      timestamp: '09:12:45',
      files: [
        {
          name: 'Architecture_Blueprint.png',
          size: 4182900,
          type: 'image/png',
        },
      ],
      totalSize: 4182900,
      status: 'completed',
    },
  ]);

  const transferIntervalRef = useRef<number | null>(null);

  // Sync dark mode class with root html
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  // Append a log entry
  const appendLog = (message: string, level: LogEntry['level'] = 'info') => {
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: getCurrentTimestamp(),
      message,
      level,
    };
    setLogs((prev) => [...prev.slice(-300), entry]);
  };

  // Initial startup logs & auto-discovery (mirrors Qt constructor)
  useEffect(() => {
    appendLog('LocalSend GUI 已启动。');
    appendLog(`使用 CLI：${settings.cliPath}`);
    appendLog(`已加载 TLS 身份：~/.config/localsend-cli/identity.pem（指纹 ${settings.fingerprint.slice(0, 24)}...）`);

    // Let the window appear first, then scan local network (matching Qt singleShot 400ms)
    const timer = setTimeout(() => {
      refreshDevices();
    }, 400);

    return () => clearTimeout(timer);
  }, []);

  // Save settings on update
  const handleSaveSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    localStorage.setItem('localsend_settings', JSON.stringify(newSettings));
    appendLog(`已更新网络与身份设置：别名 "${newSettings.deviceAlias}"，端口 ${newSettings.port}`);
  };

  // Save last target
  const handleSelectTarget = (target: string) => {
    setSelectedTarget(target);
    localStorage.setItem('localsend_lastTarget', target);
  };

  // Device discovery routine (matching Qt startDiscovery / probeHost)
  const refreshDevices = () => {
    if (progress.status === 'transferring' || progress.status === 'connecting') {
      appendLog('发送过程中不能刷新设备。', 'warn');
      return;
    }

    setIsScanning(true);
    setScanStatusText('正在扫描局域网…');
    appendLog('开始发现设备（组播监听 + 本网段扫描）…');
    appendLog(`已绑定 UDP 端口 ${settings.port} 并加入组播组 ${settings.multicastGroup}`);
    appendLog('正在探测局域网地址 (192.168.1.1 ~ 192.168.1.254)…');

    // Simulate probing network
    setTimeout(() => {
      setDevices(INITIAL_DEVICES);
      setIsScanning(false);
      setScanStatusText(`发现 ${INITIAL_DEVICES.length} 台设备`);
      INITIAL_DEVICES.forEach((d) => {
        appendLog(`发现设备：${d.alias} (${d.ip})`, 'success');
      });
      appendLog(`本轮扫描结束，共发现 ${INITIAL_DEVICES.length} 台设备。`);
    }, 1200);
  };

  const handleAddCustomDevice = (alias: string, ip: string) => {
    const newDev: Device = {
      id: `custom-${Date.now()}`,
      alias,
      ip,
      port: 53317,
      deviceType: 'desktop',
      fingerprint: generateFingerprint(),
      isOnline: true,
      lastSeen: Date.now(),
    };
    setDevices((prev) => [...prev, newDev]);
    setSelectedTarget(ip);
    appendLog(`已手动添加局域网设备：${alias} (${ip})`, 'success');
  };

  // File management
  const handleAddFiles = (newFiles: TransferFile[]) => {
    setFiles((prev) => {
      const existingNames = new Set(prev.map((f) => f.name));
      const filtered = newFiles.filter((f) => !existingNames.has(f.name));
      if (filtered.length < newFiles.length) {
        appendLog(`已跳过 ${newFiles.length - filtered.length} 个重名项。`, 'warn');
      }
      if (filtered.length > 0) {
        appendLog(`已添加 ${filtered.length} 个文件/目录。`);
      }
      return [...prev, ...filtered];
    });
  };

  const handleRemoveSelected = (ids: string[]) => {
    setFiles((prev) => prev.filter((f) => !ids.includes(f.id)));
    appendLog(`已移除 ${ids.length} 个项目。`);
  };

  const handleClearFiles = () => {
    if (files.length === 0) return;
    setFiles([]);
    appendLog('已清空待发送列表。');
  };

  // Start File Transmission (matches sendSelectedFiles in Qt)
  const handleSend = () => {
    if (!selectedTarget.trim()) {
      appendLog('缺少目标设备：请先选择设备或手动输入设备名/IP 地址。', 'warn');
      return;
    }
    if (files.length === 0) {
      appendLog('没有文件：请先添加要发送的文件或目录。', 'warn');
      return;
    }

    const totalBytes = files.reduce((acc, f) => acc + f.size, 0);
    appendLog(`开始发送：目标 ${selectedTarget}，共 ${files.length} 项（合计 ${formatBytes(totalBytes)}）。`);

    setProgress({
      status: 'connecting',
      currentFileIndex: 0,
      totalFiles: files.length,
      bytesTransferred: 0,
      totalBytes,
      speedBytesPerSec: 0,
      etaSeconds: 0,
    });

    // Simulate TLS handshake and start sending
    setTimeout(() => {
      appendLog(`已建立与 ${selectedTarget}:${settings.port} 的 mTLS 加密隧道。`);
      appendLog('对方已接受传输请求，正在流式传输数据块…');

      const chunkSize = Math.max(1024 * 512, Math.round(totalBytes / 20)); // ~20 chunks
      let transferred = 0;
      const speed = 18.5 * 1024 * 1024; // ~18.5 MB/s

      setProgress({
        status: 'transferring',
        currentFileIndex: 1,
        totalFiles: files.length,
        bytesTransferred: 0,
        totalBytes,
        speedBytesPerSec: speed,
        etaSeconds: Math.ceil(totalBytes / speed),
      });

      transferIntervalRef.current = window.setInterval(() => {
        transferred += chunkSize;
        if (transferred >= totalBytes) {
          transferred = totalBytes;
          if (transferIntervalRef.current) {
            clearInterval(transferIntervalRef.current);
            transferIntervalRef.current = null;
          }

          setProgress({
            status: 'completed',
            currentFileIndex: files.length,
            totalFiles: files.length,
            bytesTransferred: totalBytes,
            totalBytes,
            speedBytesPerSec: 0,
            etaSeconds: 0,
          });

          appendLog('发送完成。100% 数据校验通过。', 'success');
          appendLog('传输任务已结束；点击“刷新设备”可重新扫描。');

          // Record sent transfer to history
          setTransferHistory((prev) => [
            {
              id: `sent-${Date.now()}`,
              senderAlias: `发送至: ${selectedTarget}`,
              senderIp: selectedTarget,
              timestamp: getCurrentTimestamp(),
              files: files.map((f) => ({
                name: f.name,
                size: f.size,
                type: f.type,
              })),
              totalSize: totalBytes,
              status: 'completed',
            },
            ...prev,
          ]);
        } else {
          const remainingBytes = totalBytes - transferred;
          const eta = Math.max(1, Math.ceil(remainingBytes / speed));
          setProgress((prev) => ({
            ...prev,
            status: 'transferring',
            bytesTransferred: transferred,
            etaSeconds: eta,
          }));
        }
      }, 150);
    }, 800);
  };

  // Cancel Transmission (matches cancelSend in Qt)
  const handleCancelSend = () => {
    if (transferIntervalRef.current) {
      clearInterval(transferIntervalRef.current);
      transferIntervalRef.current = null;
    }
    setProgress((prev) => ({
      ...prev,
      status: 'cancelled',
      speedBytesPerSec: 0,
      etaSeconds: 0,
    }));
    appendLog('发送已取消。用户终止了传输进程。', 'warn');
  };

  // Receive mode
  const handleOpenReceive = () => {
    setShowReceiveModal(true);
    appendLog(`接收模式已启动。正在监听端口 ${settings.port}…`);
  };

  // Simulate an incoming transfer request for testing
  const handleSimulateIncoming = () => {
    const dummyReq: ReceivedTransfer = {
      id: `incoming-${Date.now()}`,
      senderAlias: 'iPhone 15 Pro',
      senderIp: '192.168.1.112',
      timestamp: getCurrentTimestamp(),
      files: [
        {
          name: 'IMG_4092_RAW.HEIC',
          size: 14829340,
          type: 'image/heic',
        },
        {
          name: 'Travel_Video_4K.mp4',
          size: 58291040,
          type: 'video/mp4',
        },
      ],
      totalSize: 73120380,
      status: 'pending',
    };

    setPendingTransfers((prev) => [dummyReq, ...prev]);
    setShowReceiveModal(true);
    appendLog(`收到来自 iPhone 15 Pro (192.168.1.112) 的文件传输请求（共 2 个文件，合计 ${formatBytes(dummyReq.totalSize)}）。`, 'warn');
  };

  const handleAcceptTransfer = (id: string) => {
    const req = pendingTransfers.find((t) => t.id === id);
    if (!req) return;

    setPendingTransfers((prev) => prev.filter((t) => t.id !== id));
    setTransferHistory((prev) => [
      {
        ...req,
        status: 'completed',
      },
      ...prev,
    ]);

    appendLog(`已接受并成功接收来自 ${req.senderAlias} 的 ${req.files.length} 个文件！`, 'success');
  };

  const handleDeclineTransfer = (id: string) => {
    const req = pendingTransfers.find((t) => t.id === id);
    setPendingTransfers((prev) => prev.filter((t) => t.id !== id));
    if (req) {
      appendLog(`已拒绝来自 ${req.senderAlias} (${req.senderIp}) 的传输请求。`, 'warn');
    }
  };

  const isBusy = progress.status === 'connecting' || progress.status === 'transferring';
  const canSend = Boolean(selectedTarget.trim()) && files.length > 0;

  return (
    <div className="min-h-screen flex flex-col bg-slate-100 dark:bg-slate-900 text-slate-800 dark:text-slate-100 font-sans">
      {/* App Header */}
      <Header
        settings={settings}
        onOpenSettings={() => setShowSettingsModal(true)}
        onOpenHistory={() => setShowHistoryDrawer(true)}
        receivedCount={transferHistory.length}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode(!darkMode)}
      />

      {/* Main Workspace Layout */}
      <main className="flex-1 p-3 md:p-4 flex flex-col gap-3 max-w-7xl w-full mx-auto overflow-hidden">
        {/* Top Splitter: Devices (left) & Pending Files (right) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 min-h-[300px]">
          {/* Left: Target Devices (320px equivalent / 4 cols) */}
          <div className="lg:col-span-4 h-full">
            <DevicePanel
              devices={devices}
              selectedTarget={selectedTarget}
              onSelectTarget={handleSelectTarget}
              isScanning={isScanning}
              scanStatusText={scanStatusText}
              onRefresh={refreshDevices}
              onAddCustomDevice={handleAddCustomDevice}
              disabled={isBusy}
            />
          </div>

          {/* Right: Files to send (680px equivalent / 8 cols) */}
          <div className="lg:col-span-8 h-full">
            <FilePanel
              files={files}
              onAddFiles={handleAddFiles}
              onRemoveSelected={handleRemoveSelected}
              onClearFiles={handleClearFiles}
              disabled={isBusy}
            />
          </div>
        </div>

        {/* Middle Section: Real-time Terminal Log Console */}
        <div className="flex-1 min-h-[160px] max-h-[320px]">
          <LogPanel logs={logs} onClearLogs={() => setLogs([])} />
        </div>
      </main>

      {/* Bottom Action and Progress Bar */}
      <BottomBar
        progress={progress}
        onSend={handleSend}
        onReceive={handleOpenReceive}
        onCancel={handleCancelSend}
        onSimulateIncoming={handleSimulateIncoming}
        canSend={canSend}
        isBusy={isBusy}
      />

      {/* Modals and Drawers */}
      {showSettingsModal && (
        <SettingsModal
          settings={settings}
          onSave={handleSaveSettings}
          onClose={() => setShowSettingsModal(false)}
        />
      )}

      <ReceiveModal
        isOpen={showReceiveModal}
        onClose={() => setShowReceiveModal(false)}
        settings={settings}
        pendingTransfers={pendingTransfers}
        onAcceptTransfer={handleAcceptTransfer}
        onDeclineTransfer={handleDeclineTransfer}
      />

      <HistoryDrawer
        isOpen={showHistoryDrawer}
        onClose={() => setShowHistoryDrawer(false)}
        transfers={transferHistory}
        onClearHistory={() => setTransferHistory([])}
      />
    </div>
  );
}

export default App;
