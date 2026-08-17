/** 字节格式化 */
export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
  const value = bytes / Math.pow(k, i);
  return `${value.toFixed(i === 0 ? 0 : decimals)} ${units[i]}`;
}

/** 速度格式化（字节/秒） */
export function formatSpeed(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '0 B/s';
  return `${formatBytes(bytesPerSec)}/s`;
}

/** 秒 -> mm:ss 或 hh:mm:ss */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(sec)}`;
  return `${pad(m)}:${pad(sec)}`;
}

/** 相对时间（中文） */
export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (abs < min) return '刚刚';
  if (abs < hour) return rtf.format(-Math.round(diff / min), 'minute');
  if (abs < day) return rtf.format(-Math.round(diff / hour), 'hour');
  if (abs < 30 * day) return rtf.format(-Math.round(diff / day), 'day');
  return new Date(iso).toLocaleDateString('zh-CN');
}

export function sanitizeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'video';
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** 简单字符串哈希（用于确定性模拟数据） */
export function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
