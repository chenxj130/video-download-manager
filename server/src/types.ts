// 全局共享类型定义（后端）

export type Platform =
  | 'youtube'
  | 'bilibili'
  | 'vimeo'
  | 'x'
  | 'tiktok'
  | 'instagram'
  | 'unknown';

export type TaskStatus =
  | 'waiting'
  | 'parsing'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type Resolution =
  | '144p'
  | '240p'
  | '360p'
  | '480p'
  | '720p'
  | '1080p'
  | '1440p'
  | '2160p';

export type FileFormat = 'mp4' | 'webm' | 'mkv' | 'mov' | 'm4a' | 'mp3';

export type Theme = 'light' | 'dark' | 'system';

/** 解析阶段返回的单条可选格式 */
export interface VideoFormatOption {
  resolution: Resolution;
  format: FileFormat;
  /** 估算字节数（如可获取） */
  sizeBytes?: number;
  fps?: number;
  note?: string;
}

/** 解析接口返回的视频元信息 */
export interface VideoMetadata {
  url: string;
  platform: Platform;
  platformName: string;
  title: string;
  author: string;
  thumbnailUrl: string;
  durationSeconds: number;
  formats: VideoFormatOption[];
  availableResolutions: Resolution[];
  availableFormats: FileFormat[];
  webpageUrl: string;
  /** 是否真实抓取（false 表示模拟数据） */
  simulated: boolean;
  /** 模拟模式下文件体积估算基数（字节），用于生成可选大小 */
  estimatedBytes?: number;
}

/** 下载任务（与数据库字段对应） */
export interface DownloadTask {
  id: string;
  url: string;
  platform: Platform;
  platformName: string;
  title: string;
  author: string;
  thumbnailUrl: string;
  durationSeconds: number;
  resolution: Resolution;
  format: FileFormat;
  saveDir: string;
  fileName: string;
  filePath: string;
  fileSizeBytes: number;
  downloadedBytes: number;
  speedBytesPerSec: number;
  status: TaskStatus;
  errorCode?: string;
  errorMessage?: string;
  progress: number; // 0-100
  etaSeconds?: number;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface Settings {
  defaultQuality: Resolution;
  defaultFormat: FileFormat;
  maxConcurrent: number;
  defaultSaveDir: string;
  maxSpeedBytesPerSec: number; // 0 = 不限速
  requestTimeoutSeconds: number;
  autoRetryCount: number;
  theme: Theme;
}

export interface DashboardStats {
  todayTasks: number;
  completed: number;
  downloading: number;
  failed: number;
  totalDownloadedBytes: number;
  totalTasks: number;
  successRate: number; // 0-100
  recentTasks: DownloadTask[];
  byPlatform: { platform: string; platformName: string; count: number }[];
  daily: { date: string; count: number; bytes: number }[];
  totalBytes: number;
}

export interface SystemInfo {
  version: string;
  databaseStatus: 'ok' | 'error';
  downloadDirStatus: 'ok' | 'missing' | 'error';
  downloadDir: string;
  diskFreeBytes: number;
  diskTotalBytes: number;
  engine: string;
  uptimeSeconds: number;
  nodeVersion: string;
  platform: string;
}

/** 标准 API 错误码 */
export type ApiErrorCode =
  | 'INVALID_URL'
  | 'UNSUPPORTED_PLATFORM'
  | 'PARSE_FAILED'
  | 'VIDEO_NOT_FOUND'
  | 'VIDEO_FORBIDDEN'
  | 'VIDEO_UNAVAILABLE'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'DISK_FULL'
  | 'WRITE_FAILED'
  | 'DUPLICATE_TASK'
  | 'TASK_NOT_FOUND'
  | 'ENGINE_UNAVAILABLE'
  | 'FILE_NOT_FOUND'
  | 'ACCESS_DENIED'
  | 'INVALID_PATH'
  | 'SAFE_DELETE_BLOCKED'
  | 'SHARE_PAGE_NOT_SUPPORTED';
