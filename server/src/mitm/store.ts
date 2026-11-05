import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { MitmPlatform, MitmTask, MitmValidation } from './types.js';
import { runMitmDownload, MitmCancelError, validateOutput } from './downloader.js';
import { probeUrl, safeFileName } from './platforms.js';
import { repairToH264 } from '../utils/media.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * MITM 任务存储与调度：内存 Map + JSON 落盘持久化。
 * 与现有 SQLite 任务表完全隔离，互不影响；服务重启后自动恢复已完成任务记录。
 */

export interface CreateMitmTaskInput {
  url: string;
  platform?: MitmPlatform | 'unknown';
  title?: string;
  headers?: Record<string, string>;
  source?: 'fixture' | 'external' | 'bridge';
}

interface RunSignal { aborted: boolean }

export class MitmStore {
  private tasks = new Map<string, MitmTask>();
  private signals = new Map<string, RunSignal>();
  private queue: string[] = [];
  private active = 0;
  /** 正在执行 run() 的任务 id：防止 cancel 后立刻 retry 造成同一 id 双 run 写同一文件 */
  private running = new Set<string>();
  /** 已被 remove 但 run() 尚未退出的任务 id：结束时需清理被 rename 复活的产物 */
  private removed = new Set<string>();
  private maxConcurrent: number;
  private timeoutMs: number;
  private downloadDir: string;
  private persistFile: string;
  private ffprobeBin: string | undefined;
  private baseUrl: string;

  constructor(opts: {
    maxConcurrent: number;
    timeoutMs: number;
    downloadDir: string;
    persistFile: string;
    ffprobeBin?: string;
    baseUrl: string;
  }) {
    this.maxConcurrent = Math.max(1, opts.maxConcurrent);
    this.timeoutMs = opts.timeoutMs;
    this.downloadDir = opts.downloadDir;
    this.persistFile = opts.persistFile;
    this.ffprobeBin = opts.ffprobeBin;
    this.baseUrl = opts.baseUrl;
    fs.mkdirSync(this.downloadDir, { recursive: true });
    fs.mkdirSync(path.dirname(this.persistFile), { recursive: true });
    this.load();
    // 旧版本持久化数据可能只有 valid:true 而无编码/可播放性字段，
    // 或停留在「AV1 已标记但未修复」。异步回填，不阻塞服务启动。
    void this.backfillValidations();
  }

  /** 重启后串行回填历史已完成任务的校验信息；单条失败不影响其它任务。 */
  private async backfillValidations(): Promise<void> {
    const candidates = this.list().filter(
      (t) => t.status === 'completed' && !!t.filePath && this.isUnderDownloadDir(t.filePath)
    );
    let updated = 0;
    for (const t of candidates) {
      try {
        const v = await validateOutput(t.filePath, t.fileSizeBytes, this.ffprobeBin);
        if (v.playerCompatible === false && config.mitm.autoRepairIncompatible) {
          // 回填期间不逐条写盘：避免 14+ 条任务各写一次整份 JSON 造成启动期 I/O 风暴
          await this.repair(t.id, false);
          updated++;
        } else if (
          t.validation?.playerCompatible !== v.playerCompatible ||
          t.validation?.videoCodec !== v.videoCodec
        ) {
          t.validation = v;
          t.updatedAt = new Date().toISOString();
          updated++;
        }
      } catch (e) {
        logger.warn(`MITM 历史校验回填失败 任务=${t.id.slice(0, 8)}: ${(e as Error).message}`);
      }
    }
    if (updated > 0) {
      this.persist(); // 全部回填完成后单次落盘
      logger.info(`MITM 已回填 ${updated} 条历史任务校验信息`);
    }
  }

  /** 产物路径必须落在 MITM 下载目录内（防止持久化文件被篡改后越权读/删任意文件） */
  private isUnderDownloadDir(p: string): boolean {
    if (!p) return false;
    const normalized = path.normalize(path.resolve(p));
    const base = path.normalize(path.resolve(this.downloadDir));
    return normalized.startsWith(base + path.sep);
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.persistFile)) return;
      const arr: MitmTask[] = JSON.parse(fs.readFileSync(this.persistFile, 'utf8'));
      for (const t of arr) {
        // 重启恢复：进行中的任务标记为失败（需重试），完成态校验文件仍在
        if (t.status === 'downloading' || t.status === 'waiting') {
          t.status = 'failed';
          t.errorCode = 'INTERRUPTED';
          t.errorMessage = '服务重启导致下载中断，请重试';
        }
        // 安全：持久化文件里的 filePath 可能指向下载目录之外（被篡改/旧版本残留），
        // 恢复时先隔离，避免后续 remove(deleteFile) / revalidate 越权读写。
        if (t.filePath && !this.isUnderDownloadDir(t.filePath)) {
          t.filePath = '';
          t.status = 'failed';
          t.errorCode = 'INVALID_PATH';
          t.errorMessage = '产物路径越界，已被安全策略拦截';
        }
        if (t.status === 'completed' && (!t.filePath || !fs.existsSync(t.filePath))) {
          t.status = 'failed';
          t.errorCode = 'FILE_MISSING';
          t.errorMessage = '产物文件已不在磁盘上';
        }
        this.tasks.set(t.id, t);
      }
      logger.info(`MITM 已恢复 ${this.tasks.size} 条任务记录`);
    } catch (e) {
      logger.warn(`MITM 任务记录读取失败(忽略): ${(e as Error).message}`);
    }
  }

  private persist(): void {
    try {
      const arr = Array.from(this.tasks.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const tmp = `${this.persistFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(arr, null, 2));
      fs.renameSync(tmp, this.persistFile);
    } catch (e) {
      logger.warn(`MITM 任务记录写入失败(忽略): ${(e as Error).message}`);
    }
  }

  list(): MitmTask[] {
    return Array.from(this.tasks.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): MitmTask | undefined {
    return this.tasks.get(id);
  }

  create(input: CreateMitmTaskInput): MitmTask {
    const probe = probeUrl(input.url);
    const platform = (input.platform && input.platform !== 'unknown' ? input.platform : probe.platform);
    const adapterHeaders = probe.headers;
    const suffix = probe.suffix;
    const baseName = safeFileName(input.title || probe.suggestedName);
    const id = randomUUID();
    const fileName = `${baseName}-${id.slice(0, 6)}${suffix}`;
    const filePath = path.join(this.downloadDir, fileName);
    const now = new Date().toISOString();
    const source: 'fixture' | 'external' | 'bridge' =
      input.source ?? (probe.isLocalSource ? 'fixture' : 'external');

    const task: MitmTask = {
      id,
      url: input.url,
      platform,
      platformName: probe.matched ? probe.platformName : (platform === 'unknown' ? '外部直链' : probe.platformName),
      title: input.title || baseName,
      fileName,
      filePath,
      suffix,
      status: 'waiting',
      progress: 0,
      downloadedBytes: 0,
      fileSizeBytes: 0,
      speedBytesPerSec: 0,
      etaSeconds: null,
      source,
      headers: { ...adapterHeaders, ...(input.headers ?? {}) },
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(id, task);
    this.persist();
    this.enqueue(id);
    return task;
  }

  private enqueue(id: string): void {
    this.queue.push(id);
    this.pump();
  }

  private pump(): void {
    while (this.active < this.maxConcurrent && this.queue.length > 0) {
      const id = this.queue.shift()!;
      const t = this.tasks.get(id);
      if (!t || t.status !== 'waiting' || this.running.has(id)) continue;
      this.active++;
      void this.run(id).finally(() => {
        this.active--;
        this.pump();
      });
    }
  }

  private async run(id: string): Promise<void> {
    const t = this.tasks.get(id);
    if (!t) return;
    this.running.add(id);
    t.status = 'downloading';
    t.updatedAt = new Date().toISOString();
    this.persist();
    const signal: RunSignal = { aborted: false };
    this.signals.set(id, signal);

    try {
      const validation = await runMitmDownload({
        url: t.url,
        headers: t.headers,
        targetPath: t.filePath,
        timeoutMs: this.timeoutMs,
        onProgress: (p) => {
          t.downloadedBytes = p.downloadedBytes;
          t.fileSizeBytes = p.fileSizeBytes;
          t.speedBytesPerSec = p.speedBytesPerSec;
          t.etaSeconds = p.etaSeconds;
          t.progress = p.fileSizeBytes > 0
            ? Math.min(100, Math.round((p.downloadedBytes / p.fileSizeBytes) * 100))
            : (p.downloadedBytes > 0 ? 99 : 0);
          t.updatedAt = new Date().toISOString();
        },
        signal,
        ffprobeBin: this.ffprobeBin,
        maxBytes: 2 * 1024 * 1024 * 1024, // 2GB 上限，防止异常响应撑爆磁盘
      });

      if (!validation.valid) {
        t.status = 'failed';
        t.errorCode = 'VALIDATION_FAILED';
        t.errorMessage = validation.reason || '产物校验失败';
      } else {
        t.status = 'completed';
        t.progress = 100;
        t.downloadedBytes = validation.actualSize;
        t.fileSizeBytes = validation.actualSize || t.fileSizeBytes;
        t.completedAt = new Date().toISOString();
        t.etaSeconds = 0;
      }
      // 把 ffprobe / magic / size / 编码校验结果挂到任务上（前端可展示）
      (t as MitmTask & { validation?: MitmValidation }).validation = validation;

      // A02 完整修复：编码不兼容的产物在任务终态前自动转码为 H.264+AAC，
      // 避免「completed + 文件无法播放」这种 API 契约层面的假成功。
      // 可用 MITM_AUTO_REPAIR=0 关闭（关闭时仅标记 playerCompatible=false + 手动修复入口）。
      if (
        validation.valid &&
        validation.playerCompatible === false &&
        config.mitm.autoRepairIncompatible
      ) {
        try {
          await this.repair(id);
        } catch (e) {
          logger.warn(
            `MITM 自动修复失败（保留原文件，可手动点击修复）任务=${id.slice(0, 8)}: ${(e as Error).message}`
          );
        }
      }
    } catch (e) {
      if (e instanceof MitmCancelError || signal.aborted) {
        t.status = 'cancelled';
        t.errorMessage = '已取消';
      } else {
        t.status = 'failed';
        t.errorCode = mapErrCode((e as Error).message);
        t.errorMessage = (e as Error).message;
        logger.warn(`MITM 下载失败 任务=${id.slice(0, 8)} ${t.errorMessage}`);
      }
    } finally {
      this.signals.delete(id);
      this.running.delete(id);
      if (this.removed.has(id)) {
        this.removed.delete(id);
        // remove() 期间 run() 可能已 rename 产物（A13：已删文件被复活），在此彻底清理
        for (const p of [t.filePath, `${t.filePath}.part`]) {
          try {
            if (p && this.isUnderDownloadDir(p) && fs.existsSync(p)) fs.unlinkSync(p);
          } catch { /* ignore */ }
        }
        this.persist();
        return;
      }
      t.updatedAt = new Date().toISOString();
      this.persist();
    }
  }

  cancel(id: string): MitmTask | undefined {
    const t = this.tasks.get(id);
    if (!t) return undefined;
    const s = this.signals.get(id);
    if (s) s.aborted = true;
    if (t.status === 'waiting' || t.status === 'downloading') {
      t.status = 'cancelled';
      t.errorMessage = '已取消';
      t.updatedAt = new Date().toISOString();
      this.persist();
    }
    return t;
  }

  retry(id: string): MitmTask | undefined {
    const t = this.tasks.get(id);
    if (!t) return undefined;
    if (t.status !== 'failed' && t.status !== 'cancelled') return t;
    // cancel 是协作式的：run() 可能仍在退出中，此时重新入队会造成同一 id 双 run
    // 并发写同一 .part / 目标文件。直接返回，待 run 结束后用户可再重试。
    if (this.running.has(id)) return t;
    t.status = 'waiting';
    t.progress = 0;
    t.downloadedBytes = 0;
    t.speedBytesPerSec = 0;
    t.errorCode = undefined;
    t.errorMessage = undefined;
    t.updatedAt = new Date().toISOString();
    this.persist();
    this.enqueue(id);
    return t;
  }

  remove(id: string, deleteFile: boolean): { ok: boolean; deletedFile: boolean } {
    const t = this.tasks.get(id);
    if (!t) return { ok: false, deletedFile: false };
    if (t.status === 'downloading' || this.running.has(id)) {
      this.cancel(id);
      // 标记后由 run().finally 清理被 rename 复活的产物，避免孤儿文件
      this.removed.add(id);
    }
    let deletedFile = false;
    // 安全：只允许删除下载目录内的产物，防止被篡改的 filePath 删除任意文件
    const safeTarget = t.filePath && this.isUnderDownloadDir(t.filePath);
    if (deleteFile && safeTarget && fs.existsSync(t.filePath)) {
      try { fs.unlinkSync(t.filePath); deletedFile = true; } catch { /* ignore */ }
    }
    const part = t.filePath ? `${t.filePath}.part` : '';
    if (part && this.isUnderDownloadDir(part) && fs.existsSync(part)) {
      try { fs.unlinkSync(part); } catch { /* ignore */ }
    }
    this.tasks.delete(id);
    this.persist();
    return { ok: true, deletedFile };
  }

  /** 重新校验一个已完成任务的产物（供验收接口调用） */
  async revalidate(id: string): Promise<MitmValidationLike | null> {
    const t = this.tasks.get(id);
    if (!t) return null;
    let result: MitmValidation;
    if (!this.isUnderDownloadDir(t.filePath)) {
      result = {
        valid: false, sizeMatches: false, magicValid: false,
        reason: '产物路径越界（安全策略拦截）', actualSize: 0, expectedSize: t.fileSizeBytes, headerHex: '',
      };
    } else if (!fs.existsSync(t.filePath)) {
      result = {
        valid: false, sizeMatches: false, magicValid: false,
        reason: '文件不存在', actualSize: 0, expectedSize: t.fileSizeBytes, headerHex: '',
      };
    } else {
      result = await validateOutput(t.filePath, t.fileSizeBytes, this.ffprobeBin);
    }
    // 修复数据流转缺陷：重新校验结果必须写回任务并持久化，
    // 否则前端轮询读到的仍是下载时的旧 validation（编码/可播放性信息丢失）。
    t.validation = result;
    t.updatedAt = new Date().toISOString();
    this.persist();
    return result;
  }

  /**
   * 修复编码不兼容的产物：转码为 H.264+AAC 的 MP4（QuickTime / 主流浏览器通用）。
   * 原文件保留为 `<name>.original.<ext>`，不静默删除用户素材。
   */
  async repair(id: string, persist = true): Promise<MitmTask | undefined> {
    const t = this.tasks.get(id);
    if (!t || t.status !== 'completed' || !this.isUnderDownloadDir(t.filePath) || !fs.existsSync(t.filePath)) {
      return undefined;
    }

    const current = await validateOutput(t.filePath, t.fileSizeBytes, this.ffprobeBin);
    if (current.playerCompatible !== false) {
      // 已可播放：仅刷新校验信息
      t.validation = current;
      t.updatedAt = new Date().toISOString();
      if (persist) this.persist();
      return t;
    }

    const repaired = await repairToH264(t.filePath, true);
    t.filePath = repaired.filePath;
    t.fileName = path.basename(repaired.filePath);
    t.suffix = path.extname(repaired.filePath);
    t.fileSizeBytes = repaired.fileSizeBytes;
    t.downloadedBytes = repaired.fileSizeBytes;
    t.progress = 100;
    const validation = await validateOutput(t.filePath, t.fileSizeBytes, this.ffprobeBin);
    t.validation = {
      ...validation,
      repaired: true,
      notes: validation.playerCompatible === false ? validation.notes : '已修复为 H.264+AAC 可播放格式',
    };
    t.updatedAt = new Date().toISOString();
    if (persist) this.persist();
    logger.info(`MITM 产物已修复为 H.264 任务=${id.slice(0, 8)}`);
    return t;
  }

  /** 各下载器通道的真实可访问性探测（走本机 HTTP，带正确 Referer） */
  async probeDownloader(platform: MitmPlatform): Promise<{ reachable: boolean; httpStatus: number | null; latencyMs: number | null }> {
    const { demoUrl } = await import('./fixture.js');
    const { buildHeaders } = await import('./platforms.js');
    const url = demoUrl(this.baseUrl, platform);
    const started = Date.now();
    return new Promise((resolve) => {
      try {
        const u = new URL(url);
        const req = http.request(u, { method: 'GET', headers: buildHeaders(platform) }, (res) => {
          res.resume();
          resolve({ reachable: res.statusCode === 200 || res.statusCode === 206, httpStatus: res.statusCode ?? null, latencyMs: Date.now() - started });
        });
        req.setTimeout(3000, () => req.destroy(new Error('timeout')));
        req.on('error', () => resolve({ reachable: false, httpStatus: null, latencyMs: null }));
        req.end();
      } catch {
        resolve({ reachable: false, httpStatus: null, latencyMs: null });
      }
    });
  }
}

type MitmValidationLike = Awaited<ReturnType<typeof validateOutput>>;

function mapErrCode(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('403') || m.includes('防盗链')) return 'HOTLINK_BLOCKED';
  if (m.includes('404')) return 'NOT_FOUND';
  if (m.includes('超时') || m.includes('timeout')) return 'TIMEOUT';
  if (m.includes('enotfound') || m.includes('econn') || m.includes('网络')) return 'NETWORK_ERROR';
  if (m.includes('非法 url')) return 'INVALID_URL';
  return 'DOWNLOAD_FAILED';
}
