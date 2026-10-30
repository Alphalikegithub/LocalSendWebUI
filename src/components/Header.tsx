import React, { useState } from 'react';
import { Send, Radio, Settings, History, ShieldCheck, Moon, Sun, Laptop, Globe, Copy, Check } from 'lucide-react';
import { AppSettings } from '../types';

interface HeaderProps {
  settings: AppSettings;
  localAddresses: { ip: string; name: string }[];
  onOpenSettings: () => void;
  onOpenHistory: () => void;
  receivedCount: number;
  darkMode: boolean;
  onToggleDarkMode: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  settings,
  localAddresses,
  onOpenSettings,
  onOpenHistory,
  receivedCount,
  darkMode,
  onToggleDarkMode,
}) => {
  const [copiedUrl, setCopiedUrl] = useState(false);
  const primaryLanIp = localAddresses[0]?.ip;

  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  return (
    <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shadow-xs">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-teal-600 text-white flex items-center justify-center shadow-xs">
          <Send className="h-5 w-5 transform -rotate-12" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-bold text-slate-800 dark:text-slate-100 leading-tight">
              LocalSend GUI
            </h1>
            <span className="text-xs px-2 py-0.5 rounded-full bg-teal-50 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 font-medium border border-teal-200 dark:border-teal-700/50">
              局域网文件传输
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 mt-0.5">
            <span className="flex items-center gap-1 font-mono text-slate-600 dark:text-slate-300">
              <Laptop className="h-3 w-3 text-slate-400" />
              {settings.deviceAlias}
            </span>
            <span>•</span>
            <span className="flex items-center gap-1 text-slate-500">
              <Radio className="h-3 w-3 text-teal-600" />
              端口: {settings.port}
            </span>
            <span>•</span>
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="h-3 w-3" />
              mTLS 就绪
            </span>
          </p>
        </div>
      </div>

      {/* Middle: Access URLs indicator */}
      <div className="hidden md:flex items-center gap-2 bg-slate-50 dark:bg-slate-900/60 px-3 py-1 rounded-full border border-slate-200 dark:border-slate-700 text-xs">
        <Globe className="h-3.5 w-3.5 text-teal-600" />
        <span className="text-slate-500">本机访问:</span>
        <button
          onClick={() => handleCopyUrl('http://localhost:3000')}
          className="font-mono text-teal-600 hover:text-teal-700 dark:text-teal-400 font-medium hover:underline flex items-center gap-1"
          title="点击复制访问地址"
        >
          <span>http://localhost:3000</span>
          {copiedUrl ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3 opacity-60" />}
        </button>
        {primaryLanIp && (
          <>
            <span className="text-slate-300 dark:text-slate-600">|</span>
            <span className="text-slate-500">局域网:</span>
            <button
              onClick={() => handleCopyUrl(`http://${primaryLanIp}:3000`)}
              className="font-mono text-slate-700 dark:text-slate-300 hover:text-teal-600 font-medium hover:underline"
              title="同局域网手机或其他电脑访问地址"
            >
              http://{primaryLanIp}:3000
            </button>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onOpenHistory}
          className="relative px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 rounded-md transition-colors flex items-center gap-1.5"
          title="查看接收与传输记录"
        >
          <History className="h-3.5 w-3.5" />
          <span>传输记录</span>
          {receivedCount > 0 && (
            <span className="ml-1 px-1.5 py-0.2 bg-teal-600 text-white rounded-full text-[10px] font-bold">
              {receivedCount}
            </span>
          )}
        </button>

        <button
          onClick={onOpenSettings}
          className="p-1.5 text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md transition-colors"
          title="网络与身份配置"
        >
          <Settings className="h-4 w-4" />
        </button>

        <button
          onClick={onToggleDarkMode}
          className="p-1.5 text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md transition-colors"
          title={darkMode ? '切换到浅色模式' : '切换到深色模式'}
        >
          {darkMode ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>
    </header>
  );
};
