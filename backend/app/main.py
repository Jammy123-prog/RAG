"""企业知识库 RAG 服务入口。

参照文章（LangChain + 通义千问 + Chroma）+ langchain-chatchat 的 FastAPI 技术栈：
- POST /api/chat/stream  SSE 流式问答（改写/兜底/溯源/流式 四大生产特性）
- POST /api/documents/upload  文档上传入库
- GET/DELETE /api/documents   文档管理
- GET /api/stats /api/health  统计与健康检查
"""
import json
import shutil
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import ingestion, vectorstore
from .config import DATA_DIR, settings
from .rag import chat_stream

app = FastAPI(title="企业知识库 RAG 系统", version="1.0.0")

# 文档内嵌图片（架构图等）：/api/images/{doc_id}/p{页}_{序号}.jpg，命中引用时随来源返回
app.mount("/api/images", StaticFiles(directory=ingestion.IMAGES_DIR), name="images")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str
    history: list[dict] = []


@app.get("/api/health")
async def health():
    return {"status": "ok", "llm": settings.llm_model, "embed": settings.embed_model}


@app.get("/api/stats")
async def get_stats():
    return vectorstore.stats()


@app.post("/api/chat/stream")
async def chat_stream_endpoint(req: ChatRequest):
    """SSE 流式问答。事件：meta（模式/改写/来源）→ delta（增量）→ done。"""

    async def gen():
        try:
            async for event in chat_stream(req.message, req.history):
                yield f"event: {event['type']}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as e:  # 兜底：流式过程中出错也要让前端收到明确信号
            yield f"event: error\ndata: {json.dumps({'message': str(e)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.post("/api/documents/upload")
async def upload_documents(files: list[UploadFile] = File(...)):
    """多文件并行入库（线程池）：解析/切分/向量化为 CPU+IO 混合负载，可安全并行。"""
    payloads = [(await f.read(), f.filename or "untitled") for f in files]

    def process(item: tuple[bytes, str]) -> dict:
        data, filename = item
        suffix = Path(filename).suffix.lower()
        if suffix not in ingestion.SUPPORTED:
            return {"errors": [{"name": filename, "error": f"不支持的格式 {suffix}（支持：pdf/docx/md/txt/csv/xlsx）"}]}
        try:
            path = ingestion.save_upload(data, filename)
            return {"success": [ingestion.ingest_file(path)]}
        except Exception as e:
            return {"errors": [{"name": filename, "error": str(e)}]}

    with ThreadPoolExecutor(max_workers=min(4, max(1, len(payloads)))) as ex:
        outs = list(ex.map(process, payloads))

    return {
        "success": [r for o in outs for r in o.get("success", [])],
        "errors": [e for o in outs for e in o.get("errors", [])],
    }


@app.get("/api/documents")
async def list_documents():
    return vectorstore.list_documents()


@app.delete("/api/documents/{doc_id}")
async def delete_document(doc_id: str):
    if not vectorstore.delete_document(doc_id):
        raise HTTPException(404, "文档不存在")
    # 同步清理该文档提取出的图片目录
    shutil.rmtree(ingestion.IMAGES_DIR / doc_id, ignore_errors=True)
    return {"ok": True}
