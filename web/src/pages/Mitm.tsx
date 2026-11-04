import { useState, useCallback } from 'react';
import { clsx } from 'clsx';
import { api, ApiRequestError } from '../api';
import type { MitmDownloader, MitmStatus, MitmTask, MitmProbe, MitmPlatform } from '../types';
import { Button, Card, CardTitle, Badge, ProgressBar, Modal, useToast, EmptyState } from '../components/ui';
import { Icon } from '../components/icons';
import { usePolling } from '../hooks/usePolling';
import { formatBytes } from '../lib/format';

/**
 * v1.1.0 资源嗅探（MITM）页面
 * 三个第三方下载器通道（微信视频号 / 抖音 / 小红书）+ 直链下载 + 任务进度 + 播放 + 自检。
 */
export function Mitm() {
  const { toast } = useToast();
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [probe, setProbe] = useState<MitmProbe | null>(null);
  const [probing, setProbing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selftesting, setSelftesting] = useState<string | null>(null);
  const [playTask, setPlayTask] = useState<MitmTask | null>(null);

  const status = usePolling<MitmStatus>(() => api.mitm.status(), 6000);
  const downloaders = usePolling<{ downloaders: MitmDownloader[] }>(() => api.mitm.downloaders(), 8000);
  const tasks = usePolling<{ tasks: MitmTask[] }>(() => api.mitm.tasks(), 1200);

  const doProbe = useCallback(async (raw: string) => {
    if (!raw.trim() || !/^https?:\/\//i.test(raw.trim())) {
      setProbe(null);
      return;
    }
    setProbing(true);
    try {
      const r = await api.mitm.probe(raw.trim());
      setProbe(r.probe);
    } catch {
      setProbe(null);
    } finally {
      setProbing(false);
    }
  }, []);

  const createTask = useCallback(async () => {
    if (!url.trim()) {
      toast('请先粘贴资源直链', 'warning');
      return;
    }
    setCreating(true);
    try {
      if (probe?.isSharePage) {
        toast('这是平台分享页链接（如 weixin.qq.com/sph/...），不是视频直链，无法下载', 'error');
        return;
      }
      await api.mitm.createTask({
        url: url.trim(),
        platform: probe?.platform !== 'unknown' ? probe?.platform : undefined,
        title: title.trim() || undefined,
      });
      toast('已加入嗅探下载队列', 'success');
      setUrl('');
      setTitle('');
      setProbe(null);
      tasks.refresh();
    } catch (e) {
      toast((e as ApiRequestError).message || '创建失败', 'error');
    } finally {
      setCreating(false);
    }
  }, [url, title, probe, toast, tasks]);

  const selftest = useCallback(async (p: MitmPlatform) => {
    setSelftesting(p);
    try {
      const r = await api.mitm.selftest(p);
      if (r.passed) toast(`${r.name} 自检通过：真实下载 + 双流校验 OK`, 'success');
      else toast(`${r.name} 自检未通过：${r.task.errorMessage || r.validation?.reason || '未知原因'}`, 'error');
      tasks.refresh();
    } catch (e) {
      toast(`自检失败：${(e as ApiRequestError).message}`, 'error');
    } finally {
      setSelftesting(null);
    }
  }, [toast, tasks]);

  const useDemo = useCallback((d: MitmDownloader) => {
    setUrl(d.demoUrl);
    doProbe(d.demoUrl);
    toast(`已填入 ${d.name} 演示直链，可直接点击「开始下载」`, 'success');
  }, [doProbe, toast]);

  const bridgeInfo = status.data?.bridge;
  const list = tasks.data?.tasks ?? [];

  return (
    <div className="mx-auto max-w-5xl">
      {/* Hero */}
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-extrabold tracking-tight">资源嗅探下载</h1>
          <Badge tone="brand">MITM · v{status.data?.version ?? '1.1.0'}</Badge>
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          微信视频号 / 抖音 / 小红书直链嗅探下载 —— 三通道独立接入，真实 HTTP 流式下载并校验产物。仅处理你有权访问的公开资源。
        </p>
      </div>

      {/* 状态条 */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatusPill
          icon="chip"
          title="无头下载引擎"
          value={status.data?.engine?.ready ? '就绪' : '加载中'}
          sub={`并发 ${status.data?.engine?.maxConcurrent ?? '-'}`}
          ok={!!status.data?.engine?.ready}
        />
        <StatusPill
          icon="database"
          title="确定性 CDN 源"
          value={status.data?.fixture?.assetReady ? '可访问' : '未就绪'}
          sub="Range 206 / 真实 mp4"
          ok={!!status.data?.fixture?.assetReady}
        />
        <StatusPill
          icon="wifi"
          title="第三方桥接 res-downloader"
          value={bridgeInfo?.online ? `在线 ${bridgeInfo.version ?? ''}` : '未连接(自动降级)'}
          sub={bridgeInfo?.online ? bridgeInfo.baseUrl : '可选增强 · 不影响下载'}
          ok={!!bridgeInfo?.online}
          neutral={!bridgeInfo?.online}
        />
      </div>

      {/* 三个下载器通道 */}
      <CardTitle className="mb-3">下载器通道</CardTitle>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {(downloaders.data?.downloaders ?? (['wechat', 'douyin', 'xiaohongshu'] as MitmPlatform[]).map((k) => ({
          platform: k,
          name: { wechat: '微信视频号', douyin: '抖音', xiaohongshu: '小红书' }[k],
          color: { wechat: '#07C160', douyin: '#161823', xiaohongshu: '#FF2442' }[k],
          description: '',
          adapterReady: true,
          sourceReachable: false,
          sourceHttpStatus: null,
          demoUrl: '',
          probeUrl: '',
          latencyMs: null,
          checkedAt: '',
        }))).map((d) => (
          <Card key={d.platform} className="flex flex-col" padded>
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl text-white text-sm font-bold" style={{ background: d.color }}>
                {d.name.slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">{d.name}</p>
                <p className="text-[11px] text-slate-400">{d.description || 'MITM 嗅探下载通道'}</p>
              </div>
              <span className={clsx('h-2.5 w-2.5 rounded-full', d.sourceReachable ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600')} />
            </div>
            <div className="mt-3 flex items-center justify-between text-xs">
              <span className="text-slate-500 dark:text-slate-400">源可达性</span>
              {d.sourceReachable ? (
                <Badge tone="success">HTTP {d.sourceHttpStatus} · {d.latencyMs}ms</Badge>
              ) : (
                <Badge tone="neutral">探测中…</Badge>
              )}
            </div>
            <div className="mt-4 flex gap-2">
              <Button size="sm" variant="secondary" className="flex-1" onClick={() => useDemo(d)} icon={<Icon name="link" size={14} />}>
                演示直链
              </Button>
              <Button size="sm" variant="ghost" loading={selftesting === d.platform} onClick={() => selftest(d.platform)} icon={<Icon name="check" size={14} />}>
                自检
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {/* 下载输入 */}
      <Card className="mb-6" padded>
        <CardTitle className="mb-3">新建嗅探下载</CardTitle>
        <div className="flex flex-col gap-3 md:flex-row">
          <div className="relative flex-[2]">
            <Icon name="link" size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={url}
              onChange={(e) => { setUrl(e.target.value); doProbe(e.target.value); }}
              onKeyDown={(e) => e.key === 'Enter' && createTask()}
              placeholder="粘贴资源直链（点上方「演示直链」可一键填入）"
              className="input pl-10"
            />
          </div>
          <div className="relative flex-1">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="文件名（可选）"
              className="input"
            />
          </div>
          <Button onClick={createTask} loading={creating || probing} icon={<Icon name="plus" size={16} />}>
            开始下载
          </Button>
        </div>
        {probe && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-xs">
            <Badge tone={probe.matched ? 'brand' : 'neutral'}>
              {probe.matched ? `识别：${probe.platformName}` : '未识别平台（按通用直链处理）'}
            </Badge>
            {probe.isSharePage ? (
              <Badge tone="danger">⚠ 分享页链接 · 非直链</Badge>
            ) : (
              <span className="text-slate-500 dark:text-slate-400">
                自动携带 Referer / UA · {probe.isLocalSource ? '内置确定性源' : '外部直链'} · 后缀 {probe.suffix}
              </span>
            )}
            {probe.isSharePage && (
              <span className="w-full text-rose-600 dark:text-rose-400">
                这是平台分享/落地页（会跳转到 HTML 网页），不是视频直链，本引擎无法直接下载。请通过 res-downloader 在客户端播放时抓包获取真实 .mp4 直链，或复制浏览器 Network 面板中的直链后粘贴。
              </span>
            )}
          </div>
        )}
      </Card>

      {/* 任务列表 */}
      <div className="mb-3 flex items-center justify-between">
        <CardTitle>下载任务 ({list.length})</CardTitle>
        <Button size="sm" variant="ghost" onClick={() => tasks.refresh()} icon={<Icon name="retry" size={14} />}>刷新</Button>
      </div>
      {list.length === 0 ? (
        <Card padded><EmptyState title="暂无嗅探下载任务" description="填入直链或点击「演示直链 / 自检」开始" /></Card>
      ) : (
        <div className="space-y-3">
          {list.map((t) => (
            <TaskRow key={t.id} task={t} onPlay={() => setPlayTask(t)} onChange={() => tasks.refresh()} />
          ))}
        </div>
      )}

      {/* 播放弹窗 */}
      <Modal open={!!playTask} onClose={() => setPlayTask(null)} title={playTask?.title} size="lg">
        {playTask && (
          <div>
            <video
              src={api.mitm.streamUrl(playTask.id)}
              controls
              autoPlay
              className="w-full rounded-lg bg-black"
              style={{ maxHeight: '60vh' }}
            />
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <Info label="平台" value={playTask.platformName} />
              <Info label="大小" value={formatBytes(playTask.fileSizeBytes)} />
              <Info label="产物校验" value={playTask.validation?.valid ? '通过' : '—'} ok={playTask.validation?.valid} />
              <Info label="音视频流" value={playTask.validation?.ffprobe || '—'} />
            </div>
            {playTask.validation?.headerHex && (
              <p className="mt-2 break-all font-mono text-[10px] text-slate-400">magic: {playTask.validation.headerHex.slice(0, 24)}</p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function StatusPill({ icon, title, value, sub, ok, neutral }: {
  icon: 'chip' | 'database' | 'wifi';
  title: string;
  value: string;
  sub: string;
  ok: boolean;
  neutral?: boolean;
}) {
  return (
    <Card className="flex items-center gap-3" padded>
      <span className={clsx(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
        ok ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300' :
          neutral ? 'bg-slate-100 text-slate-400 dark:bg-slate-800' :
            'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300'
      )}>
        <Icon name={icon} size={18} />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] text-slate-400">{title}</p>
        <p className="truncate text-sm font-semibold">{value}</p>
        <p className="truncate text-[11px] text-slate-400">{sub}</p>
      </div>
    </Card>
  );
}

function Info({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 px-2.5 py-2">
      <p className="text-[10px] text-slate-400">{label}</p>
      <p className={clsx('truncate text-xs font-medium', ok && 'text-emerald-600 dark:text-emerald-400')} title={value}>{value}</p>
    </div>
  );
}

const STATUS_LABEL: Record<string, { label: string; tone: 'neutral' | 'brand' | 'success' | 'danger' | 'warning' }> = {
  waiting: { label: '等待中', tone: 'neutral' },
  downloading: { label: '下载中', tone: 'brand' },
  completed: { label: '已完成', tone: 'success' },
  failed: { label: '失败', tone: 'danger' },
  cancelled: { label: '已取消', tone: 'neutral' },
};

function TaskRow({ task, onPlay, onChange }: { task: MitmTask; onPlay: () => void; onChange: () => void }) {
  const { toast } = useToast();
  const st = STATUS_LABEL[task.status] ?? STATUS_LABEL.waiting;
  const busy = task.status === 'waiting' || task.status === 'downloading';

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try { await fn(); toast(msg, 'success'); onChange(); }
    catch (e) { toast((e as ApiRequestError).message, 'error'); }
  };

  return (
    <Card className="p-4" padded={false}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Badge tone={st.tone}>{st.label}</Badge>
            <span className="truncate text-sm font-medium" title={task.title}>{task.title}</span>
          </div>
          <p className="mt-1 truncate text-[11px] text-slate-400" title={task.url}>
            {task.platformName} · {task.source} · {task.fileName}
          </p>
          {(busy || task.status === 'completed') && (
            <div className="mt-2 flex items-center gap-2">
              <ProgressBar value={task.progress} active={task.status === 'downloading'} className="flex-1" />
              <span className="w-24 shrink-0 text-right text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                {task.status === 'downloading'
                  ? `${task.progress}% · ${formatBytes(task.speedBytesPerSec)}/s`
                  : formatBytes(task.fileSizeBytes)}
              </span>
            </div>
          )}
          {task.status === 'failed' && (
            <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">
              {task.errorCode}: {task.errorMessage}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          {task.status === 'completed' && (
            <Button size="sm" variant="secondary" onClick={onPlay} icon={<Icon name="play" size={14} />}>播放</Button>
          )}
          {busy && (
            <Button size="sm" variant="ghost" onClick={() => act(() => api.mitm.cancel(task.id), '已取消')} icon={<Icon name="pause" size={14} />}>取消</Button>
          )}
          {(task.status === 'failed' || task.status === 'cancelled') && (
            <Button size="sm" variant="ghost" onClick={() => act(() => api.mitm.retry(task.id), '已重新入队')} icon={<Icon name="retry" size={14} />}>重试</Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => act(() => api.mitm.deleteTask(task.id), '已删除记录')} icon={<Icon name="trash" size={14} />}>删除</Button>
        </div>
      </div>
    </Card>
  );
}
