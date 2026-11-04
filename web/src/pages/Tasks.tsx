import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { api, ApiRequestError } from '../api';
import type { DownloadTask, TaskStatus } from '../types';
import { Button, Card, Modal, ProgressBar, StatusBadge, useToast, EmptyState } from '../components/ui';
import { Icon } from '../components/icons';
import { formatBytes, formatDate, formatDuration, formatSpeed } from '../lib/format';
import { usePolling } from '../hooks/usePolling';

type Tab = 'all' | 'downloading' | 'waiting' | 'paused' | 'completed' | 'failed';

const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'downloading', label: '下载中' },
  { key: 'waiting', label: '等待中' },
  { key: 'paused', label: '已暂停' },
  { key: 'completed', label: '已完成' },
  { key: 'failed', label: '失败/取消' },
];

export function Tasks() {
  const { data, loading } = usePolling<{ tasks: DownloadTask[] }>(
    () => api.listTasks(),
    1200
  );
  const [tab, setTab] = useState<Tab>('all');
  const [confirm, setConfirm] = useState<{
    task: DownloadTask;
    mode: 'task' | 'file';
  } | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const { toast } = useToast();
  const [repairingIds, setRepairingIds] = useState<Set<string>>(new Set());

  const tasks = data?.tasks ?? [];

  // BUGFIX: 原 useMemo 在并发/快速轮询下偶发返回陈旧值，改为直接计算
  const filtered = tab === 'all'
    ? tasks
    : tab === 'failed'
      ? tasks.filter((t) => t.status === 'failed' || t.status === 'cancelled')
      : tasks.filter((t) => t.status === tab);

  const previewTask = useMemo(
    () => tasks.find((t) => t.id === previewId) ?? null,
    [tasks, previewId]
  );

  const counts: Record<string, number> = { all: tasks.length };
  for (const t of tasks) counts[t.status] = (counts[t.status] ?? 0) + 1;

  const act = async (id: string, fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok, 'success');
    } catch (e) {
      toast((e as ApiRequestError).message || '操作失败', 'error');
    }
  };

  const repair = async (id: string) => {
    setRepairingIds((s) => new Set(s).add(id));
    try {
      await api.repair(id);
      toast('已修复为 H.264 可播放格式', 'success');
    } catch (e) {
      toast((e as ApiRequestError).message || '修复失败', 'error');
    } finally {
      setRepairingIds((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            data-tab={t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              'rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
              tab === t.key
                ? 'bg-brand-600 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-200/70 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
            )}
          >
            {t.label}
            {counts[t.key] ? (
              <span className="ml-1.5 text-xs opacity-80">{counts[t.key]}</span>
            ) : null}
          </button>
        ))}
      </div>

      {loading && tasks.length === 0 ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card h-28 animate-pulse opacity-60" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Icon name="tasks" size={32} />}
          title="暂无任务"
          description="回到首页粘贴视频链接，即可创建下载任务"
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              onPause={() => act(t.id, () => api.pause(t.id), '已暂停')}
              onResume={() => act(t.id, () => api.resume(t.id), '已继续')}
              onCancel={() => act(t.id, () => api.cancel(t.id), '已取消')}
              onRetry={() => act(t.id, () => api.retry(t.id), '已重试')}
              onDelete={() => setConfirm({ task: t, mode: 'task' })}
              onDeleteFile={() => setConfirm({ task: t, mode: 'file' })}
              onCopyPath={(p) => {
                navigator.clipboard?.writeText(p);
                toast('文件路径已复制', 'info');
              }}
              onOpenFolder={() => act(t.id, () => api.openTaskFolder(t.id), '已打开所在目录')}
              onPreview={() => setPreviewId(t.id)}
              onRepair={() => repair(t.id)}
              repairing={repairingIds.has(t.id)}
            />
          ))}
        </div>
      )}

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm?.mode === 'file' ? '删除实际文件' : '删除任务'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              取消
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (!confirm) return;
                const t = confirm.task;
                try {
                  if (confirm.mode === 'file') {
                    await api.deleteFile(t.id);
                    toast('文件已删除', 'success');
                  } else {
                    await api.deleteTask(t.id, false);
                    toast('任务已删除', 'success');
                  }
                } catch (e) {
                  toast((e as ApiRequestError).message || '删除失败', 'error');
                }
                setConfirm(null);
              }}
            >
              确认删除
            </Button>
          </>
        }
      >
        {confirm?.mode === 'file' ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            即将永久删除磁盘上的视频文件：<br />
            <span className="break-all font-mono text-xs text-rose-500">{confirm.task.filePath}</span>
            <br />
            此操作不可恢复。
          </p>
        ) : (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            即将删除任务「{confirm?.task.title}」的记录。
            {confirm?.task.status === 'completed' && confirm?.task.filePath ? (
              <span className="text-amber-500"> 注意：实际视频文件将保留，仅删除记录。</span>
            ) : null}
          </p>
        )}
      </Modal>

      <Modal
        open={!!previewId}
        onClose={() => setPreviewId(null)}
        title={previewTask?.title ?? '视频预览'}
        size="lg"
      >
        {previewTask?.filePath ? (
          <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
            <video
              src={api.streamTaskFile(previewTask.id)}
              controls
              autoPlay
              className="h-full w-full"
              onError={() => toast('视频加载失败，文件可能尚未完成或格式不受支持', 'error')}
            >
              你的浏览器不支持 HTML5 视频播放。
            </video>
          </div>
        ) : (
          <p className="text-sm text-slate-500">无可播放文件</p>
        )}
        <p className="mt-3 break-all font-mono text-xs text-slate-400">{previewTask?.filePath}</p>
      </Modal>
    </div>
  );
}

function TaskRow({
  task,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onDelete,
  onDeleteFile,
  onCopyPath,
  onOpenFolder,
  onPreview,
  onRepair,
  repairing,
}: {
  task: DownloadTask;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onDelete: () => void;
  onDeleteFile: () => void;
  onCopyPath: (p: string) => void;
  onOpenFolder: () => void;
  onPreview: () => void;
  onRepair: () => void;
  repairing?: boolean;
}) {
  const active = task.status === 'downloading';
  const showProgress = active || task.status === 'paused' || (task.status === 'completed' && task.progress < 100);

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="group relative aspect-video w-full overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800 sm:w-40 sm:shrink-0">
          {task.thumbnailUrl ? (
            <img src={task.thumbnailUrl} alt="" className="h-full w-full object-cover" />
          ) : null}
          {task.status === 'completed' && task.filePath && (
            <button
              onClick={onPreview}
              className="absolute inset-0 flex items-center justify-center bg-slate-900/30 opacity-0 transition-opacity group-hover:opacity-100"
              title="预览播放"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-brand-600 shadow-lg">
                <Icon name="play" size={20} />
              </span>
            </button>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate font-semibold" title={task.title}>
                {task.title}
              </h3>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {task.platformName} · {task.resolution} · {task.format.toUpperCase()} ·{' '}
                {formatBytes(task.fileSizeBytes)}
                {task.media?.videoCodec && (
                  <span
                    className={clsx(
                      'ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium',
                      task.media.playerCompatible === false
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                        : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                    )}
                  >
                    {task.media.videoCodec.toUpperCase()}
                    {task.media.repaired ? '·已修复' : ''}
                  </span>
                )}
              </p>
            </div>
            <StatusBadge status={task.status} />
          </div>

          {/* 进度 */}
          {(active || task.status === 'paused') && (
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium text-brand-600 dark:text-brand-300">
                  {Math.floor(task.progress)}%
                </span>
                <span className="text-slate-500 dark:text-slate-400">
                  {active && (
                    <>
                      {formatSpeed(task.speedBytesPerSec)} · 剩余{' '}
                      {task.etaSeconds ? formatDuration(task.etaSeconds) : '--:--'}
                    </>
                  )}
                  {task.status === 'paused' && '已暂停'}
                </span>
              </div>
              <ProgressBar value={task.progress} active={active} height={10} />
            </div>
          )}

          {task.status === 'completed' && (
            <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
              <Icon name="check" size={13} className="mr-1 inline" />
              已完成 · {formatBytes(task.fileSizeBytes)} · {formatDate(task.completedAt ?? task.updatedAt)}
            </p>
          )}

          {task.status === 'completed' && task.media && task.media.playerCompatible === false && (
            <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
              <Icon name="alert" size={13} />
              <span>
                编码不兼容（{task.media.videoCodec?.toUpperCase()}/{task.media.container?.toUpperCase()}），
                QuickTime 等播放器可能无法播放
              </span>
            </p>
          )}

          {task.status === 'failed' && (
            <p className="mt-2 flex items-center gap-1 text-xs text-rose-500">
              <Icon name="alert" size={13} />
              {task.errorMessage || '下载失败'}
            </p>
          )}
          {task.status === 'cancelled' && (
            <p className="mt-2 text-xs text-slate-400">任务已取消</p>
          )}
          {task.status === 'waiting' && (
            <p className="mt-2 text-xs text-slate-400">等待可用下载槽位…</p>
          )}

          {/* 操作 */}
          <div className="mt-3 flex flex-wrap gap-2">
            {active && (
              <>
                <Button size="sm" variant="secondary" onClick={onPause} icon={<Icon name="pause" size={14} />} data-action="pause">
                  暂停
                </Button>
                <Button size="sm" variant="ghost" onClick={onCancel} icon={<Icon name="close" size={14} />} data-action="cancel">
                  取消
                </Button>
              </>
            )}
            {task.status === 'paused' && (
              <>
                <Button size="sm" onClick={onResume} icon={<Icon name="play" size={14} />} data-action="resume">
                  继续
                </Button>
                <Button size="sm" variant="ghost" onClick={onCancel} icon={<Icon name="close" size={14} />} data-action="cancel">
                  取消
                </Button>
              </>
            )}
            {task.status === 'waiting' && (
              <Button size="sm" variant="ghost" onClick={onCancel} icon={<Icon name="close" size={14} />} data-action="cancel">
                取消
              </Button>
            )}
            {(task.status === 'failed' || task.status === 'cancelled') && (
              <>
                <Button size="sm" onClick={onRetry} icon={<Icon name="retry" size={14} />} data-action="retry">
                  重试
                </Button>
                <Button size="sm" variant="ghost" onClick={onDelete} icon={<Icon name="trash" size={14} />} data-action="delete">
                  删除
                </Button>
              </>
            )}
            {task.status === 'completed' && (
              <>
                {task.media && task.media.playerCompatible === false && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={onRepair}
                    disabled={repairing}
                    icon={<Icon name="wrench" size={14} />}
                    title="转码为 H.264+AAC 可播放格式"
                  >
                    {repairing ? '修复中…' : '修复'}
                  </Button>
                )}
                {task.filePath && (
                  <>
                    <Button
                      size="sm"
                      onClick={onPreview}
                      icon={<Icon name="play" size={14} />}
                      title="预览播放"
                    >
                      播放
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={onOpenFolder}
                      icon={<Icon name="folder" size={14} />}
                      title="打开所在目录"
                    >
                      打开目录
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => onCopyPath(task.filePath)}
                      icon={<Icon name="folder" size={14} />}
                    >
                      复制路径
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={onDeleteFile}
                      icon={<Icon name="trash" size={14} />}
                    >
                      删除文件
                    </Button>
                  </>
                )}
                <Button size="sm" variant="ghost" onClick={onDelete} icon={<Icon name="trash" size={14} />}>
                  删除记录
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
