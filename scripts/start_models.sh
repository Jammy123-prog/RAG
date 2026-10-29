#!/usr/bin/env bash
# 启动 Qwen3-14B-AWQ（对话）+ bge-m3（向量化）双 vLLM 服务
# 单卡 16GB 显存分配：LLM 72% + Embedding 18%
set -e

VLLM=/home/zpmc/miniconda3/envs/RAG-vllm/bin/vllm
export PATH="/home/zpmc/miniconda3/envs/RAG-vllm/bin:$PATH"   # 确保 ninja 等 JIT 工具可用
export VLLM_USE_FLASHINFER_SAMPLER=0                           # 规避 flashinfer JIT 编译依赖
QWEN_DIR=/home/zpmc/models/Qwen3-14B-AWQ
BGE_DIR=/home/zpmc/models/bge-m3
LOG_DIR=/home/zpmc/project/RAG/logs
mkdir -p "$LOG_DIR"

# 若已在运行则跳过
pgrep -f "vllm serve $QWEN_DIR" >/dev/null || nohup "$VLLM" serve "$QWEN_DIR" \
  --served-model-name qwen3-14b \
  --port 8000 \
  --gpu-memory-utilization 0.85 \
  --max-model-len 6144 \
  --enable-prefix-caching \
  > "$LOG_DIR/vllm_qwen.log" 2>&1 &
echo "LLM 服务启动中 → http://localhost:8000（日志 $LOG_DIR/vllm_qwen.log）"

pgrep -f "vllm serve $BGE_DIR" >/dev/null || nohup "$VLLM" serve "$BGE_DIR" \
  --runner pooling \
  --served-model-name bge-m3 \
  --port 8001 \
  --gpu-memory-utilization 0.12 \
  --max-model-len 8192 \
  > "$LOG_DIR/vllm_bge.log" 2>&1 &
echo "Embedding 服务启动中 → http://localhost:8001（日志 $LOG_DIR/vllm_bge.log）"

echo "等待服务就绪（首次加载模型约 1-3 分钟）…"
for port in 8000 8001; do
  for i in $(seq 1 60); do
    curl -s "http://localhost:$port/v1/models" >/dev/null 2>&1 && { echo "端口 $port 就绪"; break; }
    sleep 5
  done
done
curl -s http://localhost:8000/v1/models | head -c 200; echo
