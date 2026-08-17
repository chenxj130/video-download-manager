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
  | '144p' | '240p' | '360p' | '480p' | '720p' | '1080p' | '1440p' | '2160p';

export type FileFormat = 'mp4' | 'webm' | 'mkv' | 'mov' | 'm4a' | 'mp3';

export type Theme = 'light' | 'dark' | 'system';

export interface VideoFormatOption {
  resolution: Resolution;
  format: FileFormat;
  sizeBytes?: number;
  fps?: number;
  note?: string;
}

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
  simulated: boolean;
  estimatedBytes?: number;
}

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
  progress: number;
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
  maxSpeedBytesPerSec: number;
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
  successRate: number;
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

export interface ApiErrorBody {
  error: { code: string; message: string };
}
