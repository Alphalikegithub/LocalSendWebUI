import React, { useRef, useState } from 'react';
import {
  FileText,
  Folder,
  Trash2,
  FilePlus,
  FolderPlus,
  Eraser,
  MessageSquare,
  FileArchive,
  Image,
  Video,
  Music,
  CheckSquare,
  Square,
  UploadCloud,
} from 'lucide-react';
import { TransferFile } from '../types';
import { formatBytes } from '../utils/format';

interface FilePanelProps {
  files: TransferFile[];
  onAddFiles: (newFiles: TransferFile[]) => void;
  onRemoveSelected: (ids: string[]) => void;
  onClearFiles: () => void;
  disabled?: boolean;
}

export const FilePanel: React.FC<FilePanelProps> = ({
  files,
  onAddFiles,
  onRemoveSelected,
  onClearFiles,
  disabled = false,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dirInputRef = useRef<HTMLInputElement>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDragOver, setIsDragOver] = useState(false);
  const [showTextModal, setShowTextModal] = useState(false);
  const [quickText, setQuickText] = useState('');

  // Calculate summary counts matching original C++ logic
  const fileCount = files.filter((f) => !f.isDir).length;
  const dirCount = files.filter((f) => f.isDir).length;
  const totalBytes = files.reduce((acc, f) => acc + f.size, 0);

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === files.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(files.map((f) => f.id)));
    }
  };

  const handleRemoveSelected = () => {
    if (selectedIds.size === 0) return;
    onRemoveSelected(Array.from(selectedIds));
    setSelectedIds(new Set());
  };

  const handleClear = () => {
    onClearFiles();
    setSelectedIds(new Set());
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const fileList: TransferFile[] = Array.from(e.target.files).map((file) => ({
      id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      isDir: false,
      fileObj: file,
    }));
    onAddFiles(fileList);
    e.target.value = '';
  };

  const handleDirInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const dirFiles = Array.from(e.target.files);
    // Find top-level directory name
    const topPath = dirFiles[0]?.webkitRelativePath?.split('/')[0] || '文件夹';
    const totalDirSize = dirFiles.reduce((acc, f) => acc + f.size, 0);

    const folderEntry: TransferFile = {
      id: `dir-${topPath}-${Date.now()}`,
      name: topPath,
      size: totalDirSize,
      type: 'directory',
      isDir: true,
      itemCount: dirFiles.length,
    };

    onAddFiles([folderEntry]);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (disabled) return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFiles: TransferFile[] = Array.from(e.dataTransfer.files).map((file) => ({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        isDir: false,
        fileObj: file,
      }));
      onAddFiles(droppedFiles);
    }
  };

  const handleAddText = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickText.trim()) return;
    const blob = new Blob([quickText], { type: 'text/plain;charset=utf-8' });
    const textFile: TransferFile = {
      id: `text-${Date.now()}`,
      name: `Note_${new Date().toISOString().slice(0, 10)}.txt`,
      size: blob.size,
      type: 'text/plain',
      isDir: false,
      fileObj: new File([blob], `Note_${new Date().toISOString().slice(0, 10)}.txt`, {
        type: 'text/plain',
      }),
    };
    onAddFiles([textFile]);
    setQuickText('');
    setShowTextModal(false);
  };

  const getFileIcon = (file: TransferFile) => {
    if (file.isDir) {
      return <Folder className="h-4 w-4 text-amber-500 fill-amber-500/20" />;
    }
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext) || file.type.startsWith('image/')) {
      return <Image className="h-4 w-4 text-blue-500" />;
    }
    if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext) || file.type.startsWith('video/')) {
      return <Video className="h-4 w-4 text-rose-500" />;
    }
    if (['mp3', 'wav', 'flac', 'aac', 'ogg'].includes(ext) || file.type.startsWith('audio/')) {
      return <Music className="h-4 w-4 text-violet-500" />;
    }
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
      return <FileArchive className="h-4 w-4 text-orange-500" />;
    }
    return <FileText className="h-4 w-4 text-slate-500" />;
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 flex flex-col h-full shadow-xs">
      {/* Group Box Header */}
      <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 rounded-t-lg flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider">
            待发送的文件 / 目录
          </h2>
          <span className="text-[11px] px-1.5 py-0.2 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-mono">
            {files.length} 项
          </span>
        </div>

        {files.length > 0 && (
          <button
            type="button"
            onClick={toggleSelectAll}
            disabled={disabled}
            className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 flex items-center gap-1 font-medium"
          >
            {selectedIds.size === files.length ? (
              <CheckSquare className="h-3.5 w-3.5 text-teal-600" />
            ) : (
              <Square className="h-3.5 w-3.5" />
            )}
            <span>{selectedIds.size === files.length ? '取消全选' : '全选'}</span>
          </button>
        )}
      </div>

      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileInputChange}
        className="hidden"
      />
      <input
        ref={dirInputRef}
        type="file"
        // @ts-expect-error webkitdirectory attribute is standard for directory picker
        webkitdirectory="true"
        onChange={handleDirInputChange}
        className="hidden"
      />

      {/* Files List / Drop Zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        className={`flex-1 overflow-y-auto p-2 min-h-[160px] max-h-[300px] transition-colors ${
          isDragOver
            ? 'bg-teal-50/80 dark:bg-teal-950/40 border-2 border-dashed border-teal-500'
            : ''
        }`}
        title="支持把文件或目录直接拖进窗口。"
      >
        {files.length === 0 ? (
          <div
            onClick={() => !disabled && fileInputRef.current?.click()}
            className="h-full border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-teal-400 dark:hover:border-teal-500/60 rounded-md flex flex-col items-center justify-center p-6 text-center cursor-pointer transition-colors"
          >
            <UploadCloud className="h-9 w-9 text-slate-400 dark:text-slate-500 mb-2" />
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              拖拽文件或目录到此处
            </p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
              或点击 “添加文件” / “添加目录” 按钮
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {files.map((file, idx) => {
              const isSelected = selectedIds.has(file.id);
              const isEven = idx % 2 === 0;

              return (
                <div
                  key={file.id}
                  onClick={() => toggleSelect(file.id)}
                  title={`${file.name}\n大小: ${formatBytes(file.size)}${
                    file.itemCount ? `\n包含文件: ${file.itemCount} 个` : ''
                  }`}
                  className={`flex items-center justify-between p-2 rounded cursor-pointer transition-all border text-xs select-none ${
                    isSelected
                      ? 'bg-teal-50 dark:bg-teal-950/40 border-teal-500 text-teal-900 dark:text-teal-200'
                      : isEven
                      ? 'bg-slate-50 dark:bg-slate-800/40 border-transparent hover:bg-slate-100 dark:hover:bg-slate-700/60'
                      : 'bg-white dark:bg-slate-800 border-transparent hover:bg-slate-100 dark:hover:bg-slate-700/60'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(file.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                    />
                    <div className="p-1 rounded bg-slate-100 dark:bg-slate-700/80 shrink-0">
                      {getFileIcon(file)}
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-slate-800 dark:text-slate-100 truncate">
                        {file.name}
                      </div>
                      {file.isDir && (
                        <span className="text-[10px] text-slate-400">
                          目录包含 {file.itemCount} 个文件
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 pl-2">
                    <span className="font-mono text-slate-500 dark:text-slate-400 text-[11px]">
                      {formatBytes(file.size)}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveSelected([file.id]);
                      }}
                      disabled={disabled}
                      className="text-slate-400 hover:text-rose-500 p-0.5 rounded transition-colors disabled:opacity-50"
                      title="移除此项"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Button Action Bar & Summary Label (matching Qt UI layout) */}
      <div className="p-2.5 border-t border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/60 rounded-b-lg space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="px-2.5 py-1.5 bg-white dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-xs font-medium rounded flex items-center gap-1.5 transition-colors shadow-2xs disabled:opacity-50"
          >
            <FilePlus className="h-3.5 w-3.5 text-teal-600" />
            <span>添加文件</span>
          </button>

          <button
            type="button"
            onClick={() => dirInputRef.current?.click()}
            disabled={disabled}
            className="px-2.5 py-1.5 bg-white dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-xs font-medium rounded flex items-center gap-1.5 transition-colors shadow-2xs disabled:opacity-50"
          >
            <FolderPlus className="h-3.5 w-3.5 text-amber-500" />
            <span>添加目录</span>
          </button>

          <button
            type="button"
            onClick={() => setShowTextModal(true)}
            disabled={disabled}
            className="px-2.5 py-1.5 bg-white dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-xs font-medium rounded flex items-center gap-1.5 transition-colors shadow-2xs disabled:opacity-50"
          >
            <MessageSquare className="h-3.5 w-3.5 text-sky-500" />
            <span>发送文本</span>
          </button>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleRemoveSelected}
              disabled={selectedIds.size === 0 || disabled}
              className="px-2.5 py-1.5 bg-white dark:bg-slate-700 hover:bg-rose-50 dark:hover:bg-rose-950/30 border border-slate-300 dark:border-slate-600 hover:border-rose-300 text-slate-700 dark:text-slate-200 hover:text-rose-600 text-xs font-medium rounded flex items-center gap-1.5 transition-colors shadow-2xs disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5 text-rose-500" />
              <span>移除选中 ({selectedIds.size})</span>
            </button>

            <button
              type="button"
              onClick={handleClear}
              disabled={files.length === 0 || disabled}
              className="px-2.5 py-1.5 bg-white dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-xs font-medium rounded flex items-center gap-1.5 transition-colors shadow-2xs disabled:opacity-40"
            >
              <Eraser className="h-3.5 w-3.5" />
              <span>清空</span>
            </button>
          </div>
        </div>

        {/* Summary Label matching Qt MainWindow::updateSummary */}
        <div className="text-xs font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900/50 px-2.5 py-1.5 rounded border border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between">
          <span>
            文件：<strong className="text-teal-600 dark:text-teal-400 font-mono">{fileCount}</strong> 个 &nbsp;&nbsp;&nbsp;&nbsp;
            目录：<strong className="text-amber-600 dark:text-amber-400 font-mono">{dirCount}</strong> 个 &nbsp;&nbsp;&nbsp;&nbsp;
            合计：<strong className="text-slate-800 dark:text-slate-100 font-mono">{formatBytes(totalBytes)}</strong>
          </span>
          <span className="text-[11px] text-slate-400">已就绪</span>
        </div>
      </div>

      {/* Quick Text / Note Modal */}
      {showTextModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-2xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-md w-full border border-slate-200 dark:border-slate-700 p-4">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 mb-2">
              发送快速文本 / 剪贴板文本
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
              内容将保存为文本文件并无缝传输至目标设备的剪贴板/存储中。
            </p>
            <form onSubmit={handleAddText}>
              <textarea
                rows={5}
                required
                value={quickText}
                onChange={(e) => setQuickText(e.target.value)}
                placeholder="在此粘贴或输入需要发送的文本、链接或备忘录..."
                className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 font-mono focus:outline-hidden focus:ring-1 focus:ring-teal-500 mb-3"
              />
              <div className="flex justify-end gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setShowTextModal(false)}
                  className="px-3 py-1.5 rounded border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded bg-teal-600 hover:bg-teal-700 text-white font-medium"
                >
                  添加为待发送文件
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
