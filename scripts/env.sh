#!/bin/sh
# 在线视频下载管理器统一运行环境
# 被 package.json 脚本与 start.command 引用，确保：
# 1. 使用 WorkBuddy 托管 Node 22（better-sqlite3 兼容）
# 2. 补充常见 yt-dlp / ffmpeg 安装路径
#
# 注意：托管 Node 目录名带补丁号（如 22.22.2-2 / 22.22.2-6），
# 会被 WorkBuddy 升级清理，因此这里动态解析，绝不写死版本号。

_NODE_VERSIONS="/Users/zhaoshuixian/.workbuddy/binaries/node/versions"

# 解析策略：current 指针文件优先；其次选 22.x 里目录名最大者；找不到则留空走系统 PATH
_MANAGED_NODE_DIR=""
if [ -f "$_NODE_VERSIONS/current" ]; then
  _cur=$(cat "$_NODE_VERSIONS/current" 2>/dev/null | tr -d '[:space:]')
  [ -n "$_cur" ] && [ -x "$_NODE_VERSIONS/$_cur/bin/node" ] && _MANAGED_NODE_DIR="$_NODE_VERSIONS/$_cur/bin"
fi
if [ -z "$_MANAGED_NODE_DIR" ]; then
  for _d in "$_NODE_VERSIONS"/22.*; do
    [ -x "$_d/bin/node" ] && _MANAGED_NODE_DIR="$_d/bin"
  done
fi

if [ -n "$_MANAGED_NODE_DIR" ]; then
  export MANAGED_NODE="$_MANAGED_NODE_DIR"
  # 前置顺序：托管 Node > pip 安装的 yt-dlp > Homebrew 二进制 > 系统 PATH
  export PATH="$_MANAGED_NODE_DIR:$PATH"
fi

_MANAGED_PYTHON="/Users/zhaoshuixian/.workbuddy/binaries/python/versions/3.13.12/bin"
if [ -d "$_MANAGED_PYTHON" ]; then
  export MANAGED_PYTHON="$_MANAGED_PYTHON"
  export PATH="$_MANAGED_PYTHON:$PATH"
fi

# yt-dlp / ffmpeg 兜底路径（存在才加，不存在的目录前置无意义）
for _p in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin"; do
  [ -d "$_p" ] && case ":$PATH:" in *":$_p:"*) ;; *) PATH="$PATH:$_p" ;; esac
done
export PATH

# 避免沙箱代理拦截 localhost
export NO_PROXY="localhost,127.0.0.1"
