import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { ApiError } from './errors.js';

/**
 * 统一的路径白名单（安全边界）。
 *
 * 修复 P0：旧实现 `getAllowedBases()` 把每个任务的 `saveDir` 都加进白名单，
 * 而 `saveDir` 完全由 API 请求体控制 —— 攻击者提交一个指向任意目录的
 * saveDir，即可让该目录变成「允许读取」，再经 `/api/files/*` 与
 * `/system/open-folder` 越权读取服务器文件。
 *
 * 现在白名单只来自服务端配置：`config.downloadDir` + 显式授权的
 * `ALLOWED_EXTRA_DIRS`，与用户提交内容完全解耦。
 */
function realOrSelf(p: string): string {
  try {
    return path.normalize(fs.realpathSync(p));
  } catch {
    return path.normalize(p);
  }
}

function allowedBases(): string[] {
  const bases = [config.downloadDir, ...config.allowedExtraDirs].map((d) =>
    realOrSelf(path.resolve(d))
  );
  return bases;
}

/**
 * 判定绝对路径是否落在允许的目录内（含目录本身）。
 * 关键：对已存在的路径做 realpath 解析，防止「白名单目录内的符号链接指向外部文件」绕过；
 * 对尚不存在的路径（如待创建的保存目录），沿父链找到最近存在的祖先做 realpath。
 */
export function isPathAllowed(filePath: string): boolean {
  const resolved = path.normalize(path.resolve(filePath));
  let real = resolved;
  if (fs.existsSync(resolved)) {
    real = realOrSelf(resolved);
  } else {
    let parent = path.dirname(resolved);
    while (!fs.existsSync(parent) && parent !== path.dirname(parent)) {
      parent = path.dirname(parent);
    }
    const realParent = realOrSelf(parent);
    real = path.normalize(path.join(realParent, path.relative(parent, resolved)));
  }
  return allowedBases().some((base) => {
    const sepBase = base.endsWith(path.sep) ? base : base + path.sep;
    return real === base || real.startsWith(sepBase);
  });
}

/** 创建任务前校验保存目录；不在白名单内则拒绝，避免任意目录写入。 */
export function assertSafeSaveDir(dir: string): void {
  if (!isPathAllowed(dir)) {
    throw new ApiError(
      'INVALID_PATH',
      `保存目录不在允许范围内：${dir}。仅允许下载目录或其子目录；如需额外目录请配置 ALLOWED_EXTRA_DIRS`,
      400
    );
  }
}
