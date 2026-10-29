import { useEffect, useRef, useState } from 'react'
import { streamChat } from '../lib/api'
import { IconSend, IconSpark, IconQuote } from '../components/icons.jsx'

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

function SourceCard({ src }) {
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
        {/* 文档内嵌图片（架构图等），点击查看原图 */}
        {src.images?.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {src.images.map((u) => (
              <a
                key={u}
                href={u}
                target="_blank"
                rel="noreferrer"
                className="group/img block overflow-hidden rounded-xl bg-black/40 ring-1 ring-white/10 transition-all duration-500 ease-fluid hover:ring-aura/40"
                title="点击查看原图"
              >
                <img
                  src={u}
                  alt="文档插图"
                  loading="lazy"
                  className="h-24 w-auto max-w-56 object-contain transition-transform duration-500 ease-fluid group-hover/img:scale-[1.04]"
                />
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AssistantMessage({ msg }) {
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
                <SourceCard key={s.index} src={s} />
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
  const endRef = useRef(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  const send = async (text) => {
    const question = (text ?? input).trim()
    if (!question || busy) return
    setInput('')
    setBusy(true)

    const history = messages.map((m) => ({ role: m.role, content: m.content }))
    setMessages((ms) => [...ms, { role: 'user', content: question }, { role: 'assistant', content: '', streaming: true, question }])

    const patch = (fn) => setMessages((ms) => ms.map((m, i) => (i === ms.length - 1 ? fn(m) : m)))

    try {
      await streamChat({ message: question, history }, {
        meta: (e) => patch((m) => ({ ...m, mode: e.mode, rewritten: e.rewritten_query, sources: e.sources })),
        delta: (e) => patch((m) => ({ ...m, content: m.content + e.text })),
        done: () => patch((m) => ({ ...m, streaming: false })),
        error: (e) => patch((m) => ({ ...m, content: `出错了：${e.message}`, streaming: false })),
      })
    } catch (err) {
      patch((m) => ({ ...m, content: `无法连接服务：${err.message}`, streaming: false }))
    } finally {
      patch((m) => ({ ...m, streaming: false }))
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-[calc(100dvh-10rem)] flex-col">
      {/* 消息区 */}
      <div className="mx-auto w-full max-w-3xl flex-1 px-4 pt-10 md:pt-16">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center md:py-28">
            <span className="animate-reveal rounded-full bg-white/[0.04] px-3.5 py-1.5 text-[10px] font-medium uppercase tracking-[0.25em] text-white/50 ring-1 ring-inset ring-white/[0.08]">
              RAG · RETRIEVAL AUGMENTED
            </span>
            <h1 className="mt-7 animate-reveal text-[2.6rem] font-bold leading-[1.1] tracking-tight text-white [animation-delay:100ms] md:text-6xl">
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
                  <AssistantMessage msg={m} />
                </div>
              ),
            )}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {/* 输入区：双层边框 + 按钮嵌套按钮 */}
      <div className="sticky bottom-0 z-30 mt-auto bg-gradient-to-t from-void via-void/85 to-transparent pb-6 pt-10 backdrop-blur-xl">
        <div className="mx-auto w-full max-w-3xl px-4">
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
