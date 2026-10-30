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
import { getCurrentTimestamp, formatBytes } from './utils/format';

export function App() {
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('localsend_settings');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {}
    }
    return {
      deviceAlias: 'LocalSend-Client',
      port: 53317,
      multicastGroup: '224.0.0.167',
      fingerprint: '',
      autoSaveToDownloads: true,
      cliPath: '/data/QtProjects/localsend/target/debug/localsend-cli',
    };
  });

  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<string>(() => {
    return localStorage.getItem('localsend_lastTarget') || '';
  });

  const [files, setFiles] = useState<TransferFile[]>([]);
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
  const [transferHistory, setTransferHistory] = useState<ReceivedTransfer[]>([]);

  const [localAddresses, setLocalAddresses] = useState<{ ip: string; name: string }[]>([]);
  const hasInitializedRef = useRef(false);
  const activeEventSourceRef = useRef<EventSource | null>(null);

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
    setLogs((prev) => [...prev.slice(-400), entry]);
  };

  // 1. Initial startup - fetch real system status, CLI and TLS identity
  useEffect(() => {
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;

    appendLog('LocalSend GUI 已启动。');

    const initSystem = async () => {
      try {
        const res = await fetch('/api/system/status');
        if (res.ok) {
          const data = await res.json();
          const cliPath = data.cliPath || settings.cliPath;
          const fingerprint = data.fingerprint || '';
          const identityPath = data.identityPath || '';

          if (data.localAddresses) {
            setLocalAddresses(data.localAddresses);
          }

          setSettings((prev) => ({
            ...prev,
            cliPath,
            fingerprint,
            deviceAlias: data.hostname || prev.deviceAlias,
            port: data.port || 53317,
          }));

          appendLog(`使用 CLI：${cliPath}`);
          if (identityPath && fingerprint) {
            appendLog(`已加载 TLS 身份：${identityPath}（指纹 ${fingerprint}）`);
          } else {
            appendLog('未找到已生成的 TLS 证书文件，正在使用默认 TLS 身份。', 'warn');
          }

          // Auto refresh devices after 400ms (mirrors Qt C++ code)
          setTimeout(() => {
            refreshDevices();
          }, 400);
          return;
        }
      } catch (err) {
        console.warn('System status API not responding:', err);
      }

      appendLog(`使用 CLI：${settings.cliPath}`);
      setTimeout(() => {
        refreshDevices();
      }, 400);
    };

    initSystem();

    return () => {
      if (activeEventSourceRef.current) {
        activeEventSourceRef.current.close();
      }
    };
  }, []);

  const handleSaveSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    localStorage.setItem('localsend_settings', JSON.stringify(newSettings));
    appendLog(`已更新设置：CLI 路径 [${newSettings.cliPath}]，别名 [${newSettings.deviceAlias}]`);
  };

  const handleSelectTarget = (target: string) => {
    setSelectedTarget(target);
    localStorage.setItem('localsend_lastTarget', target);
  };

  // 2. Real device discovery using SSE endpoint
  const refreshDevices = () => {
    if (progress.status === 'transferring' || progress.status === 'connecting') {
      appendLog('发送过程中不能刷新设备。', 'warn');
      return;
    }

    if (activeEventSourceRef.current) {
      activeEventSourceRef.current.close();
      activeEventSourceRef.current = null;
    }

    setIsScanning(true);
    setScanStatusText('正在扫描局域网…');
    setDevices([]);

    try {
      const es = new EventSource('/api/discover/stream');
      activeEventSourceRef.current = es;

      es.addEventListener('log', (event) => {
        try {
          const data = JSON.parse(event.data);
          appendLog(data.message, data.level || 'info');
        } catch {}
      });

      es.addEventListener('device', (event) => {
        try {
          const dev = JSON.parse(event.data);
          setDevices((prev) => {
            const exists = prev.some((d) => d.ip === dev.ip);
            if (!exists) {
              return [...prev, dev];
            }
            return prev.map((d) => (d.ip === dev.ip ? dev : d));
          });
        } catch {}
      });

      es.addEventListener('status', (event) => {
        try {
          const data = JSON.parse(event.data);
          setIsScanning(false);
          setScanStatusText(data.count === 0 ? '未发现设备，可手动输入 IP' : `发现 ${data.count} 台设备`);
          es.close();
          activeEventSourceRef.current = null;
        } catch {}
      });

      es.onerror = () => {
        setIsScanning(false);
        setScanStatusText('扫描已完成');
        es.close();
        activeEventSourceRef.current = null;
      };
    } catch (err: any) {
      setIsScanning(false);
      setScanStatusText('扫描错误');
      appendLog(`扫描服务异常: ${err.message}`, 'error');
    }
  };

  const handleAddCustomDevice = (alias: string, ip: string) => {
    const newDev: Device = {
      id: `custom-${Date.now()}`,
      alias,
      ip,
      port: 53317,
      deviceType: 'desktop',
      fingerprint: '',
      isOnline: true,
      lastSeen: Date.now(),
    };
    setDevices((prev) => [...prev, newDev]);
    setSelectedTarget(ip);
    appendLog(`已手动添加局域网设备：${alias} (${ip})`, 'success');
  };

  // 3. File management
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

  // 4. Real File Sending
  const handleSend = async () => {
    if (!selectedTarget.trim()) {
      appendLog('缺少目标设备：请先选择设备或手动输入设备名/IP 地址。', 'warn');
      return;
    }
    if (files.length === 0) {
      appendLog('没有文件：请先添加要发送的文件或目录。', 'warn');
      return;
    }

    const totalBytes = files.reduce((acc, f) => acc + f.size, 0);
    appendLog(`开始发送：目标 ${selectedTarget}，共 ${files.length} 项。`);

    setProgress({
      status: 'connecting',
      currentFileIndex: 0,
      totalFiles: files.length,
      bytesTransferred: 0,
      totalBytes,
      speedBytesPerSec: 0,
      etaSeconds: 0,
    });

    try {
      // Step A: Upload any File objects to server temp directory
      const formData = new FormData();
      let hasUploads = false;
      for (const f of files) {
        if (f.fileObj) {
          formData.append('files', f.fileObj);
          hasUploads = true;
        }
      }

      let filePathsToSend: string[] = [];
      if (hasUploads) {
        appendLog('正在准备发送文件数据…');
        const uploadRes = await fetch('/api/send/upload', {
          method: 'POST',
          body: formData,
        });
        if (!uploadRes.ok) {
          throw new Error('上传待发送文件失败');
        }
        const uploadData = await uploadRes.json();
        filePathsToSend = uploadData.files.map((f: any) => f.path);
      } else {
        // Fallback for demo or simulated files
        filePathsToSend = files.map((f) => f.name);
      }

      // Step B: Trigger real CLI send
      const sendRes = await fetch('/api/send/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: selectedTarget,
          filePaths: filePathsToSend,
          customCliPath: settings.cliPath,
        }),
      });

      if (!sendRes.body) {
        throw new Error('服务器未返回响应流');
      }

      const reader = sendRes.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      setProgress((prev) => ({ ...prev, status: 'transferring' }));

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const evt of events) {
          if (!evt.trim()) continue;
          const lines = evt.split('\n');
          let eventType = '';
          let eventData = '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              eventData = line.slice(6).trim();
            }
          }

          if (eventType === 'log' && eventData) {
            try {
              const parsed = JSON.parse(eventData);
              appendLog(parsed.message, parsed.level || 'info');
            } catch {}
          } else if (eventType === 'progress' && eventData) {
            try {
              const parsed = JSON.parse(eventData);
              const line = parsed.rawLine || '';
              // Match progress lines like 24.5 MB / 100 MB or ETA
              const match = line.match(/([0-9.]+)\s*(B|KB|MB|GB|TB)\s*\/\s*([0-9.]+)\s*(B|KB|MB|GB|TB)/i);
              if (match) {
                // Approximate bytes
                setProgress((prev) => ({
                  ...prev,
                  status: 'transferring',
                  bytesTransferred: Math.min(prev.totalBytes, prev.bytesTransferred + 5000000),
                }));
              }
            } catch {}
          } else if (eventType === 'status' && eventData) {
            try {
              const parsed = JSON.parse(eventData);
              if (parsed.status === 'completed') {
                setProgress({
                  status: 'completed',
                  currentFileIndex: files.length,
                  totalFiles: files.length,
                  bytesTransferred: totalBytes,
                  totalBytes,
                  speedBytesPerSec: 0,
                  etaSeconds: 0,
                });
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
              } else if (parsed.status === 'error') {
                setProgress((prev) => ({
                  ...prev,
                  status: 'error',
                  errorMessage: parsed.error || '发送中断',
                }));
              }
            } catch {}
          }
        }
      }
    } catch (err: any) {
      appendLog(`发送错误：${err.message}`, 'error');
      setProgress((prev) => ({ ...prev, status: 'error', errorMessage: err.message }));
    }
  };

  const [downloadDir, setDownloadDir] = useState<string>('/home/user/Downloads/LocalSend');
  const [autoAccept, setAutoAccept] = useState<boolean>(true);
  const [receiveProgressLine, setReceiveProgressLine] = useState<string>('');
  const [receiveProgressPercent, setReceiveProgressPercent] = useState<number | undefined>(undefined);

  // Subscribe to receive mode events
  useEffect(() => {
    const es = new EventSource('/api/receive/stream');
    es.addEventListener('status', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (typeof data.autoAccept === 'boolean') {
          setAutoAccept(data.autoAccept);
        }
        if (data.downloadDir) {
          setDownloadDir(data.downloadDir);
        }
      } catch {}
    });

    es.addEventListener('log', (event) => {
      try {
        const data = JSON.parse(event.data);
        appendLog(data.message, data.level || 'info');
      } catch {}
    });

    es.addEventListener('progress', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.rawLine) {
          setReceiveProgressLine(data.rawLine);
        }
        if (typeof data.percent === 'number') {
          setReceiveProgressPercent(data.percent);
        }
      } catch {}
    });

    es.addEventListener('prompt', (event) => {
      try {
        const data = JSON.parse(event.data);
        const newPrompt: ReceivedTransfer = {
          id: data.id,
          senderAlias: data.sender || '局域网设备',
          senderIp: '',
          timestamp: getCurrentTimestamp(),
          files: [{ name: `传输文件 (共 ${data.fileCount} 项)`, size: 0, type: 'file' }],
          totalSize: 0,
          status: 'pending',
        };
        setPendingTransfers((prev) => [newPrompt, ...prev]);
        setShowReceiveModal(true);
        appendLog(`收到来自【${data.sender}】的文件传输请求，请确认是否接收。`, 'warn');
      } catch {}
    });

    es.addEventListener('completed', (event) => {
      try {
        const data = JSON.parse(event.data);
        setReceiveProgressPercent(100);
        setTimeout(() => {
          setReceiveProgressPercent(undefined);
          setReceiveProgressLine('');
        }, 3000);

        appendLog(`文件传输已顺利完成！文件保存在: ${data.downloadDir}`, 'success');
        fetch('/api/receive/files')
          .then((r) => r.json())
          .then((filesData) => {
            if (filesData.files && filesData.files.length > 0) {
              const topFile = filesData.files[0];
              setTransferHistory((prev) => [
                {
                  id: `recv-${Date.now()}`,
                  senderAlias: '局域网设备',
                  senderIp: 'LocalSend',
                  timestamp: getCurrentTimestamp(),
                  files: [topFile],
                  totalSize: topFile.size,
                  status: 'completed',
                },
                ...prev,
              ]);
            }
          });
      } catch {}
    });

    return () => es.close();
  }, []);

  // 5. Cancel send
  const handleCancelSend = async () => {
    appendLog('正在取消发送…', 'warn');
    setProgress((prev) => ({ ...prev, status: 'cancelled' }));
    try {
      await fetch('/api/send/cancel', { method: 'POST' });
      appendLog('发送已取消。');
    } catch (err: any) {
      appendLog(`取消异常: ${err.message}`, 'error');
    }
  };

  // 6. Seamless background receive mode (no terminal needed)
  const handleOpenReceive = async () => {
    setShowReceiveModal(true);
    try {
      const res = await fetch('/api/receive/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customCliPath: settings.cliPath,
          autoAccept,
          saveDir: downloadDir,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.downloadDir) {
          setDownloadDir(data.downloadDir);
        }
        appendLog(data.message, 'success');
      } else {
        appendLog(`无法启动接收模式：${data.error}`, 'error');
      }
    } catch (err: any) {
      appendLog(`启动接收模式失败: ${err.message}`, 'error');
    }
  };

  const handleOpenFolder = async () => {
    try {
      const res = await fetch('/api/open-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir: downloadDir }),
      });
      if (res.ok) {
        appendLog(`已在系统文件管理器中打开保存目录: ${downloadDir}`, 'info');
      }
    } catch (err: any) {
      appendLog(`打开文件夹失败: ${err.message}`, 'error');
    }
  };

  const handleToggleAutoAccept = async (enabled: boolean) => {
    setAutoAccept(enabled);
    try {
      await fetch('/api/receive/auto-accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
    } catch (err: any) {
      appendLog(`同步自动接收设置失败: ${err.message}`, 'error');
    }
  };

  const handleResetPaired = async () => {
    try {
      const res = await fetch('/api/receive/reset-paired', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        appendLog('已清空已信任设备记录，下次局域网发送将重新弹出接收确认窗口。', 'success');
      }
    } catch (err: any) {
      appendLog(`重置配对失败: ${err.message}`, 'error');
    }
  };

  const handleSimulateIncoming = () => {
    const dummyReq: ReceivedTransfer = {
      id: `incoming-${Date.now()}`,
      senderAlias: '富有的椰子',
      senderIp: '192.168.118.115',
      timestamp: getCurrentTimestamp(),
      files: [
        {
          name: 'VID20260627073253.mp4',
          size: 135371366,
          type: 'video/mp4',
        },
      ],
      totalSize: 135371366,
      status: 'pending',
    };

    setPendingTransfers((prev) => [dummyReq, ...prev]);
    setShowReceiveModal(true);
    appendLog(`收到来自 富有的椰子 (192.168.118.115) 的文件传输请求（VID20260627073253.mp4，129.1 MB）。`, 'warn');
  };

  const handleAcceptTransfer = async (id: string, action: 'p' | 'y' = 'p') => {
    const req = pendingTransfers.find((t) => t.id === id);
    setPendingTransfers((prev) => prev.filter((t) => t.id !== id));

    try {
      await fetch('/api/receive/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      appendLog(
        action === 'p'
          ? '已接受传输并永久信任该设备 (P)！'
          : '已在界面中确认接受本次传输请求 (Y)！',
        'success'
      );
      if (req) {
        setTransferHistory((prev) => [{ ...req, status: 'completed' }, ...prev]);
      }
    } catch (err: any) {
      appendLog(`确认接收异常: ${err.message}`, 'error');
    }
  };

  const handleDeclineTransfer = async (id: string) => {
    const req = pendingTransfers.find((t) => t.id === id);
    setPendingTransfers((prev) => prev.filter((t) => t.id !== id));

    try {
      await fetch('/api/receive/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'n' }),
      });
      if (req) {
        appendLog(`已在界面中拒绝来自 ${req.senderAlias} 的传输请求。`, 'warn');
      }
    } catch (err: any) {
      appendLog(`拒绝传输异常: ${err.message}`, 'error');
    }
  };

  const isBusy = progress.status === 'connecting' || progress.status === 'transferring';
  const canSend = Boolean(selectedTarget.trim()) && files.length > 0;

  return (
    <div className="h-screen max-h-screen overflow-hidden flex flex-col bg-slate-100 dark:bg-slate-900 text-slate-800 dark:text-slate-100 font-sans">
      <Header
        settings={settings}
        localAddresses={localAddresses}
        onOpenSettings={() => setShowSettingsModal(true)}
        onOpenHistory={() => setShowHistoryDrawer(true)}
        receivedCount={transferHistory.length}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode(!darkMode)}
      />

      <main className="flex-1 p-2 md:p-3 flex flex-col gap-2.5 max-w-7xl w-full mx-auto min-h-0 overflow-hidden">
        {/* Top Splitter */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5 flex-1 min-h-[260px] overflow-hidden">
          <div className="lg:col-span-4 h-full min-h-0">
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

          <div className="lg:col-span-8 h-full min-h-0">
            <FilePanel
              files={files}
              onAddFiles={handleAddFiles}
              onRemoveSelected={handleRemoveSelected}
              onClearFiles={handleClearFiles}
              disabled={isBusy}
            />
          </div>
        </div>

        {/* Real-time Console Log with guaranteed visibility and bottom scroll */}
        <div className="h-[200px] md:h-[220px] shrink-0 min-h-0">
          <LogPanel logs={logs} onClearLogs={() => setLogs([])} />
        </div>
      </main>

      <BottomBar
        progress={progress}
        onSend={handleSend}
        onReceive={handleOpenReceive}
        onCancel={handleCancelSend}
        onSimulateIncoming={handleSimulateIncoming}
        canSend={canSend}
        isBusy={isBusy}
      />

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
        downloadDir={downloadDir}
        autoAccept={autoAccept}
        onToggleAutoAccept={handleToggleAutoAccept}
        onResetPaired={handleResetPaired}
        pendingTransfers={pendingTransfers}
        onAcceptTransfer={handleAcceptTransfer}
        onDeclineTransfer={handleDeclineTransfer}
        onOpenFolder={handleOpenFolder}
        localAddresses={localAddresses}
        currentProgressLine={receiveProgressLine}
        currentProgressPercent={receiveProgressPercent}
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
