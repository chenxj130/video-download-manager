#!/bin/zsh
# 在线视频下载管理器 - 一键启动脚本
# 双击此文件即可启动后端服务并打开浏览器

cd "$(dirname "$0")"

# 加载统一运行环境（Node 22 + yt-dlp/ffmpeg 常见路径 + NO_PROXY）
. ./scripts/env.sh

echo "使用 Node: $(node --version)"
echo "yt-dlp: $(yt-dlp --version 2>/dev/null || echo '未找到')"
echo "ffmpeg: $(ffmpeg -version 2>/dev/null | head -1 || echo '未找到')"

# 检查依赖是否已安装
if [ ! -d "node_modules" ] || [ ! -d "server/node_modules" ] || [ ! -d "web/node_modules" ]; then
  echo "首次启动，正在安装依赖..."
  npm install
fi

# 检查是否已构建前端
if [ ! -f "web/dist/index.html" ]; then
  echo "首次启动，正在构建前端..."
  npm run build
fi

# 启动后端服务（后台运行）
echo "正在启动视频下载管理器..."
nohup npm run start > /tmp/vdm-server.log 2>&1 &

# 等待服务可用
for i in {1..30}; do
  if curl -s --noproxy localhost http://localhost:8787/api/health > /dev/null 2>&1; then
    echo "服务已启动: http://localhost:8787"
    open "http://localhost:8787"
    exit 0
  fi
  sleep 1
done

echo "服务启动超时，请检查日志: /tmp/vdm-server.log"
open "/tmp/vdm-server.log"
exit 1
