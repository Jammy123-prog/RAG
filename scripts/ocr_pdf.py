#!/usr/bin/env python3
"""扫描页 PDF 的 OCR 提取（在 paddle 环境中运行，由 RAG 后端 subprocess 调用）。

用法: python ocr_pdf.py <pdf路径> <输出txt路径> [页码列表，如 8,12,55]
速度优化（参照 PP-OCRv6 官方部署建议）：
  - 仅渲染/识别指定页面（后端页级自适应筛选），文本页零开销
  - 批量推理：所有页面一次性送入 predict，充分利用流水线
  - 模型规格/渲染倍率/CPU 线程由环境变量控制（默认 small + 1.5x + 8 线程，追求速度；
    需要更高精度设 PADDLE_OCR_MODEL=medium）
"""
import json
import os
import sys
import tempfile
from pathlib import Path


def main(pdf_path: str, out_path: str, pages_csv: str | None = None) -> None:
    import pypdfium2 as pdfium
    from paddleocr import PaddleOCR

    model_size = os.environ.get("PADDLE_OCR_MODEL", "small")      # small | medium
    scale = float(os.environ.get("PADDLE_OCR_SCALE", "1.5"))      # 渲染倍率
    threads = int(os.environ.get("PADDLE_OCR_THREADS", "8"))      # CPU 线程

    ocr = PaddleOCR(
        ocr_version="PP-OCRv6",
        text_detection_model_name=f"PP-OCRv6_{model_size}_det",
        text_recognition_model_name=f"PP-OCRv6_{model_size}_rec",
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        device="cpu",
        cpu_threads=threads,
        enable_mkldnn=False,  # 规避 paddlepaddle 3.3.1 CPU 的 oneDNN PIR 转换 bug
    )

    doc = pdfium.PdfDocument(pdf_path)
    total = len(doc)
    targets = sorted({int(x) for x in pages_csv.split(",") if x.strip().isdigit()}) if pages_csv else list(range(1, total + 1))
    targets = [p for p in targets if 1 <= p <= total]

    # 先渲染所有目标页，再一次性批量推理
    tmp = tempfile.TemporaryDirectory()
    page_pngs: list[tuple[int, str]] = []
    try:
        for pno in targets:
            png = str(Path(tmp.name) / f"page_{pno:05d}.png")
            doc[pno - 1].render(scale=scale).to_pil().save(png)
            page_pngs.append((pno, png))

        results = ocr.predict(input=[png for _, png in page_pngs]) if page_pngs else []
        parts: list[str] = []
        n_chars = 0
        for (pno, _png), res in zip(page_pngs, results):
            page_lines = list(res["rec_texts"])
            n_chars += sum(len(l) for l in page_lines)
            parts.append(f"@@PAGE_{pno}@@\n" + "\n".join(page_lines))
    finally:
        tmp.cleanup()

    Path(out_path).write_text("\n".join(parts), encoding="utf-8")
    print(json.dumps({"pages": len(targets), "chars": n_chars}))


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit("用法: ocr_pdf.py <pdf路径> <输出txt路径> [页码列表]")
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
