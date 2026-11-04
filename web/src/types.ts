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

/** 下载完成后探测到的媒体编码与可播放性信息 */
export interface TaskMedia {
  container?: string;
  videoCodec?: string;
  audioCodec?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  playerCompatible?: boolean;
  repaired?: boolean;
  notes?: string;
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
  media?: TaskMedia;
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

// ===== v1.1.0 MITM 嗅探下载接入层 =====
export type MitmPlatform = 'wechat' | 'douyin' | 'xiaohongshu';
export type MitmTaskStatus = 'waiting' | 'downloading' | 'completed' | 'failed' | 'cancelled';

export interface MitmDownloader {
  platform: MitmPlatform;
  name: string;
  color: string;
  description: string;
  adapterReady: boolean;
  sourceReachable: boolean;
  sourceHttpStatus: number | null;
  demoUrl: string;
  probeUrl: string;
  latencyMs: number | null;
  checkedAt: string;
}

export interface MitmValidation {
  valid: boolean;
  sizeMatches: boolean;
  magicValid: boolean;
  actualSize: number;
  expectedSize: number;
  headerHex: string;
  ffprobe?: string;
  reason?: string;
}

export interface MitmTask {
  id: string;
  url: string;
  platform: MitmPlatform | 'unknown';
  platformName: string;
  title: string;
  fileName: string;
  filePath: string;
  suffix: string;
  status: MitmTaskStatus;
  progress: number;
  downloadedBytes: number;
  fileSizeBytes: number;
  speedBytesPerSec: number;
  etaSeconds: number | null;
  errorCode?: string;
  errorMessage?: string;
  source: 'fixture' | 'external' | 'bridge';
  headers: Record<string, string>;
  validation?: MitmValidation;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface MitmStatus {
  ok: boolean;
  module: string;
  version: string;
  enabled: boolean;
  engine: { type: string; ready: boolean; maxConcurrent: number; timeoutMs: number; downloadDir: string };
  fixture: { enabled: boolean; assetReady: boolean; assetPath: string | null; rangeSupported: boolean };
  bridge: {
    enabled: boolean;
    online: boolean;
    baseUrl: string;
    appName?: string;
    version?: string;
    isProxy?: boolean;
    latencyMs: number | null;
    checkedAt: string;
    error?: string;
  };
  platforms: { key: string; name: string; color: string }[];
  time: string;
}

export interface MitmProbe {
  platform: MitmPlatform | 'unknown';
  platformName: string;
  matched: boolean;
  headers: Record<string, string>;
  suggestedName: string;
  suffix: string;
  isLocalSource: boolean;
  isSharePage?: boolean;
}
