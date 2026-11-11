import { useCallback, useEffect, useRef, useState } from 'react'
import * as echarts from 'echarts'
import DocumentPreview from '../components/DocumentPreview.jsx'
import { buildKgGraph, fetchKgEntity, fetchKgGraph, searchKgEntities } from '../lib/api'
import { setPendingAsk } from '../lib/askBus'
import { IconGraph, IconChat } from '../components/icons.jsx'

const CATEGORIES = [
  { name: '文档', itemStyle: { color: '#a78bfa' } },
  { name: '实体', itemStyle: { color: '#34d399' } },
]

function toOption(data, mode) {
  const docsOnly = mode === 'docs'
  const nodes = data.nodes.filter((n) => (docsOnly ? n.category === 0 : true))
  const nodeIds = new Set(nodes.map((n) => n.id))
  const links = data.links.filter((l) => nodeIds.has(l.source) && nodeIds.has(l.target))
  return {
    backgroundColor: 'transparent',
    tooltip: {
      backgroundColor: 'rgba(11,11,13,0.92)',
      borderColor: 'rgba(255,255,255,0.12)',
      textStyle: { color: 'rgba(255,255,255,0.85)', fontSize: 12 },
      formatter: (p) => {
        if (p.dataType === 'node') {
          if (p.data.category === 0) {
            const s = p.data.scope === 'private' ? '个人' : '公有'
            return `<b>${p.data.name}</b><br/>知识库：${s}${p.data.owner ? ` · 上传者 ${p.data.owner}` : ''}<br/>${p.data.chunks} 个知识分片<br/><span style="opacity:.55">点击查看详情</span>`
          }
          return `<b>${p.data.name}</b><br/>实体概念 · 关联 ${p.data.symbolSize > 13 ? Math.round((p.data.symbolSize - 10) / 3) : 1} 份文档<br/><span style="opacity:.55">点击查看原文片段</span>`
        }
        return p.data.kind === 'related'
          ? `两份文档共享 <b>${p.data.value}</b> 个实体概念`
          : '文档提及该实体'
      },
    },
    series: [
      {
        type: 'graph',
        layout: 'force',
        roam: true,
        draggable: true,
        categories: CATEGORIES,
        force: {
          repulsion: docsOnly ? 420 : 260,
          edgeLength: docsOnly ? [110, 240] : [70, 170],
          gravity: 0.08,
          layoutAnimation: true,
        },
        label: {
          show: true,
          color: 'rgba(255,255,255,0.75)',
          fontSize: docsOnly ? 13 : 11,
          formatter: (p) => (p.data.category === 0 || !docsOnly ? p.data.name : ''),
        },
        emphasis: {
          focus: 'adjacency',
          lineStyle: { width: 3 },
          label: { show: true, fontSize: 14, fontWeight: 'bold' },
        },
        scaleLimit: { min: 0.4, max: 4 },
        lineStyle: { opacity: 0.55, curveness: 0.12 },
        data: nodes.map((n) => ({
          ...n,
          itemStyle: n.category === 0
            ? { color: '#a78bfa', borderColor: 'rgba(255,255,255,0.35)', borderWidth: 1.5 }
            : { color: '#34d399', opacity: 0.85 },
        })),
        links: links.map((l) =>
          l.kind === 'related'
            ? { source: l.source, target: l.target, value: l.value, kind: l.kind,
                lineStyle: { type: 'dashed', color: 'rgba(167,139,250,0.45)', width: Math.min(1 + l.value * 0.6, 4) } }
            : { source: l.source, target: l.target, kind: l.kind,
                lineStyle: { color: 'rgba(255,255,255,0.1)', width: 1 } },
        ),
      },
    ],
  }
}

// ---------------- 详情侧栏 ----------------

function ScopeBadge({ scope }) {
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
      scope === 'private'
        ? 'bg-aura/10 text-aura ring-aura/25'
        : 'bg-white/[0.05] text-white/45 ring-white/[0.08]'
    }`}>
      {scope === 'private' ? '个人' : '公有'}
    </span>
  )
}

function EntityPanel({ name, onAsk, onOpenDoc, onClose }) {
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    setDetail(null)
    setError(null)
    fetchKgEntity(name)
      .then((d) => alive && setDetail(d))
      .catch((e) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [name])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-ember/80">ENTITY · 实体概念</p>
          <h3 className="mt-1.5 truncate text-xl font-bold text-white">{name}</h3>
          {detail && (
            <p className="mt-1 text-[12px] text-white/40">关联 {detail.doc_count} 份文档 · 点击下方片段可定位原文</p>
          )}
        </div>
        <button
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white/60 ring-1 ring-inset ring-white/[0.1] transition-all duration-500 ease-fluid hover:text-white active:scale-90"
          aria-label="关闭详情"
        >
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <path d="M2 2l10 10M12 2L2 12" />
          </svg>
        </button>
      </div>

      <button
        onClick={() => onAsk(`请结合知识库资料，详细介绍「${name}」的相关内容、要点与注意事项`)}
        className="mx-5 mt-4 flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-aura to-aura/70 py-3 text-[13px] font-semibold text-white shadow-[0_8px_24px_-8px_rgba(167,139,250,0.55)] transition-all duration-500 ease-fluid hover:shadow-[0_12px_32px_-8px_rgba(167,139,250,0.75)] active:scale-[0.97]"
      >
        <IconChat size={15} />
        就这个实体提问
      </button>

      <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-5">
        {error && <p className="text-[13px] text-red-300">{error}</p>}
        {!detail && !error && (
          <div className="flex gap-1.5 py-6 justify-center">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/40" style={{ animationDelay: `${i * 150}ms` }} />
            ))}
          </div>
        )}
        {detail?.docs?.map((d) => (
          <div key={d.doc_id} className="rounded-2xl bg-white/[0.03] p-3.5 ring-1 ring-inset ring-white/[0.06]">
            <div className="flex items-center gap-2">
              <button
                onClick={() => onOpenDoc({ doc_id: d.doc_id, name: d.name })}
                className="min-w-0 flex-1 truncate text-left text-[14px] font-medium text-white/85 transition-colors duration-500 hover:text-aura"
                title="点击打开原文"
              >
                {d.name}
              </button>
              <ScopeBadge scope={d.scope} />
            </div>
            {d.matches.length === 0 ? (
              <p className="mt-2 text-[12px] text-white/30">该文档提及此实体，但未解析出可展示的原文片段。</p>
            ) : (
              d.matches.map((m, i) => (
                <button
                  key={i}
                  onClick={() => onOpenDoc({ doc_id: d.doc_id, name: d.name })}
                  className="mt-2.5 block w-full rounded-xl bg-black/30 p-3 text-left ring-1 ring-inset ring-white/[0.05] transition-all duration-500 ease-fluid hover:bg-black/50 hover:ring-aura/25 active:scale-[0.995]"
                  title="点击查看全文"
                >
                  <p className="text-[12.5px] leading-relaxed text-white/60">
                    …{m.snippet}…
                  </p>
                  {m.pages.length > 0 && (
                    <p className="mt-1.5 text-[11px] text-ember/70">原文 · 第 {m.pages.join(',')} 页 · 点击查看全文</p>
                  )}
                </button>
              ))
            )}
          </div>
        ))}
        {detail && detail.docs.length === 0 && (
          <p className="text-[13px] text-white/35">未找到关联文档，可能图谱已过期，请点击「重建图谱」。</p>
        )}
      </div>
    </div>
  )
}

function DocPanel({ node, data, onAsk, onOpenEntity, onOpenDoc, onClose }) {
  const related = (data?.links || [])
    .filter((l) => l.kind === 'related' && (l.source === node.id || l.target === node.id))
    .map((l) => {
      const otherId = l.source === node.id ? l.target : l.source
      return { node: data.nodes.find((n) => n.id === otherId), shared: l.value }
    })
    .filter((r) => r.node)
  const entities = (data?.links || [])
    .filter((l) => l.kind === 'mentions' && l.source === node.id)
    .map((l) => l.target.replace(/^e:/, ''))

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-aura/80">DOCUMENT · 文档</p>
          <h3 className="mt-1.5 break-all text-xl font-bold leading-snug text-white">{node.name}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ScopeBadge scope={node.scope} />
            {node.owner && <span className="text-[12px] text-white/40">上传者 {node.owner}</span>}
            <span className="text-[12px] text-white/40">{node.chunks} 个知识分片</span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white/60 ring-1 ring-inset ring-white/[0.1] transition-all duration-500 ease-fluid hover:text-white active:scale-90"
          aria-label="关闭详情"
        >
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <path d="M2 2l10 10M12 2L2 12" />
          </svg>
        </button>
      </div>

      <div className="mx-5 mt-4 flex gap-2">
        <button
          onClick={() => onAsk(`请总结「${node.name}」这份文档的核心内容与要点`)}
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-aura to-aura/70 py-3 text-[13px] font-semibold text-white shadow-[0_8px_24px_-8px_rgba(167,139,250,0.55)] transition-all duration-500 ease-fluid hover:shadow-[0_12px_32px_-8px_rgba(167,139,250,0.75)] active:scale-[0.97]"
        >
          <IconChat size={15} />
          就这份文档提问
        </button>
        <button
          onClick={() => onOpenDoc({ doc_id: node.id, name: node.name })}
          className="flex items-center justify-center gap-2 rounded-2xl bg-white/[0.07] px-4 text-[13px] font-medium text-white/80 ring-1 ring-inset ring-white/[0.12] transition-all duration-500 ease-fluid hover:bg-white/[0.12] hover:text-white active:scale-[0.97]"
          title="打开文档原文"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 3h7v7M21 3l-9 9M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" />
          </svg>
          打开
        </button>
      </div>

      <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-5">
        {entities.length > 0 && (
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/30">核心实体 · {entities.length}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {entities.map((e) => (
                <button
                  key={e}
                  onClick={() => onOpenEntity(e)}
                  className="rounded-full bg-ember/[0.07] px-3 py-1 text-[12px] text-ember/90 ring-1 ring-inset ring-ember/20 transition-all duration-500 ease-fluid hover:bg-ember/[0.15] active:scale-[0.95]"
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}
        {related.length > 0 && (
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/30">关联文档 · {related.length}</p>
            <div className="mt-2 space-y-1.5">
              {related.map(({ node: rn, shared }) => (
                <button
                  key={rn.id}
                  onClick={() => onOpenDoc({ doc_id: rn.id, name: rn.name })}
                  className="flex w-full items-center gap-2 rounded-xl bg-white/[0.03] px-3.5 py-2.5 text-left ring-1 ring-inset ring-white/[0.06] transition-all duration-500 ease-fluid hover:bg-white/[0.07] hover:ring-aura/25 active:scale-[0.995]"
                  title="点击打开文档"
                >
                  <p className="min-w-0 flex-1 truncate text-[13px] text-white/70">{rn.name}</p>
                  <span className="shrink-0 text-[11px] text-white/30">共享 {shared} 个实体</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {entities.length === 0 && related.length === 0 && (
          <p className="text-[13px] text-white/35">该文档暂无实体与关联，建议「重建图谱」。</p>
        )}
      </div>
    </div>
  )
}

export default function GraphView({ onAsk }) {
  const [data, setData] = useState(null)
  const [mode, setMode] = useState('docs') // docs=文档关联 / full=文档+实体
  const [toast, setToast] = useState(null)
  const [building, setBuilding] = useState(false)
  // 详情面板：null | {type:'entity', name} | {type:'doc', node}
  const [panel, setPanel] = useState(null)
  const [preview, setPreview] = useState(null)
  // 实体搜索
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null) // null=未搜索 / []=无结果 / [{name,deg}]
  const [searching, setSearching] = useState(false)
  const chartRef = useRef(null)
  const chartInst = useRef(null)

  const refresh = useCallback(async () => {
    try {
      const d = await fetchKgGraph()
      setData(d)
      setBuilding(d?.status?.state === 'running')
    } catch {
      /* 后端未启动时静默 */
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // 构建期间轮询进度
  useEffect(() => {
    if (!building) return
    const t = setInterval(refresh, 2500)
    return () => clearInterval(t)
  }, [building, refresh])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  // 实体搜索（防抖）
  useEffect(() => {
    if (!query.trim()) {
      setResults(null)
      return
    }
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        setResults(await searchKgEntities(query.trim()))
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  // 渲染图表 + 节点点击 → 详情面板
  useEffect(() => {
    if (!chartRef.current) return
    if (!chartInst.current) {
      chartInst.current = echarts.init(chartRef.current)
      const onResize = () => chartInst.current?.resize()
      window.addEventListener('resize', onResize)
    }
    chartInst.current.on('click', (p) => {
      if (p.dataType !== 'node') return
      if (p.data.category === 1) setPanel({ type: 'entity', name: p.data.name })
      else setPanel({ type: 'doc', node: p.data })
    })
    if (data?.nodes?.length) {
      chartInst.current.setOption(toOption(data, mode), true)
    }
  }, [data, mode])

  useEffect(() => () => {
    chartInst.current?.dispose()
    chartInst.current = null
  }, [])

  // 选中实体：定位节点（高亮邻接 + 提示）并打开详情
  const focusEntity = (name) => {
    setResults(null)
    setQuery('')
    setPanel({ type: 'entity', name })
    if (!chartInst.current || !data?.nodes) return
    const idx = data.nodes.findIndex((n) => n.id === `e:${name}`)
    if (idx < 0) return
    try {
      chartInst.current.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: idx })
    } catch {
      /* 忽略 */
    }
  }

  const rebuild = async () => {
    try {
      await buildKgGraph()
      setBuilding(true)
      setToast({ ok: true, text: '已开始构建知识图谱：抽取实体 → 写入 Neo4j → 生成文档关联' })
      setTimeout(refresh, 1200)
    } catch (e) {
      setToast({ ok: false, text: e.message })
    }
  }

  const closePanel = () => setPanel(null)

  const hasGraph = data?.nodes?.length > 0
  const status = data?.status || {}

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-28">
      <span className="animate-reveal rounded-full bg-white/[0.04] px-3.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.25em] text-white/50 ring-1 ring-inset ring-white/[0.08]">
        KNOWLEDGE GRAPH
      </span>
      <h1 className="mt-6 animate-reveal text-4xl font-bold tracking-tight text-white [animation-delay:100ms] md:text-5xl">
        知识图谱
      </h1>
      <p className="mt-4 animate-reveal text-[16px] text-white/40 [animation-delay:200ms]">
        文档关联网络 + 实体导航：点击节点查看关联文档与原文片段，实体可一键提问；
        命中的实体还会作为一路候选参与问答召回（RRF 融合）。
      </p>

      {/* 工具栏：模式切换 + 实体搜索 */}
      <div className="mt-8 flex animate-reveal flex-wrap items-center gap-3 [animation-delay:250ms]">
        <div className="flex rounded-full bg-white/[0.04] p-1 ring-1 ring-inset ring-white/[0.08]">
          {[
            { key: 'docs', label: '文档关联' },
            { key: 'full', label: '文档 + 实体' },
          ].map((o) => (
            <button
              key={o.key}
              onClick={() => setMode(o.key)}
              className={`rounded-full px-4 py-2 text-[13px] font-medium transition-all duration-500 ease-fluid active:scale-[0.97] ${
                mode === o.key
                  ? 'bg-white/[0.09] text-white ring-1 ring-inset ring-white/[0.12]'
                  : 'text-white/40 hover:text-white/75'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        {/* 实体搜索 */}
        <div className="relative">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索实体，如 MQTT、报销…"
            className="w-56 rounded-full bg-white/[0.05] px-4 py-2 text-[13px] text-white/85 outline-none ring-1 ring-inset ring-white/[0.09] transition-all duration-500 ease-fluid placeholder:text-white/25 focus:w-72 focus:ring-aura/40"
          />
          {results !== null && (
            <div className="absolute left-0 top-11 z-20 w-72 animate-reveal overflow-hidden rounded-2xl bg-[#0b0b0d]/95 ring-1 ring-white/[0.1] backdrop-blur-2xl">
              {results.length === 0 ? (
                <p className="px-4 py-3 text-[12px] text-white/35">
                  {searching ? '搜索中…' : `没有匹配「${query}」的实体`}
                </p>
              ) : (
                results.map((r) => (
                  <button
                    key={r.name}
                    onClick={() => focusEntity(r.name)}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors duration-300 hover:bg-white/[0.06]"
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full bg-ember" />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-white/80">{r.name}</span>
                    <span className="shrink-0 text-[11px] text-white/30">{r.deg} 份文档</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        <span className="text-[12px] text-white/30">
          {status.state === 'running'
            ? `构建中 ${status.done}/${status.total}…`
            : hasGraph
              ? `${data.nodes.filter((n) => n.category === 0).length} 份文档 · ${data.nodes.filter((n) => n.category === 1).length} 个实体 · ${data.links.filter((l) => l.kind === 'related').length} 条关联`
              : status.state === 'error'
                ? `构建失败：${status.message}`
                : '暂无图谱数据'}
        </span>
        <button
          onClick={rebuild}
          disabled={building}
          className="ml-auto flex items-center gap-2 rounded-full bg-gradient-to-br from-aura to-aura/70 px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_8px_24px_-8px_rgba(167,139,250,0.55)] transition-all duration-500 ease-fluid hover:shadow-[0_12px_32px_-8px_rgba(167,139,250,0.75)] active:scale-[0.97] disabled:opacity-40 disabled:shadow-none"
        >
          <IconGraph size={15} />
          {building ? '构建中…' : hasGraph ? '重建图谱' : '构建图谱'}
        </button>
      </div>

      {/* 图谱画布（Double-Bezel）+ 详情侧栏 */}
      <div className="mt-6 animate-reveal rounded-[2rem] bg-white/[0.04] p-2 ring-1 ring-white/[0.07] [animation-delay:300ms]">
        <div className="relative h-[68dvh] min-h-[26rem] overflow-hidden rounded-[calc(2rem-0.5rem)] bg-[#0b0b0d] shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]">
          {data && !data.available ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-[1.2rem] bg-white/[0.05] text-white/40 ring-1 ring-inset ring-white/[0.08]">
                <IconGraph size={24} />
              </span>
              <p className="text-[15px] font-semibold text-white/80">Neo4j 未连接</p>
              <p className="max-w-md text-[13px] leading-relaxed text-white/35">
                启动 Neo4j 后点击「构建图谱」即可生成知识图谱：
                <br />
                <code className="mt-2 inline-block rounded-lg bg-white/[0.06] px-3 py-1.5 text-[12px] text-aura">docker compose up -d neo4j</code>
              </p>
            </div>
          ) : hasGraph ? (
            <div ref={chartRef} className="h-full w-full" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-[1.2rem] bg-white/[0.05] text-white/40 ring-1 ring-inset ring-white/[0.08]">
                <IconGraph size={24} />
              </span>
              <p className="text-[15px] font-semibold text-white/80">
                {status.state === 'running' ? '正在抽取实体并写入 Neo4j…' : '还没有图谱数据'}
              </p>
              <p className="max-w-md text-[13px] leading-relaxed text-white/35">
                {status.state === 'running'
                  ? '每份文档会调用一次 LLM 抽取核心实体，完成后自动刷新。'
                  : '先在知识库上传文档，然后点击上方「构建图谱」生成文档关联网络。'}
              </p>
            </div>
          )}

          {/* 详情侧栏（滑入） */}
          {panel && (
            <div className="animate-reveal absolute inset-y-0 right-0 z-20 w-full max-w-md border-l border-white/[0.08] bg-[#0b0b0d]/95 backdrop-blur-2xl">
              {panel.type === 'entity' ? (
                <EntityPanel name={panel.name} onAsk={onAsk} onOpenDoc={setPreview} onClose={closePanel} />
              ) : (
                <DocPanel
                  node={panel.node}
                  data={data}
                  onAsk={onAsk}
                  onOpenDoc={setPreview}
                  onOpenEntity={(name) => setPanel({ type: 'entity', name })}
                  onClose={closePanel}
                />
              )}
            </div>
          )}

          {/* 图例 */}
          {hasGraph && !panel && (
            <div className="absolute bottom-4 left-4 flex items-center gap-4 rounded-full bg-black/50 px-4 py-2 text-[12px] text-white/60 ring-1 ring-inset ring-white/[0.08] backdrop-blur-xl">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-aura" /> 文档
              </span>
              {mode === 'full' && (
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-ember" /> 实体
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-px w-4 border-t border-dashed border-aura/60" /> 文档关联
              </span>
            </div>
          )}
        </div>
      </div>

      {preview && <DocumentPreview doc={preview} onClose={() => setPreview(null)} />}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2 animate-reveal">
          <div
            className={`max-w-[90vw] rounded-full p-1 ring-1 backdrop-blur-2xl ${
              toast.ok ? 'bg-ember/[0.08] ring-ember/25' : 'bg-red-400/[0.08] ring-red-400/25'
            }`}
          >
            <p className={`truncate rounded-full px-5 py-2 text-[13px] ${toast.ok ? 'text-ember' : 'text-red-300'}`}>
              {toast.text}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
