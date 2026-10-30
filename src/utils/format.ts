export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < 4) {
    value /= 1024;
    unitIndex++;
  }
  if (unitIndex === 0) {
    return `${Math.round(bytes)} B`;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

export function getCurrentTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

export function generateFingerprint(): string {
  const chars = '0123456789ABCDEF';
  let result = '';
  for (let i = 0; i < 64; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}
