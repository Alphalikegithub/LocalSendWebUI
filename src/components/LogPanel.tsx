import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal, Copy, Trash2, ArrowDown, Check } from 'lucide-react';
import { LogEntry } from '../types';

interface LogPanelProps {
  logs: LogEntry[];
  onClearLogs: () => void;
}

export const LogPanel: React.FC<LogPanelProps> = ({ logs, onClearLogs }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomMarkerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copyStatusMsg, setCopyStatusMsg] = useState('');

  // Auto-scroll to bottom whenever logs change or autoScroll is toggled
  const scrollToBottom = useCallback((force = false) => {
    if (force || autoScroll) {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight + 2000;
      }
      bottomMarkerRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
    }
  }, [autoScroll]);

  useEffect(() => {
    scrollToBottom();
  }, [logs, scrollToBottom]);

  // Global keyboard shortcut: Ctrl+Shift+C or Alt+C to copy all logs
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'c') || (e.altKey && e.key.toLowerCase() === 'c')) {
        e.preventDefault();
        handleCopyLogs();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [logs]);

  // Robust clipboard copy with fallback that works on HTTP, remote IPs, and all environments
  const handleCopyLogs = () => {
    if (logs.length === 0) return;
    const text = logs.map((l) => `[${l.timestamp}] ${l.message}`).join('\n');

    let copiedSuccessfully = false;

    // 1. Try modern clipboard API if available
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          triggerCopiedFeedback(`已复制 ${logs.length} 行日志 (快捷键: Ctrl+Shift+C)`);
        })
        .catch(() => {
          fallbackCopy(text);
        });
      return;
    }

    fallbackCopy(text);
  };

  const fallbackCopy = (text: string) => {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'absolute';
      textarea.style.left = '0';
      textarea.style.top = '0';
      textarea.style.width = '2em';
      textarea.style.height = '2em';
      textarea.style.padding = '0';
      textarea.style.border = 'none';
      textarea.style.outline = 'none';
      textarea.style.boxShadow = 'none';
      textarea.style.background = 'transparent';
      textarea.style.opacity = '0.01';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);

      const successful = document.execCommand('copy');
      document.body.removeChild(textarea);

      if (successful) {
        triggerCopiedFeedback(`已复制 ${logs.length} 行日志`);
      } else {
        triggerCopiedFeedback('请手动按 Ctrl+A 选中日志后复制');
      }
    } catch (err) {
      triggerCopiedFeedback('复制失败，请全选日志内容复制');
    }
  };

  const triggerCopiedFeedback = (msg: string) => {
    setCopied(true);
    setCopyStatusMsg(msg);
    setTimeout(() => {
      setCopied(false);
      setCopyStatusMsg('');
    }, 2500);
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
    <div className="bg-slate-900 text-slate-200 rounded-lg border border-slate-700/80 flex flex-col h-full shadow-xs min-h-0 overflow-hidden relative">
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
          {copyStatusMsg && (
            <span className="text-[11px] font-medium text-emerald-400 bg-emerald-950/80 border border-emerald-800/60 px-2 py-0.5 rounded animate-fade-in">
              {copyStatusMsg}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setAutoScroll(true);
              scrollToBottom(true);
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
            className={`px-2 py-0.5 rounded text-[11px] font-medium flex items-center gap-1 transition-colors ${
              copied
                ? 'bg-emerald-900/80 text-emerald-300 border border-emerald-700/80'
                : 'text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700'
            }`}
            title="复制全部运行日志到剪贴板 (快捷键: Ctrl+Shift+C 或 Alt+C)"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 text-emerald-400" />
                <span>已复制</span>
              </>
            ) : (
              <>
                <Copy className="h-3 w-3 text-slate-400" />
                <span>复制日志 (Ctrl+Shift+C)</span>
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

      {/* Log Output Console with dedicated bottom marker anchor */}
      <div
        ref={scrollRef}
        onWheel={(e) => {
          // If user scrolls up, pause autoScroll; if scrolled back to bottom, resume
          if (scrollRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
            const isAtBottom = scrollHeight - scrollTop - clientHeight < 40;
            setAutoScroll(isAtBottom);
          }
        }}
        className="flex-1 overflow-x-auto overflow-y-auto p-3 font-mono text-[11.5px] leading-relaxed space-y-1 select-text bg-slate-950/60 min-h-0"
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
        {/* Scroll anchor that ensures the very last line is never cut off */}
        <div ref={bottomMarkerRef} className="h-10 shrink-0" />
      </div>
    </div>
  );
};
