#!/usr/bin/env bash
# 停止两个 vLLM 模型服务
pkill -f "vllm serve /home/zpmc/models/Qwen3-14B-AWQ" 2>/dev/null
pkill -f "vllm serve /home/zpmc/models/bge-m3" 2>/dev/null
sleep 3
pgrep -f "vllm serve" >/dev/null && echo "仍有进程残留，请手动检查 pgrep -af vllm" || echo "模型服务已全部停止"
