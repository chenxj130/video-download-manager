import { useEffect, useState } from 'react';
import { api } from '../api';
import type { SystemInfo } from '../types';
import { Icon } from './icons';

const DISMISS_KEY = 'vdm.engineBannerDismissed';

/**
 * 引擎状态横幅。
 * 当后端运行在 simulate（模拟）引擎时必须显著提示：
 * 下载产生的是占位文件，不是真实视频。避免用户误判。
 */
export function EngineBanner() {
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem(DISMISS_KEY) === '1'
  );

  useEffect(() => {
    api
      .system()
      .then((r) => setSystem(r.system))
      .catch(() => setSystem(null));
  }, []);

  if (!system || system.engine !== 'simulate' || dismissed) return null;

  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
      <span className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400">
        <Icon name="alert" size={18} />
      </span>
      <div className="min-w-0 flex-1 text-amber-900 dark:text-amber-200">
        <p className="font-semibold">当前为模拟下载模式，不会下载真实视频</p>
        <p className="mt-1 leading-relaxed text-amber-800/90 dark:text-amber-200/80">
          系统未检测到 <code className="rounded bg-amber-200/60 px-1 dark:bg-amber-500/20">yt-dlp</code>，
          任务会生成同等体积的占位文件用于演示队列与进度。要下载真实视频，请安装依赖后重启服务：
        </p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-amber-900/10 px-3 py-2 text-[12px] leading-relaxed text-amber-900 dark:bg-black/30 dark:text-amber-100">
{`brew install yt-dlp ffmpeg
# 或：pipx install yt-dlp`}
        </pre>
      </div>
      <button
        onClick={() => {
          sessionStorage.setItem(DISMISS_KEY, '1');
          setDismissed(true);
        }}
        aria-label="关闭提示"
        className="shrink-0 rounded-lg p-1 text-amber-700 transition-colors hover:bg-amber-200/60 dark:text-amber-300 dark:hover:bg-amber-500/20"
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
