import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import DocumentPreview from '../components/DocumentPreview.jsx'
import { deleteConversation, fetchMessages, listConversations, streamChat } from '../lib/api'
import { consumePendingAsk } from '../lib/askBus'
import { IconSend, IconSpark, IconQuote, IconChat, IconTrash, IconList } from '../components/icons.jsx'

const clampScale = (s) => Math.min(Math.max(s, 0.4), 10)

/* ---------------- 历史提问（本地留存，带所属会话，可跨对话定位） ---------------- */

const ASK_HISTORY_KEY = 'kb_ask_history'
const ASK_HISTORY_LIMIT = 30

/** 兼容早期只存字符串的旧数据 */
function normalizeAskItem(raw) {
  if (typeof raw === 'string') return raw.trim() ? { q: raw.trim(), cid: null } : null
  if (raw && typeof raw.q === 'string' && raw.q.trim()) return { q: raw.q.trim(), cid: raw.cid || null }
  return null
}

function saveAskHistory(list) {
  try {
    localStorage.setItem(ASK_HISTORY_KEY, JSON.stringify(list))
  } catch {
    /* 隐私模式写不进去时忽略 */
  }
}

function loadAskHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(ASK_HISTORY_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    return raw.map(normalizeAskItem).filter(Boolean).slice(0, ASK_HISTORY_LIMIT)
  } catch {
    return []
  }
}

/** 传入项优先、去重、截断后写回 localStorage；同一条提问保留已知的会话 id */
function mergeAskHistory(items, prev) {
  const next = []
  const seen = new Map()
  const push = (raw) => {
    const item = normalizeAskItem(raw)
    if (!item) return
    const hit = seen.get(item.q)
    if (hit) {
      if (!hit.cid && item.cid) hit.cid = item.cid
      return
    }
    if (next.length >= ASK_HISTORY_LIMIT) return
    seen.set(item.q, item)
    next.push(item)
  }
  items.forEach(push)
  prev.forEach(push)
  saveAskHistory(next)
  return next
}

function Lightbox({ url, onClose }) {
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const stageRef = useRef(null)
  const dragRef = useRef(null)

  useEffect(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [url])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  // 滚轮缩放（原生监听，React 的 onWheel 是 passive 无法 preventDefault）
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      setScale((s) => clampScale(s * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const onPointerDown = (e) => {
    if (scale <= 1) return
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: offset.x, oy: offset.y }
    setDragging(true)
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e) => {
    if (!dragRef.current) return
    setOffset({ x: dragRef.current.ox + e.clientX - dragRef.current.sx, y: dragRef.current.oy + e.clientY - dragRef.current.sy })
  }
  const endDrag = () => {
    dragRef.current = null
    setDragging(false)
  }

  // Portal 到 body：脱离带 transform 的祖先（animate-reveal），
  // 否则 fixed 定位与居中会相对该祖先而非视口，层级也压不过导航
  return createPortal(
    <div
      className="lightbox-backdrop fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-black/90 p-4 backdrop-blur-2xl md:p-12"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="lightbox-panel relative flex max-h-full w-full max-w-full flex-col" onClick={(e) => e.stopPropagation()}>
        {/* 关闭 + 缩放百分比 */}
        <div className="absolute -top-12 right-0 z-10 flex items-center gap-3">
          <span className="rounded-full bg-white/10 px-3 py-1 text-[12px] text-white/70 ring-1 ring-inset ring-white/15">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={() => {
              setScale(1)
              setOffset({ x: 0, y: 0 })
            }}
            className="flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-3 text-[12px] text-white/70 ring-1 ring-inset ring-white/20 transition-all duration-500 ease-fluid hover:bg-white/20 hover:text-white active:scale-95"
            aria-label="重置缩放"
          >
            复位
          </button>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/70 ring-1 ring-inset ring-white/20 transition-all duration-500 ease-fluid hover:bg-white/20 hover:text-white active:scale-90"
            aria-label="关闭预览"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
              <path d="M2 2l10 10M12 2L2 12" />
            </svg>
          </button>
        </div>
        {/* 画布区：滚轮缩放 + 拖拽平移（显式高度，避免 flex 自适应塌陷为 0） */}
        <div ref={stageRef} className="relative flex h-[78dvh] w-full items-center justify-center overflow-hidden rounded-2xl">
          <img
            src={url}
            alt="文档插图预览"
            draggable={false}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
            onDoubleClick={() => {
              if (scale > 1) {
                setScale(1)
                setOffset({ x: 0, y: 0 })
              } else setScale(2.5)
            }}
            className="max-h-full max-w-full select-none rounded-2xl bg-white object-contain shadow-2xl ring-1 ring-white/15"
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              transition: dragging ? 'none' : 'transform 0.25s cubic-bezier(0.32,0.72,0,1)',
              cursor: scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'zoom-in',
            }}
          />
        </div>
      </div>
      <p className="text-[11px] tracking-wide text-white/40">
        滚轮缩放 · 放大后拖动平移 · 双击放大/复位 · 点击图片以外任意区域或按 Esc 关闭
      </p>
    </div>,
    document.body,
  )
}

const SUGGESTIONS = [
  '公司年假政策是怎样的？',
  '报销流程需要哪些单据？',
  '新员工入职第一周要做什么？',
  '信息安全有哪些红线要求？',
]

function AnswerBody({ text, streaming }) {
  const parts = text.split(/(\[\d{1,2}\])/g)
  return (
    <div className={`whitespace-pre-wrap text-[16px] leading-[1.9] text-white/85 ${streaming ? 'stream-caret' : ''}`}>
      {parts.map((p, i) =>
        /^\[\d{1,2}\]$/.test(p) ? (
          <span key={i} className="cite-chip">
            {p.slice(1, -1)}
          </span>
        ) : (
          p
        ),
      )}
    </div>
  )
}

function SourceCard({ src, onImage, onOpen }) {
  const clickable = !!src.doc_id
  return (
    <div
      onClick={() => clickable && onOpen?.({ doc_id: src.doc_id, name: src.source })}
      className={`flex gap-3 rounded-2xl bg-white/[0.03] p-3.5 ring-1 ring-inset ring-white/[0.06] transition-colors duration-700 ease-fluid hover:bg-white/[0.05] ${
        clickable ? 'cursor-pointer hover:ring-white/[0.14]' : ''
      }`}
      title={clickable ? '点击打开原文' : undefined}
    >
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-aura/15 text-[11px] font-semibold text-aura ring-1 ring-inset ring-aura/25">
        {src.index}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[14px] font-medium text-white/80">{src.source}</p>
          <span className="shrink-0 rounded-full bg-ember/10 px-2 py-0.5 text-[11px] font-medium text-ember/90 ring-1 ring-inset ring-ember/20">
            {(src.score * 100).toFixed(0)}% 匹配
          </span>
          {src.scope === 'private' && (
            <span className="shrink-0 rounded-full bg-aura/10 px-2 py-0.5 text-[11px] font-medium text-aura ring-1 ring-inset ring-aura/25">
              个人
            </span>
          )}
          {src.graph && (
            <span className="shrink-0 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300 ring-1 ring-inset ring-emerald-400/25">
              来自图谱关联
            </span>
          )}
          {src.pages?.length > 0 && (
            <span className="shrink-0 rounded-full bg-white/[0.05] px-2 py-0.5 text-[11px] text-white/45 ring-1 ring-inset ring-white/[0.08]">
              第 {src.pages.join(',')} 页
            </span>
          )}
        </div>
        <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-white/40">{src.snippet}</p>
        {/* 文档内嵌图片（架构图等），点击页内灯箱预览 */}
        {src.images?.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {src.images.map((u) => (
              <button
                key={u}
                onClick={(e) => {
                  e.stopPropagation()
                  onImage?.(u)
                }}
                className="group/img block cursor-zoom-in overflow-hidden rounded-xl bg-black/40 ring-1 ring-white/10 transition-all duration-500 ease-fluid hover:ring-aura/40"
                title="点击放大预览"
              >
                <img
                  src={u}
                  alt="文档插图"
                  loading="lazy"
                  className="h-24 w-auto max-w-56 object-contain transition-transform duration-500 ease-fluid group-hover/img:scale-[1.04]"
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AssistantMessage({ msg, onImage, onOpenDoc }) {
  const [open, setOpen] = useState(false)
  const sources = msg.sources || []
  const visible = open ? sources : sources.slice(0, 2)
  return (
    <div className="flex flex-col items-start gap-2.5">
      {/* 双层边框（Double-Bezel）：外壳 + 内芯 */}
      <div className="max-w-[85%] rounded-[1.75rem] bg-white/[0.04] p-1.5 ring-1 ring-white/[0.07] md:max-w-[75%]">
        <div className="rounded-[calc(1.75rem-0.375rem)] bg-[#0b0b0d] px-6 py-5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-aura/30 to-ember/30 text-aura">
              <IconSpark size={13} />
            </span>
            {msg.mode && (
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium tracking-wide ring-1 ring-inset ${
                  msg.mode === 'rag'
                    ? 'bg-ember/10 text-ember ring-ember/25'
                    : 'bg-amber-400/10 text-amber-300/90 ring-amber-300/20'
                }`}
              >
                {msg.mode === 'rag' ? '知识库命中' : '模型兜底 · 未命中资料'}
              </span>
            )}
              {msg.graph_docs?.length > 0 && (
              <span
                className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-[11px] font-medium tracking-wide text-emerald-300 ring-1 ring-inset ring-emerald-400/25"
                title={`图谱召回补充：${msg.graph_docs.join('、')}`}
              >
                图谱关联召回 · {msg.graph_docs.length} 篇
              </span>
            )}
            {msg.rewritten && msg.rewritten !== msg.question && (
              <span className="hidden max-w-48 truncate text-[11px] text-white/30 md:inline" title={msg.rewritten}>
                改写检索：{msg.rewritten}
              </span>
            )}
          </div>
          {msg.content ? (
            <AnswerBody text={msg.content} streaming={msg.streaming} />
          ) : (
            <div className="flex gap-1.5 py-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/40"
                  style={{ animationDelay: `${i * 150}ms` }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 引用溯源 */}
      {sources.length > 0 && !msg.streaming && (
        <div className="ml-2 w-full max-w-[85%] md:max-w-[75%]">
          <button
            onClick={() => setOpen(!open)}
            className="group flex items-center gap-2 rounded-full bg-white/[0.03] py-1.5 pl-3 pr-1.5 text-[11px] text-white/45 ring-1 ring-inset ring-white/[0.06] transition-all duration-500 ease-fluid hover:text-white/75 active:scale-[0.97]"
          >
            <IconQuote size={13} />
            引用来源 · {sources.length} 条
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/[0.06] transition-transform duration-500 ease-fluid group-hover:translate-y-[-1px]">
              <svg width="9" height="9" viewBox="0 0 10 10" className={`transition-transform duration-500 ease-fluid ${open ? 'rotate-180' : ''}`}>
                <path d="M2 4l3-3 3 3M2 9l3-3 3 3" stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>
          {open && (
            <div className="mt-2.5 grid gap-2 animate-reveal">
              {visible.map((s) => (
                <SourceCard key={s.index} src={s} onImage={onImage} onOpen={onOpenDoc} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ChatView() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const [preview, setPreview] = useState(null)
  const [conversations, setConversations] = useState([])
  const [activeId, setActiveId] = useState(null) // null = 新对话
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [askHistory, setAskHistory] = useState(loadAskHistory)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [flash, setFlash] = useState(null) // 定位后短暂高亮某条提问 { index, seq }
  const endRef = useRef(null)
  const inputRef = useRef(null)
  const historyRef = useRef(null)
  const userMsgRefs = useRef(new Map())
  const pendingLocate = useRef(null) // 切换会话后待定位的提问文本

  const refreshConversations = useCallback(async () => {
    try {
      setConversations(await listConversations())
    } catch {
      /* 未登录等场景静默 */
    }
  }, [])

  useEffect(() => {
    refreshConversations()
  }, [refreshConversations])

  // 图谱页「一键提问」跳转过来时自动发送（挂载时消费一次）
  useEffect(() => {
    const pending = consumePendingAsk()
    if (pending) send(pending)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  // 历史提问浮层：点击外部或按 Esc 关闭
  useEffect(() => {
    if (!historyOpen) return
    const onDown = (e) => {
      if (historyRef.current && !historyRef.current.contains(e.target)) setHistoryOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setHistoryOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [historyOpen])

  // 定位高亮 1.8s 后自动褪去
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 1800)
    return () => clearTimeout(t)
  }, [flash])

  const recordAsk = (question, cid = null) => {
    setAskHistory((prev) => mergeAskHistory([{ q: question, cid }], prev))
  }

  const clearAskHistory = () => {
    try {
      localStorage.removeItem(ASK_HISTORY_KEY)
    } catch {
      /* 忽略 */
    }
    setAskHistory([])
  }

  // 在消息列表里从新到旧找该提问的下标
  const findQuestionIndex = useCallback(
    (question) => {
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i].role === 'user' && messages[i].content === question) return i
      }
      return -1
    },
    [messages],
  )

  const locateQuestion = useCallback(
    (question) => {
      const idx = findQuestionIndex(question)
      if (idx < 0) return false
      setFlash((f) => ({ index: idx, seq: (f?.seq || 0) + 1 }))
      requestAnimationFrame(() => {
        userMsgRefs.current.get(idx)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
      return true
    },
    [findQuestionIndex],
  )

  // 这条历史属于当前正在看的对话吗（没有 cid 的旧数据按当前消息内容判断）
  const isInCurrentConversation = useCallback(
    (item) => (item.cid ? item.cid === activeId : messages.some((m) => m.role === 'user' && m.content === item.q)),
    [activeId, messages],
  )

  const pickAsk = async (item) => {
    setHistoryOpen(false)
    if (isInCurrentConversation(item)) {
      if (locateQuestion(item.q)) return
      setInput(item.q)
      requestAnimationFrame(() => inputRef.current?.focus())
      return
    }
    // 其他对话的提问：先切到那个对话，等消息加载完再定位
    if (!item.cid || item.cid === activeId) {
      setInput(item.q)
      requestAnimationFrame(() => inputRef.current?.focus())
      return
    }
    pendingLocate.current = item.q
    const ok = await switchConversation(item.cid)
    if (ok) return
    pendingLocate.current = null
    setInput(item.q)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  // 切换会话后，等消息渲染完再定位到目标提问
  useEffect(() => {
    const q = pendingLocate.current
    if (!q) return
    pendingLocate.current = null
    if (!locateQuestion(q)) setInput(q)
  }, [messages, locateQuestion])

  const switchConversation = async (cid) => {
    if (busy || cid === activeId) return false
    try {
      const msgs = await fetchMessages(cid)
      setMessages(
        msgs.map((m) => ({
          role: m.role,
          content: m.content,
          mode: m.meta?.mode,
          sources: m.meta?.sources || [],
          graph_docs: m.meta?.graph_docs || [],
          rewritten: null,
          question: null,
        })),
      )
      setActiveId(cid)
      setDrawerOpen(false)
      // 把该会话里问过的问题补进历史提问（不置顶，保持最近优先）
      const asked = msgs.filter((m) => m.role === 'user').map((m) => ({ q: m.content, cid }))
      setAskHistory((prev) => {
        const known = new Set(prev.map((i) => i.q))
        const extra = asked.filter((i) => i.q && !known.has(i.q))
        return extra.length ? mergeAskHistory(prev, extra) : prev
      })
      return true
    } catch {
      return false
    }
  }

  const newConversation = () => {
    if (busy) return
    setMessages([])
    setActiveId(null)
    setDrawerOpen(false)
  }

  const removeConversation = async (cid, title) => {
    if (!window.confirm(`删除会话「${title}」？该操作不可恢复。`)) return
    await deleteConversation(cid)
    // 同步清掉该会话的历史提问，避免留下点不进去的条目
    setAskHistory((prev) => {
      const next = prev.filter((i) => i.cid !== cid)
      if (next.length === prev.length) return prev
      saveAskHistory(next)
      return next
    })
    if (cid === activeId) newConversation()
    refreshConversations()
  }

  const send = async (text) => {
    const question = (text ?? input).trim()
    if (!question || busy) return
    setInput('')
    setBusy(true)

    const convIdAtSend = activeId
    recordAsk(question, convIdAtSend)
    setMessages((ms) => [...ms, { role: 'user', content: question }, { role: 'assistant', content: '', streaming: true, question }])

    const patch = (fn) => setMessages((ms) => ms.map((m, i) => (i === ms.length - 1 ? fn(m) : m)))

    try {
      await streamChat({ message: question, conversationId: convIdAtSend }, {
        conv: (e) => {
          if (!convIdAtSend && e.conversation_id) {
            setActiveId(e.conversation_id)
            // 新对话的首条提问：补上会话 id，之后可跨对话定位回来
            setAskHistory((prev) => {
              if (!prev.some((i) => i.q === question && !i.cid)) return prev
              const next = prev.map((i) => (i.q === question && !i.cid ? { ...i, cid: e.conversation_id } : i))
              saveAskHistory(next)
              return next
            })
          }
        },
        meta: (e) => patch((m) => ({ ...m, mode: e.mode, rewritten: e.rewritten_query, sources: e.sources, graph_docs: e.graph_docs || [] })),
        delta: (e) => patch((m) => ({ ...m, content: m.content + e.text })),
        done: () => patch((m) => ({ ...m, streaming: false })),
        error: (e) => patch((m) => ({ ...m, content: `出错了：${e.message}`, streaming: false })),
      })
      refreshConversations()
    } catch (err) {
      patch((m) => ({ ...m, content: `无法连接服务：${err.message}`, streaming: false }))
    } finally {
      patch((m) => ({ ...m, streaming: false }))
      setBusy(false)
    }
  }

  // 历史提问按「本对话 / 其他对话」分组
  const curAsk = askHistory.filter((item) => isInCurrentConversation(item))
  const otherAsk = askHistory.filter((item) => !isInCurrentConversation(item))

  const renderAskItem = (item, dim = false) => (
    <button
      key={item.q}
      onClick={() => pickAsk(item)}
      className="group flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors duration-300 hover:bg-white/[0.06]"
    >
      <IconQuote size={13} className={`mt-0.5 shrink-0 transition-colors duration-300 group-hover:text-aura ${dim ? 'text-white/15' : 'text-white/25'}`} />
      <span className={`line-clamp-2 flex-1 text-[13px] leading-relaxed transition-colors duration-300 group-hover:text-white ${dim ? 'text-white/45' : 'text-white/70'}`}>
        {item.q}
      </span>
    </button>
  )

  const sidePanel = (
    <div className="flex h-full flex-col gap-3">
      <button
        onClick={newConversation}
        className="group flex items-center justify-between rounded-2xl bg-white/[0.04] py-3 pl-4 pr-1.5 text-[13px] font-medium text-white/85 ring-1 ring-inset ring-white/[0.08] transition-all duration-500 ease-fluid hover:bg-white/[0.07] active:scale-[0.97]"
      >
        开启新对话
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.07] text-white/60 transition-transform duration-500 ease-fluid group-hover:rotate-90">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </span>
      </button>
      <p className="px-2 pt-2 text-[10px] font-medium uppercase tracking-[0.2em] text-white/30">历史会话 · {conversations.length}</p>
      <div className="flex-1 space-y-1.5 overflow-y-auto pr-0.5">
        {conversations.length === 0 && <p className="px-2 py-4 text-[12px] leading-relaxed text-white/25">还没有历史会话，发送第一条消息后会自动保存。</p>}
        {conversations.map((c) => (
          <div
            key={c.id}
            className={`group flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2.5 ring-1 ring-inset transition-all duration-500 ease-fluid ${
              c.id === activeId ? 'bg-white/[0.08] ring-white/[0.14]' : 'ring-transparent hover:bg-white/[0.04]'
            }`}
            onClick={() => switchConversation(c.id)}
          >
            <IconChat size={14} className={c.id === activeId ? 'shrink-0 text-aura' : 'shrink-0 text-white/30'} />
            <div className="min-w-0 flex-1">
              <p className={`truncate text-[13px] ${c.id === activeId ? 'text-white/90' : 'text-white/60'}`}>{c.title}</p>
              <p className="truncate text-[10px] text-white/25">{c.updated_at}</p>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation()
                removeConversation(c.id, c.title)
              }}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white/0 transition-all duration-500 ease-fluid group-hover:text-white/30 hover:!text-red-300 active:scale-90"
              aria-label="删除会话"
            >
              <IconTrash size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div className="relative flex min-h-[calc(100dvh-7rem)]">
      {/* 桌面侧边栏：sticky 固定 + 自身独立滚动，不随右侧对话滚动 */}
      <aside className="hidden w-72 shrink-0 border-r border-white/[0.05] px-4 pb-8 pt-28 md:sticky md:top-0 md:block md:max-h-[100dvh] md:self-start md:overflow-y-auto lg:w-80">{sidePanel}</aside>

      {/* 移动端抽屉 */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setDrawerOpen(false)}>
          <div className="lightbox-backdrop absolute inset-0 bg-black/70 backdrop-blur-2xl" />
          <div
            className="animate-reveal absolute inset-y-0 left-0 w-80 max-w-[85vw] bg-[#0b0b0d] p-4 ring-1 ring-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            {sidePanel}
          </div>
        </div>
      )}

      {/* 消息区：顶部留出导航高度，滚动不越过顶栏 */}
      <div className="mx-auto w-full max-w-3xl flex-1 px-4 pt-28">
        <div className="mb-4 flex items-center gap-3 md:hidden">
          <button
            onClick={() => setDrawerOpen(true)}
            className="flex h-9 items-center gap-2 rounded-full bg-white/[0.05] px-4 text-[12px] text-white/70 ring-1 ring-inset ring-white/[0.09] active:scale-[0.97]"
          >
            <IconChat size={14} /> 历史会话 {conversations.length > 0 && `(${conversations.length})`}
          </button>
          <button
            onClick={newConversation}
            className="flex h-9 items-center rounded-full bg-white/[0.05] px-4 text-[12px] text-white/70 ring-1 ring-inset ring-white/[0.09] active:scale-[0.97]"
          >
            新对话
          </button>
        </div>

        {messages.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center md:py-20">
            <span className="animate-reveal rounded-full bg-white/[0.04] px-3.5 py-1.5 text-[10px] font-medium uppercase tracking-[0.25em] text-white/50 ring-1 ring-inset ring-white/[0.08]">
              RAG · RETRIEVAL AUGMENTED
            </span>
            <h1 className="mt-7 animate-reveal text-[2.2rem] font-bold leading-[1.1] tracking-tight text-white [animation-delay:100ms] md:text-5xl">
              向企业知识库
              <span className="block bg-gradient-to-r from-aura via-white to-ember bg-clip-text text-transparent">
                提出你的问题
              </span>
            </h1>
            <p className="mt-6 max-w-md animate-reveal text-[16px] leading-relaxed text-white/40 [animation-delay:200ms]">
              基于 Qwen3-14B 与 bge-m3 的私有化检索增强问答，每个答案均可溯源、流式输出。
            </p>
            <div className="mt-12 grid w-full max-w-xl animate-reveal grid-cols-1 gap-3 [animation-delay:300ms] sm:grid-cols-2">
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={i}
                  onClick={() => send(s)}
                  className="group rounded-[1.5rem] bg-white/[0.03] p-1.5 text-left ring-1 ring-inset ring-white/[0.06] transition-all duration-700 ease-fluid hover:bg-white/[0.05] hover:ring-white/[0.12] active:scale-[0.98]"
                >
                  <div className="rounded-[calc(1.5rem-0.375rem)] px-5 py-4">
                    <span className="text-[14px] text-white/65 transition-colors duration-500 group-hover:text-white/95">{s}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-8 pb-40">
            {messages.map((m, i) =>
              m.role === 'user' ? (
                <div
                  key={i}
                  ref={(el) => {
                    if (el) userMsgRefs.current.set(i, el)
                    else userMsgRefs.current.delete(i)
                  }}
                  className="flex animate-reveal justify-end"
                >
                  <div
                    className={`max-w-[80%] scroll-mt-28 rounded-[1.5rem] rounded-br-lg bg-gradient-to-br from-aura/25 to-aura/10 px-6 py-4 text-[16px] leading-relaxed text-white transition-all duration-500 ease-fluid ${
                      flash?.index === i
                        ? 'ring-2 ring-aura/80 shadow-[0_0_0_5px_rgba(167,139,250,0.16)]'
                        : 'ring-1 ring-inset ring-aura/25'
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={i} className="animate-reveal">
                  <AssistantMessage msg={m} onImage={setLightbox} onOpenDoc={setPreview} />
                </div>
              ),
            )}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {lightbox && <Lightbox url={lightbox} onClose={() => setLightbox(null)} />}
      {preview && <DocumentPreview doc={preview} onClose={() => setPreview(null)} />}

      {/* 输入区：双层边框 + 按钮嵌套按钮 */}
      <div className="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-void via-void/85 to-transparent pb-6 pt-10 backdrop-blur-xl">
        <div className="mx-auto w-full max-w-3xl px-4 md:max-w-[42rem]">
          <div
            ref={historyRef}
            className="relative rounded-[2rem] bg-white/[0.05] p-1.5 ring-1 ring-white/[0.09] transition-all duration-700 ease-fluid focus-within:ring-aura/40"
          >
            {/* 历史提问浮层：向上展开，点击外部或按 Esc 关闭 */}
            {historyOpen && (
              <div className="animate-reveal absolute inset-x-0 bottom-full z-20 mb-3 overflow-hidden rounded-[1.5rem] bg-[#101013]/95 ring-1 ring-white/[0.09] shadow-[0_-24px_64px_-24px_rgba(0,0,0,0.9)] backdrop-blur-2xl">
                <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
                  <span className="flex items-center gap-2 text-[13px] font-medium text-white/80">
                    <IconList size={14} className="shrink-0 text-white/40" />
                    历史提问
                    <span className="text-[12px] font-normal text-white/30">({askHistory.length})</span>
                  </span>
                  <button
                    onClick={() => setHistoryOpen(false)}
                    className="flex h-6 w-6 items-center justify-center rounded-full text-white/35 transition-colors duration-300 hover:bg-white/[0.08] hover:text-white"
                    aria-label="关闭历史提问"
                  >
                    <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
                      <path d="M2 2l10 10M12 2L2 12" />
                    </svg>
                  </button>
                </div>
                {askHistory.length === 0 ? (
                  <p className="px-4 py-6 text-center text-[12px] leading-relaxed text-white/25">还没有历史提问，发送第一个问题后会自动记录在这里。</p>
                ) : (
                  <div className="max-h-72 overflow-y-auto p-2">
                    {curAsk.length > 0 && (
                      <>
                        <p className="px-3 pb-1 pt-1 text-[10px] font-medium tracking-[0.18em] text-white/20">本对话 · {curAsk.length}</p>
                        {curAsk.map((item) => renderAskItem(item))}
                      </>
                    )}
                    {otherAsk.length > 0 && (
                      <>
                        <p
                          className={`px-3 pb-1 text-[10px] font-medium tracking-[0.18em] text-white/20 ${
                            curAsk.length > 0 ? 'mt-2 border-t border-white/[0.05] pt-2' : 'pt-1'
                          }`}
                        >
                          其他对话 · {otherAsk.length}
                        </p>
                        {otherAsk.map((item) => renderAskItem(item, true))}
                      </>
                    )}
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-white/[0.06] px-4 py-2">
                  <span className="text-[11px] text-white/25">点击条目跳转到提问所在处</span>
                  <button onClick={clearAskHistory} className="text-[11px] text-white/30 transition-colors duration-300 hover:text-red-300">
                    清空记录
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-end gap-2 rounded-[calc(2rem-0.375rem)] bg-[#0b0b0d] py-3.5 pl-2.5 pr-4 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">
              <button
                onClick={() => setHistoryOpen((o) => !o)}
                aria-expanded={historyOpen}
                aria-label="历史提问"
                title="历史提问"
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all duration-500 ease-fluid active:scale-90 ${
                  historyOpen ? 'bg-white/[0.14] text-white ring-1 ring-inset ring-white/15' : 'text-white/35 hover:bg-white/[0.08] hover:text-white/80'
                }`}
              >
                <IconList size={15} />
              </button>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    send()
                  }
                }}
                rows={1}
                placeholder="询问知识库中的任何内容…  Enter 发送 / Shift+Enter 换行"
                className="max-h-40 min-h-7 flex-1 resize-none bg-transparent text-[16px] leading-relaxed text-white/90 outline-none placeholder:text-white/25"
              />
              <button
                onClick={() => send()}
                disabled={busy || !input.trim()}
                className="group flex h-12 shrink-0 items-center gap-2.5 rounded-full bg-gradient-to-br from-aura to-aura/70 pl-6 pr-2 text-[14px] font-semibold text-white shadow-[0_8px_24px_-8px_rgba(167,139,250,0.55)] transition-all duration-500 ease-fluid hover:shadow-[0_12px_32px_-8px_rgba(167,139,250,0.75)] active:scale-[0.96] disabled:opacity-30 disabled:shadow-none"
              >
                发送
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 transition-transform duration-500 ease-fluid group-hover:translate-x-0.5 group-hover:-translate-y-px group-hover:scale-105">
                  <IconSend size={16} />
                </span>
              </button>
            </div>
          </div>
          <p className="mt-3 text-center text-[12px] text-white/25">
            答案由 Qwen3-14B 生成 · 优先引用知识库资料 · 未命中时自动切换模型兜底
          </p>
        </div>
      </div>
    </div>
  )
}
