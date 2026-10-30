import { useCallback, useEffect, useRef, useState } from 'react'
import { deleteConversation, fetchMessages, listConversations, streamChat } from '../lib/api'
import { IconSend, IconSpark, IconQuote, IconChat, IconTrash } from '../components/icons.jsx'

function Lightbox({ url, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <div
      className="lightbox-backdrop fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/85 p-4 backdrop-blur-2xl md:p-12"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="lightbox-panel relative max-h-full max-w-full" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="absolute -top-12 right-0 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/70 ring-1 ring-inset ring-white/20 transition-all duration-500 ease-fluid hover:bg-white/20 hover:text-white active:scale-90"
          aria-label="关闭预览"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
            <path d="M2 2l10 10M12 2L2 12" />
          </svg>
        </button>
        <img
          src={url}
          alt="文档插图预览"
          className="max-h-[82dvh] max-w-full rounded-2xl bg-white object-contain shadow-2xl ring-1 ring-white/15"
        />
      </div>
      <p className="text-[11px] tracking-wide text-white/40">点击图片以外的任意区域，或按 Esc 关闭</p>
    </div>
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
    <div className={`whitespace-pre-wrap text-[15px] leading-[1.85] text-white/85 ${streaming ? 'stream-caret' : ''}`}>
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

function SourceCard({ src, onImage }) {
  return (
    <div className="flex gap-3 rounded-2xl bg-white/[0.03] p-3.5 ring-1 ring-inset ring-white/[0.06] transition-colors duration-700 ease-fluid hover:bg-white/[0.05]">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-aura/15 text-[11px] font-semibold text-aura ring-1 ring-inset ring-aura/25">
        {src.index}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[13px] font-medium text-white/80">{src.source}</p>
          <span className="shrink-0 rounded-full bg-ember/10 px-2 py-0.5 text-[10px] font-medium text-ember/90 ring-1 ring-inset ring-ember/20">
            {(src.score * 100).toFixed(0)}% 匹配
          </span>
          {src.pages?.length > 0 && (
            <span className="shrink-0 rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] text-white/45 ring-1 ring-inset ring-white/[0.08]">
              第 {src.pages.join(',')} 页
            </span>
          )}
        </div>
        <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-white/40">{src.snippet}</p>
        {/* 文档内嵌图片（架构图等），点击页内灯箱预览 */}
        {src.images?.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {src.images.map((u) => (
              <button
                key={u}
                onClick={() => onImage?.(u)}
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

function AssistantMessage({ msg, onImage }) {
  const [open, setOpen] = useState(false)
  const sources = msg.sources || []
  const visible = open ? sources : sources.slice(0, 2)
  return (
    <div className="flex flex-col items-start gap-2.5">
      {/* 双层边框（Double-Bezel）：外壳 + 内芯 */}
      <div className="max-w-[85%] rounded-[1.75rem] bg-white/[0.04] p-1.5 ring-1 ring-white/[0.07] md:max-w-[75%]">
        <div className="rounded-[calc(1.75rem-0.375rem)] bg-[#0b0b0d] p-5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-aura/30 to-ember/30 text-aura">
              <IconSpark size={13} />
            </span>
            {msg.mode && (
              <span
                className={`rounded-full px-2.5 py-1 text-[10px] font-medium tracking-wide ring-1 ring-inset ${
                  msg.mode === 'rag'
                    ? 'bg-ember/10 text-ember ring-ember/25'
                    : 'bg-amber-400/10 text-amber-300/90 ring-amber-300/20'
                }`}
              >
                {msg.mode === 'rag' ? '知识库命中' : '模型兜底 · 未命中资料'}
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
                <SourceCard key={s.index} src={s} onImage={onImage} />
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
  const [conversations, setConversations] = useState([])
  const [activeId, setActiveId] = useState(null) // null = 新对话
  const [drawerOpen, setDrawerOpen] = useState(false)
  const endRef = useRef(null)

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

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  const switchConversation = async (cid) => {
    if (busy || cid === activeId) return
    try {
      const msgs = await fetchMessages(cid)
      setMessages(
        msgs.map((m) => ({
          role: m.role,
          content: m.content,
          mode: m.meta?.mode,
          sources: m.meta?.sources || [],
          rewritten: null,
          question: null,
        })),
      )
      setActiveId(cid)
      setDrawerOpen(false)
    } catch {
      /* 忽略 */
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
    if (cid === activeId) newConversation()
    refreshConversations()
  }

  const send = async (text) => {
    const question = (text ?? input).trim()
    if (!question || busy) return
    setInput('')
    setBusy(true)

    const convIdAtSend = activeId
    setMessages((ms) => [...ms, { role: 'user', content: question }, { role: 'assistant', content: '', streaming: true, question }])

    const patch = (fn) => setMessages((ms) => ms.map((m, i) => (i === ms.length - 1 ? fn(m) : m)))

    try {
      await streamChat({ message: question, conversationId: convIdAtSend }, {
        conv: (e) => {
          if (!convIdAtSend && e.conversation_id) setActiveId(e.conversation_id)
        },
        meta: (e) => patch((m) => ({ ...m, mode: e.mode, rewritten: e.rewritten_query, sources: e.sources })),
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
      {/* 桌面侧边栏 */}
      <aside className="hidden w-72 shrink-0 border-r border-white/[0.05] px-4 py-8 md:block lg:w-80">{sidePanel}</aside>

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

      {/* 消息区 */}
      <div className="mx-auto w-full max-w-3xl flex-1 px-4 pt-8 md:pt-10">
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
            <p className="mt-6 max-w-md animate-reveal text-[15px] leading-relaxed text-white/40 [animation-delay:200ms]">
              基于 Qwen3-14B 与 bge-m3 的私有化检索增强问答，每个答案均可溯源、流式输出。
            </p>
            <div className="mt-12 grid w-full max-w-xl animate-reveal grid-cols-1 gap-3 [animation-delay:300ms] sm:grid-cols-2">
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={i}
                  onClick={() => send(s)}
                  className="group rounded-[1.5rem] bg-white/[0.03] p-1.5 text-left ring-1 ring-inset ring-white/[0.06] transition-all duration-700 ease-fluid hover:bg-white/[0.05] hover:ring-white/[0.12] active:scale-[0.98]"
                >
                  <div className="rounded-[calc(1.5rem-0.375rem)] px-4 py-3.5">
                    <span className="text-[13px] text-white/65 transition-colors duration-500 group-hover:text-white/95">{s}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-8 pb-40">
            {messages.map((m, i) =>
              m.role === 'user' ? (
                <div key={i} className="flex animate-reveal justify-end">
                  <div className="max-w-[80%] rounded-[1.5rem] rounded-br-lg bg-gradient-to-br from-aura/25 to-aura/10 px-5 py-3.5 text-[15px] leading-relaxed text-white ring-1 ring-inset ring-aura/25">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={i} className="animate-reveal">
                  <AssistantMessage msg={m} onImage={setLightbox} />
                </div>
              ),
            )}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {lightbox && <Lightbox url={lightbox} onClose={() => setLightbox(null)} />}

      {/* 输入区：双层边框 + 按钮嵌套按钮 */}
      <div className="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-void via-void/85 to-transparent pb-6 pt-10 backdrop-blur-xl">
        <div className="mx-auto w-full max-w-3xl px-4 md:max-w-[42rem]">
          <div className="rounded-[2rem] bg-white/[0.05] p-1.5 ring-1 ring-white/[0.09] transition-all duration-700 ease-fluid focus-within:ring-aura/40">
            <div className="flex items-end gap-3 rounded-[calc(2rem-0.375rem)] bg-[#0b0b0d] px-5 py-3.5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">
              <textarea
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
                className="max-h-40 min-h-6 flex-1 resize-none bg-transparent text-[15px] leading-relaxed text-white/90 outline-none placeholder:text-white/25"
              />
              <button
                onClick={() => send()}
                disabled={busy || !input.trim()}
                className="group flex h-11 shrink-0 items-center gap-2.5 rounded-full bg-gradient-to-br from-aura to-aura/70 pl-5 pr-1.5 text-[13px] font-semibold text-white shadow-[0_8px_24px_-8px_rgba(167,139,250,0.55)] transition-all duration-500 ease-fluid hover:shadow-[0_12px_32px_-8px_rgba(167,139,250,0.75)] active:scale-[0.96] disabled:opacity-30 disabled:shadow-none"
              >
                发送
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 transition-transform duration-500 ease-fluid group-hover:translate-x-0.5 group-hover:-translate-y-px group-hover:scale-105">
                  <IconSend size={15} />
                </span>
              </button>
            </div>
          </div>
          <p className="mt-3 text-center text-[11px] text-white/25">
            答案由 Qwen3-14B 生成 · 优先引用知识库资料 · 未命中时自动切换模型兜底
          </p>
        </div>
      </div>
    </div>
  )
}
