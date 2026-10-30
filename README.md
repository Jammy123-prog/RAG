# Nexus KB —— 中小企业私有化知识库 RAG 系统

基于 **Qwen3-14B + bge-m3 + Chroma + LangChain + FastAPI** 的本地企业知识库问答系统。
技术路线源自阿里云开发者社区《基于 LangChain + 通义千问 + Chroma 的本地知识库 RAG 问答系统：从零到生产的完整实战》，并吸收了 GitHub 优质开源项目的最佳实践：

| 借鉴来源 | 吸收的实践 |
|---|---|
| [RAGFlow](https://github.com/infiniflow/ragflow) | 引用溯源、答案逐句标注来源 |
| [QAnything](https://github.com/netease-youdao/QAnything) | bge-m3 Embedding 选型、双模型架构 |
| [Dify](https://github.com/langgenius/dify) | 召回编排：查询改写 + 兜底策略 |
| [langchain-chatchat](https://github.com/chatchat-space/Langchain-Chatchat) | FastAPI 后端技术栈、全离线私有化部署 |

## 核心特性（对应文章五大生产级能力）

1. **查询改写** —— 多轮对话自动补全代词指代，提升检索召回
2. **LLM 兜底** —— 检索相似度低于阈值时自动切换大模型通用回答并明确标注
3. **引用溯源** —— 答案中 `[1][2]` 逐句标注来源，前端可视化展示匹配分数
4. **流式输出** —— SSE 增量返回，首字延迟低
5. **模块化结构** —— 配置、模型、向量库、入库、RAG 链、接口完全解耦，可直接落地生产

## 多用户与会话（v1.1）

- **登录认证**：首次访问进入登录页，注册即用；**首个注册用户自动成为管理员**
- **数据隔离**：每个用户的对话历史相互隔离（他人无法访问）；提问数据服务端按用户加载
- **会话管理**：对话自动保存（含引用来源），可开启新对话、按历史列表切换续聊、删除会话
- **知识库共享**：文档全员可检索；删除仅限上传者或管理员；列表支持搜索
- **管理员**：导航多一个「用户」页，可查看/删除用户（删除用户会级联清理其会话数据）
- 令牌 7 天有效，过期自动回登录页；数据库位于 `data/app.db`（SQLite，删除即重置用户体系）

## 架构

```
┌─────────────┐   ┌──────────────────────────────────────────┐
│  React 前端  │──▶│              FastAPI 后端                  │
│  玻璃拟态 UI │SSE│  查询改写 → 检索 → 阈值过滤 → 生成 → 溯源    │
└─────────────┘   └───────┬──────────────────────┬───────────┘
                          │                      │
                   ┌──────▼──────┐        ┌──────▼───────┐
                   │   Chroma    │        │ Qwen3-14B    │
                   │ (cosine空间) │        │ + bge-m3     │
                   │  本地向量库   │        │ Ollama / vLLM│
                   └─────────────┘        └──────────────┘
```

## 快速开始

### 1. 启动模型服务（已完成部署的机器直接运行）

```bash
bash scripts/start_models.sh     # Qwen3-14B-AWQ → :8000，bge-m3 → :8001（单卡 16GB 显存分配 85%+12%）
bash scripts/stop_models.sh      # 停止
```

模型权重存放于 `/home/zpmc/models/`（从 ModelScope 下载）。首次部署需准备：

```bash
conda create -n RAG-vllm python=3.10 -y
conda install -n RAG-vllm ninja -y
/home/zpmc/miniconda3/envs/RAG-vllm/bin/pip install vllm modelscope -i https://pypi.tuna.tsinghua.edu.cn/simple
/home/zpmc/miniconda3/envs/RAG-vllm/bin/modelscope download --model Qwen/Qwen3-14B-AWQ --local_dir /home/zpmc/models/Qwen3-14B-AWQ
/home/zpmc/miniconda3/envs/RAG-vllm/bin/modelscope download --model BAAI/bge-m3 --local_dir /home/zpmc/models/bge-m3
```

> 说明：本机 GitHub 直连被限速，Ollama 官方安装包（已改用 `.tar.zst` 新格式且重定向 GitHub）不可用，
> 故改用 **vLLM + ModelScope** 路线，效果等价且吞吐更高。若换用 Ollama，将 `.env` 的
> `LLM_BASE_URL/EMBED_BASE_URL` 指向 `http://localhost:11434/v1` 并 `ollama pull qwen3:14b bge-m3` 即可。

### 2. 启动后端（conda 环境 `RAG`，Python 3.10 + Node 20）

```bash
cd RAG
conda activate RAG
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple   # 已装好可跳过

uvicorn backend.app.main:app --host 0.0.0.0 --port 8010
```

### 3. 启动前端

```bash
cd frontend
npm install --registry=https://registry.npmmirror.com   # 已装好可跳过
npm run dev        # http://localhost:5173（/api 已代理到 8010）
```

### 4. 灌入知识并提问

```bash
conda activate RAG
python scripts/ingest_samples.py    # 或在前端「知识库」页拖拽上传 PDF/DOCX/MD/TXT/CSV/XLSX
```

然后到「对话」页提问，例如：*报销流程需要哪些单据？*（命中知识库，带 `[1]` 引用与来源卡片）
或：*量子计算的基本原理？*（未命中 → 自动切换 LLM 兜底并标注）。

## 硬件要求

| 配置 | 说明 |
|---|---|
| 最低 | 32GB 内存 + 24GB 显存（RTX 4090 / A10），Qwen3-14B 量化版 |
| 推荐 | 48GB+ 显存（如 2×A10 / A100-40G），FP16 全精度 |

## 目录结构

```
RAG/
├── backend/app/
│   ├── config.py       # 全部可调参数（.env）
│   ├── llm.py          # Qwen3-14B / bge-m3 封装（OpenAI 兼容，可切 Ollama/vLLM）
│   ├── vectorstore.py  # Chroma + 文档注册表
│   ├── ingestion.py    # 加载 → 中文切分 → 向量化 → 入库
│   ├── rag.py          # 查询改写/检索/兜底/溯源/流式（核心链路）
│   └── main.py         # FastAPI 接口（SSE / 上传 / 管理）
├── frontend/           # React + Vite + Tailwind（玻璃拟态高端 UI）
├── samples/            # 示例企业文档
├── scripts/            # 批量入库脚本
├── docker-compose.yml  # Ollama 一键拉起
└── requirements.txt
```

## 关键参数调优（.env）

| 参数 | 默认 | 说明 |
|---|---|---|
| `CHUNK_SIZE` / `CHUNK_OVERLAP` | 500 / 80 | 切片大小，制度类文档建议 400–600 |
| `TOP_K` | 6 | 召回分片数 |
| `SIM_THRESHOLD` | 0.35 | 相似度阈值，低于则触发 LLM 兜底 |
| `TEMPERATURE` | 0.7 | 生成温度，知识问答建议 0.3–0.7 |
| `DISABLE_THINKING` | true | 关闭 Qwen3 思考模式，RAG 场景响应更快 |
| `OCR_ENABLED` | true | 扫描件 PDF 自动 OCR 兜底 |
| `OCR_PYTHON` | paddle 环境 python | OCR 运行环境（PaddleOCR 3.7 + PP-OCRv6，CPU） |
| `OCR_MIN_CHARS_PER_PAGE` | 20 | 平均每页可提取字符低于此值判定为扫描件 |
| `OCR_TIMEOUT` | 600 | 单文档 OCR 超时（秒） |

## 性能优化（解析 / 切分 / 向量化加速）

参照 RAGFlow / Dify 的工程实践，针对大文档做了四层优化（250 页 / 36MB 实测 **93 秒全量入库**）：

| 环节 | 优化 | 实测收益 |
|---|---|---|
| PDF 解析 | pypdf → **PyMuPDF**（RAGFlow/Dify 同款） | 250 页 15.2s → **1.0s**（14.9x），且文本更全 |
| OCR | 全文档逐页 → **页级自适应**：仅对提不出文字的页面 OCR；批量推理；`OCR_MODEL_SIZE=small` + 1.5x 渲染 + 8 线程 | 250 页文档 OCR 负载降低 90%（仅 25 页需 OCR） |
| 图片提取 | pypdf 逐页解图 → PyMuPDF **xref 去重 + 不解码尺寸预过滤 + 200 张上限** | 25,748 个内嵌对象秒级过滤，图标/装饰不入库 |
| 多文件上传 | 串行 → **线程池并行**（最多 4 并发） | 多文件吞吐 ~4x |

精度与速度可调：`OCR_MODEL_SIZE=medium` + `OCR_SCALE=2.0` 可换更高 OCR 精度（更慢）。

## 跨语言检索与图片呈现

- **中英互译召回**（`CROSS_LINGUAL=true` 默认开启）：提问时一次 LLM 调用完成「查询改写 + 中英互译」，中/英双查询并行检索、按分片去重合并——中文提问可命中英文资料，回答自动使用提问语言并保留 `[n]` 引用标注
- **文档图片呈现**：入库时自动提取 PDF 内嵌图片（架构图、示意图，过滤 <100px 图标）至 `data/images/{doc_id}/`；分片记录页码，命中时对应页的图片随引用来源返回，前端来源卡片内渲染缩略图（点击看原图），服务地址 `/api/images/{doc_id}/p{页}_{序号}.jpg`

## 扫描件 OCR（PP-OCRv6）

上传的 PDF 若无可提取文本（扫描件/图片型），后端自动调用 **PaddleOCR PP-OCRv6**
（`paddle` conda 环境，CPU 运行，不与 vLLM 抢显存）完成识别后入库，全程对前端透明。

```
pypdf 提取文本 → 平均每页 < 20 字符？
    ├─ 否 → 正常文本入库
    └─ 是 → subprocess 调用 scripts/ocr_pdf.py（paddle 环境）
            pypdfium2 渲染页面(2x) → PP-OCRv6_medium 识别 → 文本入库
```

OCR 环境重建（换机器时）：

```bash
conda create -n paddle python=3.10 -y
/home/zpmc/miniconda3/envs/paddle/bin/pip install paddleocr paddlepaddle -i https://pypi.tuna.tsinghua.edu.cn/simple
# 首次运行自动下载 PP-OCRv6 模型至 ~/.paddlex/official_models/（国内源，速度快）
```

## 生产建议

- **高并发**：vLLM + `--enable-prefix-caching`，配合 Nginx 做 SSE 反代（关闭缓冲）
- **复杂 PDF/扫描件**：可接入 OCR（PaddleOCR）后再入库，参照 RAGFlow DeepDoc 思路
- **检索质量**：可叠加 bge-reranker-v2-m3 对 Top-K 重排（QAnything 方案）
- **权限**：中小企业单知识库够用；多部门隔离时按 collection 拆分并加鉴权
