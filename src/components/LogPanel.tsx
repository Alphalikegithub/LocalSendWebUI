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

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleCopyLogs = () => {
    const text = logs.map((l) => `[${l.timestamp}] ${l.message}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
    <div className="bg-slate-900 text-slate-200 rounded-lg border border-slate-700/80 flex flex-col h-full shadow-xs">
      {/* Log Header */}
      <div className="px-3 py-1.5 border-b border-slate-800 bg-slate-950/70 rounded-t-lg flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-teal-400" />
          <h2 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
            运行日志
          </h2>
          <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono">
            {logs.length} 行
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setAutoScroll(!autoScroll)}
            className={`px-2 py-0.5 rounded text-[11px] font-medium flex items-center gap-1 transition-colors ${
              autoScroll
                ? 'bg-teal-950 text-teal-400 border border-teal-800/80'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
            title={autoScroll ? '自动滚屏已开启' : '自动滚屏已关闭'}
          >
            <ArrowDown className="h-3 w-3" />
            <span>滚屏</span>
          </button>

          <button
            type="button"
            onClick={handleCopyLogs}
            className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition-colors"
            title="复制所有日志"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
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

      {/* Log Output Console */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-x-auto overflow-y-auto p-2.5 font-mono text-[11.5px] leading-relaxed space-y-0.5 select-text bg-slate-950/40"
      >
        {logs.length === 0 ? (
          <div className="text-slate-600 italic py-4 text-center">暂无日志输出</div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="whitespace-pre flex items-start gap-2 hover:bg-slate-800/30 px-1 rounded">
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
