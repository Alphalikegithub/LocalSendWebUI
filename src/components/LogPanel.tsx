import React, { useEffect, useRef, useState } from 'react';
import { Terminal, Copy, Trash2, ArrowDown, Check } from 'lucide-react';
import { LogEntry } from '../types';

interface LogPanelProps {
  logs: LogEntry[];
  onClearLogs: () => void;
}

export const LogPanel: React.FC<LogPanelProps> = ({ logs, onClearLogs }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);

  // Auto-scroll to bottom whenever logs change
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // Robust clipboard copy with fallback that works on HTTP, remote IPs, and all browsers
  const handleCopyLogs = () => {
    if (logs.length === 0) return;
    const text = logs.map((l) => `[${l.timestamp}] ${l.message}`).join('\n');

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        })
        .catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  };

  const fallbackCopy = (text: string) => {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-999999px';
      textarea.style.top = '-999999px';
      textarea.setAttribute('readonly', '');
      document.body.appendChild(textarea);
      textarea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (successful) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (err) {
      console.warn('Fallback copy error:', err);
    }
  };

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  const getLevelStyle = (level: LogEntry['level']) => {
    switch (level) {
      case 'error':
        return 'text-rose-400 font-semibold';
      case 'warn':
        return 'text-amber-300';
      case 'success':
        return 'text-emerald-400 font-medium';
      default:
        return 'text-slate-300';
    }
  };

  return (
    <div className="bg-slate-900 text-slate-200 rounded-lg border border-slate-700/80 flex flex-col h-full shadow-xs min-h-0 overflow-hidden">
      {/* Log Header */}
      <div className="px-3 py-1.5 border-b border-slate-800 bg-slate-950/80 rounded-t-lg flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-teal-400" />
          <h2 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
            运行日志
          </h2>
          <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono">
            {logs.length} 行
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setAutoScroll(true);
              scrollToBottom();
            }}
            className={`px-2 py-0.5 rounded text-[11px] font-medium flex items-center gap-1 transition-colors ${
              autoScroll
                ? 'bg-teal-950 text-teal-400 border border-teal-800/80'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
            title="滚至最底端"
          >
            <ArrowDown className="h-3 w-3" />
            <span>到底部</span>
          </button>

          <button
            type="button"
            onClick={handleCopyLogs}
            className="px-2 py-0.5 rounded text-[11px] font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 flex items-center gap-1 transition-colors"
            title="复制全部运行日志"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 text-emerald-400" />
                <span className="text-emerald-400">已复制</span>
              </>
            ) : (
              <>
                <Copy className="h-3 w-3 text-slate-400" />
                <span>复制日志</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onClearLogs}
            className="p-1 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded transition-colors"
            title="清空日志"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Log Output Console with generous bottom padding so bottom lines are never clipped */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-x-auto overflow-y-auto p-3 font-mono text-[11.5px] leading-relaxed space-y-1 select-text bg-slate-950/50 min-h-0 pb-10"
      >
        {logs.length === 0 ? (
          <div className="text-slate-600 italic py-6 text-center">暂无日志输出</div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="whitespace-pre flex items-start gap-2 hover:bg-slate-800/40 px-1 py-0.5 rounded">
              <span className="text-slate-500 shrink-0 select-none">
                [{log.timestamp}]
              </span>
              <span className={`break-all ${getLevelStyle(log.level)}`}>
                {log.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
