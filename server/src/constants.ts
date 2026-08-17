import type { FileFormat, Platform, Resolution } from './types.js';

export interface PlatformMeta {
  key: Platform;
  name: string;
  /** URL 主机名匹配规则（小写包含匹配） */
  hosts: string[];
  /** 主题色（用于 UI badge / 图表） */
  color: string;
  /** 是否支持真实下载（需 yt-dlp） */
  supportsReal: boolean;
}

export const PLATFORMS: PlatformMeta[] = [
  {
    key: 'youtube',
    name: 'YouTube',
    hosts: ['youtube.com', 'youtu.be', 'm.youtube.com'],
    color: '#FF0000',
    supportsReal: true,
  },
  {
    key: 'bilibili',
    name: 'Bilibili',
    hosts: ['bilibili.com', 'b23.tv', 'biligame.com'],
    color: '#FB7299',
    supportsReal: true,
  },
  {
    key: 'vimeo',
    name: 'Vimeo',
    hosts: ['vimeo.com', 'player.vimeo.com'],
    color: '#1AB7EA',
    supportsReal: true,
  },
  {
    key: 'x',
    name: 'X',
    hosts: ['x.com', 'twitter.com', 't.co'],
    color: '#000000',
    supportsReal: true,
  },
  {
    key: 'tiktok',
    name: 'TikTok',
    hosts: ['tiktok.com', 'vt.tiktok.com', 'vm.tiktok.com'],
    color: '#69C9D0',
    supportsReal: true,
  },
  {
    key: 'instagram',
    name: 'Instagram',
    hosts: ['instagram.com', 'instagr.am'],
    color: '#E1306C',
    supportsReal: true,
  },
];

export const RESOLUTIONS: Resolution[] = [
  '144p',
  '240p',
  '360p',
  '480p',
  '720p',
  '1080p',
  '1440p',
  '2160p',
];

export const FORMATS: FileFormat[] = [
  'mp4',
  'webm',
  'mkv',
  'mov',
  'm4a',
  'mp3',
];

export const STATUS_LABELS: Record<string, string> = {
  waiting: '等待中',
  parsing: '解析中',
  downloading: '下载中',
  paused: '已暂停',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

/** 各分辨率对应的「估算单分钟字节数」基数（模拟下载用）。
 *  数值随分辨率递增，仅用于演示真实文件写入体积。 */
export const RESOLUTION_BYTES_PER_MINUTE: Record<Resolution, number> = {
  '144p': 4 * 1024 * 1024,
  '240p': 8 * 1024 * 1024,
  '360p': 14 * 1024 * 1024,
  '480p': 24 * 1024 * 1024,
  '720p': 45 * 1024 * 1024,
  '1080p': 85 * 1024 * 1024,
  '1440p': 160 * 1024 * 1024,
  '2160p': 320 * 1024 * 1024,
};

/** 模拟下载时，把估算体积限制在合理范围，避免写盘过大（字节） */
export const SIMULATE_MIN_BYTES = 3 * 1024 * 1024;
export const SIMULATE_MAX_BYTES = 60 * 1024 * 1024;

export const CONCURRENCY_OPTIONS = [1, 2, 3, 5, 10];
