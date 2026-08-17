import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { api, ApiRequestError } from '../api';
import type { FileFormat, Resolution, Settings, SystemInfo, Theme } from '../types';
import { Button, Card, CardTitle, useToast } from '../components/ui';
import { Icon } from '../components/icons';
import { useTheme } from '../context/ThemeContext';
import { formatBytes } from '../lib/format';

const RESOLUTIONS: Resolution[] = ['144p', '240p', '360p', '480p', '720p', '1080p', '1440p', '2160p'];
const FORMATS: FileFormat[] = ['mp4', 'webm', 'mkv', 'mov', 'm4a', 'mp3'];
const CONCURRENCY = [1, 2, 3, 5, 10];

export function Settings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    api.settings().then((r) => setSettings(r.settings)).catch(() => {});
    api.system().then((r) => setSystem(r.system)).catch(() => {});
  }, []);

  const update = async (patch: Partial<Settings>) => {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    setSaving(true);
    try {
      const r = await api.updateSettings(patch);
      setSettings(r.settings);
    } catch (e) {
      toast((e as ApiRequestError).message || '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!settings) {
    return <div className="card h-40 animate-pulse opacity-60" />;
  }

  const speedMB = settings.maxSpeedBytesPerSec
    ? Math.round((settings.maxSpeedBytesPerSec / 1024 / 1024) * 10) / 10
    : 0;

  const themeOptions: { key: Theme; label: string; icon: 'sun' | 'moon' | 'chip' }[] = [
    { key: 'light', label: '浅色', icon: 'sun' },
    { key: 'dark', label: '深色', icon: 'moon' },
    { key: 'system', label: '跟随系统', icon: 'chip' },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* 下载设置 */}
      <Card>
        <CardTitle className="mb-4 flex items-center gap-2">
          <Icon name="tasks" size={16} /> 下载设置
        </CardTitle>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">默认下载质量</label>
            <select
              className="input"
              value={settings.defaultQuality}
              onChange={(e) => update({ defaultQuality: e.target.value as Resolution })}
            >
              {RESOLUTIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">默认文件格式</label>
            <select
              className="input"
              value={settings.defaultFormat}
              onChange={(e) => update({ defaultFormat: e.target.value as FileFormat })}
            >
              {FORMATS.map((f) => (
                <option key={f} value={f}>{f.toUpperCase()}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">最大并发任务</label>
            <select
              className="input"
              value={settings.maxConcurrent}
              onChange={(e) => update({ maxConcurrent: Number(e.target.value) })}
            >
              {CONCURRENCY.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">默认保存目录</label>
            <input
              className="input"
              value={settings.defaultSaveDir}
              onChange={(e) => update({ defaultSaveDir: e.target.value })}
              placeholder="留空使用服务器默认目录"
            />
          </div>
        </div>
      </Card>

      {/* 网络设置 */}
      <Card>
        <CardTitle className="mb-4 flex items-center gap-2">
          <Icon name="wifi" size={16} /> 网络设置
        </CardTitle>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="label">最大下载速度 (MB/s)</label>
            <input
              type="number"
              min={0}
              step={0.5}
              className="input"
              value={speedMB}
              onChange={(e) =>
                update({ maxSpeedBytesPerSec: Math.max(0, Number(e.target.value)) * 1024 * 1024 })
              }
            />
            <p className="mt-1 text-xs text-slate-400">0 = 不限速</p>
          </div>
          <div>
            <label className="label">请求超时 (秒)</label>
            <input
              type="number"
              min={5}
              max={600}
              className="input"
              value={settings.requestTimeoutSeconds}
              onChange={(e) => update({ requestTimeoutSeconds: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="label">自动重试次数</label>
            <input
              type="number"
              min={0}
              max={5}
              className="input"
              value={settings.autoRetryCount}
              onChange={(e) => update({ autoRetryCount: Math.max(0, Number(e.target.value)) })}
            />
          </div>
        </div>
      </Card>

      {/* 外观 */}
      <Card>
        <CardTitle className="mb-4 flex items-center gap-2">
          <Icon name="sun" size={16} /> 外观
        </CardTitle>
        <div className="flex gap-3">
          {themeOptions.map((o) => (
            <button
              key={o.key}
              onClick={() => {
                setTheme(o.key);
                update({ theme: o.key });
              }}
              className={clsx(
                'flex flex-1 flex-col items-center gap-2 rounded-xl border-2 py-4 transition-colors',
                theme === o.key
                  ? 'border-brand-500 bg-brand-500/5'
                  : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
              )}
            >
              <Icon name={o.icon} size={22} />
              <span className="text-sm">{o.label}</span>
            </button>
          ))}
        </div>
      </Card>

      {/* 系统 */}
      <Card>
        <CardTitle className="mb-4 flex items-center gap-2">
          <Icon name="database" size={16} /> 系统
        </CardTitle>
        <div className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <Row icon="chip" label="当前版本" value={system?.version ?? '—'} />
          <Row
            icon="database"
            label="数据库状态"
            value={system?.databaseStatus === 'ok' ? '正常' : '异常'}
            ok={system?.databaseStatus === 'ok'}
          />
          <Row
            icon="folder"
            label="下载目录状态"
            value={
              system?.downloadDirStatus === 'ok'
                ? '正常'
                : system?.downloadDirStatus === 'missing'
                ? '缺失'
                : '错误'
            }
            ok={system?.downloadDirStatus === 'ok'}
          />
          <Row
            icon="disk"
            label="磁盘剩余空间"
            value={
              system
                ? `${formatBytes(system.diskFreeBytes)} / ${formatBytes(system.diskTotalBytes)}`
                : '—'
            }
          />
          <Row icon="tasks" label="下载引擎" value={system?.engine ?? '—'} />
          <Row icon="gauge" label="运行时长" value={system ? `${system.uptimeSeconds}s` : '—'} />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <p className="break-all text-xs text-slate-400">下载目录：{system?.downloadDir}</p>
          {system?.downloadDir && (
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                try {
                  await api.openFolder(system!.downloadDir);
                  toast('已打开下载目录', 'success');
                } catch (e) {
                  toast((e as ApiRequestError).message || '打开目录失败', 'error');
                }
              }}
              icon={<Icon name="folder" size={14} />}
            >
              打开目录
            </Button>
          )}
        </div>
        {saving && <p className="mt-2 text-xs text-brand-500">保存中…</p>}
      </Card>
    </div>
  );
}

function Row({
  icon,
  label,
  value,
  ok,
}: {
  icon: 'chip' | 'database' | 'folder' | 'disk' | 'tasks' | 'gauge';
  label: string;
  value: string;
  ok?: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-2 dark:border-slate-800/60">
      <span className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
        <Icon name={icon} size={15} /> {label}
      </span>
      <span
        className={clsx(
          'font-medium',
          ok === true && 'text-emerald-600 dark:text-emerald-400',
          ok === false && 'text-rose-500'
        )}
      >
        {value}
      </span>
    </div>
  );
}
