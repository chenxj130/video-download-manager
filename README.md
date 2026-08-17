# 在线视频下载管理器 (Video Download Manager)

统一管理你的在线视频下载任务：粘贴链接 → 解析 → 选清晰度/格式 → 并发下载 → 看进度 → 历史归档。
后端 Express + better-sqlite3，前端 React + Vite + Tailwind，单端口对外（API 与前端同源）。

> 默认端口 `8787`。引擎支持两种模式：
> - **ytdlp（真实下载）**：调用系统 `yt-dlp` + `ffmpeg`，下载真实视频文件（高清源为视频/音频分离流，自动合并）。
> - **simulate（模拟下载）**：在没有 `yt-dlp`/`ffmpeg` 或离线环境下，写入按比例占位的真实体积文件，用于演示与测试，文件并非真实视频。
>
> 启动时会自动检测可用引擎；若只装了部分依赖会**降级为 simulate** 并在前端顶部弹出警告条。

---

## 特性

- 支持平台：YouTube、Bilibili、Vimeo、X(Twitter)、TikTok、Instagram（公开链接）。
- 解析视频元信息：标题、作者、时长、缩略图、可选分辨率与格式、估算体积。
- 创建下载任务，支持选择分辨率（`144p`–`2160p`）、格式（`mp4/webm/mkv/mov/m4a/mp3`）。
- 并发下载（默认 3，可在 1–10 间调节），队列自动推进。
- 实时进度、速度、ETA；暂停 / 继续 / 取消 / 重试 / 删除。
- 仪表板：今日任务、完成数、成功率、按平台分布、近 7 日趋势。
- 历史页：已完成/失败/已取消记录，支持搜索、按平台/状态过滤、排序。
- 设置：默认画质、格式、并发数、限速、超时、自动重试、主题（浅色/深色/跟随系统）。
- 任务持久化（SQLite），容器/进程重启后任务与下载记录可恢复。
- Docker 支持（`docker compose up -d`，多阶段构建，内置 yt-dlp + ffmpeg）。

---

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 18、Vite 5、Tailwind CSS 3、React Router 6、TypeScript |
| 后端 | Node.js、Express 4、better-sqlite3、TypeScript、tsx |
| 数据 | SQLite（单文件，项目内 `data/` 目录） |
| 下载引擎 | yt-dlp + ffmpeg（真实）/ 内置 SimulateEngine（占位） |
| 部署 | Docker 多阶段镜像 + docker compose |

---

## 环境要求

- Node.js ≥ 18（推荐 22）
- 真实下载需安装 `yt-dlp` 与 `ffmpeg` 并可在 PATH 中找到（或用环境变量指定绝对路径）
- 可选：Docker / Docker Compose（用于容器化部署）

---

## 快速开始（源码）

```bash
# 1. 安装全部依赖（含 server 与 web，postinstall 会自动安装子目录）
npm install

# 2. 开发模式（同时启动后端 + 前端）
npm run dev
#   后端:  http://localhost:8787  (API 基地址 /api)
#   前端:  http://localhost:5173  (Vite 开发服务器，已代理 /api 到 8787)

# 3. 生产模式
npm run build          # 构建前端静态产物到 web/dist
npm start              # 启动后端，由后端在 8787 托管前端 + API
#   访问:  http://localhost:8787
```

> 前端是 SPA，必须通过 HTTP 访问，不能直接用 `file://` 打开 `web/dist/index.html`。

### 安装真实下载依赖（推荐）

```bash
# macOS (Homebrew)
brew install yt-dlp ffmpeg

# 或用 pipx / pip
pipx install yt-dlp && brew install ffmpeg
```

若 `yt-dlp`/`ffmpeg` 不在 PATH（例如装在 venv 或 pipx 目录），用环境变量指定绝对路径：

```bash
YTDLP_PATH=/opt/homebrew/bin/yt-dlp FFMPEG_PATH=/opt/homebrew/bin/ffmpeg npm start
```

---

## Docker 部署

```bash
# 构建并后台启动（镜像内置 yt-dlp + ffmpeg，引擎自动为 ytdlp）
docker compose up -d

# 查看日志
docker compose logs -f

# 访问
open http://localhost:8787

# 停止并保留数据
docker compose down

# 停止并删除卷（会清空 data/ 与 downloads/）
docker compose down -v
```

- 数据卷：`/app/data`（SQLite）与 `/app/downloads`（下载文件）已挂载到宿主 `./data`、`./downloads`，容器重建不丢数据。
- 健康检查：`/api/health` 返回 `{ ok: true }`。
- 如需改宿主端口，编辑 `docker-compose.yml` 中 `ports: "8787:8787"` 的左侧值即可。

---

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `PORT` | `8787` | 服务监听端口 |
| `DATA_DIR` | `./data` | SQLite 数据库目录 |
| `DOWNLOAD_DIR` | `./downloads` | 下载文件落盘目录 |
| `DOWNLOAD_ENGINE` | `auto` | `auto` / `ytdlp` / `simulate` |
| `YTDLP_PATH` | `yt-dlp` | yt-dlp 可执行文件（命令名或绝对路径） |
| `FFMPEG_PATH` | `ffmpeg` | ffmpeg 可执行文件（命令名或绝对路径） |
| `YTDLP_KEEP_FRAGMENTS` | `0` | 设为 `1` 时保留 HLS 临时分片，可绕过某些安全沙箱对批量删除的拦截 |
| `MAX_CONCURRENT` | `3` | 最大并发下载数（1–10） |
| `WEB_DIST` | `../web/dist` | 生产模式前端产物目录 |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `REQUEST_TIMEOUT` | `60` | 单次解析/下载请求超时（秒） |

示例见 `.env.example`（复制为 `.env` 后按需修改）。

---

## 目录结构

```
视频下载/
├── docker-compose.yml        # 容器编排（含验证用 docker-compose.verify.yml）
├── Dockerfile                # 多阶段构建：web-build / server-deps / runtime
├── .dockerignore
├── .env.example
├── package.json              # 根：concurrently 同时启动前后端
├── server/                   # 后端
│   ├── src/
│   │   ├── index.ts          # 入口：Express、静态托管、健康检查、错误处理
│   │   ├── config.ts         # 配置与环境变量
│   │   ├── db.ts             # SQLite 初始化
│   │   ├── platforms.ts      # URL 校验与平台识别
│   │   ├── constants.ts      # 平台/分辨率/格式/状态字典
│   │   ├── engine/           # 下载引擎（index 自动检测 + ytdlp + simulate）
│   │   ├── routes/           # /api 各路由
│   │   ├── services/         # taskManager 任务编排
│   │   ├── utils/            # errors / file / format / logger
│   │   └── types.ts          # 共享类型
│   ├── test/api.test.ts      # API 自动化测试
│   └── package.json
└── web/                      # 前端
    ├── src/
    │   ├── pages/            # Dashboard / Tasks / History / Home / Settings
    │   ├── components/       # Layout / EngineBanner / charts / ui
    │   ├── api.ts            # API 客户端
    │   ├── context/          # ThemeContext
    │   └── hooks/            # usePolling
    └── package.json
```

---

## API 文档

基地址：`/api`。统一错误体：`{ "error": { "code": "CODE", "message": "中文说明" } }`。

### 系统

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查，返回 `{ ok: true, time }` |
| GET | `/api/system` | 系统信息：版本、引擎(`ytdlp`/`simulate`)、磁盘、运行时长等 |

### 解析

| 方法 | 路径 | 请求体 | 说明 |
|------|------|--------|------|
| POST | `/api/parse` | `{ url }` | 解析链接，返回 `{ metadata }`（标题/作者/时长/可选格式/估算体积/是否模拟） |

### 任务

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/tasks?status=&platform=` | 任务列表（可按状态、平台过滤） |
| POST | `/api/tasks` | 创建任务，请求体 `{ url, resolution, format, saveDir? }`；返回 `201 { task }` |
| GET | `/api/tasks/:id` | 单个任务详情 |
| POST | `/api/tasks/:id/pause` | 暂停 |
| POST | `/api/tasks/:id/resume` | 继续 |
| POST | `/api/tasks/:id/cancel` | 取消 |
| POST | `/api/tasks/:id/retry` | 重试 |
| DELETE | `/api/tasks/:id/file` | 仅删除下载文件（保留任务记录） |
| DELETE | `/api/tasks/:id?deleteFile=true` | 删除任务；`deleteFile=true` 同时删文件 |

### 历史

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/history?search=&platform=&status=&sort=desc` | 历史记录（已完成/失败/已取消），支持搜索/过滤/排序 |
| DELETE | `/api/history/:id` | 删除历史记录（仅记录，不删文件） |

### 仪表板

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/dashboard` | 汇总统计：`{ stats }`（今日任务/完成/下载中/失败/成功率/近 7 日/按平台分布/最近任务） |

### 设置

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/settings` | 读取设置 |
| PUT | `/api/settings` | 更新设置，允许字段：`defaultQuality, defaultFormat, maxConcurrent, defaultSaveDir, maxSpeedBytesPerSec, requestTimeoutSeconds, autoRetryCount, theme` |

### 任务状态枚举

`waiting`（等待中）· `parsing`（解析中）· `downloading`（下载中）· `paused`（已暂停）· `completed`（已完成）· `failed`（失败）· `cancelled`（已取消）

### 常见错误码

`INVALID_URL`（URL 无效/为空）、`UNSUPPORTED_PLATFORM`（平台不支持）、`PARSE_FAILED`（解析失败）、`VIDEO_NOT_FOUND`/`VIDEO_FORBIDDEN`/`VIDEO_UNAVAILABLE`（视频不可用）、`NETWORK_ERROR`、`TIMEOUT`、`DISK_FULL`、`WRITE_FAILED`、`DUPLICATE_TASK`、`TASK_NOT_FOUND`、`ENGINE_UNAVAILABLE`、`SAFE_DELETE_BLOCKED`（运行环境拦截批量删除，见 FAQ）。

> 调试技巧：在 URL 后追加 `__err=network`（或含 `notfound` / `priv` 关键字）可触发对应故障，用于演示错误处理与前端提示。

---

## 测试

```bash
npm run typecheck    # 前后端 TypeScript 类型检查
npm run test:api     # 后端 API 自动化测试（node + tsx）
```

浏览器端使用 Playwright 覆盖仪表板/任务/历史/设置等核心路径。

---

## FAQ

**Q: 为什么下载下来是占位文件而不是真实视频？**
A: 当前引擎为 `simulate`（未检测到 `yt-dlp`+`ffmpeg`）。安装两者并使其可在 PATH 找到（或用 `YTDLP_PATH`/`FFMPEG_PATH` 指定），重启后引擎即切换为 `ytdlp`。前端顶部也会出现黄色警告条提示降级状态。

**Q: 选了 1080p 但只下到 360p？**
A: 旧版单流选择器只匹配 progressive 流（YouTube 高清为视频/音频分离）。已修复为 DASH 合并选择器（`bv*+ba` + `--merge-output-format` + ffmpeg），真正实现所选分辨率。

**Q: 并发数设为 0 变成 3？**
A: 早期 `Number(v) || 3` 把 `0` 当 falsy 误判为「未提供」。已改为显式 `Number.isFinite` 判断并夹到 [1,10]。

**Q: Docker 报 `project name must not be empty`？**
A: 项目目录含中文名，compose 消毒后项目名为空。已在 `docker-compose.yml` 顶部加 `name: video-download-manager` 显式指定。

**Q: 直接双击打开前端页面白屏？**
A: 前端是 SPA，需经 HTTP 访问（开发 `npm run dev` 或生产 `npm start`），不能用 `file://` 打开。

**Q: X/Twitter 下载到一半报 `SAFE_DELETE_BLOCKED` 或 `解析失败：yt-dlp exited 1`？**
A: 某些安全沙箱会限制单个进程/轮次内累计删除 ≥50 个文件，而 X 的 HLS 流会产生大量 `.part-Frag*` 临时分片。启动时加上 `YTDLP_KEEP_FRAGMENTS=1` 即可保留分片、避免触发拦截。普通桌面/终端/Docker 环境无需开启，保持下载目录更干净。
