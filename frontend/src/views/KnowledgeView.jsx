import { useCallback, useEffect, useRef, useState } from 'react'
import { deleteDocument, fetchDocuments, uploadDocuments } from '../lib/api'
import { IconUpload, IconDoc, IconTrash } from '../components/icons.jsx'

const fmtSize = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)

function UploadingCard({ name }) {
  return (
    <div className="flex items-center gap-4 rounded-[1.5rem] bg-white/[0.03] p-1.5 ring-1 ring-inset ring-white/[0.06]">
      <div className="flex w-full items-center gap-4 rounded-[calc(1.5rem-0.375rem)] bg-[#0b0b0d] px-5 py-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-aura/10 text-aura ring-1 ring-inset ring-aura/20">
          <IconDoc size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium text-white/80">{name}</p>
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full w-1/3 animate-[slide_1.2s_cubic-bezier(0.32,0.72,0,1)_infinite] rounded-full bg-gradient-to-r from-aura to-ember" />
          </div>
        </div>
        <span className="shrink-0 text-[12px] text-white/40">解析 · 切分 · 向量化中</span>
      </div>
    </div>
  )
}

export default function KnowledgeView({ onStatsChange }) {
  const [docs, setDocs] = useState([])
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState([])
  const [toast, setToast] = useState(null)
  const inputRef = useRef(null)

  const refresh = useCallback(async () => {
    try {
      setDocs(await fetchDocuments())
      onStatsChange?.()
    } catch {
      /* 后端未启动时静默 */
    }
  }, [onStatsChange])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const handleFiles = async (fileList) => {
    const files = [...fileList]
    if (!files.length) return
    setUploading(files.map((f) => f.name))
    try {
      const res = await uploadDocuments(files)
      if (res.success?.length) {
        setToast({ ok: true, text: `已入库 ${res.success.length} 份文档，共 ${res.success.reduce((a, d) => a + d.chunks, 0)} 个知识分片` })
      }
      if (res.errors?.length) {
        setToast({ ok: false, text: res.errors.map((e) => `${e.name}：${e.error}`).join('；') })
      }
    } catch {
      setToast({ ok: false, text: '上传失败，请确认后端服务已启动' })
    } finally {
      setUploading([])
      refresh()
    }
  }

  const remove = async (id, name) => {
    try {
      await deleteDocument(id)
      setToast({ ok: true, text: `已删除「${name}」及其全部向量分片` })
      refresh()
    } catch {
      setToast({ ok: false, text: '删除失败' })
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-24 pt-16 md:pt-24">
      <span className="animate-reveal rounded-full bg-white/[0.04] px-3.5 py-1.5 text-[10px] font-medium uppercase tracking-[0.25em] text-white/50 ring-1 ring-inset ring-white/[0.08]">
        KNOWLEDGE VAULT
      </span>
      <h1 className="mt-6 animate-reveal text-4xl font-bold tracking-tight text-white [animation-delay:100ms] md:text-5xl">
        知识库管理
      </h1>
      <p className="mt-4 animate-reveal text-[15px] text-white/40 [animation-delay:200ms]">
        上传企业文档，自动完成解析、中文友好切分与 bge-m3 向量化，全流程本地私有化。
      </p>

      {/* 拖拽上传区（Double-Bezel） */}
      <div
        className="mt-12 animate-reveal rounded-[2rem] bg-white/[0.04] p-2 ring-1 ring-white/[0.07] transition-all duration-700 ease-fluid [animation-delay:300ms] focus-within:ring-aura/30"
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          handleFiles(e.dataTransfer.files)
        }}
      >
        <button
          onClick={() => inputRef.current?.click()}
          className={`group flex w-full flex-col items-center gap-5 rounded-[calc(2rem-0.5rem)] px-6 py-14 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] transition-colors duration-700 ease-fluid ${
            dragging ? 'bg-aura/[0.07]' : 'bg-[#0b0b0d] hover:bg-[#0e0e11]'
          }`}
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-[1.4rem] bg-gradient-to-br from-aura/20 to-ember/15 text-aura ring-1 ring-inset ring-white/10 transition-transform duration-700 ease-fluid group-hover:-translate-y-1 group-hover:scale-105">
            <IconUpload size={26} />
          </span>
          <div className="text-center">
            <p className="text-[15px] font-semibold text-white/85">
              {dragging ? '松开即刻入库' : '拖拽文档到这里，或点击选择'}
            </p>
            <p className="mt-2 text-[12px] text-white/35">支持 PDF · DOCX · Markdown · TXT · CSV · XLSX，可多选</p>
          </div>
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.md,.txt,.csv,.xlsx"
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {/* 上传中 */}
      {uploading.length > 0 && (
        <div className="mt-6 grid gap-3">
          {uploading.map((n) => (
            <UploadingCard key={n} name={n} />
          ))}
        </div>
      )}

      {/* 文档列表 */}
      {docs.length > 0 && (
        <div className="mt-14 animate-reveal [animation-delay:150ms]">
          <div className="mb-5 flex items-baseline justify-between px-1">
            <h2 className="text-[15px] font-semibold tracking-wide text-white/70">已入库文档</h2>
            <span className="text-[12px] text-white/30">{docs.length} 份</span>
          </div>
          <div className="grid gap-3">
            {docs.map((d, i) => (
              <div
                key={d.doc_id}
                className="group flex items-center gap-4 rounded-[1.5rem] bg-white/[0.03] p-1.5 ring-1 ring-inset ring-white/[0.06] transition-all duration-700 ease-fluid animate-reveal hover:bg-white/[0.05] hover:ring-white/[0.1]"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="flex w-full items-center gap-4 rounded-[calc(1.5rem-0.375rem)] bg-[#0b0b0d] px-5 py-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/[0.05] text-white/70 ring-1 ring-inset ring-white/[0.08]">
                    <IconDoc size={19} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium text-white/85">{d.name}</p>
                    <p className="mt-1 text-[12px] text-white/35">
                      {d.uploaded_at} · {d.chunks} 个分片 · {fmtSize(d.size)}
                    </p>
                  </div>
                  <span className="hidden shrink-0 rounded-full bg-ember/10 px-2.5 py-1 text-[10px] font-medium text-ember ring-1 ring-inset ring-ember/20 sm:block">
                    已向量化
                  </span>
                  <button
                    onClick={() => remove(d.doc_id, d.name)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/25 transition-all duration-500 ease-fluid hover:bg-red-400/10 hover:text-red-300 active:scale-90"
                    aria-label="删除文档"
                  >
                    <IconTrash size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Toast（双层边框胶囊） */}
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

      <style>{`@keyframes slide { 0% { transform: translateX(-120%) } 100% { transform: translateX(320%) } }`}</style>
    </div>
  )
}
