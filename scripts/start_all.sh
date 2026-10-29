#!/usr/bin/env bash
bash /home/zpmc/project/RAG/scripts/start_models.sh
cd /home/zpmc/project/RAG
nohup /home/zpmc/miniconda3/envs/RAG/bin/uvicorn backend.app.main:app --port 8010 > /tmp/kb_backend.log 2>&1 &
cd frontend && nohup env PATH=/home/zpmc/miniconda3/envs/RAG/bin:$PATH npm run dev > /tmp/kb_frontend.log 2>&1 &
sleep 5
echo "全部就绪 → http://localhost:5173"
