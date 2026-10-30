import React, { useState, useEffect } from 'react';
import {
  Download,
  X,
  Radio,
  Laptop,
  Check,
  Ban,
  FolderOpen,
  QrCode,
  FileText,
  Clock,
  Sparkles,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { AppSettings, ReceivedTransfer } from '../types';
import { formatBytes } from '../utils/format';

interface ReceiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  downloadDir: string;
  autoAccept: boolean;
  onToggleAutoAccept: (enabled: boolean) => void;
  pendingTransfers: ReceivedTransfer[];
  onAcceptTransfer: (transferId: string, action?: 'p' | 'y') => void;
  onDeclineTransfer: (transferId: string) => void;
  onOpenFolder: () => void;
}

export const ReceiveModal: React.FC<ReceiveModalProps> = ({
  isOpen,
  onClose,
  settings,
  downloadDir,
  autoAccept,
  onToggleAutoAccept,
  pendingTransfers,
  onAcceptTransfer,
  onDeclineTransfer,
  onOpenFolder,
}) => {
  const [showQr, setShowQr] = useState(false);
  const [downloadedFiles, setDownloadedFiles] = useState<{ name: string; size: number; mtime: number }[]>([]);
  const [terminalLaunching, setTerminalLaunching] = useState(false);

  const handleLaunchTerminal = async () => {
    setTerminalLaunching(true);
    try {
      const res = await fetch('/api/system/terminal-receive', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || '未能启动终端');
      }
    } catch (e: any) {
      alert(`启动终端失败: ${e.message}`);
    } finally {
      setTerminalLaunching(false);
    }
  };

  // Fetch downloaded files list
  useEffect(() => {
    if (isOpen) {
      fetch('/api/receive/files')
        .then((r) => r.json())
        .then((data) => {
          if (data.files) {
            setDownloadedFiles(data.files);
          }
        })
        .catch(() => {});
    }
  }, [isOpen, pendingTransfers]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-2xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl max-w-lg w-full border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-4 py-3 bg-teal-600 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Radio className="h-5 w-5 animate-pulse text-teal-200" />
            <div>
              <h3 className="text-sm font-bold leading-tight">接收模式 (后台无缝运行)</h3>
              <p className="text-[11px] text-teal-100">
                LocalSend v2 监听中 · 端口 {settings.port}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-teal-100 hover:text-white p-1 rounded transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3.5 overflow-y-auto flex-1">
          {/* Storage Directory Card (Prominent & Clear!) */}
          <div className="bg-slate-50 dark:bg-slate-900/70 rounded-lg p-3 border border-slate-200 dark:border-slate-700 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <FolderOpen className="h-3.5 w-3.5 text-teal-600" />
                <span>接收文件保存路径</span>
              </span>
              <button
                type="button"
                onClick={onOpenFolder}
                className="px-2.5 py-1 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-slate-700 dark:text-slate-200 text-xs font-medium flex items-center gap-1 shadow-2xs transition-colors"
                title="在系统文件管理器中打开此文件夹"
              >
                <FolderOpen className="h-3.5 w-3.5 text-teal-600" />
                <span>在文件夹中打开</span>
              </button>
            </div>

            <div className="font-mono text-xs text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-950 p-2 rounded border border-slate-200 dark:border-slate-800 truncate select-all">
              {downloadDir || '/home/user/Downloads/LocalSend'}
            </div>

            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoAccept}
                  onChange={(e) => onToggleAutoAccept(e.target.checked)}
                  className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  自动接受局域网传输（无需每次手动点击确认）
                </span>
              </label>
            </div>
          </div>

          {/* Pending Transfer Requests (Accept / Decline right in Web UI) */}
          {pendingTransfers.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 animate-bounce" />
                <span>新收到的文件传输请求 (需确认)</span>
              </h4>

              {pendingTransfers.map((req) => (
                <div
                  key={req.id}
                  className="p-3 rounded-lg border-2 border-teal-500 bg-teal-50/70 dark:bg-teal-950/40 space-y-2 shadow-xs"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                        {req.senderAlias}
                      </span>
                      {req.senderIp && (
                        <span className="ml-2 text-[11px] font-mono text-slate-500">
                          ({req.senderIp})
                        </span>
                      )}
                    </div>
                    {req.totalSize > 0 && (
                      <span className="text-xs font-mono font-bold text-teal-700 dark:text-teal-400">
                        {formatBytes(req.totalSize)}
                      </span>
                    )}
                  </div>

                  <div className="bg-white dark:bg-slate-900 rounded p-2 text-xs border border-teal-200 dark:border-teal-800/80 max-h-24 overflow-y-auto space-y-1">
                    {req.files.map((file, idx) => (
                      <div key={idx} className="flex items-center justify-between text-slate-700 dark:text-slate-300">
                        <span className="truncate pr-2 font-medium">{file.name}</span>
                        {file.size > 0 && (
                          <span className="font-mono text-[11px] text-slate-400 shrink-0">
                            {formatBytes(file.size)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                    <button
                      onClick={() => onDeclineTransfer(req.id)}
                      className="px-2.5 py-1.5 text-xs rounded border border-rose-200 dark:border-rose-800 bg-white dark:bg-slate-800 text-rose-600 hover:bg-rose-50 font-medium transition-colors flex items-center gap-1"
                      title="拒绝此次传输"
                    >
                      <Ban className="h-3.5 w-3.5" />
                      <span>拒绝 (N)</span>
                    </button>
                    <button
                      onClick={() => onAcceptTransfer(req.id, 'y')}
                      className="px-3 py-1.5 text-xs rounded border border-teal-300 dark:border-teal-700 bg-teal-50 dark:bg-slate-800 text-teal-700 dark:text-teal-300 hover:bg-teal-100 font-bold transition-colors flex items-center gap-1"
                      title="仅接受本次传输，下次仍会询问"
                    >
                      <Check className="h-3.5 w-3.5" />
                      <span>仅本次接收 (Y)</span>
                    </button>
                    <button
                      onClick={() => onAcceptTransfer(req.id, 'p')}
                      className="px-3.5 py-1.5 text-xs rounded bg-teal-600 hover:bg-teal-700 text-white font-bold transition-colors flex items-center gap-1 shadow-xs"
                      title="接受并信任此设备指纹，未来无需再次确认"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" />
                      <span>接受并信任配对 (P)</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Downloaded Files List */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                已接收的文件 ({downloadedFiles.length})
              </h4>
            </div>

            {downloadedFiles.length === 0 ? (
              <div className="p-5 text-center border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-lg text-slate-400">
                <Download className="h-6 w-6 mx-auto mb-1 opacity-40" />
                <p className="text-xs font-medium">当前目录暂无接收文件</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  从其他手机或电脑向当前设备发送文件，将自动存入此目录。
                </p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {downloadedFiles.map((file, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-2 bg-slate-50 dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-700 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0 pr-2">
                      <FileText className="h-4 w-4 text-teal-600 shrink-0" />
                      <span className="truncate font-medium text-slate-800 dark:text-slate-200" title={file.name}>
                        {file.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                      <span className="font-mono text-[11px] text-slate-400">
                        {formatBytes(file.size)}
                      </span>
                      <a
                        href={`/api/download-file/${encodeURIComponent(file.name)}`}
                        download={file.name}
                        className="px-2 py-0.5 rounded bg-teal-50 dark:bg-teal-950 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 font-medium hover:bg-teal-100 transition-colors"
                        title="下载到本地浏览器"
                      >
                        下载
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center text-xs shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleLaunchTerminal}
              disabled={terminalLaunching}
              className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 flex items-center gap-1 font-medium hover:underline text-[11px]"
              title="在独立的系统桌面终端（gnome-terminal/xterm 等）中启动"
            >
              <Terminal className="h-3.5 w-3.5 text-slate-400" />
              <span>{terminalLaunching ? '正在打开…' : '切换到桌面独立终端窗口'}</span>
            </button>
          </div>
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded hover:bg-slate-300 dark:hover:bg-slate-600 font-medium"
          >
            关闭窗口（后台继续接收）
          </button>
        </div>
      </div>
    </div>
  );
};
