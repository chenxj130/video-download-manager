import type { ApiErrorCode } from '../types.js';

export class ApiError extends Error {
  code: ApiErrorCode;
  status: number;
  constructor(code: ApiErrorCode, message: string, status = 400) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

/** 把底层/引擎错误映射到友好中文错误与错误码 */
export function mapEngineError(err: unknown): {
  code: ApiErrorCode;
  message: string;
} {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  if (lower.includes('not found') || lower.includes('404'))
    return { code: 'VIDEO_NOT_FOUND', message: '视频不存在' };
  if (lower.includes('forbidden') || lower.includes('403') || lower.includes('private'))
    return { code: 'VIDEO_FORBIDDEN', message: '视频资源不可访问（可能需要授权）' };
  if (lower.includes('unavailable') || lower.includes('unavailable'))
    return { code: 'VIDEO_UNAVAILABLE', message: '视频资源暂不可访问' };
  if (lower.includes('timeout'))
    return { code: 'TIMEOUT', message: '下载超时' };
  if (
    lower.includes('network') ||
    lower.includes('econn') ||
    lower.includes('reset') ||
    lower.includes('aborted')
  )
    return { code: 'NETWORK_ERROR', message: '网络连接中断' };
  if (lower.includes('disk') || lower.includes('no space') || lower.includes('ENOSPC'))
    return { code: 'DISK_FULL', message: '磁盘空间不足' };
  if (lower.includes('write') || lower.includes('EACCES') || lower.includes('EPERM'))
    return { code: 'WRITE_FAILED', message: '文件写入失败' };
  // WorkBuddy/沙箱安全策略拦截批量删除（HLS 分片清理超过阈值）
  if (lower.includes('safe-delete') || lower.includes('safe_delete_bulk_confirm_required'))
    return {
      code: 'SAFE_DELETE_BLOCKED',
      message:
        '当前运行环境的安全策略拦截了视频下载过程中的临时分片清理。' +
        '请在非沙箱环境（直接终端/原生应用）中使用，或在设置中开启“保留 HLS 分片”。',
    };

  return { code: 'PARSE_FAILED', message: `解析失败：${msg.slice(0, 120)}` };
}
