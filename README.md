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

- Node.js **18–24**（推荐 22.22.2）
  - ⚠️ **不要使用 Node 26+**：`better-sqlite3` 原生模块目前不兼容 Node 26 的 V8 API，启动会报 `ERR_DLOPEN_FAILED` / `Could not locate the bindings file`。
  - 若系统默认是 Homebrew 安装的 Node 26，项目已自动通过 `scripts/env.sh` 切换到 WorkBuddy 托管的 Node 22.22.2，并补充 yt-dlp/ffmpeg 常见路径，无需手动切换。
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
| `MITM_ENABLED` | `1` | v1.1.0 是否启用 MITM 接入层（0 关闭） |
| `MITM_FIXTURE` | `1` | 内置确定性 CDN 源（验收/离线演示），默认开启 |
| `MITM_BRIDGE` | `1` | 是否桥接真实第三方 res-downloader（不可达自动降级） |
| `MITM_BRIDGE_URL` | `http://127.0.0.1:8899` | 第三方 res-downloader 地址 |
| `MITM_DOWNLOAD_DIR` | `./downloads/mitm` | MITM 产物独立目录 |
| `MITM_MAX_CONCURRENT` | `3` | MITM 任务并发数 |
| `MITM_TIMEOUT_MS` | `120000` | MITM 单次下载超时（毫秒） |
| `MITM_BASE_URL` | `http://127.0.0.1:8787` | 拼接演示直链用 |
| `MITM_FFPROBE_PATH` | `ffprobe` | 产物双流校验工具 |

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
│   │   ├── mitm/             # v1.1.0 第三方 MITM 嗅探下载接入层
│   │   │   ├── platforms.ts  #   微信/抖音/小红书 三平台适配器
│   │   │   ├── downloader.ts #   无头直链下载引擎（HEAD→GET→流式→校验）
│   │   │   ├── fixture.ts    #   内置确定性 CDN 源（Range + 防盗链）
│   │   │   ├── bridge.ts     #   可选桥接 res-downloader :8899
│   │   │   ├── store.ts      #   任务存储/调度（JSON 持久化，独立于 SQLite）
│   │   │   ├── router.ts     #   /api/mitm 路由
│   │   │   └── assets/       #   demo.mp4 真实可播放演示资源
│   │   ├── routes/           # /api 各路由
│   │   ├── services/         # taskManager 任务编排
│   │   ├── utils/            # errors / file / format / logger
│   │   └── types.ts          # 共享类型
│   ├── test/api.test.ts      # API 自动化测试
│   └── package.json
└── web/                      # 前端
    ├── src/
    │   ├── pages/            # Dashboard / Tasks / History / Home / Settings / Mitm
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

### MITM 嗅探下载（v1.1.0）

基地址 `/api/mitm`，与现有任务系统完全隔离。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/mitm/status` | 模块状态：无头引擎、确定性源、第三方桥接 online/offline、三平台清单 |
| GET | `/api/mitm/downloaders` | 三个下载器通道 + 真实 HTTP 可达性探测（含演示直链） |
| POST | `/api/mitm/probe` | `{ url }` → 识别平台、返回自动携带的 Referer/UA 头 |
| POST | `/api/mitm/tasks` | `{ url, platform?, title?, headers? }` 创建嗅探下载任务 |
| GET | `/api/mitm/tasks` / `/api/mitm/tasks/:id` | 任务列表 / 详情（含进度、产物校验） |
| GET | `/api/mitm/tasks/:id/stream` | 播放已完成产物（支持 Range 206） |
| POST | `/api/mitm/tasks/:id/cancel` / `retry` / `revalidate` | 取消 / 重试 / 重新校验产物 |
| DELETE | `/api/mitm/tasks/:id?deleteFile=true` | 删除任务（可选删文件） |
| POST | `/api/mitm/downloaders/:platform/selftest` | **一键端到端验收**：真实下载一次并校验 magic/size/ffprobe |
| GET | `/api/mitm/fixture/:platform/probe` | 单下载器轻量探测 |
| GET | `/api/mitm/fixture/:platform/media.mp4` | 确定性 CDN 源（需正确 Referer，支持 Range） |
| GET | `/api/mitm/bridge/status` / `config` | 第三方 res-downloader 桥接状态 / 配置 |
| POST | `/api/mitm/bridge/download` | `{ url }` 委派第三方，并同时落一条内置引擎任务保证完成 |

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

**Q: 启动时报 `ERR_DLOPEN_FAILED` / `was compiled against a different Node.js version` / `Could not locate the bindings file`？**
A: 系统默认 Node 与 `better-sqlite3` 原生模块不兼容。本项目已在 `package.json` 脚本中强制使用 WorkBuddy 托管的 Node 22.22.2；若仍报错，执行 `cd server && npm rebuild better-sqlite3` 重新编译即可。根本解决：避免使用 Node 26+ 运行本项目。

**Q: 直接双击打开前端页面白屏？**
A: 前端是 SPA，需经 HTTP 访问（开发 `npm run dev` 或生产 `npm start`），不能用 `file://` 打开。

**Q: X/Twitter 下载到一半报 `SAFE_DELETE_BLOCKED` 或 `解析失败：yt-dlp exited 1`？**
A: 某些安全沙箱会限制单个进程/轮次内累计删除 ≥50 个文件，而 X 的 HLS 流会产生大量 `.part-Frag*` 临时分片。启动时加上 `YTDLP_KEEP_FRAGMENTS=1` 即可保留分片、避免触发拦截。普通桌面/终端/Docker 环境无需开启，保持下载目录更干净。

---

## 第三方 MITM 嗅探下载（v1.1.0）

新增「资源嗅探」页面（`/mitm`），接入第三方 MITM 下载器能力，覆盖**微信视频号 / 抖音 / 小红书**三个独立下载器通道。
与原有 YouTube/Bilibili 等 yt-dlp 体系**完全隔离**：独立命名空间 `/api/mitm`、独立产物目录 `downloads/mitm`、独立 JSON 任务存储，不影响任何现有功能。

### 架构（为什么这样做）

第三方 `res-downloader` 是 **Wails 桌面 GUI 应用**，其官方「代理嗅探」依赖三样东西：GUI 窗口 + 系统 CA 根证书信任 + 微信/抖音客户端产生的真实网络流量。这三者无法在服务端/无头/Docker 环境里凭空产生，且装全局 CA 有安全风险。因此本接入层采用**双轨**：

1. **无头直链下载引擎（主交付）**：用 Node 原生 `http/https` 复刻该下载器的 `HEAD→GET→分片写盘` 机制，但不依赖 Wails GUI 主循环，可常驻服务端进程，因而**能真正完成下载**。三平台适配器自动带上正确的 `Referer`/`User-Agent`（对齐平台 CDN 防盗链规则）。
2. **可选桥接（增强）**：桌面端若运行着 `res-downloader`（默认 `127.0.0.1:8899`），`/api/mitm/bridge/*` 会探测其 `app-info`/`get-config` 并委派下载；**不可达时自动降级为 offline，不影响主流程**。桥接仅做只读探测 + 直链委派，绝不触碰系统代理开关与 CA 安装。
3. **内置确定性 CDN 源**：一个真实的 4 秒 H.264+AAC `demo.mp4`，支持 `Range 206` + 逐平台防盗链校验。用于**可重复、离线、不依赖外网**的端到端验收与演示 —— 下载引擎必须带对平台请求头才能取到完整文件。

> 合规：仅处理你自己有权访问的公开/自有资源直链，不实现任何 DRM 破解、登录/付费墙/访问控制绕过。

### 快速验证（三平台各真实下载一次）

```bash
npm run start                     # 单端口 8787
# 三个下载器通道的真实 HTTP 可达性
curl http://localhost:8787/api/mitm/downloaders
# 每个通道独立自检：真实下载 + magic/size/ffprobe 校验，返回 passed:true
for p in wechat douyin xiaohongshu; do
  curl -X POST http://localhost:8787/api/mitm/downloaders/$p/selftest
done
```

浏览器打开 `http://localhost:8787/mitm`：三张下载器卡片可点「演示直链」（一键填入）或「自检」；也可粘贴真实资源直链后「开始下载」，任务列表实时显示进度、可播放/取消/重试/删除。

### 部署配置

见 `.env.example` 的 `MITM_*` 段、`docker-compose.yml` 与 `Dockerfile` 的 MITM 环境变量。Docker 场景：
- 内置引擎与确定性源**开箱即用**（镜像已含 `ffmpeg/ffprobe` 与 `demo.mp4`）。
- 若要桥接宿主桌面的第三方 `res-downloader`，compose 已加 `extra_hosts: host.docker.internal:host-gateway` 及 `MITM_BRIDGE_URL`。

### 已知限制

- 真实「GUI 代理嗅探自动抓流」仍需桌面端运行 `res-downloader` 并装 CA、开系统代理；服务端提供的是其**无头等价直链下载内核**与**可选桥接**，不是 GUI 自动化。
- 平台直链普遍带时效签名（`encfilekey`/`token`/`X-snsvideoflag` 等），过期或被防盗链拦截会返回明确错误（403/404），需重新嗅探获取新直链。
- 内置确定性源用于验收/演示；生产真实下载请把 URL 换成你有权访问的资源直链（请求头可由 `/api/mitm/probe` 自动推断，或手动传 `headers`，如带 Cookie）。

详细实现、验证结果与限制见 `MITM_DELIVERY.md` 与 `CHANGELOG.md`。
