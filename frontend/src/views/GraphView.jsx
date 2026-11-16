import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as echarts from 'echarts'
import DocumentPreview from '../components/DocumentPreview.jsx'
import { buildKgGraph, fetchFolders, fetchKgEntity, fetchKgGraph, searchKgEntities } from '../lib/api'
import { setPendingAsk } from '../lib/askBus'
import { IconGraph, IconChat } from '../components/icons.jsx'

const CATEGORIES = [
  { name: '文档', itemStyle: { color: '#a78bfa' } },
  { name: '实体', itemStyle: { color: '#34d399' } },
  { name: '关联文档', itemStyle: { color: '#94a3b8' } },
]

const DOC_COLOR = '#a78bfa'      // 当前范围内的文档
const ENTITY_COLOR = '#34d399'   // 实体
const BRIDGE_COLOR = '#fbbf24'   // 桥接实体（其他文件夹也提及）
const EXTERNAL_COLOR = '#94a3b8' // 关联文件夹里的文档

const UNFILED = '__unfiled__'

// 文件名/实体名过长会把画布糊成一片：折成多行 + 只在真的放不下时才截断
const wrap = (s, perLine, lines = 2) => {
  const text = (s || '').trim()
  const max = perLine * lines
  const cut = text.length > max ? `${text.slice(0, max - 1)}…` : text
  const out = []
  for (let i = 0; i < cut.length && out.length < lines; i += perLine) {
    out.push(cut.slice(i, i + perLine))
  }
  return out.join('\n')
}

function toOption(data, mode) {
  const docsOnly = mode === 'docs'
  // 「文档关联」模式保留范围文档与关联文件夹文档，只隐藏实体
  const nodes = data.nodes.filter((n) => (docsOnly ? n.category !== 1 : true))
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
          if (p.data.category === 2) {
            return `<b>${p.data.name}</b><br/>关联文件夹的文档${p.data.folder ? ` · ${p.data.folder}` : ''}<br/>与当前范围共享 ${p.data.shared_links} 个实体<br/><span style="opacity:.55">点击查看详情</span>`
          }
          if (p.data.category === 0) {
            const s = p.data.scope === 'private' ? '个人' : '公有'
            return `<b>${p.data.name}</b><br/>知识库：${s}${p.data.folder ? ` · ${p.data.folder}` : ' · 未分组'}${p.data.owner ? ` · 上传者 ${p.data.owner}` : ''}<br/>${p.data.chunks} 个知识分片<br/><span style="opacity:.55">点击查看详情</span>`
          }
          const bridge = p.data.bridge
            ? `<br/><span style="color:${BRIDGE_COLOR}">桥接实体：另有 ${p.data.external_deg} 份其他文件夹文档提及</span>`
            : ''
          return `<b>${p.data.name}</b><br/>实体概念 · 关联 ${p.data.deg} 份文档${bridge}<br/><span style="opacity:.55">点击查看原文片段</span>`
        }
        if (p.data.kind === 'related') {
          return p.data.cross
            ? `跨文件夹关联 · 共享 <b>${p.data.value}</b> 个实体`
            : `同范围文档共享 <b>${p.data.value}</b> 个实体概念`
        }
        return '文档提及该实体'
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
          repulsion: docsOnly ? 900 : 360,
          edgeLength: docsOnly ? [150, 300] : [80, 190],
          gravity: docsOnly ? 0.05 : 0.08,
          layoutAnimation: true,
        },
        label: {
          show: true,
          position: 'bottom',
          distance: 7,
          color: 'rgba(255,255,255,0.62)',
          fontSize: docsOnly ? 11.5 : 10.5,
          lineHeight: docsOnly ? 15 : 14,
          align: 'center',
          // 文档名最多两行（约 36 字），实体名最多两行（约 20 字）
          formatter: (p) => {
            if (p.data.category === 0 || p.data.category === 2) return wrap(p.data.name, docsOnly ? 18 : 14)
            return docsOnly ? '' : wrap(p.data.name, 10)
          },
        },
        // 密集图里先上下错开标签，仍遮挡再隐藏，避免硬挤在一起
        labelLayout: { hideOverlap: true, moveOverlap: 'shiftY' },
        emphasis: {
          focus: 'adjacency',
          lineStyle: { width: 3 },
          // 悬停/选中时展示完整名称，不再截断
          label: {
            show: true,
            fontSize: 12.5,
            fontWeight: 'bold',
            position: 'bottom',
            color: 'rgba(255,255,255,0.92)',
            formatter: (p) => p.data.name,
          },
        },
        scaleLimit: { min: 0.4, max: 4 },
        lineStyle: { opacity: 0.55, curveness: 0.12 },
        data: nodes.map((n) => ({
          ...n,
          itemStyle:
            n.category === 0
              ? { color: DOC_COLOR, borderColor: 'rgba(255,255,255,0.35)', borderWidth: 1.5 }
              : n.category === 2
                ? { color: EXTERNAL_COLOR, opacity: 0.7, borderColor: 'rgba(148,163,184,0.6)', borderWidth: 1.5, borderType: 'dashed' }
                : n.bridge
                  ? { color: BRIDGE_COLOR, borderColor: 'rgba(251,191,36,0.65)', borderWidth: 1.5 }
                  : { color: ENTITY_COLOR, opacity: 0.85 },
          label:
            n.category === 2
              ? { color: 'rgba(255,255,255,0.4)' }
              : n.bridge
                ? { color: 'rgba(251,191,36,0.85)' }
                : undefined,
        })),
        links: links.map((l) =>
          l.kind === 'related'
            ? { source: l.source, target: l.target, value: l.value, kind: l.kind, cross: l.cross,
                lineStyle: l.cross
                  ? { type: 'dotted', color: 'rgba(148,163,184,0.5)', width: Math.min(1 + l.value * 0.5, 3) }
                  : { type: 'dashed', color: 'rgba(167,139,250,0.45)', width: Math.min(1 + l.value * 0.6, 4) } }
            : { source: l.source, target: l.target, kind: l.kind,
                lineStyle: { color: 'rgba(255,255,255,0.1)', width: 1 } },
        ),
      },
    ],
  }
}

// ---------------- 文件夹范围选择器 ----------------

function useFolderOptions(folders) {
  return useMemo(() => {
    const byParent = new Map()
    for (const f of folders) {
      const p = f.parent_id || ''
      if (!byParent.has(p)) byParent.set(p, [])
      byParent.get(p).push(f)
    }
    const memo = new Map()
    const total = (id) => {
      if (memo.has(id)) return memo.get(id)
      const self = folders.find((f) => f.id === id)
      let n = self?.count || 0
      for (const c of byParent.get(id) || []) n += total(c.id)
      memo.set(id, n)
      return n
    }
    const out = []
    const walk = (parent, depth) => {
      const kids = [...(byParent.get(parent) || [])].sort((a, b) =>
        (a.name || '').localeCompare(b.name || '', 'zh'),
      )
      for (const f of kids) {
        out.push({ id: f.id, name: f.name, depth, count: total(f.id) })
        walk(f.id, depth + 1)
      }
    }
    walk('', 0)
    return out
  }, [folders])
}

function PickerRow({ active, onClick, depth = 0, name, count, hint }) {
  return (
    <button
      onClick={onClick}
      className={`group flex w-full items-center gap-2 rounded-xl py-2 pr-3 text-left transition-colors duration-200 ${
        active ? 'bg-aura/[0.12]' : 'hover:bg-white/[0.05]'
      }`}
      style={{ paddingLeft: `${10 + depth * 14}px` }}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? 'bg-aura' : 'bg-white/15 group-hover:bg-white/35'}`} />
      <span className={`min-w-0 flex-1 truncate text-[13px] ${active ? 'text-aura' : 'text-white/75'}`}>{name}</span>
      {hint && <span className="shrink-0 text-[11px] text-white/25">{hint}</span>}
      {count != null && (
        <span className={`shrink-0 tabular-nums text-[11px] ${active ? 'text-aura/70' : 'text-white/25'}`}>
          {count}
        </span>
      )}
    </button>
  )
}

function FolderPicker({ options, value, onChange }) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = value === UNFILED
    ? '未分组文档'
    : options.find((o) => o.id === value)?.name || '全部文档'

  const pick = (id) => {
    onChange(id)
    setOpen(false)
  }

  return (
    <div ref={boxRef} className="relative z-40">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex max-w-[15rem] items-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium ring-1 ring-inset transition-all duration-500 ease-fluid active:scale-[0.97] ${
          value
            ? 'bg-aura/10 text-aura ring-aura/30'
            : 'bg-white/[0.05] text-white/60 ring-white/[0.09] hover:text-white/85'
        }`}
        title="选择图谱范围：同一文件夹下的文档关联更强"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
        </svg>
        <span className="truncate">{current}</span>
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className={`shrink-0 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}>
          <path d="M2 4l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-11 z-50 w-80 animate-reveal overflow-hidden rounded-2xl bg-[#0b0b0d] shadow-[0_28px_70px_-24px_rgba(0,0,0,0.95)] ring-1 ring-white/[0.1]">
          <div className="flex items-baseline justify-between px-4 pb-1.5 pt-3">
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/30">图谱范围</p>
            <p className="text-[10.5px] text-white/25">同文件夹关联更密</p>
          </div>
          <div className="max-h-72 overflow-y-auto px-1.5 pb-1.5">
            <PickerRow active={value === ''} onClick={() => pick('')} name="全部文档" hint="含所有文件夹" />
            <PickerRow active={value === UNFILED} onClick={() => pick(UNFILED)} name="未分组文档" />
            {options.length > 0 && (
              <>
                <div className="my-1 h-px bg-white/[0.07]" />
                <p className="px-2.5 pb-1 pt-1 text-[10px] font-medium uppercase tracking-[0.2em] text-white/25">
                  知识库文件夹
                </p>
                {options.map((o) => (
                  <PickerRow
                    key={o.id}
                    active={value === o.id}
                    onClick={() => pick(o.id)}
                    depth={o.depth}
                    name={o.name}
                    count={o.count}
                  />
                ))}
              </>
            )}
            {options.length === 0 && (
              <p className="px-3 py-2.5 text-[12px] text-white/30">还没有文件夹，可先在知识库新建</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
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
      return { node: data.nodes.find((n) => n.id === otherId), shared: l.value, cross: l.cross }
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
            {node.folder ? (
              <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[11px] text-white/45 ring-1 ring-inset ring-white/[0.08]">
                {node.folder}
              </span>
            ) : (
              <span className="rounded-full bg-white/[0.03] px-2 py-0.5 text-[11px] text-white/30 ring-1 ring-inset ring-white/[0.06]">
                未分组
              </span>
            )}
            {node.owner && <span className="text-[12px] text-white/40">上传者 {node.owner}</span>}
            <span className="text-[12px] text-white/40">{node.chunks} 个知识分片</span>
          </div>
          {node.in_scope === false && (
            <p className="mt-2 rounded-xl bg-white/[0.03] px-3 py-2 text-[12px] text-white/45 ring-1 ring-inset ring-white/[0.06]">
              该文档不在当前范围，是因为它与当前范围内的文档共享了 {node.shared_links} 个实体
            </p>
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
              {related.map(({ node: rn, shared, cross }) => (
                <button
                  key={rn.id}
                  onClick={() => onOpenDoc({ doc_id: rn.id, name: rn.name })}
                  className="flex w-full items-center gap-2 rounded-xl bg-white/[0.03] px-3.5 py-2.5 text-left ring-1 ring-inset ring-white/[0.06] transition-all duration-500 ease-fluid hover:bg-white/[0.07] hover:ring-aura/25 active:scale-[0.995]"
                  title="点击打开文档"
                >
                  <p className="min-w-0 flex-1 truncate text-[13px] text-white/70">{rn.name}</p>
                  <span className="shrink-0 text-[11px] text-white/30">
                    {cross ? '跨文件夹 · ' : ''}共享 {shared} 个实体
                  </span>
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

export default function GraphView({ onAsk, user }) {
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
  // 图谱范围：'' 全库 / UNFILED 未分组 / 文件夹 id（含子文件夹）
  const [folders, setFolders] = useState([])
  const [folderId, setFolderId] = useState('')
  const [includeExternal, setIncludeExternal] = useState(true)
  const chartRef = useRef(null)
  const chartInst = useRef(null)

  const folderOptions = useFolderOptions(folders)

  const refresh = useCallback(async () => {
    try {
      const d = await fetchKgGraph({ folderId, includeExternal })
      setData(d)
      setBuilding(d?.status?.state === 'running')
    } catch {
      /* 后端未启动时静默 */
    }
  }, [folderId, includeExternal])

  useEffect(() => {
    refresh()
  }, [refresh])

  // 文件夹列表（范围选择器的选项，带文档数）
  useEffect(() => {
    fetchFolders()
      .then((list) => setFolders(Array.isArray(list) ? list : []))
      .catch(() => setFolders([]))
  }, [])

  // 切换范围后旧面板里的节点可能已不在图上
  useEffect(() => {
    setPanel(null)
  }, [folderId, includeExternal])

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
    // 切换范围时空状态会换占位符，旧实例挂在已移除的 DOM 上，必须重建
    if (chartInst.current && chartInst.current.getDom() !== chartRef.current) {
      chartInst.current.dispose()
      chartInst.current = null
    }
    if (!chartInst.current) chartInst.current = echarts.init(chartRef.current)
    chartInst.current.off('click')
    chartInst.current.on('click', (p) => {
      if (p.dataType !== 'node') return
      if (p.data.category === 1) setPanel({ type: 'entity', name: p.data.name })
      else setPanel({ type: 'doc', node: p.data })
    })
    if (data?.nodes?.length) {
      chartInst.current.setOption(toOption(data, mode), true)
      // 首帧容器高度可能还没稳定，重算一次尺寸，避免力导向布局把节点挤到画布一角
      requestAnimationFrame(() => chartInst.current?.resize())
    }
  }, [data, mode])

  useEffect(() => {
    const onResize = () => chartInst.current?.resize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

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
      const r = await buildKgGraph(folderId)
      setBuilding(true)
      setToast({
        ok: true,
        text: `已开始构建「${r?.scope || scopeLabel}」：抽取实体 → 写入 Neo4j → 生成文档关联`,
      })
      setTimeout(refresh, 1200)
    } catch (e) {
      setToast({ ok: false, text: e.message })
    }
  }

  const closePanel = () => setPanel(null)

  const hasGraph = data?.nodes?.length > 0
  const status = data?.status || {}
  const scope = data?.scope || {}
  const scopeLabel = scope.label || '全部文档'
  const scoped = !!folderId
  const docsInGraph = data ? data.nodes.filter((n) => n.category === 0).length : 0
  const externalDocs = data ? data.nodes.filter((n) => n.category === 2).length : 0

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-28">
      <span className="animate-reveal rounded-full bg-white/[0.04] px-3.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.25em] text-white/50 ring-1 ring-inset ring-white/[0.08]">
        KNOWLEDGE GRAPH
      </span>
      <h1 className="mt-6 animate-reveal text-4xl font-bold tracking-tight text-white [animation-delay:100ms] md:text-5xl">
        知识图谱
      </h1>
      <p className="mt-4 animate-reveal text-[16px] text-white/40 [animation-delay:200ms]">
        选一个文件夹只看这个业务域的关联网络（同目录文档共享上下文，关联更密）；
        跨文件夹共享的实体会被标为桥接，点击节点可查看关联文档与原文片段，实体还能一键提问。
      </p>

      {/* 工具栏：范围选择 + 模式切换 + 实体搜索（relative z-30：让下拉盖住下方画布） */}
      <div className="relative z-30 mt-8 flex animate-reveal flex-wrap items-center gap-3 [animation-delay:250ms]">
        <FolderPicker options={folderOptions} value={folderId} onChange={setFolderId} />
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
            ? `构建中（${status.scope?.label || '全部文档'}）${status.done}/${status.total}…`
            : hasGraph
              ? `${docsInGraph} 份文档 · ${data.nodes.filter((n) => n.category === 1).length} 个实体 · ${data.links.filter((l) => l.kind === 'related' && !l.cross).length} 条关联`
              : status.state === 'error'
                ? `构建失败：${status.message}`
                : '暂无图谱数据'}
        </span>
        {/* 构建会消耗 LLM 额度并影响他人查询，仅管理员可见；按文件夹只重建该范围 */}
        {user?.role === 'admin' && (
          <button
            onClick={rebuild}
            disabled={building}
            className="ml-auto flex items-center gap-2 rounded-full bg-gradient-to-br from-aura to-aura/70 px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_8px_24px_-8px_rgba(167,139,250,0.55)] transition-all duration-500 ease-fluid hover:shadow-[0_12px_32px_-8px_rgba(167,139,250,0.75)] active:scale-[0.97] disabled:opacity-40 disabled:shadow-none"
            title={scoped ? `只重建「${scopeLabel}」内的文档，其他文件夹图谱不受影响` : '全量重建：逐份文档调用 LLM 抽取实体'}
          >
            <IconGraph size={15} />
            {building
              ? '构建中…'
              : scoped
                ? hasGraph ? '重建此范围' : '构建此范围'
                : hasGraph ? '重建图谱' : '构建图谱'}
          </button>
        )}
      </div>

      {/* 范围说明条：选文件夹后给出可解释的数字与跨文件夹桥接 */}
      {scoped && (
        <div className="mt-4 flex animate-reveal flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl bg-white/[0.03] px-5 py-3 ring-1 ring-inset ring-white/[0.06]">
          <span className="flex items-center gap-2 text-[13px] text-white/70">
            <span className="h-2 w-2 rounded-full bg-aura" />
            {scopeLabel}
            {scope.subfolder_count > 0 && (
              <span className="text-[12px] text-white/35">含 {scope.subfolder_count} 个子文件夹</span>
            )}
          </span>
          <span className="text-[12px] text-white/40">
            {scope.registry_documents ?? 0} 份文档 · 已入图 {docsInGraph}
            {scope.pending > 0 && (
              <span className="text-ember/80"> · {scope.pending} 份待构建</span>
            )}
          </span>
          {scope.bridge_entities > 0 && (
            <span className="flex items-center gap-1.5 text-[12px] text-white/50">
              <span className="h-2 w-2 rounded-full" style={{ background: BRIDGE_COLOR }} />
              {scope.bridge_entities} 个桥接实体（其他文件夹也提及）
            </span>
          )}
          {(scope.external_documents_total > 0 || externalDocs > 0) && (
            <button
              onClick={() => setIncludeExternal((v) => !v)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] ring-1 ring-inset transition-all duration-500 ease-fluid active:scale-[0.97] ${
                includeExternal
                  ? 'bg-white/[0.07] text-white/75 ring-white/[0.12]'
                  : 'text-white/40 ring-white/[0.08] hover:text-white/70'
              }`}
              title="显示与当前范围共享实体的其他文件夹文档（虚线连出）"
            >
              <span className="h-2 w-2 rounded-full" style={{ background: EXTERNAL_COLOR }} />
              {includeExternal
                ? `关联文件夹文档 ${externalDocs}`
                : `显示关联文件夹文档（${scope.external_documents_total}）`}
            </button>
          )}
        </div>
      )}

      {/* 图谱画布（Double-Bezel）+ 详情侧栏 */}
      <div className="relative z-0 mt-6 animate-reveal rounded-[2rem] bg-white/[0.04] p-2 ring-1 ring-white/[0.07] [animation-delay:300ms]">
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
                {status.state === 'running'
                  ? '正在抽取实体并写入 Neo4j…'
                  : scoped
                    ? `「${scopeLabel}」还没有图谱数据`
                    : '还没有图谱数据'}
              </p>
              <p className="max-w-md text-[13px] leading-relaxed text-white/35">
                {status.state === 'running'
                  ? `每份文档会调用一次 LLM 抽取核心实体（${status.scope?.label || '全部文档'} ${status.done}/${status.total}），完成后自动刷新。`
                  : scoped
                    ? '点击右上角「构建此范围」只为这个文件夹（含子文件夹）建图，不会重跑其他文件夹。'
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
            <div className="absolute bottom-4 left-4 flex flex-wrap items-center gap-4 rounded-full bg-black/50 px-4 py-2 text-[12px] text-white/60 ring-1 ring-inset ring-white/[0.08] backdrop-blur-xl">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-aura" /> 文档
              </span>
              {mode === 'full' && (
                <>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-ember" /> 实体
                  </span>
                  {scope.bridge_entities > 0 && (
                    <span className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: BRIDGE_COLOR }} /> 桥接实体
                    </span>
                  )}
                </>
              )}
              {externalDocs > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: EXTERNAL_COLOR }} /> 关联文件夹文档
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
