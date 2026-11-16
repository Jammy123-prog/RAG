#!/usr/bin/env bash
# Nexus KB 一键启动/停止脚本
#
# 用法:
#   bash scripts/kb.sh start            # 启动全部（模型 → Neo4j → 后端 → 前端）
#   bash scripts/kb.sh start backend    # 只启动某个组件
#   bash scripts/kb.sh stop [组件]      # 停止（默认全部）
#   bash scripts/kb.sh restart [组件]   # 重启
#   bash scripts/kb.sh status           # 各组件端口 / 健康 / PID
#   bash scripts/kb.sh logs [组件]      # 跟踪日志（默认 backend）
#
# 组件: models | neo4j | backend | frontend | all
#
# 设计要点:
#   - 幂等：已在运行/端口已通的组件直接跳过，重复执行不会启两个进程
#   - 就绪等待：按 HTTP 健康检查判断，不再是固定 sleep
#   - 停止：PID 文件 → pkill 兜底 → 端口释放校验，避免端口残留
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOGS="$ROOT/logs"
RUN="$LOGS/run"
mkdir -p "$LOGS" "$RUN"

# ---- 运行环境（与 .env 保持一致）----
export PATH="/home/zpmc/miniconda3/envs/RAG/bin:$PATH"
PY=/home/zpmc/miniconda3/envs/RAG/bin/python
UVICORN=/home/zpmc/miniconda3/envs/RAG/bin/uvicorn
ENV_FILE="$ROOT/.env"

env_get() {  # env_get KEY 默认值
  local v=""
  [ -f "$ENV_FILE" ] && v=$(grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d ' \r')
  echo "${v:-$2}"
}

BACKEND_HOST=${BACKEND_HOST:-$(env_get HOST 0.0.0.0)}
BACKEND_PORT=${BACKEND_PORT:-$(env_get PORT 8010)}
FRONTEND_PORT=${FRONTEND_PORT:-5173}
LLM_PORT=8000
EMBED_PORT=8001
NEO4J_PORT=7687

C_OK=$'\033[32m'; C_ER=$'\033[31m'; C_DIM=$'\033[2m'; C_YL=$'\033[33m'; C_0=$'\033[0m'
# 输出被重定向/管道时不带颜色转义，方便 grep 与写进报告
[ -t 1 ] || { C_OK=""; C_ER=""; C_DIM=""; C_YL=""; C_0=""; }

# ---------------- 通用工具 ----------------

port_open() {  # port_open 端口
  ss -lntH 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$1$"
}

http_ok() {  # http_ok url
  curl -sf -m 2 -o /dev/null "$1" 2>/dev/null
}

wait_http() {  # wait_http url 超时秒 [标签]
  local url=$1 timeout=${2:-60} label=${3:-$1} i
  for ((i = 0; i < timeout; i++)); do
    http_ok "$url" && return 0
    sleep 1
  done
  echo "  ${C_ER}✗${C_0} $label 等待超时（${timeout}s），请看日志"
  return 1
}

pid_alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }

save_pid() { echo "$2" >"$RUN/$1.pid"; }
read_pid() { [ -f "$RUN/$1.pid" ] && cat "$RUN/$1.pid" || echo ""; }

kill_pid_file() {
  local pid
  pid=$(read_pid "$1")
  if pid_alive "$pid"; then kill "$pid" 2>/dev/null; fi
  rm -f "$RUN/$1.pid"
}

wait_port_free() {  # wait_port_free 端口 超时秒
  local p=$1 timeout=${2:-15} i
  for ((i = 0; i < timeout; i++)); do
    port_open "$p" || return 0
    sleep 1
  done
  return 1
}

lan_ip() { hostname -I 2>/dev/null | awk '{print $1}'; }

# ---------------- 组件：models（vLLM 双服务）----------------

models_start() {
  if http_ok "http://127.0.0.1:$LLM_PORT/v1/models" && http_ok "http://127.0.0.1:$EMBED_PORT/v1/models"; then
    echo "  ${C_DIM}·${C_0} models 已在运行，跳过"
    return 0
  fi
  echo "  → 启动 models（Qwen3-14B :$LLM_PORT + bge-m3 :$EMBED_PORT，首次加载 1-3 分钟）"
  nohup bash "$ROOT/scripts/start_models.sh" >>"$LOGS/start_models.out" 2>&1 &
  save_pid models $!
}

models_stop() {
  bash "$ROOT/scripts/stop_models.sh" 2>/dev/null || true
  kill_pid_file models
}

models_status() {
  local llm="未启动" emb="未启动"
  http_ok "http://127.0.0.1:$LLM_PORT/v1/models" && llm="就绪"
  http_ok "http://127.0.0.1:$EMBED_PORT/v1/models" && emb="就绪"
  echo "  models    : LLM $LLM_PORT=$llm · Embedding $EMBED_PORT=$emb"
}

# ---------------- 组件：neo4j ----------------

neo4j_start() {
  if port_open "$NEO4J_PORT"; then
    echo "  ${C_DIM}·${C_0} neo4j 已在运行，跳过"
    return 0
  fi
  echo "  → 启动 neo4j（:$NEO4J_PORT）"
  bash "$ROOT/scripts/neo4j-local.sh" start >>"$LOGS/neo4j.out" 2>&1 || true
}

neo4j_stop() {
  bash "$ROOT/scripts/neo4j-local.sh" stop >>"$LOGS/neo4j.out" 2>&1 || true
}

neo4j_status() {
  local s="未启动"
  port_open "$NEO4J_PORT" && s="就绪"
  echo "  neo4j     : $NEO4J_PORT=$s"
}

# ---------------- 组件：backend（FastAPI + uvicorn）----------------

backend_start() {
  if http_ok "http://127.0.0.1:$BACKEND_PORT/api/health"; then
    echo "  ${C_DIM}·${C_0} backend 已在运行，跳过"
    return 0
  fi
  if port_open "$BACKEND_PORT"; then
    echo "  ${C_ER}✗${C_0} 端口 $BACKEND_PORT 已被其他进程占用，未启动 backend"
    echo "    ${C_DIM}ss -lntp | grep $BACKEND_PORT${C_0}"
    return 1
  fi
  echo "  → 启动 backend（$BACKEND_HOST:$BACKEND_PORT）"
  # 用 ; 分隔，确保 $! 取到的是 uvicorn 自身的 pid（而不是子 shell）
  (cd "$ROOT"; nohup "$UVICORN" backend.app.main:app --host "$BACKEND_HOST" --port "$BACKEND_PORT" \
    >>"$LOGS/backend.log" 2>&1 & echo $! >"$RUN/backend.pid")
}

backend_stop() {
  kill_pid_file backend
  pkill -f "uvicorn backend.app.main:app" 2>/dev/null
  if ! wait_port_free "$BACKEND_PORT" 15; then
    echo "  ${C_YL}!${C_0} backend 端口未释放，强制结束"
    pkill -9 -f "uvicorn backend.app.main:app" 2>/dev/null
    wait_port_free "$BACKEND_PORT" 5
  fi
}

backend_status() {
  local pid health
  pid=$(read_pid backend)
  if http_ok "http://127.0.0.1:$BACKEND_PORT/api/health"; then
    health="$(curl -s -m 2 "http://127.0.0.1:$BACKEND_PORT/api/health")"
    echo "  backend   : $BACKEND_PORT=就绪 ${C_DIM}$health${C_0}"
  elif port_open "$BACKEND_PORT"; then
    echo "  backend   : $BACKEND_PORT=${C_YL}端口在监听但 /api/health 不通${C_0}"
  else
    echo "  backend   : $BACKEND_PORT=未启动"
  fi
  [ -n "$pid" ] && pid_alive "$pid" && echo "              ${C_DIM}pid=$pid 日志 logs/backend.log${C_0}"
}

# ---------------- 组件：frontend（Vite dev server）----------------

frontend_start() {
  if http_ok "http://127.0.0.1:$FRONTEND_PORT/"; then
    echo "  ${C_DIM}·${C_0} frontend 已在运行，跳过"
    return 0
  fi
  if [ ! -d "$ROOT/frontend/node_modules" ]; then
    echo "  → frontend 依赖缺失，执行 npm install"
    (cd "$ROOT/frontend" && npm install >>"$LOGS/frontend.log" 2>&1) || {
      echo "  ${C_ER}✗${C_0} npm install 失败，请看 logs/frontend.log"
      return 1
    }
  fi
  echo "  → 启动 frontend（Vite :$FRONTEND_PORT）"
  (cd "$ROOT/frontend"; nohup npm run dev -- --host 0.0.0.0 --port "$FRONTEND_PORT" \
    >>"$LOGS/frontend.log" 2>&1 & echo $! >"$RUN/frontend.pid")
}

frontend_stop() {
  kill_pid_file frontend
  pkill -f "$ROOT/frontend/node_modules/.bin/vite" 2>/dev/null
  pkill -f "vite --host 0.0.0.0 --port $FRONTEND_PORT" 2>/dev/null
  wait_port_free "$FRONTEND_PORT" 15 || echo "  ${C_YL}!${C_0} frontend 端口未释放"
}

frontend_status() {
  local s="未启动"
  http_ok "http://127.0.0.1:$FRONTEND_PORT/" && s="就绪"
  echo "  frontend  : $FRONTEND_PORT=$s"
}

# ---------------- 编排 ----------------

normalize() {  # 组件名归一：缺省 all
  local c=${1:-all}
  case "$c" in
    all | "") echo "models neo4j backend frontend" ;;
    models | vllm | llm) echo "models" ;;
    neo4j | kg | graph) echo "neo4j" ;;
    backend | api | server) echo "backend" ;;
    frontend | web | vite) echo "frontend" ;;
    *) echo "" ;;
  esac
}

do_start() {
  local comps
  comps=$(normalize "${1:-all}")
  [ -z "$comps" ] && { echo "未知组件：$1（models|neo4j|backend|frontend|all）"; return 1; }

  echo "启动 Nexus KB${C_DIM}（组件：$comps）${C_0}"
  for c in $comps; do "${c}_start"; done

  echo "等待服务就绪…"
  local ok=1
  case " $comps " in *" models "*)
    wait_http "http://127.0.0.1:$LLM_PORT/v1/models" 240 "LLM :$LLM_PORT" || ok=0
    wait_http "http://127.0.0.1:$EMBED_PORT/v1/models" 240 "Embedding :$EMBED_PORT" || ok=0
    ;;
  esac
  case " $comps " in *" neo4j "*)
    for ((i = 0; i < 60; i++)); do port_open "$NEO4J_PORT" && break; sleep 1; done
    ;;
  esac
  case " $comps " in *" backend "*)
    wait_http "http://127.0.0.1:$BACKEND_PORT/api/health" 120 "backend :$BACKEND_PORT" || ok=0
    ;;
  esac
  case " $comps " in *" frontend "*)
    wait_http "http://127.0.0.1:$FRONTEND_PORT/" 90 "frontend :$FRONTEND_PORT" || ok=0
    ;;
  esac

  echo
  do_status
  echo
  local ip; ip=$(lan_ip)
  echo "本机访问 : ${C_OK}http://localhost:$FRONTEND_PORT${C_0}   ${C_DIM}（API: http://localhost:$BACKEND_PORT/api/health）${C_0}"
  [ -n "$ip" ] && echo "局域网   : ${C_OK}http://$ip:$FRONTEND_PORT${C_0}"
  echo "日志     : tail -f logs/{backend,frontend,vllm_qwen,vllm_bge}.log"
  [ "$ok" = 1 ] || printf "%s\n" "  ${C_ER}有组件未就绪，请按上面提示看日志${C_0}"
}

do_stop() {
  local comps
  comps=$(normalize "${1:-all}")
  [ -z "$comps" ] && { echo "未知组件：$1（models|neo4j|backend|frontend|all）"; return 1; }
  echo "停止 Nexus KB${C_DIM}（组件：$comps）${C_0}"
  # 反向顺序停止：前端 → 后端 → neo4j → 模型
  local ordered="" c
  for c in frontend backend neo4j models; do
    case " $comps " in *" $c "*) ordered="$ordered $c" ;; esac
  done
  for c in $ordered; do
    echo "  → 停止 $c"
    "${c}_stop"
  done
  echo "完成"
}

do_status() {
  echo "Nexus KB 运行状态："
  models_status
  neo4j_status
  backend_status
  frontend_status
}

do_logs() {
  local c=${1:-backend}
  local f
  case "$c" in
    models | llm | vllm) f="$LOGS/vllm_qwen.log" ;;
    embed) f="$LOGS/vllm_bge.log" ;;
    neo4j) f="$LOGS/neo4j.out" ;;
    backend | api) f="$LOGS/backend.log" ;;
    frontend | web | vite) f="$LOGS/frontend.log" ;;
    *) f="$LOGS/$c.log" ;;
  esac
  [ -f "$f" ] || { echo "日志不存在：$f"; return 1; }
  echo "${C_DIM}== $f（Ctrl+C 退出）==${C_0}"
  tail -n 100 -f "$f"
}

usage() {
  cat <<EOF
Nexus KB 管理脚本

用法: bash scripts/kb.sh <命令> [组件]

  start   [组件]   启动（默认 all）
  stop    [组件]   停止（默认 all）
  restart [组件]   重启
  status           查看各组件端口与健康状态
  logs    [组件]   跟踪日志（默认 backend）

组件: models | neo4j | backend | frontend | all

示例:
  bash scripts/kb.sh start            # 全部启动
  bash scripts/kb.sh start models     # 只起模型服务（GPU 占用大，可单独控制）
  bash scripts/kb.sh restart backend  # 改完后端代码后重启 API
  bash scripts/kb.sh status
EOF
}

main() {
  local cmd=${1:-}
  shift 2>/dev/null || true
  case "$cmd" in
    start) do_start "${1:-all}" ;;
    stop) do_stop "${1:-all}" ;;
    restart) do_stop "${1:-all}" && do_start "${1:-all}" ;;
    status) do_status ;;
    logs) do_logs "${1:-backend}" ;;
    "" | -h | --help | help) usage ;;
    *) echo "未知命令：$cmd"; usage; exit 1 ;;
  esac
}

main "$@"
