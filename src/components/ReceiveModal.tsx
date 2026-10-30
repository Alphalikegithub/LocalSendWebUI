import React, { useState } from 'react';
import {
  Download,
  X,
  Radio,
  Laptop,
  Check,
  Ban,
  FileCheck,
  ExternalLink,
  QrCode,
  ShieldAlert,
} from 'lucide-react';
import { AppSettings, ReceivedTransfer } from '../types';
import { formatBytes } from '../utils/format';

interface ReceiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  pendingTransfers: ReceivedTransfer[];
  onAcceptTransfer: (transferId: string) => void;
  onDeclineTransfer: (transferId: string) => void;
}

export const ReceiveModal: React.FC<ReceiveModalProps> = ({
  isOpen,
  onClose,
  settings,
  pendingTransfers,
  onAcceptTransfer,
  onDeclineTransfer,
}) => {
  const [showQr, setShowQr] = useState(false);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-2xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl max-w-lg w-full border border-slate-200 dark:border-slate-700 overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 bg-teal-600 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Radio className="h-5 w-5 animate-pulse" />
            <div>
              <h3 className="text-sm font-bold leading-tight">接收模式 (已开启监听)</h3>
              <p className="text-[11px] text-teal-100">
                LocalSend v2 服务端正在运行于端口 {settings.port}
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

        {/* Listening Status & Device Card */}
        <div className="p-4 space-y-4">
          <div className="bg-slate-50 dark:bg-slate-900/60 rounded-lg p-3 border border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-teal-100 dark:bg-teal-900/50 flex items-center justify-center text-teal-600 dark:text-teal-300">
                <Laptop className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xs font-bold text-slate-800 dark:text-slate-100">
                  {settings.deviceAlias}
                </div>
                <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  IP 地址: 192.168.1.18 : {settings.port}
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowQr(!showQr)}
              className="px-2.5 py-1 text-xs border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center gap-1"
            >
              <QrCode className="h-3.5 w-3.5" />
              <span>{showQr ? '收起' : '配对码'}</span>
            </button>
          </div>

          {/* QR Pairing Code info */}
          {showQr && (
            <div className="p-3 bg-teal-50/60 dark:bg-teal-950/30 rounded-lg border border-teal-200 dark:border-teal-800/60 text-center space-y-2">
              <div className="text-xs font-semibold text-teal-900 dark:text-teal-200">
                局域网直连信息
              </div>
              <div className="font-mono text-xs bg-white dark:bg-slate-900 p-2 rounded border border-teal-100 dark:border-teal-800 text-slate-700 dark:text-slate-200 select-all">
                http://192.168.1.18:{settings.port}
              </div>
              <p className="text-[11px] text-teal-700 dark:text-teal-400">
                其他手机或电脑打开 LocalSend 后可在“发送”页面直接输入此 IP 建立极速传输。
              </p>
            </div>
          )}

          {/* Pending Transfer Requests */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                待确认的接收请求 ({pendingTransfers.length})
              </h4>
            </div>

            {pendingTransfers.length === 0 ? (
              <div className="p-6 text-center border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-lg">
                <div className="relative inline-flex mb-3">
                  <div className="w-10 h-10 rounded-full bg-teal-500/20 animate-ping absolute" />
                  <div className="w-10 h-10 rounded-full bg-teal-500/30 flex items-center justify-center text-teal-600 dark:text-teal-400">
                    <Download className="h-5 w-5" />
                  </div>
                </div>
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  正在等待来自同一局域网的传输…
                </p>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                  只要发送端向当前设备发送文件，此处将实时弹出确认窗口。
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {pendingTransfers.map((req) => (
                  <div
                    key={req.id}
                    className="p-3 rounded-lg border border-teal-300 dark:border-teal-700 bg-teal-50/50 dark:bg-teal-950/40 space-y-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                          {req.senderAlias}
                        </span>
                        <span className="ml-2 text-[11px] font-mono text-slate-500">
                          ({req.senderIp})
                        </span>
                      </div>
                      <span className="text-xs font-mono font-semibold text-teal-700 dark:text-teal-400">
                        {formatBytes(req.totalSize)}
                      </span>
                    </div>

                    <div className="bg-white dark:bg-slate-900 rounded p-2 text-xs border border-slate-200 dark:border-slate-700 max-h-24 overflow-y-auto space-y-1">
                      {req.files.map((file, idx) => (
                        <div key={idx} className="flex items-center justify-between text-slate-700 dark:text-slate-300">
                          <span className="truncate pr-2">{file.name}</span>
                          <span className="font-mono text-[11px] text-slate-400 shrink-0">
                            {formatBytes(file.size)}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        onClick={() => onDeclineTransfer(req.id)}
                        className="px-3 py-1.5 text-xs rounded border border-rose-200 dark:border-rose-800 bg-white dark:bg-slate-800 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center gap-1 font-medium transition-colors"
                      >
                        <Ban className="h-3.5 w-3.5" />
                        <span>拒绝</span>
                      </button>
                      <button
                        onClick={() => onAcceptTransfer(req.id)}
                        className="px-4 py-1.5 text-xs rounded bg-teal-600 hover:bg-teal-700 text-white flex items-center gap-1 font-medium shadow-xs transition-colors"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>接受并下载</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center text-xs">
          <span className="text-slate-500 dark:text-slate-400">
            保持此窗口开启以持续监听接收传输
          </span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded hover:bg-slate-300 dark:hover:bg-slate-600 font-medium"
          >
            隐藏到后台
          </button>
        </div>
      </div>
    </div>
  );
};
