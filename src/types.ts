export interface Device {
  id: string;
  alias: string;
  ip: string;
  port: number;
  deviceModel?: string;
  deviceType: 'desktop' | 'mobile' | 'server' | 'web';
  fingerprint: string;
  isOnline: boolean;
  lastSeen: number;
}

export interface TransferFile {
  id: string;
  name: string;
  size: number;
  type: string;
  isDir?: boolean;
  itemCount?: number;
  fileObj?: File;
  previewUrl?: string;
}

export interface TransferProgress {
  status: 'idle' | 'connecting' | 'transferring' | 'completed' | 'cancelled' | 'error';
  currentFileIndex: number;
  totalFiles: number;
  bytesTransferred: number;
  totalBytes: number;
  speedBytesPerSec: number;
  etaSeconds: number;
  errorMessage?: string;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  message: string;
  level: 'info' | 'warn' | 'error' | 'success';
}

export interface AppSettings {
  deviceAlias: string;
  port: number;
  multicastGroup: string;
  fingerprint: string;
  autoSaveToDownloads: boolean;
  cliPath: string;
}

export interface ReceivedTransfer {
  id: string;
  senderAlias: string;
  senderIp: string;
  timestamp: string;
  files: {
    name: string;
    size: number;
    type: string;
    blobUrl?: string;
  }[];
  totalSize: number;
  status: 'pending' | 'accepted' | 'declined' | 'completed';
}
