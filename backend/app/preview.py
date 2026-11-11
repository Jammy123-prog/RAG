"""文档预览：把已入库文档渲染成前端可直接展示的形式。

两级能力：
1) 页面级渲染（类 WPS 阅读器）：PDF 直接用 PyMuPDF 逐页出图；DOCX/XLSX 经 LibreOffice
   无头转 PDF 再逐页出图；MD/TXT/CSV 走 PyMuPDF Story 排版成 A4 页后出图。
2) 降级内容预览：转换失败或历史文档无原文件时，返回 HTML / 纯文本，保证「任何文档都能点开」。
"""
import csv
import html
import io
import re
import shutil
import subprocess
import threading
from pathlib import Path

import pymupdf

from . import vectorstore
from .config import DATA_DIR

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}
TEXT_EXT = {".md", ".markdown", ".txt"}

PREVIEW_DIR = DATA_DIR / "preview"  # 转换/渲染缓存：{doc_id}/render.pdf、p{n}_{scale}.png
A4_W, A4_H = 595.0, 842.0  # A4 点值（72dpi）

_PAGE_RE = re.compile(r"@@PAGE_(\d+)@@")
_MAX_ROWS = 300
_MAX_COLS = 20

_STORY_CSS = (
    "body{font-family:'Noto Sans CJK SC','Source Han Sans SC','WenQuanYi Zen Hei',sans-serif;"
    "font-size:11pt;line-height:1.75;color:#1a1a1a}"
    "h1{font-size:20pt;margin:0 0 12pt}h2{font-size:15pt;margin:16pt 0 8pt}"
    "h3{font-size:13pt;margin:14pt 0 6pt}h4{font-size:11.5pt;margin:12pt 0 6pt}"
    "p{margin:6pt 0}li{margin:3pt 0 3pt 16pt}"
    "table{border-collapse:collapse;width:100%;font-size:9.5pt;margin:8pt 0}"
    "td,th{border:1px solid #cfcfcf;padding:4pt 6pt;vertical-align:top}"
    "pre{font-family:monospace;font-size:9pt;white-space:pre-wrap}"
    "code{font-family:monospace;background:#f2f2f2;padding:1px 3px}"
)


def _esc(s: str) -> str:
    return html.escape(s or "", quote=False)


def _esc(s: str) -> str:
    return html.escape(s or "", quote=False)


# ---------------- DOCX ----------------

def _docx_html(path: Path) -> str:
    """DOCX → HTML（段落 + 表格按原顺序；标题按样式映射 h1-h3）。"""
    from docx import Document
    from docx.oxml.ns import qn
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    doc = Document(str(path))
    parts: list[str] = []
    for child in doc.element.body.iterchildren():
        if child.tag == qn("w:p"):
            p = Paragraph(child, doc)
            text = (p.text or "").strip()
            if not text:
                continue
            style = (p.style.name or "").lower()
            level = next((n for n in ("1", "2", "3") if style.endswith(n) and "heading" in style), None)
            if level:
                parts.append(f"<h{level}>{_esc(text)}</h{level}>")
            elif "list" in style:
                parts.append(f"<li>{_esc(text)}</li>")
            else:
                parts.append(f"<p>{_esc(text)}</p>")
        elif child.tag == qn("w:tbl"):
            t = Table(child, doc)
            rows = []
            for r in t.rows[:60]:
                cells = "".join(f"<td>{_esc(c.text.strip())}</td>" for c in r.cells[:_MAX_COLS])
                rows.append(f"<tr>{cells}</tr>")
            if rows:
                parts.append(f"<table><tbody>{''.join(rows)}</tbody></table>")
    return "".join(parts)


# ---------------- 表格 ----------------

def _sheet_html(path: Path) -> str:
    """XLSX → HTML（前 3 个工作表，每表前 300 行）。"""
    from openpyxl import load_workbook

    wb = load_workbook(str(path), read_only=True, data_only=True)
    parts: list[str] = []
    try:
        for ws in wb.worksheets[:3]:
            parts.append(f"<h4>{_esc(ws.title)}</h4>")
            rows = []
            for row in ws.iter_rows(max_row=_MAX_ROWS, max_col=_MAX_COLS, values_only=True):
                if not any(v is not None and str(v).strip() for v in row):
                    continue
                cells = "".join(f"<td>{_esc('' if v is None else str(v))}</td>" for v in row)
                rows.append(f"<tr>{cells}</tr>")
            parts.append(f"<table><tbody>{''.join(rows)}</tbody></table>")
    finally:
        wb.close()
    return "".join(parts)


def _csv_html(path: Path) -> str:
    raw = path.read_bytes()
    text = None
    for enc in ("utf-8-sig", "utf-8", "gbk", "gb18030"):
        try:
            text = raw.decode(enc)
            break
        except Exception:
            continue
    if text is None:
        text = raw.decode("utf-8", "ignore")
    rows = []
    for i, row in enumerate(csv.reader(io.StringIO(text))):
        if i > _MAX_ROWS:
            break
        rows.append("<tr>" + "".join(f"<td>{_esc(c)}</td>" for c in row[:_MAX_COLS]) + "</tr>")
    return f"<table><tbody>{''.join(rows)}</tbody></table>"


# ---------------- 文本 ----------------

def _md_html(text: str) -> str:
    try:
        from markdown_it import MarkdownIt

        md = MarkdownIt("commonmark").enable(["table", "strikethrough"])
        return md.render(text)
    except Exception:
        return f"<pre>{_esc(text)}</pre>"


def _chunks_text(doc_id: str) -> str:
    """历史文档未保留原文件时，用已入库分片拼回可读文本（去页码标记，按分片序）。"""
    try:
        raw = vectorstore.get_vectorstore()._collection.get(
            where={"doc_id": doc_id}, include=["documents", "metadatas"]
        )
        pairs = list(zip(raw.get("documents") or [], raw.get("metadatas") or []))
        pairs.sort(key=lambda p: p[1].get("chunk_index", 0) if p[1] else 0)
        text = "\n\n".join(t for t, _ in pairs if t)
        return _PAGE_RE.sub("", text).strip()
    except Exception:
        return ""


# ---------------- 入口 ----------------

def build_preview(info: dict) -> dict:
    """返回 {kind: pdf|image|html|text|download, ...}，供前端按类型渲染。"""
    doc_id = info["doc_id"]
    name = info.get("name", "")
    suffix = Path(name).suffix.lower()
    path = Path(info.get("path") or "")
    exists = bool(info.get("path")) and path.exists()
    base = {
        "doc_id": doc_id,
        "name": name,
        "size": info.get("size", 0),
        "uploaded_at": info.get("uploaded_at"),
        "scope": info.get("scope", "public"),
        "owner": info.get("owner"),
        "has_file": exists,
    }

    if exists and suffix == ".pdf":
        return {**base, "kind": "pdf"}
    if exists and suffix in IMAGE_EXT:
        return {**base, "kind": "image"}
    if exists and suffix == ".docx":
        try:
            return {**base, "kind": "html", "html": _docx_html(path)}
        except Exception as e:
            base["note"] = f"Word 解析失败：{e}"
    if exists and suffix == ".xlsx":
        try:
            return {**base, "kind": "html", "html": _sheet_html(path)}
        except Exception as e:
            base["note"] = f"表格解析失败：{e}"
    if exists and suffix == ".csv":
        try:
            return {**base, "kind": "html", "html": _csv_html(path)}
        except Exception as e:
            base["note"] = f"CSV 解析失败：{e}"
    if exists and suffix in TEXT_EXT:
        text = path.read_text(encoding="utf-8", errors="ignore")
        if suffix in (".md", ".markdown"):
            return {**base, "kind": "html", "html": _md_html(text[:200_000])}
        return {**base, "kind": "text", "text": text[:200_000]}
    if exists and suffix == ".txt":
        return {**base, "kind": "text", "text": path.read_text(encoding="utf-8", errors="ignore")[:200_000]}

    # 兜底：用已入库分片文本预览（历史文档、原文件已清理、或未知格式）
    text = _chunks_text(doc_id)
    if text:
        note = base.get("note") or ("原文件未保留，以下为入库解析文本（可能不含图片与版式）" if not exists else "")
        return {**base, "kind": "text", "text": text[:200_000], "note": note}
    return {**base, "kind": "download", "note": base.get("note") or "该文档暂无可预览内容，请下载原文件查看"}


# ==================== 页面级渲染（类 WPS 阅读器） ====================

_conv_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock_for(doc_id: str) -> threading.Lock:
    """同一文档的转换串行化（阅读器会并发请求多页/元信息，避免重复转换与写冲突）。"""
    with _locks_guard:
        lock = _conv_locks.get(doc_id)
        if lock is None:
            lock = threading.Lock()
            _conv_locks[doc_id] = lock
        return lock


def _cache_dir(doc_id: str) -> Path:
    d = PREVIEW_DIR / doc_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _html_for_story(info: dict, exists: bool, path: Path, suffix: str) -> str:
    """把文档内容整理为 Story 可排版的 HTML（MD/TXT/CSV 与无原文件兜底用）。"""
    body = _html_body(info, exists, path, suffix)
    return f"<body>{body}</body>"


def _html_body(info: dict, exists: bool, path: Path, suffix: str) -> str:
    if exists and suffix == ".csv":
        return _csv_html(path)
    if exists and suffix in (".md", ".markdown"):
        return _md_html(path.read_text(encoding="utf-8", errors="ignore")[:400_000])
    if exists and suffix in (".txt",):
        text = path.read_text(encoding="utf-8", errors="ignore")[:400_000]
        return "".join(f"<p>{_esc(line) or '<br/>'}</p>" for line in text.splitlines())
    text = _chunks_text(info["doc_id"])[:400_000]
    return "".join(f"<p>{_esc(line) or '<br/>'}</p>" for line in text.splitlines())


def _story_to_pdf(html: str, out: Path) -> Path:
    """用 PyMuPDF Story 把 HTML 自动分页排成 A4 PDF（离线、无浏览器依赖）。"""
    story = pymupdf.Story(html=html, user_css=_STORY_CSS)
    page_rect = pymupdf.Rect(0, 0, A4_W, A4_H)
    writer = pymupdf.DocumentWriter(str(out))
    more = 1
    guard = 0
    while more and guard < 2000:
        dev = writer.begin_page(page_rect)
        more, _ = story.place(page_rect)
        story.draw(dev)
        writer.end_page()
        guard += 1
    writer.close()
    return out


def _soffice_to_pdf(src: Path, out: Path) -> Path | None:
    """LibreOffice 无头转换（DOCX/XLSX → PDF），保留版式与图片，接近 WPS 显示效果。"""
    out.parent.mkdir(parents=True, exist_ok=True)
    try:
        proc = subprocess.run(
            ["soffice", "--headless", "--norestore", "--convert-to", "pdf", "--outdir", str(out.parent), str(src)],
            capture_output=True, timeout=180,
        )
    except Exception:
        return None
    produced = out.parent / f"{src.stem}.pdf"
    if proc.returncode != 0 or not produced.exists():
        return None
    try:
        if produced.resolve() != out.resolve():
            shutil.move(str(produced), str(out))
    except Exception:
        return None
    return out


def ensure_pdf(info: dict) -> Path | None:
    """把文档准备成可逐页渲染的 PDF（带 mtime/size 戳的缓存），失败返回 None。"""
    path = Path(info.get("path") or "")
    if not info.get("path") or not path.exists():
        text = _chunks_text(info["doc_id"])
        if not text:
            return None
        cached = _cache_dir(info["doc_id"]) / "render.pdf"
        if cached.exists():
            return cached
        try:
            return _story_to_pdf(_html_for_story(info, False, path, ""), cached)
        except Exception:
            return None

    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return path
    if suffix in IMAGE_EXT:
        return None

    cache = _cache_dir(info["doc_id"])
    cached = cache / "render.pdf"
    stamp_file = cache / "render.stamp"
    stamp = f"{path.stat().st_mtime:.0f}-{path.stat().st_size}"
    if cached.exists() and stamp_file.exists() and stamp_file.read_text(encoding="utf-8") == stamp:
        return cached

    with _lock_for(info["doc_id"]):
        # 等锁期间可能已被其它请求转换完成
        if cached.exists() and stamp_file.exists() and stamp_file.read_text(encoding="utf-8") == stamp:
            return cached
        try:
            if suffix in (".docx", ".xlsx", ".doc", ".xls"):
                result = _soffice_to_pdf(path, cached)
            else:
                result = _story_to_pdf(_html_for_story(info, True, path, suffix), cached)
        except Exception:
            return None
        if result and result.exists():
            stamp_file.write_text(stamp, encoding="utf-8")
            for old in cache.glob("p*.png"):  # 版本已变，旧页面图作废
                old.unlink(missing_ok=True)
            return result
        return None


def pages_meta(info: dict) -> dict:
    """返回 {mode: pages|image|none, page_count}，供前端决定用阅读器还是降级预览。"""
    path = Path(info.get("path") or "")
    if info.get("path") and path.exists() and path.suffix.lower() in IMAGE_EXT:
        return {"mode": "image", "page_count": 1}
    pdf = ensure_pdf(info)
    if not pdf:
        return {"mode": "none", "page_count": 0}
    try:
        with pymupdf.open(pdf) as doc:
            return {"mode": "pages", "page_count": doc.page_count}
    except Exception:
        return {"mode": "none", "page_count": 0}


def render_page_bytes(info: dict, page_no: int, scale: float = 2.0) -> bytes | None:
    """渲染第 page_no 页（1 起）为 PNG 字节；带磁盘缓存，供阅读器滚动加载。"""
    path = Path(info.get("path") or "")
    if info.get("path") and path.exists() and path.suffix.lower() in IMAGE_EXT:
        return path.read_bytes() if page_no == 1 else None

    pdf = ensure_pdf(info)
    if not pdf:
        return None
    scale = max(1.0, min(3.0, float(scale)))
    cache = _cache_dir(info["doc_id"])
    version = int(pdf.stat().st_mtime)  # 与 PDF 版本绑定，重转后自动失效
    png = cache / f"p{page_no}_{scale:.1f}_{version}.png"
    if png.exists():
        return png.read_bytes()
    try:
        with pymupdf.open(pdf) as doc:
            if not (1 <= page_no <= doc.page_count):
                return None
            pix = doc[page_no - 1].get_pixmap(matrix=pymupdf.Matrix(scale, scale))
            data = pix.tobytes("png")
        png.write_bytes(data)
        return data
    except Exception:
        return None
