#!/usr/bin/env bash
# MITM_BRIDGE_RUNBOOK.sh — 第三方桥接（res-downloader）真机接入收尾脚本
#
# 作用：桌面端启动 res-downloader 后，一键完成「前置探测 → 状态判定 → 直链抓取 → 委派下载」。
# 边界（重要）：本脚本【只读探测 + 调用本项目既有 HTTP API】，绝不：
#   - 修改 macOS 系统代理开关
#   - 安装 / 信任任何 CA 根证书
#   - 启停或注入微信等第三方进程
#   - 改动项目源码 / 数据库 / 运行中的服务
# 因此可安全反复运行；桥接未就绪时只打印诊断，不产生任何副作用。
#
# 用法：
#   bash MITM_BRIDGE_RUNBOOK.sh              # 完整流程（探测 + 引导 + 直链抓取 + 委派）
#   bash MITM_BRIDGE_RUNBOOK.sh --probe-only # 只做前置探测与诊断，不进入交互
#   bash MITM_BRIDGE_RUNBOOK.sh --submit "https://...直链..."   # 直接把已抓到的直链委派下载
#
# 依赖：curl、python3（仅用于 JSON 美化/取字段，macOS 自带）

set -uuo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:8787/api/mitm}"
BRIDGE_URL="${BRIDGE_URL:-http://127.0.0.1:8899}"
PROBE_ONLY=0
SUBMIT_URL=""
for arg in "$@"; do
  case "$arg" in
    --probe-only) PROBE_ONLY=1 ;;
    --submit) shift; SUBMIT_URL="${1:-}" ;;
    *) : ;;
  esac
  shift || true
done

PASS=0; FAIL=0
ONLINE_OK=0          # 后端 /bridge/status 权威 online 标志（步骤2写入，步骤4复用）
APPINFO_OK=0         # 直连 :8899 app-info 是否 HTTP200 && code==1
GETCFG_OK=0          # 直连 :8899 get-config 是否 HTTP200 && code==1
ok(){   printf '  \033[32m✅\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
warn(){ printf '  \033[33m⚠️ \033[0m %s\n' "$1"; }
bad(){  printf '  \033[31m❌\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }
info(){ printf '     %s\n' "$1"; }
hr(){  printf '\033[90m────────────────────────────────────────────────────────\033[0m\n'; }
json(){ python3 -m json.tool 2>/dev/null || cat; }
# 直连第三方端点强校验：仅 HTTP 200 且 JSON.code===1 才算真就绪
# 规避 sandbox-c 透明代理把 ECONNREFUSED 包装成 502 非空响应导致的假阳性
probe_bridge_endpoint(){
  # $1=路径  $2=标签；回显 "<http_code>|<body>"，设置全局 *_OK
  local url="$BRIDGE_URL$1" code body http
  body=$(curl -sS --max-time 3 -w '\n__HTTP__%{http_code}' "$url" 2>/dev/null || true)
  http=$(printf '%s' "$body" | sed -n 's/^__HTTP__\([0-9][0-9][0-9]\)$/\1/p')
  # 按行删除标记行（sed 无法用 \n 跨行匹配；残留会让 json.load 失败 → 假阴性）
  body=$(printf '%s' "$body" | sed '/^__HTTP__[0-9][0-9][0-9]$/d')
  local verdict
  verdict=$(printf '%s' "$body" | python3 -c 'import sys,json;print("1" if json.load(sys.stdin).get("code")==1 else "0")' 2>/dev/null || echo "0")
  if [ "$http" = "200" ] && [ "$verdict" = "1" ]; then
    ok "$2 就绪（HTTP 200 / code=1）：$body"
    return 0
  else
    # 明确区分「代理伪装的 502/上游拒绝」与「空响应」
    if [ "$http" = "502" ] || [ "$http" = "503" ] || echo "$body" | grep -qi 'upstream\|bad gateway\|connection refused'; then
      warn "$2 未就绪：拿到 HTTP ${http:-000}（沙箱代理/上游拒绝的伪装响应，非第三方）→ 判离线"
    else
      warn "$2 未就绪：HTTP ${http:-000} / code≠1（响应：${body:-<empty>}）→ 判离线"
    fi
    return 1
  fi
}

echo ""
echo "════════════════════════════════════════════════════════════"
echo " MITM 桥接真机接入 · 收尾自检      $(date '+%Y-%m-%d %H:%M:%S')"
echo " 项目 API : $API_BASE"
echo " 桥接目标 : $BRIDGE_URL"
echo "════════════════════════════════════════════════════════════"
echo ""

# ── 步骤 1：主服务健康 ──────────────────────────────────────────
echo "【1/5】主服务健康探测"
HEALTH=$(curl -sS --max-time 4 "$API_BASE/../health" 2>/dev/null || true)
if echo "$HEALTH" | grep -q '"ok"[[:space:]]*:[[:space:]]*true'; then
  ok "主服务在线：$HEALTH"
else
  # 兜底：直接打 /api/health（不同挂载前缀）
  HEALTH2=$(curl -sS --max-time 4 "http://127.0.0.1:8787/api/health" 2>/dev/null || true)
  if echo "$HEALTH2" | grep -q '"ok"[[:space:]]*:[[:space:]]*true'; then
    ok "主服务在线（/api/health）：$HEALTH2"
  else
    bad "主服务未响应 8787，请先 npm run dev 启动后端。返回：${HEALTH:-<empty>}"
  fi
fi

# ── 步骤 2：桥接状态 ─────────────────═════════════════════════
echo ""
echo "【2/5】桥接状态（本项目 /bridge/status）"
STATUS=$(curl -sS --max-time 5 "$API_BASE/bridge/status" 2>/dev/null || true)
if [ -z "$STATUS" ]; then
  bad "无法访问 /bridge/status（主服务可能未起）"
else
  echo "$STATUS" | json | sed 's/^/     /'
  ONLINE=$(echo "$STATUS" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("bridge",{}).get("online"))' 2>/dev/null || echo "")
  if [ "$ONLINE" = "True" ]; then
    ONLINE_OK=1
    ok "桥接在线：第三方 res-downloader 已就绪（后端权威 online=true）"
  else
    ONLINE_OK=0
    warn "桥接离线（bridge.online=false）— 这是当前预期状态，非代码故障"
    info "需在【真实 macOS 桌面会话】启动 res-downloader（Wails GUI，监听 :8899），"
    info "并在其界面内开启抓包（代理 + 证书由其自身管理），本脚本不代劳。"
  fi
fi

# ── 步骤 3：直接探测第三方 :8899（区分「项目降级」与「第三方没起」）──
echo ""
echo "【3/5】直连第三方 :8899 探测（强校验：HTTP 200 && code===1）"
if probe_bridge_endpoint "/api/app-info" "app-info"; then APPINFO_OK=1; else APPINFO_OK=0; fi
if probe_bridge_endpoint "/api/get-config" "get-config"; then GETCFG_OK=1; else GETCFG_OK=0; fi

# ── 步骤 4：诊断结论（唯一权威 = 步骤2 后端 /bridge/status 的 ONLINE_OK）──
# 修复要点：结论绝不与后端 online 状态矛盾。直连探测仅作佐证，
# 且因沙箱代理会把 ECONNREFUSED 伪装成 502/Hy2 非空响应，直连"绿"不足以反推在线。
echo ""
echo "【4/5】当前结论"
hr
DIRECT_OK=0
[ "$APPINFO_OK" = "1" ] && [ "$GETCFG_OK" = "1" ] && DIRECT_OK=1
if [ "$ONLINE_OK" = "1" ]; then
  if [ "$DIRECT_OK" = "1" ]; then
    echo "  🟢 第三方桥接可用（后端 online=true 且直连双端点均 HTTP200/code=1）"
    echo "     → 可进入直链抓取与委派下载（步骤 5）。"
  else
    echo "  🟡 后端判定在线，但直连 :8899 双端点未全部通过强校验（online=true / direct=部分）。"
    echo "     可能为 ThirdPartyBridge 与直连探测走了不同网络路径（代理），建议复核后再委派下载。"
  fi
else
  # 后端判离线 → 结论一律"未就绪"，无论直连探测结果，杜绝自相矛盾
  echo "  🟡 第三方桥接未就绪（后端 /bridge/status 权威判定 online=false）。"
  if [ "$DIRECT_OK" = "1" ]; then
    echo "     ⚠️ 注意：直连 :8899 双端点虽回 200/code=1，但后端仍判离线 ——"
    echo "        这通常是沙箱代理/独立命名空间造成的『伪就绪』或后端缓存未刷新，"
    echo "        以后端 online 为准，本结论不采信直连绿灯，避免误导。"
  fi
  echo "     剩余的唯一人工动作（无法由脚本/AI 代劳，且属授权范围外）："
  echo "       1) 在真实 Mac 桌面登录并启动 res-downloader（Wails 应用）"
  echo "       2) 在该应用内开启系统代理 + 安装其自签 CA（仅该应用管理）"
  echo "       3) 打开微信 PC 端 → 进入目标视频号/公众号 → 播放目标视频"
  echo "       4) 回到 res-downloader 资源列表，复制视频直链（.mp4 / m3u8）"
  echo "       5) 运行： bash MITM_BRIDGE_RUNBOOK.sh --submit \"<直链>\""
  echo "     本脚本不会修改系统代理/CA，也不会操作微信进程。"
fi
hr

if [ "$PROBE_ONLY" = "1" ]; then
  echo ""
  echo "（--probe-only：诊断结束，未做任何写操作）"
  echo "探测汇总： ✅ $PASS   ❌ $FAIL"
  exit 0
fi

# ── 步骤 5：直链抓取 → 委派下载 ────────────────────────────────
echo ""
echo "【5/5】直链提交与委派下载"
URL="$SUBMIT_URL"
if [ -z "$URL" ]; then
  echo ""
  echo "  请粘贴从 res-downloader 抓到的视频直链（回车提交，直接回车=跳过）："
  printf "  > "
  read -r URL || true
fi

if [ -z "$URL" ]; then
  warn "未提供直链，本轮不委派下载（零副作用）。"
  echo ""
  echo "完成：探测汇总 ✅ $PASS   ❌ $FAIL   |   委派下载：跳过"
  exit 0
fi

case "$URL" in
  http://*|https://*) : ;;
  *) bad "直链格式不合法（需 http/https 开头）：$URL"; exit 1 ;;
esac

echo ""
info "提交直链 → POST $API_BASE/bridge/download"
info "URL: $URL"
echo ""
RESP=$(curl -sS --max-time 15 -X POST "$API_BASE/bridge/download" \
  -H 'Content-Type: application/json' \
  -d "$(python3 -c 'import sys,json;print(json.dumps({"url":sys.argv[1]}))' "$URL")" 2>/dev/null || true)

if [ -z "$RESP" ]; then
  bad "下载委派请求无响应（主服务未起或桥接未启用返回 503）"
  echo "完成：探测汇总 ✅ $PASS   ❌ $FAIL   |   委派下载：失败"
  exit 1
fi

echo "$RESP" | json | sed 's/^/     /'
echo ""
ACCEPTED=$(echo "$RESP" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("bridge",{}).get("accepted"))' 2>/dev/null || echo "")
LOCALID=$(echo "$RESP" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("localTask",{}).get("id",""))' 2>/dev/null || echo "")
if [ "$ACCEPTED" = "True" ]; then
  ok "第三方已接受下载委派"
else
  warn "第三方未接受（桥接可能离线），但内置引擎已兜底建任务"
fi
if [ -n "$LOCALID" ]; then
  ok "内置引擎任务已创建：id=$LOCALID（确定性完成，不依赖第三方）"
  info "可在项目下载列表查看进度，或 GET $API_BASE/tasks"
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo " 完成：探测汇总 ✅ $PASS   ❌ $FAIL   |   委派下载：已提交"
echo "════════════════════════════════════════════════════════════"
