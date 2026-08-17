#!/usr/bin/env bash
# =============================================================================
# deploy.sh — 将「在线视频下载管理器」项目部署到 GitHub（可重复执行）
# 用法:
#   ./deploy.sh                         # 使用下方默认值
#   REPO_NAME=foo VISIBILITY=private ./deploy.sh   # 环境变量覆盖
# 前置: gh 已登录目标账号(github.com/chenxj130) 且具备 repo 权限
# =============================================================================
set -euo pipefail

# ===== 可配置参数 =====
REPO_NAME="${REPO_NAME:-video-download-manager}"
VISIBILITY="${VISIBILITY:-public}"          # public | private
BRANCH="${BRANCH:-main}"
REMOTE_URL="${REMOTE_URL:-https://github.com/chenxj130/${REPO_NAME}.git}"
PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"

cd "$PROJECT_DIR"
echo "==> 项目目录: $PROJECT_DIR"

# ===== 0. 前置检查 =====
if ! command -v git >/dev/null 2>&1; then echo "✗ 未找到 git"; exit 1; fi
if [ "$VISIBILITY" = "private" ]; then VIS_FLAG="--private"; else VIS_FLAG="--public"; fi
# 若需要新建仓库，确认 gh 已登录
if ! git ls-remote "$REMOTE_URL" >/dev/null 2>&1; then
  if ! command -v gh >/dev/null 2>&1 || ! gh auth status >/dev/null 2>&1; then
    echo "✗ 远程仓库不存在且 gh 未登录，无法新建。请先: gh auth login"
    exit 1
  fi
fi

# ===== 1. 初始化仓库（若尚未初始化）=====
if [ ! -d .git ]; then
  git init -b "$BRANCH"
  echo "==> git init (branch=$BRANCH)"
else
  git checkout -B "$BRANCH" >/dev/null 2>&1 || true
fi

# ===== 2. 防御性保护：确保密钥/记忆不会被提交 =====
grep -qxF '.workbuddy/' .gitignore 2>/dev/null || echo '.workbuddy/' >> .gitignore
grep -qxF '.env'        .gitignore 2>/dev/null || echo '.env'        >> .gitignore
grep -qxF '.env.local'  .gitignore 2>/dev/null || echo '.env.local'  >> .gitignore

# ===== 3. 暂存（尊重 .gitignore）=====
git add -A

# ===== 4. 提交（仅在有变更时）=====
if git diff --cached --quiet; then
  echo "==> 无新增变更，跳过提交"
else
  git commit -m "feat: deploy video-download-manager ($(date '+%Y-%m-%d %H:%M'))"
  echo "==> 已提交"
fi

# ===== 5. 配置远程并推送 =====
PUSHED=0
if git remote get-url origin >/dev/null 2>&1; then
  echo "==> 远程 origin 已存在: $(git remote get-url origin)"
else
  if git ls-remote "$REMOTE_URL" >/dev/null 2>&1; then
    # 远端仓库已存在 -> 直接添加
    git remote add origin "$REMOTE_URL"
    echo "==> 已添加远程 origin -> $REMOTE_URL"
  else
    # 远端仓库不存在 -> 用 gh 新建并推送
    echo "==> 远端仓库不存在，使用 gh 创建 ($VISIBILITY)..."
    gh repo create "$REPO_NAME" "$VIS_FLAG" --source=. --remote=origin --push \
      --description "在线视频下载管理器 - 自主 Agent 开发的 Web 应用 (React+Vite+Tailwind / Express+SQLite / yt-dlp)"
    PUSHED=1
    echo "==> gh 已创建并推送"
  fi
fi

if [ "${PUSHED:-0}" = "1" ]; then
  echo "==> 推送已在 gh repo create 阶段完成"
else
  git push -u origin "$BRANCH"
  echo "==> 推送完成"
fi

echo ""
echo "✅ 部署成功: $REMOTE_URL"
echo "   前端/后端单端口: http://localhost:8787  (npm install && npm run build && npm run start)"
