#!/bin/sh
# 视频下载管理器 —— L1 主保护：GUI 终端看护进程
# 由 guard.command 在独立 Terminal.app 会话中启动，进程树挂在 Terminal.app 下。
# 与 L2（launchd LaunchAgent）相互独立：不同父进程、不同会话、不同启动机制、
# 不同保活逻辑；任一层被关闭/被回收，另一层仍可独立把服务拉起。
#
# 职责边界：只做「探测 + 幂等补位」，绝不 kill / 重启 / 抢占任何已运行实例。
# 补位统一委托给 scripts/serve.sh（唯一启动权威，自带热备与原子锁），
# 因此 L1 与 L2 天然遵循同一套互斥协议，不会互相抢 8787。

REPO="/Users/zhaoshuixian/Documents/KnowledgeBase_Assets/Code/视频下载"

# 同 serve.sh：看护派生的服务进程必须脱离 WorkBuddy 的 NODE_OPTIONS / FS shim，
# 否则 broker socket 断开后静态文件读取会抛未捕获异常导致服务反复崩溃。
unset NODE_OPTIONS
unset CODEBUDDY_BROKERED_FS_HOOK_ENABLED
unset PYTHONPATH
unset BASH_ENV

PORT_V="${VDM_PORT:-8787}"
HEALTH="http://127.0.0.1:${PORT_V}/api/health"
LOG="${VDM_GUARD_LOG:-/tmp/vdm-guard.log}"
TAG="${VDM_GUARD_TAG:-L1}"
INTERVAL="${VDM_GUARD_INTERVAL:-10}"
FAIL_THRESHOLD=2
COOLDOWN=30

log() { printf '[%s] [%s] %s\n' "$(date '+%F %T')" "$TAG" "$*" >> "$LOG"; }
health_ok() {
  curl -s --noproxy '*' --max-time 3 "$HEALTH" 2>/dev/null | grep -q '"ok"'
}

log "看护启动 pid=$$ port=$PORT_V interval=${INTERVAL}s（现有实例不受影响）"
fail=0
while :; do
  if health_ok; then
    fail=0
  else
    fail=$((fail + 1))
    log "health 失败 ($fail/$FAIL_THRESHOLD)"
    if [ "$fail" -ge "$FAIL_THRESHOLD" ]; then
      log "触发幂等补位 → serve.sh"
      PORT="$PORT_V" nohup /bin/sh "$REPO/scripts/serve.sh" \
        >> /tmp/vdm-server.log 2>&1 < /dev/null &
      i=0
      while [ "$i" -lt 40 ]; do
        health_ok && break
        sleep 1
        i=$((i + 1))
      done
      if health_ok; then
        log "补位成功：$HEALTH"
      else
        log "补位失败，请查看 /tmp/vdm-server.log"
      fi
      # 冷却，避免与 L2 在启动窗口内反复竞争
      fail=0
      sleep "$COOLDOWN"
      continue
    fi
  fi
  sleep "$INTERVAL"
done
