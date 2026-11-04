# MITM 桥接端到端验证报告（路径 A · res-downloader 抓包）

> 版本：`1.1.1` ｜ 验证日期：2026-11-04
> 目标链接：`https://weixin.qq.com/sph/AgfvIvv5uH`（微信视频号分享页）
> 验证方式：路径 A —— 项目内置桥接模块对接第三方 `res-downloader`（`:8899`）做真实抓包→解析→下载
> 验收口径：请求捕获、解析与文件实际下载均成功，并输出验证结果及异常

---

## 一、验证目标与范围

1. 确认项目桥接模块能**真实连通**本机运行的 `res-downloader`（第三方 MITM 嗅探后端）。
2. 确认 `res-downloader` 通过桥接**受理下载委派**（解析契约）。
3. 确认委派后的真实视频文件**实际下载并落盘**，且经产物校验为**可播放 MP4**。
4. 如实说明：对目标 `sph` 链接的「真实抓包捕获」一步在本环境能否自动化完成，及其原因。
5. 输出完整证据链、异常与遗留项。

---

## 二、验证环境

| 组件 | 状态 / 版本 |
|---|---|
| 项目服务 | `http://localhost:8787`（最新代码，`version=1.1.1`，bridge 默认启用） |
| 第三方后端 | `res-downloader` 二进制 `res-downloader/bin/res-downloader`（`version: 3.1.3`，arm64，监听 `127.0.0.1:8899`） |
| Node 运行时 | v22.22.2（经 `scripts/env.sh` 动态解析，规避 better-sqlite3 与 Node 26 ABI 不兼容） |
| 微信客户端 | `/Applications/WeChat.app` 已安装，但本沙箱无 GUI 会话、无法扫码登录、无法程序化「打开并播放」视频 |
| 校验工具 | `file` / `ffprobe`（ffmpeg 套件） |

---

## 三、验证方法与步骤

1. 在同一 Bash 调用内启动 `res-downloader` 后台进程，轮询 `:8899 /api/app-info` 直到 `HTTP 200`。
2. 通过项目 `/api/mitm/bridge/status` 确认桥接探测到第三方后端（`online=true`）。
3. 通过 `/api/mitm/bridge/config` 读取第三方配置（验证只读探测契约）。
4. 通过 `/api/mitm/bridge/download` 推送一条**合法可达的微信直链**（项目 `fixture` 源，带 `platform=wechat` → 适配器自动带 `Referer: https://channels.weixin.qq.com/`），验证「捕获得到直链后 → 桥接下载 → 落盘校验」整段下游流程。
5. 轮询派生本地任务至终态，校验落地文件（字节数 / `ftyp` 头 / `file` / `ffprobe`）。
6. 额外推送一条**伪造微信 CDN 直链**（`encfilekey=FAKE`），验证「非真实资源不假成功」的诚实校验。
7. 8 秒后复探 `:8899`，确认第三方进程持续常驻。

---

## 四、实测结果（真实、可复现）

| # | 验证项 | 结果 | 证据 |
|---|---|---|---|
| ① | `res-downloader` 启动并常驻 | ✅ | 日志 `version: 3.1.3` + `Service started, listening http://127.0.0.1:8899`；8s 后复探仍 `HTTP 200` |
| ② | 项目桥接连通真实 `res-downloader` | ✅ | `bridge.online=true`，`appName=res-downloader`，`version=3.1.3`，`latencyMs=1` |
| ③ | 桥接读取第三方配置 | ✅ | `GET /api/mitm/bridge/config` → `ok:true`（含 Proxy / 保存目录 / MimeMap / Rule） |
| ④ | 桥接委派下载（解析契约） | ✅ | `POST /api/mitm/bridge/download` → `bridge.accepted=true`，`bridge.error=ok`（`res-downloader /api/download` 已受理 MediaInfo） |
| ⑤ | 文件实际下载 + 校验 | ✅ | 派生本地任务 `completed`，落地 `downloads/mitm/e2e2-53f80d.mp4` |
| ⑥ | 产物有效性 | ✅ | `254794` 字节；`file` → `ISO Media, MP4 Base Media v1`；`ffprobe` → `h264`(video) + `aac`(audio)，可播放 |
| ⑦ | 诚实校验（非法直链不假成功） | ✅ | 伪造 `wxapp.tc.qq.com?encfilekey=FAKE` 任务 → `status=failed`，`bytes=0` |

**关键证据（落地文件）：**
```
downloads/mitm/e2e2-53f80d.mp4          254794 bytes  ISO Media, MP4 Base Media v1  (h264 + aac)
downloads/mitm/wechat-e2e-test-56654e.mp4  254794 bytes  ISO Media, MP4 Base Media v1  (h264 + aac)
```
上述文件均由 `bridge/download` 经桥接双轨（内置无头引擎）真实下载，并通过 `ftyp`/`isom` 校验。

**桥接状态原始响应（节选）：**
```json
{
  "bridge": { "online": true, "appName": "res-downloader", "version": "3.1.3", "latencyMs": 1 },
  "localTask": { "id": "53f80d18-...", "status": "running" }
}
```

**下载委派原始响应（节选）：**
```json
{
  "bridge": { "accepted": true, "error": "ok" },
  "localTask": { "id": "53f80d18-...", "status": "pending" }
}
```

---

## 五、唯一未在此环境完成的一步：对 `sph/AgfvIvv5uH` 的真实「抓包捕获」

- **原因**：`res-downloader` 的捕获是 **MITM 代理嗅探**——只有当**真实登录的微信客户端**把系统代理指向它（`127.0.0.1:8899`）、信任其 CA 证书、并**实际打开且播放**该视频号链接时，它才能在流量里看到 `wxapp.tc.qq.com/.../*.mp4?encfilekey=...&token=...` 真实直链。
- 本沙箱无 GUI 微信会话、无法扫码登录、无法用程序「打开并播放」该视频 → 这一步的物理前置不可得。**这不是代码 bug，是平台 / 环境约束**（与分享页链接根因诊断一致）。
- 因此本轮用一个**合法可达的微信直链**（`.../fixture/wechat/media.mp4?platform=wechat`，带正确 `Referer`）等价验证了「捕获得到直链后 → 桥接下载 → 落盘校验」这一整段下游流程——生产环境只是把该 URL 换成 `res-downloader` 捕获到的真实 `wxapp.tc.qq.com` 链接，下载器逻辑完全一致。

---

## 六、真实桌面全链路操作指南（你本机完成 `AgfvIvv5uH` 抓包）

1. 双击 `res-downloader/bin/res-downloader` 启动 → 首页点「启动代理」（系统代理设为 `127.0.0.1:8899`，并信任其 CA 证书）。
2. 在微信客户端打开 `weixin.qq.com/sph/AgfvIvv5uH` 并**播放视频** → `res-downloader` 资源列表出现该视频的真实 `.mp4` 直链（`wxapp.tc.qq.com/...?encfilekey=...&token=...`）。
3. 复制该直链 → 粘贴进本项目「资源嗅探」页下载（或 `POST /api/mitm/bridge/download`）→ 适配器自动带 `Referer: https://channels.weixin.qq.com/`，文件落盘并校验。
4. ⚠️ 微信直链 `token` / `encfilekey` **短期有效且常绑定会话 / IP**，捕获后请尽快下载。

---

## 七、异常与遗留项

- **遗留失败任务已清理**：上一轮修复前持久化的旧失败任务 `367a1e3c`（`sph/AmBuvnzI0h`，2733 字节假 `.mp4`）与伪造 CDN 任务 `8d9e5cfd` 已删除；当前任务列表中仅保留 3 个合法验证产物（`53f80d18` / `56654e6b` / `65998c6f`，均 `completed` + `valid=True`）。
- **`res-downloader` 自带下载引擎**：据 prior `VERIFICATION_REPORT.md`，其 GUI 进程内持续出网传输在纯无头环境可能被挂起。本设计双轨机制正是为此——**实际文件由内置无头引擎保证落盘**，`res-downloader` 仅作可选增强 / 捕获源。本轮实测印证该设计有效。
- **无代码级异常**：桥接连通、委派、下载、校验全链路无报错；仅在无头沙箱无法执行「微信客户端真实播放」这一物理前置。

---

## 八、结论

✅ **桥接链路真实跑通**：`res-downloader` 启动 → 项目桥接 `online` → 委派解析受理 → 内置引擎实际下载 → 落地 `254794` 字节可播放 MP4（`ffprobe` 双流校验通过）。
✅ **诚实校验有效**：伪造 / 非媒体链接不会被伪装成成功。
✅ **零回归**：三平台自检 `passed=true`，分享页 `sph` 链接现被 `400` 清晰拦截。
⚠️ **唯一限制**：目标 `sph` 链接的「真实抓包捕获」依赖真实登录微信客户端播放，属平台机制限制，需在你本机桌面按第六节操作完成。

以「各下载器可稳定访问和下载使用，且桥接链路端到端验证通过」为口径，**路径 A 验证达标（捕获前置除外，已明确说明）**。
