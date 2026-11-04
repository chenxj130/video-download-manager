# ============================================================
# 在线视频下载管理器 — 多阶段构建
#   stage 1 (web-build)    : 编译前端静态产物
#   stage 2 (server-deps)  : 安装后端依赖（含 better-sqlite3 原生编译）
#   stage 3 (runtime)      : 精简运行时镜像 + yt-dlp/ffmpeg 真实下载能力
# ============================================================

# ---------- stage 1: 前端构建 ----------
FROM node:22-bookworm-slim AS web-build
WORKDIR /app/web

# 先只拷贝清单以复用依赖层缓存
COPY web/package*.json ./
RUN npm ci

COPY web/ ./
RUN npm run build


# ---------- stage 2: 后端依赖 ----------
FROM node:22-bookworm-slim AS server-deps
WORKDIR /app/server

# better-sqlite3 是原生模块，需要编译工具链
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY server/package*.json ./
# 生产依赖 + tsx（运行 TS 源码所需，位于 devDependencies）
RUN npm ci


# ---------- stage 3: 运行时 ----------
FROM node:22-bookworm-slim AS runtime

# ffmpeg：音视频合并（高清源为视频/音频分离流，必须合并）
# yt-dlp：真实下载引擎；缺失时应用会自动降级为模拟模式
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg python3 python3-pip ca-certificates \
    && pip3 install --no-cache-dir --break-system-packages -U yt-dlp \
    && apt-get purge -y python3-pip \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 后端源码与依赖
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY server/package*.json ./server/
COPY server/tsconfig.json ./server/
COPY server/src ./server/src

# 前端构建产物（由后端静态托管，单端口对外）
COPY --from=web-build /app/web/dist ./web/dist

ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/app/data \
    DOWNLOAD_DIR=/app/downloads \
    WEB_DIST=/app/web/dist \
    DOWNLOAD_ENGINE=auto \
    MAX_CONCURRENT=3 \
    LOG_LEVEL=info \
    MITM_ENABLED=1 \
    MITM_FIXTURE=1 \
    MITM_BRIDGE=1 \
    MITM_MAX_CONCURRENT=3 \
    MITM_DOWNLOAD_DIR=/app/downloads/mitm \
    MITM_BASE_URL=http://127.0.0.1:8787

# 数据与下载目录必须挂载为卷，否则容器重建会丢失任务与文件
RUN mkdir -p /app/data /app/downloads
VOLUME ["/app/data", "/app/downloads"]

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/server
CMD ["npx", "tsx", "src/index.ts"]
