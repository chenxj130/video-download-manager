import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { paths } from './config.js';
import { logger } from './utils/logger.js';
import type { DownloadTask, Settings } from './types.js';

fs.mkdirSync(path.dirname(paths.dbFile), { recursive: true });

export const db = new Database(paths.dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  platform TEXT NOT NULL,
  platform_name TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  thumbnail_url TEXT NOT NULL DEFAULT '',
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  resolution TEXT NOT NULL,
  format TEXT NOT NULL,
  save_dir TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL DEFAULT '',
  file_size_bytes INTEGER NOT NULL DEFAULT 0,
  downloaded_bytes INTEGER NOT NULL DEFAULT 0,
  speed_bytes_per_sec INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  progress REAL NOT NULL DEFAULT 0,
  eta_seconds INTEGER,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_platform ON tasks(platform);
`);

const DEFAULT_SETTINGS: Settings = {
  defaultQuality: '1080p',
  defaultFormat: 'mp4',
  maxConcurrent: 3,
  defaultSaveDir: '', // 运行时填充
  maxSpeedBytesPerSec: 0,
  requestTimeoutSeconds: 60,
  autoRetryCount: 1,
  theme: 'system',
};

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL
);
`);

function loadSettings(): Settings {
  const row = db.prepare('SELECT data FROM settings WHERE id = 1').get() as
    | { data: string }
    | undefined;
  if (!row) {
    const initial = { ...DEFAULT_SETTINGS };
    db.prepare('INSERT INTO settings (id, data) VALUES (1, ?)').run(
      JSON.stringify(initial)
    );
    return initial;
  }
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(row.data) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export const settingsStore = {
  get(): Settings {
    return loadSettings();
  },
  update(patch: Partial<Settings>): Settings {
    const current = loadSettings();
    const next = { ...current, ...patch };
    db.prepare('UPDATE settings SET data = ? WHERE id = 1').run(
      JSON.stringify(next)
    );
    logger.info('设置已更新', Object.keys(patch));
    return next;
  },
};

/** 行 -> DownloadTask 对象映射 */
export function rowToTask(row: Record<string, unknown>): DownloadTask {
  return {
    id: row.id as string,
    url: row.url as string,
    platform: row.platform as DownloadTask['platform'],
    platformName: row.platform_name as string,
    title: row.title as string,
    author: row.author as string,
    thumbnailUrl: row.thumbnail_url as string,
    durationSeconds: row.duration_seconds as number,
    resolution: row.resolution as DownloadTask['resolution'],
    format: row.format as DownloadTask['format'],
    saveDir: row.save_dir as string,
    fileName: row.file_name as string,
    filePath: row.file_path as string,
    fileSizeBytes: row.file_size_bytes as number,
    downloadedBytes: row.downloaded_bytes as number,
    speedBytesPerSec: row.speed_bytes_per_sec as number,
    status: row.status as DownloadTask['status'],
    errorCode: (row.error_code as string) || undefined,
    errorMessage: (row.error_message as string) || undefined,
    progress: row.progress as number,
    etaSeconds: (row.eta_seconds as number) ?? undefined,
    retryCount: row.retry_count as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    startedAt: (row.started_at as string) || undefined,
    completedAt: (row.completed_at as string) || undefined,
  };
}

const insertStmt = db.prepare(`
INSERT INTO tasks (
  id, url, platform, platform_name, title, author, thumbnail_url,
  duration_seconds, resolution, format, save_dir, file_name, file_path,
  file_size_bytes, downloaded_bytes, speed_bytes_per_sec, status,
  error_code, error_message, progress, eta_seconds, retry_count,
  created_at, updated_at, started_at, completed_at
) VALUES (
  @id, @url, @platform, @platformName, @title, @author, @thumbnailUrl,
  @durationSeconds, @resolution, @format, @saveDir, @fileName, @filePath,
  @fileSizeBytes, @downloadedBytes, @speedBytesPerSec, @status,
  @errorCode, @errorMessage, @progress, @etaSeconds, @retryCount,
  @createdAt, @updatedAt, @startedAt, @completedAt
)
`);

export function insertTask(task: DownloadTask): void {
  const now = new Date().toISOString();
  insertStmt.run({
    id: task.id,
    url: task.url ?? '',
    platform: task.platform ?? '',
    platformName: task.platformName ?? '',
    title: task.title ?? '',
    author: task.author ?? '',
    thumbnailUrl: task.thumbnailUrl ?? '',
    durationSeconds: task.durationSeconds ?? 0,
    resolution: task.resolution ?? '',
    format: task.format ?? '',
    saveDir: task.saveDir ?? '',
    fileName: task.fileName ?? '',
    filePath: task.filePath ?? '',
    fileSizeBytes: task.fileSizeBytes ?? 0,
    downloadedBytes: task.downloadedBytes ?? 0,
    speedBytesPerSec: task.speedBytesPerSec ?? 0,
    status: task.status ?? 'waiting',
    errorCode: task.errorCode ?? null,
    errorMessage: task.errorMessage ?? null,
    progress: task.progress ?? 0,
    etaSeconds: task.etaSeconds ?? null,
    retryCount: task.retryCount ?? 0,
    createdAt: task.createdAt ?? now,
    updatedAt: task.updatedAt ?? now,
    startedAt: task.startedAt ?? null,
    completedAt: task.completedAt ?? null,
  });
}

const updateStmt = db.prepare(`
UPDATE tasks SET
  url=@url, platform=@platform, platform_name=@platformName, title=@title,
  author=@author, thumbnail_url=@thumbnailUrl, duration_seconds=@durationSeconds,
  resolution=@resolution, format=@format, save_dir=@saveDir, file_name=@fileName,
  file_path=@filePath, file_size_bytes=@fileSizeBytes, downloaded_bytes=@downloadedBytes,
  speed_bytes_per_sec=@speedBytesPerSec, status=@status, error_code=@errorCode,
  error_message=@errorMessage, progress=@progress, eta_seconds=@etaSeconds,
  retry_count=@retryCount, created_at=@createdAt, updated_at=@updatedAt,
  started_at=@startedAt, completed_at=@completedAt
WHERE id=@id
`);

export function updateTask(task: DownloadTask): void {
  const now = new Date().toISOString();
  updateStmt.run({
    id: task.id,
    url: task.url ?? '',
    platform: task.platform ?? '',
    platformName: task.platformName ?? '',
    title: task.title ?? '',
    author: task.author ?? '',
    thumbnailUrl: task.thumbnailUrl ?? '',
    durationSeconds: task.durationSeconds ?? 0,
    resolution: task.resolution ?? '',
    format: task.format ?? '',
    saveDir: task.saveDir ?? '',
    fileName: task.fileName ?? '',
    filePath: task.filePath ?? '',
    fileSizeBytes: task.fileSizeBytes ?? 0,
    downloadedBytes: task.downloadedBytes ?? 0,
    speedBytesPerSec: task.speedBytesPerSec ?? 0,
    status: task.status ?? 'waiting',
    errorCode: task.errorCode ?? null,
    errorMessage: task.errorMessage ?? null,
    progress: task.progress ?? 0,
    etaSeconds: task.etaSeconds ?? null,
    retryCount: task.retryCount ?? 0,
    createdAt: task.createdAt ?? now,
    updatedAt: task.updatedAt ?? now,
    startedAt: task.startedAt ?? null,
    completedAt: task.completedAt ?? null,
  });
}

export function deleteTaskRow(id: string): void {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
}

export function getTaskRow(id: string): DownloadTask | null {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToTask(row) : null;
}

export function getAllTasks(): DownloadTask[] {
  const rows = db
    .prepare('SELECT * FROM tasks ORDER BY created_at DESC')
    .all() as Record<string, unknown>[];
  return rows.map(rowToTask);
}

export function getTaskCount(): number {
  const row = db.prepare('SELECT COUNT(*) as c FROM tasks').get() as {
    c: number;
  };
  return row.c;
}
