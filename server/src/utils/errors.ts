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
  let rawMsg = err instanceof Error ? err.message : String(err);
  
  // 过滤掉 stderr 中的警告行（如 Deprecated Feature / WARNING 等），提取真实有效错误
  const validLines = rawMsg
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('WARNING:') && !l.startsWith('Deprecated Feature:'));
  
  const msg = validLines.length > 0 ? validLines.join(' ') : rawMsg;
  const lower = msg.toLowerCase();

  // B站 / 云机房 IP 触发安全风控拦截（HTTP 412 Precondition Failed）
  if (lower.includes('412') || lower.includes('precondition failed'))
    return {
      code: 'VIDEO_FORBIDDEN',
      message: 'B站触发机房IP安全风控拦截(HTTP 412)。由于云服务器IP段被B站识别为数据中心流量，需在服务端配置有效Cookie以完成身份验证。',
    };
  if (lower.includes('not found') || lower.includes('404'))
    return { code: 'VIDEO_NOT_FOUND', message: '视频不存在' };
  if (lower.includes('forbidden') || lower.includes('403') || lower.includes('private'))
    return { code: 'VIDEO_FORBIDDEN', message: '视频资源不可访问（可能需要登录或私密视频）' };
  if (lower.includes('unavailable'))
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

  return { code: 'PARSE_FAILED', message: `解析失败：${msg.slice(0, 150)}` };
}
