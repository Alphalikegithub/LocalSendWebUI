import React from 'react';
import { Send, Download, Ban, Radio, Sparkles } from 'lucide-react';
import { TransferProgress } from '../types';
import { formatBytes } from '../utils/format';

interface BottomBarProps {
  progress: TransferProgress;
  onSend: () => void;
  onReceive: () => void;
  onCancel: () => void;
  onSimulateIncoming: () => void;
  canSend: boolean;
  isBusy: boolean;
}

export const BottomBar: React.FC<BottomBarProps> = ({
  progress,
  onSend,
  onReceive,
  onCancel,
  onSimulateIncoming,
  canSend,
  isBusy,
}) => {
  const percent =
    progress.totalBytes > 0
      ? Math.min(100, Math.round((progress.bytesTransferred / progress.totalBytes) * 100))
      : 0;

  const getStatusText = () => {
    switch (progress.status) {
      case 'connecting':
        return '正在连接…';
      case 'transferring':
        return `发送中 ${percent}%  (${formatBytes(progress.bytesTransferred)} / ${formatBytes(
          progress.totalBytes
        )})${
          progress.speedBytesPerSec > 0
            ? ` · ${(progress.speedBytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
            : ''
        }${progress.etaSeconds > 0 ? ` · 预计剩余 ${progress.etaSeconds} 秒` : ''}`;
      case 'completed':
        return '发送完成';
      case 'cancelled':
        return '已取消';
      case 'error':
        return `发送失败${progress.errorMessage ? `: ${progress.errorMessage}` : ''}`;
      default:
        return '就绪';
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-xs">
      {/* Progress Bar Container */}
      <div className="flex-1 min-w-[240px]">
        <div className="relative w-full h-7 bg-slate-100 dark:bg-slate-700 rounded-md border border-slate-200 dark:border-slate-600 overflow-hidden flex items-center justify-center">
          {/* Animated fill indicator */}
          <div
            className={`absolute left-0 top-0 bottom-0 transition-all duration-200 ${
              progress.status === 'completed'
                ? 'bg-emerald-500'
                : progress.status === 'error'
                ? 'bg-rose-500'
                : progress.status === 'cancelled'
                ? 'bg-amber-500'
                : isBusy
                ? 'bg-teal-600'
                : 'bg-teal-500/80'
            }`}
            style={{
              width:
                progress.status === 'connecting'
                  ? '100%'
                  : `${isBusy ? Math.max(percent, 2) : percent}%`,
              opacity: progress.status === 'connecting' ? 0.35 : 1,
            }}
          />

          {/* Progress Label */}
          <span className="relative z-10 text-xs font-semibold text-slate-800 dark:text-slate-100 drop-shadow-xs px-2 truncate">
            {getStatusText()}
          </span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onSend}
          disabled={!canSend || isBusy}
          className={`px-4 py-2 rounded-md font-semibold text-xs flex items-center gap-1.5 transition-all shadow-xs ${
            canSend && !isBusy
              ? 'bg-teal-600 hover:bg-teal-700 active:bg-teal-800 text-white shadow-teal-500/20'
              : 'bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed border border-slate-200 dark:border-slate-600'
          }`}
          title={!canSend ? '请先选择目标设备并添加待发送文件' : '发送选中的文件'}
        >
          <Send className="h-3.5 w-3.5" />
          <span>发送</span>
        </button>

        <button
          type="button"
          onClick={onReceive}
          disabled={isBusy}
          className="px-4 py-2 rounded-md font-semibold text-xs bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 active:bg-slate-300 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 flex items-center gap-1.5 transition-all shadow-2xs disabled:opacity-50"
          title="开启接收模式监听并接收局域网文件"
        >
          <Download className="h-3.5 w-3.5 text-teal-600" />
          <span>接收</span>
        </button>

        <button
          type="button"
          onClick={onCancel}
          disabled={!isBusy}
          className={`px-3 py-2 rounded-md font-semibold text-xs flex items-center gap-1.5 transition-all shadow-2xs border ${
            isBusy
              ? 'bg-white dark:bg-slate-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 border-rose-300 dark:border-rose-700 active:bg-rose-100'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600 border-slate-200 dark:border-slate-700 cursor-not-allowed'
          }`}
          title="取消当前的发送任务"
        >
          <Ban className="h-3.5 w-3.5" />
          <span>取消发送</span>
        </button>

        <button
          type="button"
          onClick={onSimulateIncoming}
          disabled={isBusy}
          className="px-2.5 py-2 rounded-md text-xs font-medium bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 flex items-center gap-1 transition-colors"
          title="模拟外部设备发送文件测试接收功能"
        >
          <Sparkles className="h-3.5 w-3.5 text-amber-500" />
          <span className="hidden sm:inline">模拟来电接收</span>
        </button>
      </div>
    </div>
  );
};
