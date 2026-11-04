import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  db,
  insertTask,
  updateTask,
  deleteTaskRow,
  getTaskRow,
  getAllTasks,
  settingsStore,
} from '../db.js';
import type { DownloadTask, Settings, VideoMetadata, DashboardStats, SystemInfo } from '../types.js';
import { ApiError, mapEngineError } from '../utils/errors.js';
import { getDiskSpace, ensureDir, removeFileSafe } from '../utils/file.js';
import { sanitizeFileName, clamp } from '../utils/format.js';
import { config } from '../config.js';
import { getEngine, getEngineName } from '../engine/index.js';
import { AbortError, type ProgressUpdate } from '../engine/simulate.js';
import { probeMedia, repairToH264 } from '../utils/media.js';
import { SIMULATE_MAX_BYTES, SIMULATE_MIN_BYTES } from '../constants.js';
import { logger } from '../utils/logger.js';

interface ActiveDownload {
  abort: AbortController;
  desired: 'paused' | 'cancelled' | null;
}

const ACTIVE_STATUSES = ['waiting', 'parsing', 'downloading', 'paused'] as const;

class TaskManager {
  private tasks = new Map<string, DownloadTask>();
  private active = new Map<string, ActiveDownload>();
  private lastSave = new Map<string, number>();
  private startedAt = Date.now();

  /** 初始化：从数据库加载任务并恢复 */
  init(): void {
    const rows = getAllTasks();
    for (const t of rows) this.tasks.set(t.id, t);
    logger.info(`已从数据库加载 ${this.tasks.size} 个任务`);
    this.recover();
  }

  /** 服务重启后的任务恢复策略 */
  private recover(): void {
    let recovered = 0;
    for (const t of this.tasks.values()) {
      if (t.status === 'downloading' || t.status === 'parsing') {
        // 进程曾异常退出 -> 退回等待，保留已下载进度（模拟引擎支持续传）
        t.status = 'waiting';
        t.progress = t.fileSizeBytes > 0 ? (t.downloadedBytes / t.fileSizeBytes) * 100 : 0;
        t.speedBytesPerSec = 0;
        t.errorCode = undefined;
        t.errorMessage = undefined;
        this.save(t);
        recovered++;
      }
      // paused / waiting 保持不变
    }
    if (recovered > 0) logger.info(`恢复了 ${recovered} 个中断的任务为等待状态`);
    this.startQueue();
  }

  // ---------- 基础读取 ----------
  getTasks(filter?: { status?: string; platform?: string }): DownloadTask[] {
    let list = Array.from(this.tasks.values());
    if (filter?.status) list = list.filter((t) => t.status === filter.status);
    if (filter?.platform) list = list.filter((t) => t.platform === filter.platform);
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getTask(id: string): DownloadTask | null {
    return this.tasks.get(id) ?? null;
  }

  getSettings(): Settings {
    const s = settingsStore.get();
    // 默认保存目录为空时回退到全局下载目录，便于前端展示
    return { ...s, defaultSaveDir: s.defaultSaveDir?.trim() || config.downloadDir };
  }

  updateSettings(patch: Partial<Settings>): Settings {
    const next = settingsStore.update(patch);
    // 并发数变化立即生效
    if (patch.maxConcurrent !== undefined) this.startQueue();
    return next;
  }

  // ---------- 创建任务 ----------
  createTask(
    meta: VideoMetadata,
    selection: { resolution: string; format: string; saveDir?: string }
  ): DownloadTask {
    const settings = this.getSettings();
    // 重复检测：同 URL + 分辨率 + 格式 且未失败的，视为重复
    for (const t of this.tasks.values()) {
      if (
        t.url === meta.url &&
        t.resolution === selection.resolution &&
        t.format === selection.format &&
        t.status !== 'failed' &&
        t.status !== 'cancelled'
      ) {
        throw new ApiError(
          'DUPLICATE_TASK',
          '该视频已存在相同分辨率/格式的任务，请勿重复下载',
          409
        );
      }
    }

    const saveDir = selection.saveDir?.trim() || settings.defaultSaveDir || config.downloadDir;
    ensureDir(saveDir);

    // 选择文件格式大小
    const opt = meta.formats.find(
      (f) => f.resolution === selection.resolution && f.format === selection.format
    );
    let size = opt?.sizeBytes ?? meta.estimatedBytes ?? SIMULATE_MIN_BYTES;
    if (getEngineName() === 'simulate') {
      size = clamp(size, SIMULATE_MIN_BYTES, SIMULATE_MAX_BYTES);
    }

    const fileName = this.uniqueFileName(saveDir, `${sanitizeFileName(meta.title)}.${selection.format}`);
    const now = new Date().toISOString();
    const task: DownloadTask = {
      id: randomUUID(),
      url: meta.url,
      platform: meta.platform,
      platformName: meta.platformName,
      title: meta.title,
      author: meta.author,
      thumbnailUrl: meta.thumbnailUrl,
      durationSeconds: meta.durationSeconds,
      resolution: selection.resolution as DownloadTask['resolution'],
      format: selection.format as DownloadTask['format'],
      saveDir,
      fileName,
      filePath: '',
      fileSizeBytes: Math.round(size),
      downloadedBytes: 0,
      speedBytesPerSec: 0,
      status: 'waiting',
      progress: 0,
      etaSeconds: undefined,
      retryCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(task.id, task);
    insertTask(task);
    logger.info(`创建任务 ${task.id} (${task.platformName}) ${task.resolution} ${task.format}`);
    this.startQueue();
    return task;
  }

  private uniqueFileName(dir: string, base: string): string {
    const ext = path.extname(base);
    const name = path.basename(base, ext);
    let candidate = `${name}${ext}`;
    let i = 2;
    while (fs.existsSync(path.join(dir, candidate))) {
      candidate = `${name}_${i}${ext}`;
      i++;
    }
    return candidate;
  }

  // ---------- 并发队列 ----------
  private activeCount(): number {
    let n = 0;
    for (const t of this.tasks.values()) if (t.status === 'downloading') n++;
    return n;
  }

  private startQueue(): void {
    const max = this.getSettings().maxConcurrent;
    while (this.activeCount() < max) {
      const next = Array.from(this.tasks.values())
        .filter((t) => t.status === 'waiting')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (!next) break;
      this.startDownload(next);
    }
  }

  private startDownload(task: DownloadTask): void {
    const isResume = task.status === 'paused' && task.downloadedBytes > 0;
    task.status = 'downloading';
    task.startedAt = task.startedAt ?? new Date().toISOString();
    if (!isResume) {
      task.downloadedBytes = 0;
      task.progress = 0;
      task.errorCode = undefined;
      task.errorMessage = undefined;
    }
    const abort = new AbortController();
    this.active.set(task.id, { abort, desired: null });
    this.save(task);
    logger.info(`开始下载 ${task.id}`);

    const engine = getEngine();
    const settings = this.getSettings();
    const handle = engine.createDownload({
      task,
      outDir: task.saveDir,
      startBytes: task.downloadedBytes,
      resume: isResume,
      maxSpeedBytesPerSec: settings.maxSpeedBytesPerSec,
      requestTimeoutSeconds: settings.requestTimeoutSeconds,
      signal: abort.signal,
      onProgress: (p: ProgressUpdate) => this.onProgress(task.id, p),
    });

    handle
      .run()
      .then((res) => {
        // 媒体探测/自动修复在 onComplete 内部异步执行，自身捕获异常，避免污染下载成功状态
        void this.onComplete(task.id, res.filePath, res.fileSizeBytes);
      })
      .catch((err) => this.onError(task.id, err));
  }

  private onProgress(id: string, p: ProgressUpdate): void {
    const task = this.tasks.get(id);
    if (!task || task.status !== 'downloading') return;
    task.downloadedBytes = p.downloadedBytes;
    task.fileSizeBytes = p.fileSizeBytes || task.fileSizeBytes;
    task.speedBytesPerSec = p.speedBytesPerSec;
    task.etaSeconds = p.etaSeconds;
    task.progress = p.fileSizeBytes > 0 ? (p.downloadedBytes / p.fileSizeBytes) * 100 : 0;
    const now = Date.now();
    if (now - (this.lastSave.get(id) ?? 0) > 400) {
      this.save(task);
      this.lastSave.set(id, now);
    }
  }

  private async onComplete(id: string, filePath: string, fileSize: number): Promise<void> {
    const task = this.tasks.get(id);
    if (!task) return;
    task.status = 'completed';
    task.filePath = filePath;
    task.fileName = path.basename(filePath);
    task.fileSizeBytes = fileSize || task.fileSizeBytes;
    task.downloadedBytes = task.fileSizeBytes;
    task.progress = 100;
    task.speedBytesPerSec = 0;
    task.etaSeconds = 0;
    task.completedAt = new Date().toISOString();

    // 下载后媒体校验：探测编码与可播放性；不兼容时按配置自动转码修复，
    // 从源头消除「下载完成但无法播放」的复现风险。
    if (task.format !== 'mp3' && task.format !== 'm4a') {
      try {
        const media = await probeMedia(filePath);
        if (media) {
          task.media = media;
          if (media.playerCompatible === false && config.autoRepairIncompatible) {
            logger.warn(
              `检测到不兼容编码 ${media.videoCodec}/${media.container}，自动转码为 H.264: ${task.id}`
            );
            const repaired = await repairToH264(filePath, true);
            task.filePath = repaired.filePath;
            task.fileName = path.basename(repaired.filePath);
            task.fileSizeBytes = repaired.fileSizeBytes;
            task.downloadedBytes = repaired.fileSizeBytes;
            task.media = { ...repaired.media, repaired: true };
          }
        }
      } catch (e) {
        logger.warn(`媒体校验/修复跳过（不影响下载结果）${task.id}: ${(e as Error).message}`);
      }
    }

    this.active.delete(id);
    this.save(task);
    logger.info(`下载完成 ${id} -> ${task.filePath}`);
    this.startQueue();
  }

  private onError(id: string, err: unknown): void {
    const task = this.tasks.get(id);
    if (!task) return;
    // 在移除 active 前读取期望动作，确保 pause/cancel 能被正确识别
    const desired = this.active.get(id)?.desired ?? null;
    this.active.delete(id);
    const action = this.desiredMap.get(id) ?? desired;
    this.desiredMap.delete(id);

    if (err instanceof AbortError) {
      if (action === 'paused') {
        task.status = 'paused';
        task.speedBytesPerSec = 0;
        task.etaSeconds = undefined;
        this.save(task);
        logger.info(`任务已暂停 ${id}`);
        this.startQueue();
        return;
      }
      // 取消
      task.status = 'cancelled';
      task.speedBytesPerSec = 0;
      this.save(task);
      logger.info(`任务已取消 ${id}`);
      this.startQueue();
      return;
    }

    // 真实错误
    let code: string;
    let message: string;
    if (err instanceof ApiError) {
      // 已携带明确错误码/信息（如注入故障），直接透传
      code = err.code;
      message = err.message;
    } else {
      const mapped = mapEngineError(err);
      code = mapped.code;
      message = mapped.message;
    }
    task.status = 'failed';
    task.errorCode = code;
    task.errorMessage = message;
    task.speedBytesPerSec = 0;
    this.save(task);
    logger.warn(`任务失败 ${id}: ${message}`);

    // 自动重试
    const settings = this.getSettings();
    if (task.retryCount < settings.autoRetryCount) {
      task.retryCount += 1;
      task.status = 'waiting';
      task.downloadedBytes = 0;
      task.progress = 0;
      task.errorCode = undefined;
      task.errorMessage = undefined;
      this.save(task);
      logger.info(`任务自动重试 ${id} (第 ${task.retryCount} 次)`);
    }
    this.startQueue();
  }

  // 保存期望动作（pause/cancel 时用于在 abort 后区分）
  private desiredMap = new Map<string, 'paused' | 'cancelled'>();

  // ---------- 任务控制 ----------
  pause(id: string): DownloadTask {
    const task = this.require(id);
    if (task.status !== 'downloading') {
      throw new ApiError('INVALID_URL', '仅下载中的任务可以暂停', 400);
    }
    const a = this.active.get(id);
    if (a) {
      this.desiredMap.set(id, 'paused');
      a.desired = 'paused';
      a.abort.abort();
    }
    return task;
  }

  resume(id: string): DownloadTask {
    const task = this.require(id);
    if (task.status !== 'paused') {
      throw new ApiError('INVALID_URL', '仅已暂停的任务可以继续', 400);
    }
    task.status = 'waiting';
    this.save(task);
    this.startQueue();
    return task;
  }

  cancel(id: string): DownloadTask {
    const task = this.require(id);
    if (task.status === 'downloading') {
      const a = this.active.get(id);
      if (a) {
        this.desiredMap.set(id, 'cancelled');
        a.desired = 'cancelled';
        a.abort.abort();
      }
    } else if (task.status === 'waiting' || task.status === 'parsing') {
      task.status = 'cancelled';
      this.save(task);
      this.startQueue();
    } else {
      throw new ApiError('INVALID_URL', '该任务无法取消', 400);
    }
    return task;
  }

  retry(id: string): DownloadTask {
    const task = this.require(id);
    if (task.status !== 'failed' && task.status !== 'cancelled') {
      throw new ApiError('INVALID_URL', '仅失败/已取消的任务可以重试', 400);
    }
    task.status = 'waiting';
    task.downloadedBytes = 0;
    task.progress = 0;
    task.errorCode = undefined;
    task.errorMessage = undefined;
    task.retryCount = 0;
    this.save(task);
    this.startQueue();
    return task;
  }

  remove(id: string, deleteFile = false): void {
    const task = this.require(id);
    if (task.status === 'downloading') {
      const a = this.active.get(id);
      if (a) {
        this.desiredMap.set(id, 'cancelled');
        a.desired = 'cancelled';
        a.abort.abort();
      }
    }
    if (deleteFile && task.filePath && fs.existsSync(task.filePath)) {
      removeFileSafe(task.filePath);
    }
    this.active.delete(id);
    this.desiredMap.delete(id);
    this.tasks.delete(id);
    deleteTaskRow(id);
    logger.info(`已删除任务 ${id} (删文件=${deleteFile})`);
    this.startQueue();
  }

  /** 删除已下载文件（不影响任务记录） */
  deleteFile(id: string): boolean {
    const task = this.require(id);
    if (!task.filePath) return false;
    const ok = removeFileSafe(task.filePath);
    if (ok) {
      task.filePath = '';
      this.save(task);
    }
    return ok;
  }

  /** 手动修复：对已完成但编码不兼容的任务转码为 H.264+AAC 可播放格式 */
  async repair(id: string): Promise<DownloadTask> {
    const task = this.require(id);
    if (task.status !== 'completed' || !task.filePath) {
      throw new ApiError('INVALID_URL', '仅已完成且存在文件的任务可修复', 400);
    }
    if (!fs.existsSync(task.filePath)) {
      throw new ApiError('FILE_NOT_FOUND', '文件不存在，可能已被删除', 404);
    }
    try {
      const media = await probeMedia(task.filePath);
      if (media && media.playerCompatible) {
        // 已经可播放，无需转码，仅刷新探测信息
        task.media = media;
        this.save(task);
        return task;
      }
      const repaired = await repairToH264(task.filePath, true);
      task.filePath = repaired.filePath;
      task.fileName = path.basename(repaired.filePath);
      task.fileSizeBytes = repaired.fileSizeBytes;
      task.downloadedBytes = repaired.fileSizeBytes;
      task.media = { ...repaired.media, repaired: true };
      this.save(task);
      return task;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError('WRITE_FAILED', `修复失败: ${(e as Error).message}`, 500);
    }
  }

  private require(id: string): DownloadTask {
    const t = this.tasks.get(id);
    if (!t) throw new ApiError('TASK_NOT_FOUND', '任务不存在', 404);
    return t;
  }

  private save(task: DownloadTask): void {
    task.updatedAt = new Date().toISOString();
    updateTask(task);
  }

  // ---------- 历史 ----------
  getHistory(filter?: {
    search?: string;
    platform?: string;
    status?: string;
    sort?: 'asc' | 'desc';
  }): DownloadTask[] {
    let list = Array.from(this.tasks.values()).filter((t) =>
      ['completed', 'failed', 'cancelled'].includes(t.status)
    );
    if (filter?.platform) list = list.filter((t) => t.platform === filter.platform);
    if (filter?.status) list = list.filter((t) => t.status === filter.status);
    if (filter?.search) {
      const q = filter.search.toLowerCase();
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.author.toLowerCase().includes(q) ||
          t.fileName.toLowerCase().includes(q)
      );
    }
    const dir = filter?.sort === 'asc' ? 1 : -1;
    return list.sort((a, b) => a.createdAt.localeCompare(b.createdAt) * dir);
  }

  removeHistory(id: string): void {
    // 仅删除历史记录，不删除实际文件
    this.remove(id, false);
  }

  // ---------- Dashboard ----------
  getDashboard(): DashboardStats {
    const all = Array.from(this.tasks.values());
    const today = new Date().toISOString().slice(0, 10);
    const todayTasks = all.filter((t) => t.createdAt.slice(0, 10) === today).length;
    const completed = all.filter((t) => t.status === 'completed').length;
    const downloading = all.filter((t) => t.status === 'downloading').length;
    const failed = all.filter((t) => t.status === 'failed').length;
    const totalDownloadedBytes = all
      .filter((t) => t.status === 'completed')
      .reduce((s, t) => s + t.fileSizeBytes, 0);
    const totalTasks = all.length;
    const terminal = completed + failed;
    const successRate = terminal > 0 ? (completed / terminal) * 100 : 0;

    const byPlatformMap = new Map<string, { name: string; count: number }>();
    for (const t of all) {
      const cur = byPlatformMap.get(t.platform) ?? { name: t.platformName, count: 0 };
      cur.count++;
      byPlatformMap.set(t.platform, cur);
    }
    const byPlatform = Array.from(byPlatformMap.entries()).map(([platform, v]) => ({
      platform,
      platformName: v.name,
      count: v.count,
    }));

    // 最近 14 天
    const daily: { date: string; count: number; bytes: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const date = d.toISOString().slice(0, 10);
      const dayTasks = all.filter((t) => t.createdAt.slice(0, 10) === date);
      daily.push({
        date,
        count: dayTasks.length,
        bytes: dayTasks
          .filter((t) => t.status === 'completed')
          .reduce((s, t) => s + t.fileSizeBytes, 0),
      });
    }

    const recentTasks = Array.from(this.tasks.values())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 8);

    return {
      todayTasks,
      completed,
      downloading,
      failed,
      totalDownloadedBytes,
      totalTasks,
      successRate,
      recentTasks,
      byPlatform,
      daily,
      totalBytes: totalDownloadedBytes,
    };
  }

  // ---------- 系统信息 ----------
  async getSystemInfo(): Promise<SystemInfo> {
    const disk = await getDiskSpace(config.downloadDir);
    let downloadDirStatus: SystemInfo['downloadDirStatus'] = 'ok';
    try {
      fs.accessSync(config.downloadDir, fs.constants.W_OK);
    } catch {
      downloadDirStatus = 'missing';
    }
    return {
      version: config.version,
      databaseStatus: 'ok',
      downloadDirStatus,
      downloadDir: config.downloadDir,
      diskFreeBytes: disk.free,
      diskTotalBytes: disk.total,
      engine: getEngineName(),
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      nodeVersion: process.version,
      platform: process.platform,
    };
  }
}

export const taskManager = new TaskManager();
