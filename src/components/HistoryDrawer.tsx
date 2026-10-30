import React from 'react';
import { X, History, Download, FileText, CheckCircle2, Clock } from 'lucide-react';
import { ReceivedTransfer } from '../types';
import { formatBytes } from '../utils/format';

interface HistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  transfers: ReceivedTransfer[];
  onClearHistory: () => void;
}

export const HistoryDrawer: React.FC<HistoryDrawerProps> = ({
  isOpen,
  onClose,
  transfers,
  onClearHistory,
}) => {
  if (!isOpen) return null;

  const downloadFile = (file: { name: string; blobUrl?: string }) => {
    if (file.blobUrl) {
      const a = document.createElement('a');
      a.href = file.blobUrl;
      a.download = file.name;
      a.click();
    } else {
      // Create a mockup text file for simulated files
      const blob = new Blob([`LocalSend Received File: ${file.name}\nTimestamp: ${new Date().toISOString()}`], {
        type: 'text/plain',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-2xs flex justify-end">
      <div className="bg-white dark:bg-slate-800 w-full max-w-md h-full shadow-2xl flex flex-col border-l border-slate-200 dark:border-slate-700 animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-slate-900">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-teal-600" />
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
              文件传输与接收记录
            </h3>
            <span className="text-[11px] px-1.5 py-0.2 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-mono">
              {transfers.length}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* List of transfers */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {transfers.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 p-6">
              <History className="h-10 w-10 mb-2 opacity-30" />
              <p className="text-xs font-semibold">暂无传输记录</p>
              <p className="text-[11px] mt-1 text-slate-400">
                收发完成的文件会记录在此处，支持随时下载或重传。
              </p>
            </div>
          ) : (
            transfers.map((item) => (
              <div
                key={item.id}
                className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 space-y-2 text-xs"
              >
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    <span>来自: {item.senderAlias}</span>
                  </div>
                  <span className="text-[11px] text-slate-400 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {item.timestamp}
                  </span>
                </div>

                <div className="space-y-1.5 pt-1">
                  {item.files.map((file, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-1.5 bg-white dark:bg-slate-800 rounded border border-slate-100 dark:border-slate-700"
                    >
                      <div className="flex items-center gap-2 min-w-0 pr-2">
                        <FileText className="h-3.5 w-3.5 text-teal-600 shrink-0" />
                        <span className="truncate text-slate-700 dark:text-slate-300 font-medium">
                          {file.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono text-[11px] text-slate-400">
                          {formatBytes(file.size)}
                        </span>
                        <button
                          onClick={() => downloadFile(file)}
                          className="p-1 text-teal-600 hover:text-teal-700 hover:bg-teal-50 dark:hover:bg-teal-950/40 rounded transition-colors"
                          title="下载文件"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        {transfers.length > 0 && (
          <div className="p-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 flex justify-between items-center text-xs">
            <button
              onClick={onClearHistory}
              className="text-rose-600 hover:underline font-medium"
            >
              清空所有记录
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded hover:bg-slate-300 dark:hover:bg-slate-600"
            >
              关闭
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
