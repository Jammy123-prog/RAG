import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import DocumentViewer from './DocumentViewer.jsx'
import { fetchDocumentBlobUrl, fetchDocumentPages, fetchDocumentPreview } from '../lib/api'

const fmtSize = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((b || 0) / 1024))} KB`)

const PREVIEW_CSS = `
.doc-preview-html { color: rgba(255,255,255,.82); font-size: 14.5px; line-height: 1.85; }
.doc-preview-html h1,.doc-preview-html h2,.doc-preview-html h3,.doc-preview-html h4 {
  color: #fff; font-weight: 700; margin: 1.4em 0 .6em; line-height: 1.35;
}
.doc-preview-html h1 { font-size: 1.5em }
.doc-preview-html h2 { font-size: 1.3em }
.doc-preview-html h3 { font-size: 1.12em }
.doc-preview-html h4 { font-size: 1em; color: rgba(255,255,255,.7) }
.doc-preview-html p { margin: .7em 0 }
.doc-preview-html li { margin: .3em 0 .3em 1.2em; list-style: disc }
.doc-preview-html table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 13px }
.doc-preview-html td { border: 1px solid rgba(255,255,255,.1); padding: 6px 10px; vertical-align: top }
.doc-preview-html tr:nth-child(odd) td { background: rgba(255,255,255,.02) }
.doc-preview-html code { background: rgba(255,255,255,.08); padding: 1px 5px; border-radius: 5px; font-size: .9em }
.doc-preview-html pre { background: rgba(255,255,255,.05); padding: 14px; border-radius: 12px; overflow: auto }
.doc-preview-html a { color: #c4b5fd; text-decoration: underline }
.doc-preview-html blockquote { border-left: 2px solid rgba(167,139,250,.5); padding-left: 12px; color: rgba(255,255,255,.55) }
`

export default function DocumentPreview({ doc, onClose }) {
  const [data, setData] = useState(null)
  const [pages, setPages] = useState(null) // {mode, page_count}
  const [error, setError] = useState(null)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  useEffect(() => {
    if (!doc?.doc_id) return
    let alive = true
    setData(null)
    setPages(null)
    setError(null)
    fetchDocumentPreview(doc.doc_id)
      .then((p) => alive && setData(p))
      .catch((e) => alive && setError(e.message))
    // 页面级渲染（类 WPS）：失败则退回内容预览
    fetchDocumentPages(doc.doc_id)
      .then((p) => alive && setPages(p))
      .catch(() => alive && setPages({ mode: 'none', page_count: 0 }))
    return () => {
      alive = false
    }
  }, [doc?.doc_id])

  const download = async () => {
    if (!doc?.doc_id) return
    try {
      setDownloading(true)
      const url = await fetchDocumentBlobUrl(doc.doc_id)
      const a = document.createElement('a')
      a.href = url
      a.download = data?.name || doc.name || 'document'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e) {
      setError(e.message)
    } finally {
      setDownloading(false)
    }
  }

  const kind = data?.kind
  const hasFile = data?.has_file
  const useViewer = pages && (pages.mode === 'pages' || pages.mode === 'image')
  const loading = !error && (!data || !pages)

  return createPortal(
    <div
      className="lightbox-backdrop fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-black/90 p-3 backdrop-blur-2xl md:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-[1.5rem] bg-[#0b0b0d] ring-1 ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-start gap-3 border-b border-white/[0.07] px-5 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[9.5px] font-medium uppercase tracking-[0.2em] text-aura/80">DOCUMENT</p>
            <h3 className="mt-0.5 break-all text-[15px] font-semibold leading-snug text-white/90">{data?.name || doc?.name}</h3>
            <p className="mt-0.5 text-[11.5px] text-white/35">
              {data ? fmtSize(data.size) : ''}
              {data?.uploaded_at ? ` · ${data.uploaded_at}` : ''}
              {data?.scope === 'private' ? ' · 个人知识库' : data ? ' · 公有知识库' : ''}
              {pages?.mode === 'pages' && pages.page_count ? ` · ${pages.page_count} 页` : ''}
            </p>
          </div>
          <button
            onClick={download}
            disabled={downloading || !hasFile}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-white/[0.07] px-3 text-[12px] text-white/70 ring-1 ring-inset ring-white/[0.12] transition-all duration-500 ease-fluid hover:bg-white/[0.12] hover:text-white active:scale-95 disabled:opacity-30"
            title={hasFile ? '下载原文件' : '历史文档未保留原文件'}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16" />
            </svg>
            下载
          </button>
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.07] text-white/70 ring-1 ring-inset ring-white/[0.12] transition-all duration-500 ease-fluid hover:bg-white/[0.12] hover:text-white active:scale-90"
            aria-label="关闭预览"
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
              <path d="M2 2l10 10M12 2L2 12" />
            </svg>
          </button>
        </div>

        {/* 内容区 */}
        {useViewer ? (
          <div className="h-[76dvh] min-h-0">
            <DocumentViewer docId={doc.doc_id} pageCount={pages.page_count} mode={pages.mode} name={data?.name || doc?.name} />
          </div>
        ) : (
          <div className="min-h-0 max-h-[76dvh] flex-1 overflow-auto bg-[#08080a]">
            {error && <div className="flex h-64 items-center justify-center px-8 text-center text-[13px] text-red-300">{error}</div>}
            {loading && !error && (
              <div className="flex h-64 items-center justify-center gap-1.5">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/40" style={{ animationDelay: `${i * 150}ms` }} />
                ))}
              </div>
            )}
            {data && kind === 'html' && (
              <div className="mx-auto max-w-3xl px-8 py-8">
                <style>{PREVIEW_CSS}</style>
                <div className="doc-preview-html" dangerouslySetInnerHTML={{ __html: data.html || '' }} />
              </div>
            )}
            {data && kind === 'text' && (
              <pre className="mx-auto max-w-3xl whitespace-pre-wrap break-words px-8 py-8 text-[13.5px] leading-[1.9] text-white/75">{data.text}</pre>
            )}
            {data && kind !== 'html' && kind !== 'text' && (
              <div className="flex h-64 flex-col items-center justify-center gap-3 px-8 text-center">
                <p className="text-[13px] text-white/45">{data.note || '该格式暂不支持在线预览'}</p>
                <button
                  onClick={download}
                  className="rounded-full bg-gradient-to-br from-aura to-aura/70 px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_8px_24px_-8px_rgba(167,139,250,0.55)] active:scale-95"
                >
                  下载原文件查看
                </button>
              </div>
            )}
          </div>
        )}

        {data?.note && (
          <p className="border-t border-white/[0.07] px-5 py-2 text-[11px] text-white/30">{data.note}</p>
        )}
      </div>
      <p className="text-[11px] text-white/35">
        {useViewer ? 'Ctrl + 滚轮缩放 · ← → 翻页 · Esc 关闭' : 'Esc 或点击空白处关闭'}
      </p>
    </div>,
    document.body,
  )
}
