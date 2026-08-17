import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile, spawn } from 'node:child_process';

const execFileAsync = promisify(execFile);

/** 跨平台获取磁盘剩余/总空间（字节） */
export async function getDiskSpace(dir: string): Promise<{ free: number; total: number }> {
  try {
    // Node 18.16+ 提供 statfsSync
    // @ts-ignore - 类型可能未覆盖
    const stat = fs.statfsSync(dir);
    const free = stat.bavail * stat.bsize;
    const total = stat.blocks * stat.bsize;
    return { free, total };
  } catch {
    // 回退：macOS/Linux 用 df
    try {
      const { stdout } = await execFileAsync('df', ['-k', dir], { timeout: 3000 });
      const line = stdout.trim().split('\n').pop() ?? '';
      const cols = line.split(/\s+/);
      const totalKb = Number(cols[1]);
      const availKb = Number(cols[3]);
      if (totalKb > 0 && availKb > 0) {
        return { free: availKb * 1024, total: totalKb * 1024 };
      }
    } catch {
      /* ignore */
    }
    return { free: Number.MAX_SAFE_INTEGER, total: Number.MAX_SAFE_INTEGER };
  }
}

/** 检查目录是否可写 */
export function isDirWritable(dir: string): boolean {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** 递归确保目录存在 */
export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/** 删除文件（忽略不存在） */
export function removeFileSafe(filePath: string): boolean {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** 估算文件大小 */
export function getFileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

/**
 * 检测可执行文件是否可用。
 * - 传入绝对路径时：直接校验存在且具备执行权限（支持不在 PATH 中的受管安装）
 * - 传入命令名时：走 which/where 查找 PATH
 */
export async function hasExecutable(name: string): Promise<boolean> {
  if (name.includes('/') || name.includes('\\')) {
    try {
      fs.accessSync(name, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  try {
    await execFileAsync(process.platform === 'win32' ? 'where' : 'which', [name], {
      timeout: 3000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 使用系统文件管理器打开目录。
 * 仅应在已验证 path 位于允许目录之后调用。
 */
export async function openFolder(dir: string): Promise<void> {
  const normalized = path.normalize(dir);
  if (!fs.existsSync(normalized) || !fs.statSync(normalized).isDirectory()) {
    throw new Error('目录不存在');
  }
  const [cmd, args] =
    process.platform === 'win32'
      ? ['explorer', [normalized]]
      : process.platform === 'darwin'
        ? ['open', [normalized]]
        : ['xdg-open', [normalized]];
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    proc.on('error', reject);
    proc.on('spawn', () => resolve());
  });
}
