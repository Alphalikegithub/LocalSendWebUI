import React, { useState } from 'react';
import { RefreshCw, Monitor, Smartphone, Server, Plus, X, Search, CheckCircle2 } from 'lucide-react';
import { Device } from '../types';

interface DevicePanelProps {
  devices: Device[];
  selectedTarget: string;
  onSelectTarget: (target: string) => void;
  isScanning: boolean;
  scanStatusText: string;
  onRefresh: () => void;
  onAddCustomDevice: (alias: string, ip: string) => void;
  disabled?: boolean;
}

export const DevicePanel: React.FC<DevicePanelProps> = ({
  devices,
  selectedTarget,
  onSelectTarget,
  isScanning,
  scanStatusText,
  onRefresh,
  onAddCustomDevice,
  disabled = false,
}) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [newAlias, setNewAlias] = useState('');
  const [newIp, setNewIp] = useState('');
  const [filterQuery, setFilterQuery] = useState('');

  const filteredDevices = devices.filter(
    (d) =>
      d.alias.toLowerCase().includes(filterQuery.toLowerCase()) ||
      d.ip.toLowerCase().includes(filterQuery.toLowerCase())
  );

  const handleAddDevice = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIp.trim()) return;
    const alias = newAlias.trim() || `设备-${newIp.split('.').pop() || 'Node'}`;
    onAddCustomDevice(alias, newIp.trim());
    setNewAlias('');
    setNewIp('');
    setShowAddModal(false);
  };

  const getDeviceIcon = (type: Device['deviceType']) => {
    switch (type) {
      case 'mobile':
        return <Smartphone className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />;
      case 'server':
        return <Server className="h-4 w-4 text-purple-600 dark:text-purple-400" />;
      default:
        return <Monitor className="h-4 w-4 text-sky-600 dark:text-sky-400" />;
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 flex flex-col h-full shadow-xs">
      {/* Group Box Header */}
      <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 rounded-t-lg flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider">
            目标设备
          </h2>
          <span className="text-[11px] px-1.5 py-0.2 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-mono">
            {devices.length}
          </span>
        </div>

        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          disabled={disabled}
          className="text-xs text-teal-600 hover:text-teal-700 dark:text-teal-400 flex items-center gap-1 font-medium hover:underline disabled:opacity-50"
        >
          <Plus className="h-3 w-3" />
          <span>添加 IP</span>
        </button>
      </div>

      {/* Search / Filter bar if multiple devices */}
      {devices.length > 3 && (
        <div className="px-3 py-1.5 border-b border-slate-100 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-900/20">
          <div className="relative">
            <Search className="h-3 w-3 absolute left-2 top-2 text-slate-400" />
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="过滤设备名称或 IP..."
              className="w-full text-xs pl-7 pr-2 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-teal-500"
            />
          </div>
        </div>
      )}

      {/* Device List Box */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-[160px] max-h-[300px]">
        {filteredDevices.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-4 text-center text-slate-400 dark:text-slate-500">
            <Monitor className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-xs font-medium">暂无发现的设备</p>
            <p className="text-[11px] mt-1 text-slate-400">
              请确认同一局域网下的 LocalSend 已打开，或点击下方“刷新设备”重新扫描
            </p>
          </div>
        ) : (
          filteredDevices.map((device, idx) => {
            const isSelected = selectedTarget === device.ip || selectedTarget === device.alias;
            const isEven = idx % 2 === 0;

            return (
              <div
                key={device.id}
                onClick={() => onSelectTarget(device.ip)}
                title={`名称: ${device.alias}\nIP 地址: ${device.ip}:${device.port}\n设备指纹: ${device.fingerprint}`}
                className={`flex items-center justify-between p-2 rounded cursor-pointer transition-all border text-xs select-none ${
                  isSelected
                    ? 'bg-teal-50 dark:bg-teal-950/40 border-teal-500 text-teal-900 dark:text-teal-200 font-medium shadow-xs'
                    : isEven
                    ? 'bg-slate-50 dark:bg-slate-800/40 border-transparent hover:bg-slate-100 dark:hover:bg-slate-700/60'
                    : 'bg-white dark:bg-slate-800 border-transparent hover:bg-slate-100 dark:hover:bg-slate-700/60'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="p-1 rounded bg-slate-100 dark:bg-slate-700/80">
                    {getDeviceIcon(device.deviceType)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold truncate text-slate-800 dark:text-slate-100">
                        {device.alias}
                      </span>
                      {device.deviceModel && (
                        <span className="text-[10px] text-slate-400 font-normal hidden sm:inline">
                          ({device.deviceModel})
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                      {device.ip}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 pl-2">
                  {isSelected && (
                    <CheckCircle2 className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                  )}
                  <span
                    className={`h-2 w-2 rounded-full ${
                      device.isOnline ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
                    }`}
                    title={device.isOnline ? '在线' : '离线'}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Target input and discovery control bar */}
      <div className="p-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/60 space-y-2.5 rounded-b-lg">
        {/* Send to target input field */}
        <div className="flex items-center gap-2">
          <label
            htmlFor="target-input"
            className="text-xs font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap shrink-0"
          >
            发送到：
          </label>
          <div className="relative flex-1">
            <input
              id="target-input"
              type="text"
              value={selectedTarget}
              onChange={(e) => onSelectTarget(e.target.value)}
              disabled={disabled}
              placeholder="设备名或 IP 地址"
              className="w-full text-xs px-2.5 py-1.5 pr-7 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded text-slate-800 dark:text-slate-100 font-mono focus:outline-hidden focus:ring-1 focus:ring-teal-500 focus:border-teal-500 disabled:opacity-50"
            />
            {selectedTarget && !disabled && (
              <button
                type="button"
                onClick={() => onSelectTarget('')}
                className="absolute right-1.5 top-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                title="清空目标"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Discovery refresh button and status */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={isScanning || disabled}
            className="px-3 py-1.5 bg-white dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-xs font-medium rounded flex items-center gap-1.5 shrink-0 transition-colors shadow-2xs disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-teal-600 ${isScanning ? 'animate-spin' : ''}`} />
            <span>{isScanning ? '扫描中…' : '刷新设备'}</span>
          </button>

          <div
            className="text-[11px] text-slate-500 dark:text-slate-400 truncate flex-1"
            title={scanStatusText}
          >
            {scanStatusText}
          </div>
        </div>

        {/* Hints */}
        <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-tight">
          提示：也可以直接输入对方设备的 IP。接收模式可实时接收局域网设备发送的文件。
        </p>
      </div>

      {/* Manual Add IP Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-2xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-sm w-full border border-slate-200 dark:border-slate-700 p-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-700 mb-3">
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                手动添加局域网设备
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleAddDevice} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-600 dark:text-slate-300 mb-1 font-medium">
                  IP 地址 (必填):
                </label>
                <input
                  type="text"
                  required
                  placeholder="例如: 192.168.1.108"
                  value={newIp}
                  onChange={(e) => setNewIp(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 font-mono focus:outline-hidden focus:ring-1 focus:ring-teal-500"
                />
              </div>

              <div>
                <label className="block text-slate-600 dark:text-slate-300 mb-1 font-medium">
                  设备名称 / 别名 (可选):
                </label>
                <input
                  type="text"
                  placeholder="例如: 办公室台式机 / 手机"
                  value={newAlias}
                  onChange={(e) => setNewAlias(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-hidden focus:ring-1 focus:ring-teal-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-1.5 rounded border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded bg-teal-600 hover:bg-teal-700 text-white font-medium"
                >
                  确定添加
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
