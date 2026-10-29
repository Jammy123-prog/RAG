"""文档入库流水线：加载 → 中文友好切分 → bge-m3 向量化 → Chroma 入库。

支持 pdf / docx / md / txt / csv / xlsx，参照 RAGFlow 切片策略与 langchain-chatchat 加载器。
扫描件 PDF（提不出文本）自动调用 PaddleOCR PP-OCRv6 兜底（paddle 环境 subprocess）。
"""
import io
import os
import re
import subprocess
import uuid
from pathlib import Path

import pymupdf

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

from . import vectorstore
from .config import BASE_DIR, DATA_DIR, UPLOAD_DIR, settings

SUPPORTED = {".pdf", ".docx", ".md", ".txt", ".csv", ".xlsx"}

# 中文优先的切分分隔符（参照 Dify / FastGPT 中文切片实践）
_SEPARATORS = ["\n\n", "\n", "。", "！", "？", "；", "，", " ", ""]

# 页码标记：切分后从分片文本中反解页码，用于命中时返回对应页的图片
_PAGE_MARK = "@@PAGE_{n}@@"
_PAGE_RE = re.compile(r"@@PAGE_(\d+)@@")

# 图片目录布局：data/images/{doc_id}/p{页码}_{序号}.jpg
IMAGES_DIR = DATA_DIR / "images"


def _load_pdf(path: Path, doc_id: str | None = None) -> str:
    """PDF → 带页码标记的全文（PyMuPDF 解析，比 pypdf 快一个数量级）。

    页级自适应 OCR：仅对提不出文字的页面调用 PP-OCRv6，文本页零 OCR 开销。
    同时渲染「页面快照」：扫描页 + 矢量绘图密集页（工程图纸多为矢量，位图提取抓不到）。
    """
    import pymupdf

    with pymupdf.open(path) as doc:
        pages = [pg.get_text("text") for pg in doc]
    if settings.ocr_enabled:
        need = [i + 1 for i, t in enumerate(pages) if len(t.strip()) < settings.ocr_min_chars_per_page]
        if need:
            ocr_map = _ocr_pdf(path, need)
            for pno, t in ocr_map.items():
                if 1 <= pno <= len(pages):
                    pages[pno - 1] = t
    if doc_id and settings.page_snapshots:
        need_set = {i + 1 for i, t in enumerate(pages) if len(t.strip()) < settings.ocr_min_chars_per_page}
        snap_pages = set(need_set)
        with pymupdf.open(path) as doc:  # 矢量绘图密集页（拓扑图/图纸常为矢量）
            for i, pg in enumerate(doc, 1):
                if i in snap_pages or len(snap_pages) >= settings.snapshot_max:
                    continue
                if len(pg.get_drawings()) >= settings.snapshot_drawings:
                    snap_pages.add(i)
        _render_page_snapshots(path, doc_id, sorted(snap_pages))
    return "\n".join(_PAGE_MARK.format(n=i) + "\n" + t for i, t in enumerate(pages, 1))


def _render_page_snapshots(path: Path, doc_id: str, pages: list[int], scale: float = 1.5, max_snapshots: int = 60) -> int:
    """把关键页面渲染为整页 PNG 快照（架构图/图纸页），命中引用时随来源展示。"""
    if not doc_id or not pages:
        return 0
    out_dir = IMAGES_DIR / doc_id
    out_dir.mkdir(parents=True, exist_ok=True)
    count = 0
    try:
        with pymupdf.open(path) as doc:
            for pno in pages:
                if count >= max_snapshots:
                    break
                out = out_dir / f"p{pno}_snapshot.png"
                if out.exists():
                    count += 1
                    continue
                doc[pno - 1].get_pixmap(matrix=pymupdf.Matrix(scale, scale)).save(out)
                count += 1
    except Exception:
        pass
    return count


def _ocr_pdf(path: Path, pages: list[int]) -> dict[int, str]:
    """跨环境调用 paddle 环境的 OCR 脚本，仅识别指定页，返回 {页码: 文本}。"""
    out = path.with_suffix(".ocr.txt")
    env = dict(os.environ)
    env.update(
        PADDLE_OCR_MODEL=settings.ocr_model_size,
        PADDLE_OCR_SCALE=str(settings.ocr_scale),
        PADDLE_OCR_THREADS=str(settings.ocr_cpu_threads),
    )
    cmd = [
        settings.ocr_python,
        str(BASE_DIR / "scripts" / "ocr_pdf.py"),
        str(path),
        str(out),
        ",".join(str(p) for p in pages),
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=settings.ocr_timeout, env=env)
    except subprocess.TimeoutExpired:
        raise ValueError(f"「{path.name}」OCR 超时（>{settings.ocr_timeout}s），可拆分后上传或调大 OCR_TIMEOUT")
    if proc.returncode != 0 or not out.exists():
        detail = (proc.stderr or b"").decode("utf-8", "ignore")[-300:]
        raise ValueError(f"OCR 失败（{settings.ocr_python}）：{detail}")
    raw = out.read_text(encoding="utf-8", errors="ignore")
    result: dict[int, str] = {}
    parts = _PAGE_RE.split(raw)
    # split 后奇数位为页码，偶数位为该页文本
    for i in range(1, len(parts), 2):
        result[int(parts[i])] = parts[i + 1] if i + 1 < len(parts) else ""
    return result


def _load_docx(path: Path) -> str:
    """docx 解析：段落 + 表格（会议纪要等文档内容常在表格中）+ 文本框 XML 兜底。"""
    import docx

    d = docx.Document(str(path))
    parts = [p.text.strip() for p in d.paragraphs if p.text.strip()]
    for t in d.tables:
        for row in t.rows:
            seen: list[str] = []
            for c in row.cells:  # 合并单元格会重复出现，去掉连续重复
                txt = c.text.strip()
                if txt and (not seen or txt != seen[-1]):
                    seen.append(txt)
            if seen:
                parts.append(" | ".join(seen))
    if not parts:
        # 兜底：文本框（w:txbxContent）里的内容 python-docx 拿不到，直接从 XML 抽取
        import zipfile

        xml = zipfile.ZipFile(path).read("word/document.xml").decode("utf-8", "ignore")
        parts = [t.strip() for t in re.findall(r"<w:t[^>]*>([^<]*)</w:t>", xml) if t.strip()]
    return "\n".join(parts)


def _load_table(path: Path) -> str:
    if path.suffix == ".csv":
        rows = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    else:
        from openpyxl import load_workbook
        ws = load_workbook(str(path), read_only=True).active
        rows = ["\t".join("" if c is None else str(c) for c in row) for row in ws.iter_rows(values_only=True)]
    return "\n".join(rows)


def load_text(path: Path, doc_id: str | None = None) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        text = _load_pdf(path, doc_id)
    elif suffix == ".docx":
        text = _load_docx(path)
    elif suffix in {".csv", ".xlsx"}:
        text = _load_table(path)
    else:  # md / txt
        text = path.read_text(encoding="utf-8", errors="ignore")
    return text.strip()


def split_documents(text: str, source: str, doc_id: str) -> list[Document]:
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=settings.chunk_size,
        chunk_overlap=settings.chunk_overlap,
        separators=_SEPARATORS,
        length_function=len,
    )
    docs = []
    current_page = 0  # 页码续传：页码标记只在页首，页中分片继承上一分片的页码
    for i, chunk in enumerate(splitter.split_text(text)):
        pages = sorted({int(m) for m in _PAGE_RE.findall(chunk)})
        clean = _PAGE_RE.sub("", chunk).strip()
        if not clean:
            continue
        if pages:
            current_page = pages[-1]
        elif current_page:
            pages = [current_page]
        meta = {"source": source, "doc_id": doc_id, "chunk_index": i}
        if pages:
            meta["pages"] = ",".join(str(p) for p in pages)
        docs.append(Document(page_content=clean, metadata=meta))
    return docs


def _extract_pdf_images(path: Path, doc_id: str, min_px: int = 200, max_images: int = 200) -> int:
    """提取 PDF 内嵌图片（架构图/示意图等），存 data/images/{doc_id}/p{页}_{序号}.jpg。

    性能策略（参照 RAGFlow 图片处理）：xref 去重 → 依据图片信息预过滤尺寸（不解码）→ 总量上限。
    """
    from PIL import Image

    out_dir = IMAGES_DIR / doc_id
    out_dir.mkdir(parents=True, exist_ok=True)
    count, seen_xref = 0, set()
    try:
        with pymupdf.open(path) as doc:
            for pno, page in enumerate(doc, 1):
                if count >= max_images:
                    break
                for info in page.get_images(full=True):
                    if count >= max_images:
                        break
                    xref = info[0]
                    if xref in seen_xref:
                        continue
                    seen_xref.add(xref)
                    width, height = int(info[2]), int(info[3])
                    if width < min_px or height < min_px:
                        continue
                    try:
                        raw = doc.extract_image(xref)
                        im = Image.open(io.BytesIO(raw["image"]))
                        im.convert("RGB").save(out_dir / f"p{pno}_{count}.jpg", quality=88)
                        count += 1
                    except Exception:
                        continue
    except Exception:
        pass
    return count


def page_image_urls(doc_id: str | None, pages: list[int] | None) -> list[str]:
    """返回指定文档指定页的图片 URL（命中引用时随来源返回给前端）。"""
    if not doc_id or not pages:
        return []
    d = IMAGES_DIR / doc_id
    if not d.exists():
        return []
    urls = []
    for f in sorted(d.iterdir()):
        m = re.match(r"p(\d+)_", f.name)
        if m and int(m.group(1)) in pages:
            urls.append(f"/api/images/{doc_id}/{f.name}")
    return urls


def ingest_file(path: Path, display_name: str | None = None) -> dict:
    """单文件入库：返回文档注册信息。"""
    name = display_name or path.name
    doc_id = str(uuid.uuid4())[:8]
    text = load_text(path, doc_id)
    if not text:
        raise ValueError(f"文档「{name}」未能解析出文本内容（可能是扫描件，建议先用 OCR）")
    docs = split_documents(text, name, doc_id)
    if not docs:
        raise ValueError(f"文档「{name}」未能生成有效知识分片")
    vectorstore.add_documents(docs)
    n_images = _extract_pdf_images(path, doc_id) if path.suffix.lower() == ".pdf" else 0
    if path.suffix.lower() == ".pdf":  # 含页面快照（矢量图纸页）
        n_images += len(list((IMAGES_DIR / doc_id).glob("*_snapshot.png")))
    info = vectorstore.register_document(name, chunks=len(docs), size=path.stat().st_size, doc_id=doc_id)
    info["images"] = n_images
    return info


def save_upload(data: bytes, filename: str) -> Path:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    safe = "".join(c if c.isalnum() or c in "-_.（）《》" else "_" for c in filename)
    path = UPLOAD_DIR / f"{str(uuid.uuid4())[:8]}_{safe}"
    path.write_bytes(data)
    return path
