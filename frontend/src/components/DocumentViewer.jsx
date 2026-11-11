import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchDocumentPageBlobUrl } from '../lib/api'

/**
 * 类 WPS 文档阅读器：
 * - 白色 A4 页连续滚动 + 页码定位（后端逐页渲染 PNG，版式与源文档一致）
 * - 工具栏：页码跳转 / 缩放 / 适应宽度 / 缩略图侧栏
 * - Ctrl + 滚轮缩放，左右方向键翻页
 */

const A4_W = 794 // 96dpi 下 A4 宽度（CSS px），页面高度按比例自适应
const PAGE_RATIO = 1.414

const Icon = ({ d, size = 14, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d={d} />
  </svg>
)

export default function DocumentViewer({ docId, pageCount, mode, name }) {
  const scrollRef = useRef(null)
  const pageRefs = useRef([])
  const urlsRef = useRef({})
  const loadingRef = useRef(new Set())
  const [urls, setUrls] = useState({})
  const [zoom, setZoom] = useState(null)
  const [current, setCurrent] = useState(1)
  const [jump, setJump] = useState('')
  const [thumbs, setThumbs] = useState(false)
  const [failed, setFailed] = useState({})

  const loadPage = useCallback(
    async (n) => {
      if (!docId || n < 1 || n > pageCount) return
      if (urlsRef.current[n] || loadingRef.current.has(n)) return
      loadingRef.current.add(n)
      try {
        const url = await fetchDocumentPageBlobUrl(docId, n, 2)
        urlsRef.current[n] = url
        setUrls((u) => ({ ...u, [n]: url }))
      } catch {
        setFailed((f) => ({ ...f, [n]: true }))
      } finally {
        loadingRef.current.delete(n)
      }
    },
    [docId, pageCount],
  )

  // 首次：按容器宽度自适应缩放，预载前两页
  useEffect(() => {
    if (mode === 'image') {
      loadPage(1)
      return
    }
    const el = scrollRef.current
    const fit = () => {
      if (!el) return
      const w = el.clientWidth - 64
      setZoom((z) => z ?? Math.min(1.5, Math.max(0.45, w / A4_W)))
    }
    fit()
    loadPage(1)
    loadPage(2)
  }, [loadPage, mode])

  // 卸载时释放全部 blob
  useEffect(
    () => () => {
      Object.values(urlsRef.current).forEach((u) => URL.revokeObjectURL(u))
      urlsRef.current = {}
    },
    [],
  )

  // 滚动：更新当前页 + 懒加载邻近页
  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el || mode === 'image') return
    const probe = el.scrollTop + el.clientHeight * 0.35
    let idx = 1
    for (let i = 0; i < pageRefs.current.length; i += 1) {
      const node = pageRefs.current[i]
      if (node && node.offsetTop <= probe) idx = i + 1
    }
    setCurrent(idx)
    for (let i = Math.max(1, idx - 1); i <= Math.min(pageCount, idx + 2); i += 1) loadPage(i)
  }, [loadPage, mode, pageCount])

  // Ctrl + 滚轮缩放（原生监听以阻止浏览器缩放）
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      setZoom((z) => Math.min(3, Math.max(0.4, (z || 1) * (e.deltaY < 0 ? 1.1 : 1 / 1.1))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // 键盘翻页
  useEffect(() => {
    const onKey = (e) => {
      if (mode === 'image' || e.target.tagName === 'INPUT') return
      if (e.key === 'ArrowRight') goTo(current + 1)
      if (e.key === 'ArrowLeft') goTo(current - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, mode])

  const goTo = (n) => {
    const page = Math.min(Math.max(1, n), pageCount)
    const el = scrollRef.current
    const node = pageRefs.current[page - 1]
    if (el && node) el.scrollTo({ top: node.offsetTop - 12, behavior: 'smooth' })
    loadPage(page)
    setCurrent(page)
  }

  const fitWidth = () => {
    const el = scrollRef.current
    if (!el) return
    setZoom(Math.min(2.2, Math.max(0.45, (el.clientWidth - 64) / A4_W)))
  }

  const pageW = Math.round(A4_W * (zoom || 1))
  const pageH = Math.round(pageW * PAGE_RATIO)

  const toolbarBtn = 'flex h-8 items-center justify-center gap-1.5 rounded-lg px-2.5 text-[12px] text-white/60 transition-all duration-300 hover:bg-white/[0.08] hover:text-white active:scale-95 disabled:opacity-25 disabled:hover:bg-transparent'

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {/* 工具栏 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.07] bg-[#101013] px-3 py-2">
        <button onClick={() => setThumbs((v) => !v)} className={toolbarBtn} title="页面缩略图" aria-label="页面缩略图">
          <Icon d="M4 5h6v14H4zM14 5h6v6h-6zM14 13h6v6h-6z" />
        </button>
        <span className="mx-1 h-4 w-px bg-white/10" />
        <button onClick={() => goTo(current - 1)} disabled={current <= 1} className={toolbarBtn} aria-label="上一页">
          <Icon d="m15 6-6 6 6 6" />
        </button>
        <div className="flex items-center gap-1 text-[12px] text-white/60">
          <input
            value={jump}
            placeholder={String(current)}
            onChange={(e) => setJump(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                goTo(Number(jump) || current)
                setJump('')
                e.currentTarget.blur()
              }
            }}
            onBlur={() => {
              if (jump) {
                goTo(Number(jump) || current)
                setJump('')
              }
            }}
            className="w-9 rounded-md bg-white/[0.06] py-0.5 text-center text-[12px] text-white/80 outline-none ring-1 ring-inset ring-white/[0.08] placeholder:text-white/80 focus:ring-aura/40"
            aria-label="当前页"
          />
          <span className="text-white/25">/ {mode === 'image' ? 1 : pageCount}</span>
        </div>
        <button onClick={() => goTo(current + 1)} disabled={current >= pageCount} className={toolbarBtn} aria-label="下一页">
          <Icon d="m9 6 6 6-6 6" />
        </button>

        <span className="ml-auto flex items-center gap-1">
          <button onClick={() => setZoom((z) => Math.max(0.4, (z || 1) - 0.15))} className={toolbarBtn} aria-label="缩小">
            <Icon d="M5 12h14" />
          </button>
          <span className="w-10 text-center text-[11.5px] tabular-nums text-white/45">{Math.round((zoom || 1) * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.min(3, (z || 1) + 0.15))} className={toolbarBtn} aria-label="放大">
            <Icon d="M12 5v14M5 12h14" />
          </button>
          <button onClick={fitWidth} className={`${toolbarBtn} ml-1`} title="适应宽度">
            <Icon d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4" />
            适应宽度
          </button>
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 缩略图侧栏 */}
        {thumbs && (
          <div className="hidden w-28 shrink-0 overflow-y-auto border-r border-white/[0.07] bg-[#0d0d10] p-2 sm:block">
            {Array.from({ length: mode === 'image' ? 1 : pageCount }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                onClick={() => goTo(n)}
                onMouseEnter={() => loadPage(n)}
                className={`mb-2 block w-full rounded-md p-0.5 ring-1 transition-all duration-300 ${
                  current === n ? 'ring-aura/60' : 'ring-white/[0.06] hover:ring-white/20'
                }`}
                aria-label={`第 ${n} 页`}
              >
                {urls[n] ? (
                  <img src={urls[n]} alt={`第 ${n} 页`} className="w-full bg-white" />
                ) : (
                  <span className="block w-full bg-white/10" style={{ aspectRatio: '1 / 1.414' }} />
                )}
                <span className="mt-0.5 block text-center text-[10px] text-white/35">{n}</span>
              </button>
            ))}
          </div>
        )}

        {/* 页面画布 */}
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="relative min-h-0 flex-1 overflow-auto bg-[#151517] px-6 py-6"
        >
          <div className="mx-auto flex w-fit flex-col items-center gap-5">
            {mode === 'image' ? (
              <div className="flex items-center justify-center">
                {urls[1] ? (
                  <img
                    src={urls[1]}
                    alt={name}
                    className="max-w-full rounded-sm bg-white shadow-[0_4px_24px_rgba(0,0,0,0.5)] ring-1 ring-black/20"
                  />
                ) : (
                  <span className="block h-96 w-72 animate-pulse rounded-sm bg-white/10" />
                )}
              </div>
            ) : (
              Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                <div
                  key={n}
                  ref={(el) => {
                    pageRefs.current[n - 1] = el
                  }}
                  className="shrink-0"
                  style={{ width: pageW }}
                >
                  <div
                    className="relative overflow-hidden rounded-[2px] bg-white shadow-[0_6px_28px_rgba(0,0,0,0.55)] ring-1 ring-black/30"
                    style={{ minHeight: pageH }}
                  >
                    {urls[n] ? (
                      <img src={urls[n]} alt={`第 ${n} 页`} className="block w-full" draggable={false} />
                    ) : (
                      <div className="flex items-center justify-center" style={{ minHeight: pageH }}>
                        {failed[n] ? (
                          <span className="text-[12px] text-neutral-400">第 {n} 页加载失败</span>
                        ) : (
                          <span className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-500" />
                        )}
                      </div>
                    )}
                  </div>
                  <p className="mt-1.5 text-center text-[10.5px] tabular-nums text-white/25">
                    {n} / {pageCount}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
