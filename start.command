#!/bin/zsh
# 在线视频下载管理器 - 一键启动脚本（手动 / 双击入口）
# 若 launchd 常驻服务已在运行，本脚本只打开浏览器，不再重复拉起实例。

cd "$(dirname "$0")" || exit 1

# 加载统一运行环境（Node 22 + yt-dlp/ffmpeg 路径 + NO_PROXY）
. ./scripts/env.sh

BASE="http://127.0.0.1:8787"
LOG="/tmp/vdm-server-manual.log"

# 幂等：端口已有服务则直接打开浏览器，避免重复实例 EADDRINUSE 把已有进程搞崩
if curl -s --noproxy '*' --max-time 2 "$BASE/api/health" >/dev/null 2>&1; then
  echo "服务已在运行：$BASE"
  open "$BASE"
  exit 0
fi

echo "使用 Node: $(node --version)"
echo "yt-dlp: $(yt-dlp --version 2>/dev/null || echo '未找到')"
echo "ffmpeg: $(ffmpeg -version 2>/dev/null | head -1 || echo '未找到')"

if [ ! -d "node_modules" ] || [ ! -d "server/node_modules" ] || [ ! -d "web/node_modules" ]; then
  echo "首次启动，正在安装依赖..."
  npm install
fi

if [ ! -f "web/dist/index.html" ]; then
  echo "首次启动，正在构建前端..."
  npm run build
fi

# 统一走唯一启动权威 serve.sh（幂等 + flock 互斥 + 清除沙箱 shim 注入）；
# stdin 重定向 + &! 脱离终端（zsh 语法），不再每次重新 build 前端
echo "正在启动视频下载管理器..."
PORT=8787 nohup /bin/sh "$(pwd)/scripts/serve.sh" > "$LOG" 2>&1 < /dev/null &!

for i in {1..30}; do
  if curl -s --noproxy '*' --max-time 2 "$BASE/api/health" >/dev/null 2>&1; then
    echo "服务已启动: $BASE"
    open "$BASE"
    exit 0
  fi
  sleep 1
done

echo "服务启动超时，日志尾部："
tail -n 30 "$LOG"
open "$LOG"
exit 1
