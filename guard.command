#!/bin/zsh
# 视频下载管理器 —— L1 主保护：GUI 终端看护实例入口
# 由 `open -a Terminal guard.command` 启动，新建独立窗口，不劫持任何已有终端窗口内容。
# 该窗口的进程树挂在 Terminal.app 下，与 L2（launchd）完全独立。
# 关闭本窗口只影响 L1；L2 仍可提供兜底。

cd "$(dirname "$0")" || exit 1
. ./scripts/env.sh

echo "视频下载管理器 · L1 GUI 终端看护"
echo "  - 只做探测 + 幂等补位，不会干扰当前已运行的服务"
echo "  - 日志：/tmp/vdm-guard.log   服务日志：/tmp/vdm-server.log"
echo "  - 关闭本窗口将失去 L1 保护；L2 (launchd) 仍可兜底"
echo ""

exec /bin/sh "$(pwd)/scripts/guard.sh"
