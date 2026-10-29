"""全局配置：所有可调参数集中于 .env，参照文章"模块化、可直接落地生产"思路。"""
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = DATA_DIR / "uploads"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", env_file_encoding="utf-8", extra="ignore")

    # LLM
    llm_base_url: str = "http://localhost:11434/v1"
    llm_model: str = "qwen3:14b"
    llm_api_key: str = "ollama"
    temperature: float = 0.7
    disable_thinking: bool = True

    # Embedding
    embed_base_url: str = "http://localhost:11434/v1"
    embed_model: str = "bge-m3"
    embed_api_key: str = "ollama"

    # 知识库
    chroma_dir: str = str(DATA_DIR / "chroma")
    chunk_size: int = 500
    chunk_overlap: int = 80
    top_k: int = 6
    sim_threshold: float = 0.35
    # 跨语言检索：查询自动改写+中英互译，双路召回合并（中文问题可命中英文资料）
    cross_lingual: bool = True

    # OCR（扫描件自动识别，PaddleOCR PP-OCRv6 运行于独立 paddle 环境，页级自适应）
    ocr_enabled: bool = True
    ocr_python: str = "/home/zpmc/miniconda3/envs/paddle/bin/python"
    ocr_min_chars_per_page: int = 20  # 单页可提取字符低于此值才走 OCR（页级判定）
    ocr_timeout: int = 600
    ocr_model_size: str = "small"     # small=速度优先 / medium=精度优先
    ocr_scale: float = 1.5            # 页面渲染倍率（越大越清晰越慢）
    ocr_cpu_threads: int = 8

    # 页面快照：扫描页 + 矢量绘图密集页渲染为整页图（矢量架构图无法用位图提取获得）
    page_snapshots: bool = True
    snapshot_drawings: int = 40       # 单页矢量路径数达到该值视为图纸页
    snapshot_max: int = 60            # 单文档快照页数上限

    # 服务
    host: str = "0.0.0.0"
    port: int = 8000


settings = Settings()
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR.mkdir(parents=True, exist_ok=True)
(DATA_DIR / "images").mkdir(parents=True, exist_ok=True)  # PDF 内嵌图片，StaticFiles 挂载要求目录先存在
