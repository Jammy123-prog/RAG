# 变更与优化说明（CHANGELOG）

> 项目：Nexus KB —— 中小企业私有化知识库 RAG 系统
> 技术栈：Qwen3-14B-AWQ (vLLM) + bge-m3 (vLLM) + Chroma + LangChain + FastAPI + React
> 技术路线源自阿里云开发者社区《基于 LangChain + 通义千问 + Chroma 的本地知识库 RAG 问答系统》，
> 并吸收 RAGFlow / Dify / QAnything / langchain-chatchat 的工程实践。

---

## v1.1 —— 多用户与会话管理（2026-10-30）

参照 Dify / FastGPT 的多租户与会话模型：

- **用户认证**：注册/登录（HMAC-SHA256 签名令牌，7 天有效，零第三方依赖）；首个注册用户自动成为管理员；
  密码 PBKDF2 加盐哈希存储（`data/app.db` SQLite）
- **数据隔离**：会话与消息按用户隔离（A 无法读取/删除 B 的会话，越权返回 404）；提问历史服务端加载
- **会话管理**：新对话 / 历史会话列表（桌面侧边栏 + 移动端抽屉）/ 切换续聊 / 删除；标题自动取首问前 20 字；
  问答与引用来源（mode/sources）全部落库，刷新后可完整还原
- **文档权限**：知识库全员共享可检索；删除仅限管理员或上传者本人；文档列表支持搜索过滤
- **管理员面板**：用户列表/删除（级联清理其会话数据）
- 401 自动登出回登录页；文档删除按钮按权限显隐

---

## 一、系统架构（当前版本）

```
┌────────────────────┐  HTTP /api（SSE 流式） ┌─────────────────────────────────┐
│  React 前端 :5173   │ ─────────────────────▶ │  FastAPI 后端 :8010（conda RAG） │
│  概览/对话/知识库   │                        │  rag.py        检索增强编排       │
└────────────────────┘                        │  ingestion.py  解析/切分/向量化   │
                                              │  vectorstore.py Chroma + 注册表  │
                                              └───────┬──────────────┬──────────┘
                                                      │              │ OpenAI 兼容 API
                                        ┌─────────────▼───┐   ┌──────▼────────────┐
                                        │ vLLM :8000      │   │ vLLM :8001        │
                                        │ Qwen3-14B-AWQ   │   │ bge-m3 (1024维)   │
                                        │ 显存 85%        │   │ 显存 12%          │
                                        └─────────────────┘   └───────────────────┘
                                              （同一块 GPU，模型权重位于 ~/models/）
   扫描件 OCR（独立 paddle 环境 / CPU）：PP-OCRv6 (PaddleOCR 3.7.0) subprocess 按需调用
```

**conda 环境隔离**：`RAG`（Python 3.10 + Node 20，后端与前端工具链）、`RAG-vllm`（模型推理）、
`paddle`（OCR，已清理冗余依赖，仅保留 PaddleOCR + paddlepaddle CPU）。

---

## 二、功能演进时间线

### v0.1 —— 基础 RAG 全链路
- 文章五大生产特性落地：查询改写、LLM 兜底（相似度阈值）、引用溯源（[n] 标注）、SSE 流式输出、模块化配置（.env）
- 文档入库：pdf/docx/md/txt/csv/xlsx → 中文友好递归切分 → bge-m3 向量化 → Chroma（cosine 空间）
- 前端：玻璃拟态高端 UI（概览 Bento / 对话 / 知识库管理）

### v0.2 —— 模型服务落地（国内网络适配）
- Ollama 官方安装包不可用（新版改 .tar.zst 格式 + GitHub 直连限速 ~6KB/s）
- 改用 **vLLM 双服务**方案：Qwen3-14B-AWQ（ModelScope 下载）+ bge-m3（--runner pooling）
- 单卡 16GB 显存分配：LLM 85%（6K 上下文）+ Embedding 12%
- 规避两个上游 bug：flashinfer JIT 缺 ninja（装 ninja + 禁用 flashinfer 采样）、paddlepaddle 3.3.1 oneDNN PIR 转换错误（enable_mkldnn=False）

### v0.3 —— 扫描件 OCR（PP-OCRv6）
- `paddle` 环境清理：移除 YOLO/torch 全家桶等 35 个冗余包（~6GB → 867MB）
- 安装 PaddleOCR 3.7.0（最新模型系列 **PP-OCRv6**，small/medium 可选）
- 扫描件 PDF 自动检测（平均每页 < 20 字符）→ subprocess 调用 OCR → 带页码标记入库

### v0.4 —— 中英跨语言检索 + 图片呈现
- **双语多路召回**：一次 LLM 调用完成「查询改写 + 中英互译」，双查询并行检索、按分片去重合并——中文提问可命中英文资料，回答自动使用提问语言
- **图片呈现**：PDF 内嵌图片提取（>200px 过滤图标）、分片记录页码、命中时对应页图片随来源返回前端缩略图（点击看原图）

### v0.5 —— 性能优化（解析/切分/向量化提速）
| 环节 | 优化 | 250 页 / 36MB 实测 |
|---|---|---|
| PDF 解析 | pypdf → **PyMuPDF** | 15.2s → 1.0s（**14.9x**），文本提取更全 |
| OCR | 全文档 → **页级自适应**（仅无文字页）+ 批量推理 + small 模型 + 1.5x 渲染 | OCR 负载降 90%（250 页仅 25 页需 OCR） |
| 图片提取 | xref 去重 + 不解码尺寸预过滤 + 200 张上限 | 25,748 个内嵌对象秒级过滤 |
| 多文件上传 | 线程池并行（4 并发） | 吞吐 ~4x |
| **端到端** | | **约 15~30 分钟 → 86~93 秒** |

### v0.6 —— 健壮性与覆盖面修复
- **docx 表格解析**：会议纪要类文档内容全在表格（python-docx 的 paragraphs 拿不到）→ 段落 + 表格 + 文本框 XML 三层解析
- **矢量图纸呈现**：工程架构图多为矢量绘图（位图提取抓不到）→ 对扫描页 + 矢量绘图密集页（≥40 路径）渲染**整页快照**
- **页码续传**：页码标记只在页首，页中分片继承上一分片页码，全部来源可溯源到页

---

## 三、已修复的关键 Bug 清单

| Bug | 影响 | 修复 |
|---|---|---|
| `uuid.uuid4()[:8]` 直接切片 UUID 对象 | 网页上传全部失败 | `str(uuid.uuid4())[:8]` |
| 注册表与分片元数据使用两个不同 doc_id | 删除文档清不掉向量分片 | 统一为同一 doc_id，删除时按元数据清理 + 报错不静默 |
| `_render_page_snapshots` / `_extract_pdf_images` 未导入 pymupdf（NameError 被吞） | 快照与图片全部为 0 | 模块顶层 `import pymupdf` |
| OCR 输出无页码信息 | 扫描件分片无法关联页码 | OCR 脚本按页输出 `@@PAGE_n@@` 标记 |
| docx 纯表格文档解析为空 | 会议纪要无法入库 | 表格 + 文本框 XML 兜底解析 |

---

## 四、当前验证状态（2026-10-29）

- 知识库：250 页英文工程 LLD（595 分片 / 247 图片）+ 英文扫描件架构图 + 中文员工手册
- 跨语言：中文提问「网络架构图」→ 命中英文资料（0.732），来源带页码与 3 张图纸
- 兜底：知识库外问题自动切换 LLM 通用回答并标注
- 端到端入库：36MB / 250 页含 OCR 与图片提取共 86 秒

---

## 五、关键参数速查（.env）

| 参数 | 默认 | 说明 |
|---|---|---|
| `CROSS_LINGUAL` | true | 中英双语多路召回 |
| `CHUNK_SIZE / CHUNK_OVERLAP` | 500 / 80 | 切片大小 / 重叠 |
| `TOP_K / SIM_THRESHOLD` | 6 / 0.35 | 召回数 / 兜底阈值 |
| `OCR_MODEL_SIZE` | small | OCR 精度（medium 更准更慢） |
| `PAGE_SNAPSHOTS` | true | 矢量图纸页整页快照 |
| `SNAPSHOT_DRAWINGS / SNAPSHOT_MAX` | 40 / 60 | 图纸页判定阈值 / 快照上限 |

## 六、启动命令

```bash
bash scripts/start_models.sh                                    # vLLM 双服务（:8000/:8001）
/home/zpmc/miniconda3/envs/RAG/bin/uvicorn backend.app.main:app --port 8010   # 后端
cd frontend && PATH=/home/zpmc/miniconda3/envs/RAG/bin:$PATH npm run dev      # 前端 :5173
```

详见 `README.md`。
