#!/bin/sh
# 视频下载管理器 —— 唯一启动权威
# 被两层独立保护共用：L1/L2 看护 (guard.sh) / launchd LaunchAgent，
# 以及手动入口 start.command、GUI 入口 guard.command（经 guard.sh 间接汇聚）。
# 所有启动路径最终都汇聚到它，因此「不抢占现有实例」只需在此保证一次。
#
# 关键协议（针对「会话内进程被回收 / ERR_CONNECTION_REFUSED」根因）：
#  1. 前台 exec，把生命周期交给调用方（launchd 或看护派生的独立会话）。
#  2. 幂等：已有服务时进入「热备待命」，绝不抢占端口；同时避免 launchd
#     KeepAlive 因 EADDRINUSE 陷入崩溃重启循环。
#  3. 互斥：start_locked.py 用 fcntl.flock 内核文件锁，锁随进程退出自动释放，
#     不依赖任何 mkdir/rmdir/rm（沙箱 safe-delete shim 会让目录锁残留并卡死兜底）。
#  4. 环境隔离：清除 WorkBuddy 注入的 NODE_OPTIONS / FS shim。shim 会把
#     fs.createReadStream 代理到沙箱 broker；会话结束 broker 关闭后读取前端
#     静态文件即抛 "connect failed: Connection refused" 未捕获异常杀死 node。
#     实测该崩溃已发生（2026-11-12 14:34），必须显式清除。
#  5. launchd 不继承交互 shell 的 PATH / 动态代理端口，故显式加载 env.sh；
#     本机实测直连 bilibili 可达（HTTP 200），无需注入代理。

REPO="/Users/zhaoshuixian/Documents/KnowledgeBase_Assets/Code/视频下载"
PORT_V="${PORT:-8787}"
HEALTH="http://127.0.0.1:${PORT_V}/api/health"
# 运行时锁放 /tmp，避免污染代码仓（flock 基于 fd，路径变更不影响已运行实例）
LOCK="/tmp/vdm-${PORT_V}.flock"

health_ok() {
  curl -s --noproxy '*' --max-time 3 "$HEALTH" 2>/dev/null | grep -q '"ok"'
}

cd "$REPO" || exit 1
. ./scripts/env.sh

unset NODE_OPTIONS
unset CODEBUDDY_BROKERED_FS_HOOK_ENABLED
unset PYTHONPATH
unset BASH_ENV

export PORT="$PORT_V"
export DOWNLOAD_ENGINE="${DOWNLOAD_ENGINE:-auto}"
export NO_PROXY="localhost,127.0.0.1"
export no_proxy="localhost,127.0.0.1"

[ -f "web/dist/index.html" ] || { npm run build || exit 1; }

# (2) 已有服务 → 热备，不抢占；一旦现有实例消失，本层立即尝试接管
while health_ok; do
  sleep 10
done

echo "[$(date '+%F %T')] serve.sh 尝试接管 (port=$PORT_V)" >> /tmp/vdm-server.log
# (3) 抢到内核锁者启动服务并持续持锁；抢不到者以 3 退出，交给另一层/下一轮处理
exec python3 "$REPO/scripts/start_locked.py" "$LOCK" npm --prefix server run start
