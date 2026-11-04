# 版本变更说明 (Changelog)

本项目遵循语义化版本。所有版本保持向后兼容：新增能力均为**旁路增量**，不改动既有路由/引擎/数据库。

---

## v1.1.1 — 分享页误判修复 + 桥接端到端验证（2026-11-04）

### 修复（缺陷）
- **MITM 分享页链接误判为直链**：`weixin.qq.com/sph/...` 等是视频号/抖音/小红书「分享落地页」URL（返回 `text/html`），原引擎当直链下载会把整页 HTML 存成 `.mp4` → 校验缺 `ftyp` → `VALIDATION_FAILED`。
  - `server/src/mitm/platforms.ts`：新增 `SHARE_PAGE_PATTERNS`，识别三平台分享页/落地页 URL（`weixin.qq.com/sph/`、`channels.weixin.qq.com/finder-preview`、`douyin.com/video/`、`v.douyin.com/`、`xiaohongshu.com/explore/`、`xhslink.com/` 等）；`probeUrl` 标记 `isSharePage`。
  - `server/src/mitm/router.ts`：`POST /api/mitm/tasks` 命中分享页直接返回 `400 SHARE_PAGE_NOT_SUPPORTED`，给出明确引导，不创建任务、不写假文件。
  - `server/src/mitm/downloader.ts`：下载前做响应 `Content-Type` 预检（`text/html` / `application/json` / `text/plain` 等立即以可读原因失败），并对首块字节强校验兜底（防 `octet-stream` 伪装）。
  - `server/src/types.ts`：注册 `SHARE_PAGE_NOT_SUPPORTED` 错误码。
  - `web/src/pages/Mitm.tsx` + `web/src/types.ts`：前端新增「⚠ 分享页链接·非直链」红标 + 创建拦截 + 引导文案。

### 验证
- **桥接端到端实测**（详见 `MITM_E2E_BRIDGE_VERIFICATION.md`）：启动真实 `res-downloader`（v3.1.3，`:8899`）→ 项目桥接 `online=true` → `bridge/download` 委派解析 → 内置引擎实际下载微信直链 → 落地 `254794` 字节真实 MP4（ffprobe：h264+aac，可播放）。伪造 CDN 直链任务诚实返回 `failed`，无假成功。
- 分享页 `sph` 链接现被 `400` 清晰拦截；三平台自检 `passed=true` 零回归。

### 版本号
`package.json` / `server/package.json` / `web/package.json` / `config.version` / `docker-compose.yml` 镜像 tag：`1.1.0` → `1.1.1`。

---

## v1.1.0 — 第三方 MITM 嗅探下载接入层（2026-11-04）

### 新增功能

**新增「资源嗅探」模块，接入第三方 MITM 下载器，覆盖微信视频号 / 抖音 / 小红书三个独立下载器通道。**

| 类别 | 内容 |
|------|------|
| 后端内核 | `server/src/mitm/`：`platforms.ts`（三平台适配器：host 规则、Referer/UA、命名、后缀）、`downloader.ts`（无头直链下载引擎：HEAD→GET 流式、Range、重定向、超时、取消、2GB 上限、magic+size+ffprobe 产物校验）、`store.ts`（任务存储/调度、并发限制、取消/重试/重启恢复、JSON 持久化）、`bridge.ts`（可选桥接真实 res-downloader :8899，只读探测 + 下载委派，不可达自动降级）、`fixture.ts`（内置确定性 CDN 源：真实 mp4 + Range 206 + 逐平台防盗链）、`types.ts`、`router.ts`、`assets/demo.mp4` |
| 路由 | 新增 `/api/mitm/*`（status / downloaders / probe / tasks / stream / selftest / fixture / bridge），挂载于 `routes/index.ts` 单行；**零改动**现有 `/parse /tasks /history /dashboard /settings /system /files` |
| 前端 | 新增 `web/src/pages/Mitm.tsx`（`/mitm` 页面：三下载器卡片 + 状态条 + URL 识别 + 下载 + 进度 + 播放 + 自检）；`api.ts` 增 `mitm.*` 方法；`types.ts` 增 MITM 类型；`App.tsx` 增路由；`Layout.tsx` 增「资源嗅探」导航与标题；`icons.tsx` 增 `radar` 图标 |
| 配置 | `config.ts` 增 `mitm` 配置块；`.env.example`、`docker-compose.yml`（含 `extra_hosts` 桥接）、`Dockerfile` 增 `MITM_*` 环境变量 |
| 部署 | 镜像内置 `ffmpeg/ffprobe` + `demo.mp4`，内置引擎与确定性源开箱即用；桥接宿主桌面第三方为可选增强 |
| 文档 | `README.md`（特性/环境变量/目录结构/API/新章节）、`CHANGELOG.md`（本文件）、`MITM_DELIVERY.md`（实现+部署+验证结果+已知限制） |

### 架构决策（关键）

第三方 `res-downloader` 是 **Wails 桌面 GUI 应用**，官方代理嗅探依赖「GUI 窗口 + 系统 CA 根证书 + 客户端真实流量」，无法在服务端/无头/Docker 重现，且装全局 CA 有安全风险。因此采用**双轨**：

1. **无头直链下载引擎（主交付）**：Node 原生 http/https 复刻 `HEAD→GET→写盘`，不依赖 Wails GUI 主循环，可常驻服务端 → **能真正完成下载**。
2. **可选桥接（增强）**：桌面端运行 `res-downloader` 时探测/委派；不可达自动降级 offline，不影响主流程。桥接绝不触碰系统代理开关与 CA 安装。
3. **本地确定性 CDN 源**：真实 4 秒 H.264+AAC mp4 + Range + 防盗链，用于**离线可重复**的端到端验收。

### 与现有功能的隔离性

- 独立命名空间 `/api/mitm`、独立产物目录 `downloads/mitm`、独立 `data/mitm-tasks.json` 存储；**不写入现有 SQLite `tasks` 表**，不污染 Dashboard/历史统计。
- 现有 engine（ytdlp/simulate）、taskManager、db、前端页面逻辑零改动。
- 回归验证：现有 5 个页面 + 6 个 API 全部 HTTP 200。

### 版本号

`package.json` / `server/package.json` / `web/package.json` / `config.version` / `docker-compose.yml` 镜像 tag：`1.0.0` → `1.1.0`。

---

## v1.0.0 — 初始版本（2026-08 ~ 2026-11）

- 从零构建在线视频下载管理器（React+Vite+Tailwind / Express+better-sqlite3 / yt-dlp 双引擎 + Docker）。
- 历次缺陷修复：视频无法播放（simulate 假字节→ffmpeg 可播放占位 + Range 流接口）、打开目录全链路、`yt-dlp exited 1`（沙箱 `SAFE_DELETE_BLOCKED` → `YTDLP_KEEP_FRAGMENTS`）、Node 26 与 better-sqlite3 不兼容（Node 22 环境脚本动态解析）、YouTube DASH 音视频流未合并（`resolveBin` 绝对路径 + 产物校验 + 兜底合并）。
- GitHub 首次部署 `d22f693`，缺陷修复提交 `35fd062`。
