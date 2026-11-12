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
    sim_threshold: float = 0.35        # 检索召回阈值：低于此分的分片不进入上下文
    strong_hit_threshold: float = 0.5  # 强命中阈值：最高分仍低于此值视为弱命中（误命中），回退模型兜底
    # 跨语言检索：查询自动改写+中英互译，双路召回合并（中文问题可命中英文资料）
    cross_lingual: bool = True

    # 知识图谱（Neo4j，新增模块）
    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = "nexuskb123"
    kg_entities_per_doc: int = 12  # 每份文档抽取的实体/概念数上限
    kg_sample_chunks: int = 8      # 每份文档参与抽取的分片采样数
    kg_max_entity_nodes: int = 60  # 可视化返回的实体节点数上限（按关联文档数排序）
    kg_enhance: bool = True             # 图增强检索：问题命中实体 → 邻居文档参与召回（RRF 融合）
    kg_graph_max_docs: int = 3          # 图增强时最多补充的邻居文档数
    kg_graph_chunks_per_doc: int = 2    # 每个邻居文档补充的分片数

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
    # CORS 白名单（逗号分隔）：填前端实际访问地址，如 http://192.168.1.99:5173
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"


settings = Settings()
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR.mkdir(parents=True, exist_ok=True)
(DATA_DIR / "images").mkdir(parents=True, exist_ok=True)  # PDF 内嵌图片，StaticFiles 挂载要求目录先存在
