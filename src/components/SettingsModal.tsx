import React, { useState } from 'react';
import { X, Shield, Terminal, Save, RotateCcw, Key } from 'lucide-react';
import { AppSettings } from '../types';
import { generateFingerprint } from '../utils/format';

interface SettingsModalProps {
  settings: AppSettings;
  onSave: (newSettings: AppSettings) => void;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  onSave,
  onClose,
}) => {
  const [form, setForm] = useState<AppSettings>({ ...settings });

  const handleRegenerateFingerprint = () => {
    setForm({
      ...form,
      fingerprint: generateFingerprint(),
    });
  };

  const handleResetDefaults = () => {
    setForm({
      deviceAlias: 'LocalSend-Web-Client',
      port: 53317,
      multicastGroup: '224.0.0.167',
      fingerprint: generateFingerprint(),
      autoSaveToDownloads: true,
      cliPath: '/usr/local/bin/localsend-cli',
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-2xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-2xl max-w-lg w-full border border-slate-200 dark:border-slate-700 overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-teal-600" />
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
              LocalSend GUI 网络与身份配置
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              本设备别名 (Alias)
            </label>
            <input
              type="text"
              required
              value={form.deviceAlias}
              onChange={(e) => setForm({ ...form, deviceAlias: e.target.value })}
              className="w-full px-2.5 py-1.5 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-hidden focus:ring-1 focus:ring-teal-500"
            />
            <span className="text-[11px] text-slate-400">
              在其他 LocalSend 设备扫描时所显示的本机名称。
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                监听端口 (Port)
              </label>
              <input
                type="number"
                required
                value={form.port}
                onChange={(e) => setForm({ ...form, port: parseInt(e.target.value) || 53317 })}
                className="w-full px-2.5 py-1.5 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 font-mono focus:outline-hidden focus:ring-1 focus:ring-teal-500"
              />
              <span className="text-[11px] text-slate-400">LocalSend 默认协议端口为 53317</span>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                组播地址 (Multicast)
              </label>
              <input
                type="text"
                required
                value={form.multicastGroup}
                onChange={(e) => setForm({ ...form, multicastGroup: e.target.value })}
                className="w-full px-2.5 py-1.5 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 font-mono focus:outline-hidden focus:ring-1 focus:ring-teal-500"
              />
              <span className="text-[11px] text-slate-400">UDP 发现组播地址</span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                <Key className="h-3.5 w-3.5 text-amber-500" />
                <span>TLS 安全指纹 (Fingerprint SHA-256)</span>
              </label>
              <button
                type="button"
                onClick={handleRegenerateFingerprint}
                className="text-[11px] text-teal-600 hover:text-teal-700 font-medium"
              >
                重新生成
              </button>
            </div>
            <textarea
              rows={2}
              readOnly
              value={form.fingerprint}
              className="w-full px-2.5 py-1.5 border border-slate-300 dark:border-slate-600 rounded bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 font-mono text-[11px] select-all"
            />
            <span className="text-[11px] text-slate-400">
              用于 LocalSend v2 mTLS 双向认证证书比对以识别设备唯一性。
            </span>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
              <Terminal className="h-3.5 w-3.5 text-slate-500" />
              <span>CLI 引擎可执行路径 (LOCALSEND_CLI)</span>
            </label>
            <input
              type="text"
              value={form.cliPath}
              onChange={(e) => setForm({ ...form, cliPath: e.target.value })}
              className="w-full px-2.5 py-1.5 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 font-mono text-xs focus:outline-hidden focus:ring-1 focus:ring-teal-500"
            />
            <span className="text-[11px] text-slate-400">
              可配置系统安装的 localsend-cli 路径或使用内置 Web Engine。
            </span>
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={handleResetDefaults}
              className="px-2.5 py-1.5 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 flex items-center gap-1 transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>恢复默认值</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                取消
              </button>
              <button
                type="submit"
                className="px-3.5 py-1.5 bg-teal-600 hover:bg-teal-700 text-white font-medium rounded flex items-center gap-1.5 shadow-xs"
              >
                <Save className="h-3.5 w-3.5" />
                <span>保存配置</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
