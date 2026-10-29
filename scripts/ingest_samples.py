#!/usr/bin/env python3
"""批量入库 samples/ 目录下的示例文档，用于快速验证效果。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.app import ingestion  # noqa: E402

if __name__ == "__main__":
    sample_dir = Path(__file__).resolve().parent.parent / "samples"
    for f in sorted(sample_dir.iterdir()):
        if f.suffix.lower() in ingestion.SUPPORTED:
            info = ingestion.ingest_file(f)
            print(f"[OK] {info['name']} → {info['chunks']} 个分片已入库")
    print("\n完成。现在可以启动前端提问，例如：公司年假政策是怎样的？")
