import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { api, ApiRequestError } from '../api';
import type { VideoMetadata, VideoFormatOption } from '../types';
import { Button, Card, useToast } from '../components/ui';
import { Icon } from '../components/icons';
import { formatBytes, formatDuration } from '../lib/format';

export function Home() {
  const [url, setUrl] = useState('');
  const [parsing, setParsing] = useState(false);
  const [meta, setMeta] = useState<VideoMetadata | null>(null);
  const [res, setRes] = useState('');
  const [fmt, setFmt] = useState('');
  const [saveDir, setSaveDir] = useState('');
  const [enqueuing, setEnqueuing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [enqueued, setEnqueued] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  const parse = useCallback(async () => {
    if (!url.trim()) {
      toast('请先粘贴视频链接', 'warning');
      return;
    }
    setParsing(true);
    setMeta(null);
    setEnqueued(false);
    try {
      const { metadata } = await api.parse(url.trim());
      setMeta(metadata);
      // 默认选择：最高分辨率 + mp4（若可用）
      const highest = metadata.availableResolutions[metadata.availableResolutions.length - 1];
      setRes(metadata.availableResolutions.includes('1080p') ? '1080p' : highest);
      setFmt(metadata.availableFormats.includes('mp4') ? 'mp4' : metadata.availableFormats[0]);
    } catch (e) {
      const err = e as ApiRequestError;
      toast(err.message || '解析失败', 'error');
    } finally {
      setParsing(false);
    }
  }, [url, toast]);

  const enqueue = useCallback(async () => {
    if (!meta) return;
    setEnqueuing(true);
    try {
      await api.createTask({ url: meta.url, resolution: res, format: fmt, saveDir: saveDir || undefined });
      setEnqueued(true);
      toast('已加入下载队列', 'success');
    } catch (e) {
      const err = e as ApiRequestError;
      toast(err.message || '加入队列失败', 'error');
    } finally {
      setEnqueuing(false);
    }
  }, [meta, res, fmt, saveDir, toast]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (text) setUrl(text.trim());
  };

  const selectedOpt: VideoFormatOption | undefined = meta?.formats.find(
    (f) => f.resolution === res && f.format === fmt
  );

  return (
    <div className="mx-auto max-w-3xl">
      {/* Hero */}
      <div className="mb-8 text-center">
        <h1 className="bg-gradient-to-r from-brand-500 to-indigo-400 bg-clip-text text-3xl font-extrabold tracking-tight text-transparent md:text-4xl">
          在线视频下载管理器
        </h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          统一管理你的在线视频下载任务
        </p>
      </div>

      {/* 输入区 */}
      <Card className="p-2">
        <div
          onDrop={onDrop}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          className={clsx(
            'rounded-xl border-2 border-dashed p-4 transition-colors',
            dragOver
              ? 'border-brand-500 bg-brand-500/5'
              : 'border-slate-200 dark:border-slate-700'
          )}
        >
          <div className="flex flex-col gap-3 md:flex-row">
            <div className="relative flex-1">
              <Icon
                name="link"
                size={18}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && parse()}
                placeholder="粘贴视频链接"
                className="input pl-10 py-3 text-base"
                style={undefined}
              />
            </div>
            <Button size="lg" onClick={parse} loading={parsing} icon={<Icon name="search" size={18} />}>
              {parsing ? '解析中…' : '解析视频'}
            </Button>
          </div>
          <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-slate-400">
            <Icon name="drag" size={14} /> 支持把链接直接拖拽到此处
          </p>
        </div>
      </Card>

      {/* 错误提示 */}
      {!parsing && !meta && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[
            { name: 'YouTube', color: '#FF0000' },
            { name: 'Bilibili', color: '#FB7299' },
            { name: 'Vimeo', color: '#1AB7EA' },
            { name: 'X', color: '#888' },
            { name: 'TikTok', color: '#69C9D0' },
            { name: 'Instagram', color: '#E1306C' },
          ].map((p) => (
            <div
              key={p.name}
              className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white px-3 py-2.5 text-sm dark:bg-slate-900"
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />
              {p.name}
            </div>
          ))}
        </div>
      )}

      {/* 预览卡片 */}
      {meta && (
        <PreviewCard
          meta={meta}
          res={res}
          fmt={fmt}
          saveDir={saveDir}
          onRes={setRes}
          onFmt={setFmt}
          onSaveDir={setSaveDir}
          selectedOpt={selectedOpt}
          enqueuing={enqueuing}
          enqueued={enqueued}
          onEnqueue={enqueue}
          onReset={() => {
            setMeta(null);
            setUrl('');
            setEnqueued(false);
          }}
          onGoTasks={() => navigate('/tasks')}
        />
      )}
    </div>
  );
}

function PreviewCard({
  meta,
  res,
  fmt,
  saveDir,
  onRes,
  onFmt,
  onSaveDir,
  selectedOpt,
  enqueuing,
  enqueued,
  onEnqueue,
  onReset,
  onGoTasks,
}: {
  meta: VideoMetadata;
  res: string;
  fmt: string;
  saveDir: string;
  onRes: (v: string) => void;
  onFmt: (v: string) => void;
  onSaveDir: (v: string) => void;
  selectedOpt?: VideoFormatOption;
  enqueuing: boolean;
  enqueued: boolean;
  onEnqueue: () => void;
  onReset: () => void;
  onGoTasks: () => void;
}) {
  const thumb = meta.thumbnailUrl.startsWith('data:') ? meta.thumbnailUrl : meta.thumbnailUrl;
  return (
    <Card className="mt-6 animate-scale-in">
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="aspect-video w-full overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800 sm:w-64 sm:shrink-0">
          {thumb ? (
            <img src={thumb} alt="thumbnail" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-slate-400">
              <Icon name="play" size={32} />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span
              className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
            >
              {meta.platformName}
            </span>
            {meta.simulated && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-400 dark:bg-slate-800">
                模拟数据
              </span>
            )}
          </div>
          <h3 className="truncate text-lg font-semibold" title={meta.title}>
            {meta.title}
          </h3>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            {meta.author || '未知作者'} · {formatDuration(meta.durationSeconds)}
          </p>
          <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-200">
            {res} · {fmt.toUpperCase()} ·{' '}
            {selectedOpt?.sizeBytes ? formatBytes(selectedOpt.sizeBytes) : '大小未知'}
          </p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className="label">视频质量</label>
          <select className="input" value={res} onChange={(e) => onRes(e.target.value)}>
            {meta.availableResolutions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">文件格式</label>
          <select className="input" value={fmt} onChange={(e) => onFmt(e.target.value)}>
            {meta.availableFormats.map((f) => (
              <option key={f} value={f}>
                {f.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">保存位置（可选）</label>
          <input
            className="input"
            placeholder="留空使用默认目录"
            value={saveDir}
            onChange={(e) => onSaveDir(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {enqueued ? (
          <>
            <Button variant="success" icon={<Icon name="check" size={16} />} onClick={onGoTasks}>
              前往任务列表
            </Button>
            <Button variant="ghost" onClick={onReset}>
              再添加一个
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onEnqueue} loading={enqueuing} icon={<Icon name="plus" size={16} />}>
              加入下载队列
            </Button>
            <Button variant="ghost" onClick={onReset}>
              取消
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
