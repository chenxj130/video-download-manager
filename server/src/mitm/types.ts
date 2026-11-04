// MITM 嗅探下载接入层 — 共享类型
// 该模块与现有 tasks/parse/dashboard 完全隔离，独立类型，避免污染主项目。

/** 支持的第三方 MITM 平台（每个平台即一个独立「下载器」通道） */
export type MitmPlatform = 'wechat' | 'douyin' | 'xiaohongshu';

export type MitmTaskStatus =
  | 'waiting'
  | 'downloading'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** 平台适配器：定义一个下载器的识别规则、请求头、命名与产物约定 */
export interface MitmPlatformAdapter {
  key: MitmPlatform;
  name: string;
  shortName: string;
  /** 品牌色（前端展示） */
  color: string;
  /** 直链 host 匹配片段（命中即认定为该平台资源） */
  hostHints: string[];
  /** 页面 host 匹配片段（用于从落地页 URL 推断平台） */
  pageHostHints: string[];
  /** 防盗链 Referer —— 缺失会被 CDN 拒绝 */
  referer: string;
  /** 默认 User-Agent */
  userAgent: string;
  /** 额外固定请求头 */
  extraHeaders: Record<string, string>;
  /** 默认产物后缀 */
  suffix: string;
  /** 该平台资源说明 */
  description: string;
}

/** URL 探测结果 */
export interface MitmProbeResult {
  platform: MitmPlatform | 'unknown';
  platformName: string;
  matched: boolean;
  /** Suggested headers 用于后续真实下载 */
  headers: Record<string, string>;
  /** 建议文件名（不含后缀） */
  suggestedName: string;
  suffix: string;
  /** 是否为本模块内置的确定性 CDN 源 */
  isLocalSource: boolean;
  /** 是否为平台「分享页/落地页」URL（非直链，需抓包获取真实直链） */
  isSharePage: boolean;
}

/** 单个下载器通道的运行状态 */
export interface MitmDownloaderStatus {
  platform: MitmPlatform;
  name: string;
  color: string;
  description: string;
  /** 适配器是否已就绪 */
  adapterReady: boolean;
  /** 内置确定性源是否可访问（真实 HTTP 探测） */
  sourceReachable: boolean;
  sourceHttpStatus: number | null;
  /** 演示直链（可直接下载到真实可播放 mp4） */
  demoUrl: string;
  /** 探测端点 */
  probeUrl: string;
  /** 最近一次探测耗时 ms */
  latencyMs: number | null;
  checkedAt: string;
}

/** MITM 下载任务 */
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
  progress: number; // 0-100
  downloadedBytes: number;
  fileSizeBytes: number;
  speedBytesPerSec: number;
  etaSeconds: number | null;
  errorCode?: string;
  errorMessage?: string;
  /** 产物来源：内置确定性源 / 外部直链 / 第三方桥接 */
  source: 'fixture' | 'external' | 'bridge';
  /** 请求头（脱敏后可用于排查） */
  headers: Record<string, string>;
  /** 产物校验结果（完成时附带） */
  validation?: MitmValidation;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

/** 产物校验结果 */
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
