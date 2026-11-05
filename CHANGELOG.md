# 版本变更说明 (Changelog)

本项目遵循语义化版本。所有版本保持向后兼容：新增能力均为**旁路增量**，不改动既有路由/引擎/数据库。

---

## v1.1.2 — 下载后无法播放根因修复：AV1 编码规避 + 媒体探测/自动修复（2026-11-04）

### 问题现象
- 部分下载完成的视频（典型为 YouTube 高分辨率档）在 QuickTime Player 弹出「此文件包含一些 QuickTime 无法播放的媒体」而**无法播放**；部分默认浏览器亦无法解码。
- 文件本身完整（约 44 MB、结构合法），`ffprobe` 显示容器 `mp4`、视频编码 `av1`、音频 `aac`、1920×1080。
- 下载目录遗留多对 `.fhls-*.mp4`(视频) + `.fhls-audio-*.mp4`(音频) 分片，均为未合并的 HLS 分段，单独打开亦不可播。
- 后端终端偶见 `EADDRINUSE`（8787 端口被重复实例占用，属服务可用性问题，与文件播放无直接因果）。

### 根因结论
1. **主因（编码/播放环境不兼容）**：`server/src/engine/ytdlp.ts` 的格式选择表达式 `bv*[height<=N][ext=mp4]+ba...` **未对视频编码做过滤**，`bv*` 会命中平台提供的 AV1(`av01`) 封装 MP4 流。AV1 在 MP4 容器内结构合法，但 QuickTime 与多数默认浏览器解码器不支持 → 表现为「文件不兼容」。模拟引擎（`simulate.ts`）使用 `libx264` 输出 H.264，故不受此影响，根因锁定在真实 yt-dlp 引擎路径。
2. **次因（分片未合并）**：HLS(`.fhls-*`) 视频/音频分片在某些来源下未被 ffmpeg 合并，遗留为不可播的独立文件。
3. **异常处理的缺口**：原实现仅做「退出码 0 + 文件存在性」校验，**不探测编码/可播放性**，因此即便下到不可播文件也记为 `completed`，前端无任何告警与补救入口。

### 修复内容
- **`server/src/engine/ytdlp.ts`**：将格式选择抽取为 `buildFormatSelector(height, ext)`。mp4/mov **优先 H.264(`avc1`)**、逐级排除 `av01`/`vp9`，最后才兜底（兜底命中 av01 时由下方自动修复兜底）；webm 保留 VP9/AV1（浏览器原生支持）。从下载源头规避 AV1-in-MP4。
- **`server/src/utils/media.ts`（新增）**：
  - `probeMedia()`：用 `ffprobe` 读取容器/视频编码/音频编码/分辨率/时长，经 `isPlayerCompatible()` 判定能否被 QuickTime+主流浏览器直接解码。
  - `repairToH264()`：用 `ffmpeg` 将不兼容文件转码为 **H.264+AAC 的 MP4**（最通用可播放格式），保留原文件为 `<name>.original.<ext>`。
- **`server/src/services/taskManager.ts`**：
  - `onComplete()` 下载后**自动探测媒体信息**并写入任务；当 `playerCompatible===false` 且 `config.autoRepairIncompatible` 为真时**自动转码修复**，从源头消除复现。
  - 新增 `repair(id)` 手动修复方法（已完成且编码不兼容的任务可一键转码）。
- **`server/src/routes/tasks.ts`**：新增 `POST /api/tasks/:id/repair`。
- **数据层 `server/src/types.ts` + `server/src/db.ts` + `web/src/types.ts`**：`DownloadTask` 增加 `media?: TaskMedia`（编码/容器/可播放性/是否已修复）；`tasks` 表 `ALTER` 增加 `media TEXT` 列（JSON，旧库安全补齐），并完成行映射。
- **前端 `web/src/api.ts`**：新增 `api.repair(id)`；`web/src/components/icons.tsx` 新增 `wrench` 图标；`web/src/pages/Tasks.tsx` 与 `History.tsx`：已完成且不兼容时显示 **⚠ 编码不兼容** 告警徽标 + **「修复」** 按钮（转码为 H.264 可播放格式），并展示视频编码标签。

### 优化项（下载校验与播放异常处理）
- 下载校验从「退出码 + 文件存在」升级为 **「编码级可播放性探测」**，不可播文件不再被记为静默成功。
- **双重防护**：格式选择规避（治本）+ 下载后自动修复（兜底），即使个别来源仅提供 AV1 也能产出可播放文件。
- 前端提供明确的**不兼容告警 + 一键修复**入口，用户无需懂编码即可补救历史已下载文件。
- 新增配置开关 `AUTO_REPAIR_INCOMPATIBLE`（默认开启，设 `0` 仅标记不转码）与 `FFPROBE_PATH`（探测用 ffprobe 路径）。

### 验证结果
- **类型检查**：`npm run typecheck`（server + web）全部通过。
- **真实文件探测**：对 `downloads/` 中真实故障文件 `ffprobe` 经 `probeMedia()` 返回
  `{container:"mp4", videoCodec:"av1", audioCodec:"aac", width:1920, height:1080, durationSeconds:639.3, playerCompatible:false}`，告警文案正确。
- **修复链路**：截取该 AV1 文件 5s 片段（仍为 `av1/mp4, playerCompatible:false`）→ `repairToH264()` 转码 → 复探为 `{videoCodec:"h264", audioCodec:"aac", playerCompatible:true}`，验证 AV1→H.264 修复闭环可用。
- **服务启动**：`npm run start` 正常启动（引擎 `ytdlp`），历史任务正常加载，`POST /api/tasks/:id/repair` 路由注册正确、未知任务返回 `404 TASK_NOT_FOUND`。
- **已知权衡**：软件解码 AV1 转码较慢（44MB 1080p 约需数十分钟），但格式选择已优先规避 AV1，自动修复极少触发；如介意可在 `.env` 设 `AUTO_REPAIR_INCOMPATIBLE=0` 仅标记不转码。

### 版本号
`package.json` / `server/package.json` / `web/package.json` / `config.version` / `docker-compose.yml` 镜像 tag：`1.1.1` → `1.1.2`。

---

## v1.1.3 — 系统诊断收口 + 安全加固（CORS/鉴权、命令注入、平台仿冒）（2026-11-05）

> 范围：全量代码审查（74 个源码文件 / 7758 行）+ 视频号业务流端到端测试矩阵（33 用例）。
> 在 v1.1.2 基础上补齐诊断期发现并收口：MITM 假成功闭环、历史数据回填、以及下列安全加固。
> 版本号已 bump 至 `1.1.3`，已提交（未 push）。

### 实测复现并修复

| 编号 | 严重度 | 问题 / 根因 | 修复 |
|---|---|---|---|
| B1/A03/A04 | P1 | `validateOutput` 的 `headerHex.startsWith('000000')` 宽松分支 + ffprobe 失败仅标 `unavailable` 不推翻 `valid` → 无 ftyp 垃圾文件被记为「下载成功」（实测 1024B 假 MP4 `valid:true`） | 改为多容器签名严格判定，ffprobe 解析失败/无流一律判 `valid:false` |
| B3/A01/A02 | P1 | MITM 链路只查 `codec_type` 不读 `codec_name`，AV1-in-MP4 被判通过且无告警/补救；v1.1.2 主链路修复未覆盖此处 | 复用 `utils/media.probeMedia` 统一判定；`MitmValidation` 增编码/可播放性字段；下载完成即探测并写回任务；**默认自动转码为 H.264+AAC**（`MITM_AUTO_REPAIR=0` 可关闭仅标记），并提供手动 `repair` 入口。原「仅标记 + 手动修复」经复验仍属 API 契约假成功，已补齐 |
| A01/A04 | P1 | `store.run` 未传 `ffprobeBin`；`revalidate` 结果不写回任务 → 前端轮询读到旧校验 | 贯通 ffprobe 参数；`revalidate` 写回 `t.validation` 并 persist |
| — | P1 | `db.ts` 的 `updateStmt` 漏 `SET media=@media` → v1.1.2 探测结果重启即丢失（better-sqlite3 静默忽略多余绑定） | 补齐 `media=@media`，单测验证 insert/update 双路径持久化 |
| A06 | **P0** | `/api/mitm/*` 无鉴权且接受任意 http(s) URL，`requestOnce`/重定向无 host 校验 → SSRF（内网/云元数据）；用户 headers 可注入凭证 | 新增 `mitm/safety.ts`：私有网段/元数据拒绝、重定向每跳校验、请求头键白名单；环回默认放行（fixture/桥接依赖），可设 `MITM_BLOCK_LOOPBACK=1` 收紧 |
| [01] | **P0** | `getAllowedBases()` 把用户可控 `saveDir` 纳入白名单 → 越权读任意目录；`createTask` 无校验即 `ensureDir` 任意目录 | 新增 `utils/pathSafety.ts`（含 realpath 防符号链接绕过），白名单仅来自服务端配置 + `ALLOWED_EXTRA_DIRS`；`createTask` 前置 `assertSafeSaveDir` |
| A07/A12/A13 | P1 | `remove(deleteFile)` 无路径白名单；协作式 cancel 后 retry 可致同一 id 双 run；删除后 `renameSync` 复活产物 | `running`/`removed` 集合 + 路径白名单 + `.part` 清理 + run().finally 清理复活文件 |
| [04] | P1 | `onComplete` async 化后 `startQueue` 在 ffprobe/转码之后 → 阻塞后续任务入队 | 槽位释放与 `startQueue` 提前，探测/修复异步后置并二次持久化 |
| A09 | P2 | `bridge/download` 绕过分享页拦截 | 与 `/tasks` 一致加 `isSharePage` 校验 |
| C1/C2 | P1 | `web/dist` 陈旧 + `vite base:'./'` 深路由刷新白屏 | `npm run start` 先构建前端；`base:'/'`；已重建 dist |
| C5 | P2 | History 单值 `repairingId` 并发覆盖 | 改为 `Set<string>` |
| N01 | P2 | ffprobe 由「可选」变「强制前置」，缺 ffprobe 环境所有合法产物都会 `VALIDATION_FAILED` | 区分「工具缺失」与「产物非法」：工具缺失时保留 `valid:true` 但 `codecChecked:false` + 明确 notes |
| N04 | P2 | `downloader.ts` 注释曾自称 `v1.1.3`，与版本号不一致 | 已随本轮统一 bump 至 `1.1.3`，config/package.json 三处版本与注释一致 |
| C15 | P3 | `.env.example` 缺 7 项配置开关 | 补齐 `FFPROBE_PATH` / `AUTO_REPAIR_INCOMPATIBLE` / `SIMULATE_USE_FFMPEG` / `REQUEST_TIMEOUT` / `ALLOWED_EXTRA_DIRS` / `MITM_AUTO_REPAIR` / `MITM_BLOCK_LOOPBACK` |
| — | P2 | MITM「修复」按钮在产物文件已被删除时仍显示，点击必然 404 | 显示条件增加 `!!task.filePath` 校验 |
| C9 | P2 | MITM 播放弹窗无 `onError` | 增加播放失败提示 + 编码/可播放性展示 + 不兼容告警 + 「修复」按钮 |
| [09] | **P1** | `engine/ytdlp.ts` 的 `fallbackMerge` 用 `execSync` 拼接 shell 字符串（含 `target`/`file` 文件名）→ 攻击者可借视频标题/分片名中的 `"` 逃逸执行任意命令 | 彻底移除 `execSync`：`fallbackMerge` 改用 `spawnSync(args[], {shell:false})`；`resolveBin` 改为纯 `fs` PATH 扫描（无 shell）；新增命令注入负向单测 |
| [10]/XM-01 | **P1** | `index.ts` `cors()` 默认 `origin:'*'` 且 `/api`（含 `/api/mitm/*`）全无鉴权 → 一旦暴露到网络即任意调用 | CORS 收紧为仅同源/localhost（可配 `CORS_ORIGINS` 显式白名单）；默认监听 `127.0.0.1`（可配 `HOST`）；新增可选 `API_TOKEN`：配置后 `/api` 全路由强制 `Authorization: Bearer` 或 `x-api-token`，仅 `/api/health` 免鉴 |
| [11] | P1 | `platforms.ts`/`ytdlp.ts` 用 `host.includes(h)` 匹配平台 → `notyoutube.com` 被误判为 youtube 并通过 `validateUrl` 的「受支持平台」校验（仿冒域名绕过） | 改为 `host === h \|\| host.endsWith('.' + h)` 精确/子域匹配，杜绝子串仿冒 |

### 前端新增
- `web/src/api.ts` 增 `mitm.repair(id)`；`Mitm.tsx` 增编码信息展示、不兼容告警与一键修复；`web/src/types.ts` 的 `MitmValidation` 与后端对齐。
- 后端新增 `POST /api/mitm/tasks/:id/repair`（原文件保留为 `.original.<ext>`）。

### 验证
- `npm run typecheck` / `npm --prefix web run build`：退出码 0。
- 单元/工具层 **17/17 PASS**：media insert/update 持久化、路径白名单（含符号链接）、SSRF 拦截与环回放行、请求头过滤、ffprobe 缺失回退、AV1 探测、命令注入负向校验（无 shell 拼接）。
- HTTP 端到端 **33/33 PASS**：正常下载/桥接委派/Range 206/416、异常（分享页、伪造 CDN、text/html、伪装 mp4、非法 URL、未知任务）、边界（0 字节、无 ftyp 假 MP4、AV1 不可播放、4 并发）、安全（SSRF ×3、headers 注入、桥接分享页、CORS 仅同源/localhost 拒绝跨域、API_TOKEN 缺失 401）、修复链路（AV1→H.264 `repaired:true`）。
- 历史数据回填：重启服务触发 `backfillValidations()`，14 条 AV1 历史任务全部转 H.264（`completed+av1+未修复=0`）。
- 视频号「真实内容」端到端仍受环境前置限制：需登录态微信客户端 + 系统代理 + 受信任 CA + 实际播放才能抓到 `wxapp.tc.qq.com` 直链；本轮素材为内置确定性源，未冒充真实内容。

### 新增/补齐配置
`ALLOWED_EXTRA_DIRS`、`MITM_BLOCK_LOOPBACK=1`、`MITM_AUTO_REPAIR=0`、`FFPROBE_PATH`、`AUTO_REPAIR_INCOMPATIBLE`、`SIMULATE_USE_FFMPEG`、`REQUEST_TIMEOUT`、`MITM_FFPROBE_PATH`（上述已在 v1.1.2 诊断期补齐）；**本轮新增**：`HOST`（默认 `127.0.0.1`，公网部署改 `0.0.0.0` 并务必配合下方两项）、`API_TOKEN`（留空=本地信任免鉴权；设置后 `/api` 全路由强制令牌）、`CORS_ORIGINS`（逗号分隔显式跨域白名单，留空=仅同源/localhost）。`.env.example` 已补齐全部。

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
