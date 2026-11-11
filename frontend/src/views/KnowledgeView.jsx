import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DocumentPreview from '../components/DocumentPreview.jsx'
import { createFolder, deleteDocument, deleteFolder, fetchDocuments, fetchFolders, uploadDocuments } from '../lib/api'
import { IconUpload, IconDoc, IconTrash } from '../components/icons.jsx'

const fmtSize = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)

const FolderIcon = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M3 7.5A2 2 0 0 1 5 5.5h4l2 2.5h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
)

const ChevronIcon = ({ size = 11, open = false }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform duration-300 ${open ? 'rotate-90' : ''}`}>
    <path d="m9 6 6 6-6 6" />
  </svg>
)

const SearchIcon = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
)

const PlusIcon = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
)

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

function DocRow({ d, user, onOpen, onRemove, delay }) {
  const canDelete = user?.role === 'admin' || !d.owner || d.owner === user?.username
  return (
    <div
      className="group flex items-center gap-4 rounded-[1.5rem] bg-white/[0.03] p-1.5 ring-1 ring-inset ring-white/[0.06] transition-all duration-700 ease-fluid animate-reveal hover:bg-white/[0.05] hover:ring-white/[0.1]"
      style={{ animationDelay: delay }}
    >
      <div className="flex w-full items-center gap-4 rounded-[calc(1.5rem-0.375rem)] bg-[#0b0b0d] px-5 py-4">
        <button
          onClick={() => onOpen(d)}
          className="flex min-w-0 flex-1 items-center gap-4 text-left active:scale-[0.995]"
          title="点击打开文档"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/[0.05] text-white/70 ring-1 ring-inset ring-white/[0.08] transition-colors duration-500 group-hover:text-aura">
            <IconDoc size={19} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-[15px] font-medium text-white/85 group-hover:text-white">{d.name}</span>
              {d.match === 'semantic' && (
                <span className="shrink-0 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300 ring-1 ring-inset ring-emerald-400/25">语义匹配</span>
              )}
              {d.match === 'both' && (
                <span className="shrink-0 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300 ring-1 ring-inset ring-emerald-400/25">名称+语义</span>
              )}
            </span>
            <span className="mt-1 block truncate text-[13px] text-white/35">
              {d.uploaded_at} · {d.chunks} 个分片{d.images ? ` · ${d.images} 张图` : ''} · {fmtSize(d.size)}
              {d.match_score ? ` · 相关度 ${(d.match_score * 100).toFixed(0)}%` : ''}
            </span>
          </span>
        </button>
        {(d.scope || 'public') === 'private' ? (
          <span className="hidden shrink-0 rounded-full bg-aura/10 px-3 py-1 text-[11px] font-medium text-aura ring-1 ring-inset ring-aura/25 sm:block">个人</span>
        ) : (
          <span className="hidden shrink-0 rounded-full bg-sky-400/10 px-3 py-1 text-[11px] font-medium text-sky-300 ring-1 ring-inset ring-sky-400/25 sm:block">公有</span>
        )}
        {d.owner && (
          <span className="hidden shrink-0 rounded-full bg-white/[0.05] px-2.5 py-1 text-[11px] text-white/40 ring-1 ring-inset ring-white/[0.08] md:block">{d.owner}</span>
        )}
        {canDelete ? (
          <button
            onClick={() => onRemove(d.doc_id, d.name)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/25 transition-all duration-500 ease-fluid hover:bg-red-400/10 hover:text-red-300 active:scale-90"
            aria-label="删除文档"
          >
            <IconTrash size={16} />
          </button>
        ) : (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/15" title={`仅管理员或上传者（${d.owner}）可删除`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
              <rect x="5" y="11" width="14" height="9" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
          </span>
        )}
      </div>
    </div>
  )
}

/* ---------------- 侧边栏树节点 ---------------- */

function TreeNode({ folder, depth, childrenOf, docCount, selectedId, collapsed, onToggle, onSelect, onAddChild }) {
  const kids = childrenOf(folder.id)
  const hasKids = kids.length > 0
  const open = !collapsed.has(folder.id)
  const active = selectedId === folder.id
  return (
    <div>
      <div
        className={`group flex items-center gap-1 rounded-xl pr-1 transition-all duration-300 ease-fluid ${
          active ? 'bg-aura/[0.12] ring-1 ring-inset ring-aura/25' : 'hover:bg-white/[0.05]'
        }`}
        style={{ paddingLeft: `${6 + depth * 14}px` }}
      >
        <button
          onClick={() => hasKids && onToggle(folder.id)}
          className={`flex h-6 w-5 shrink-0 items-center justify-center ${hasKids ? 'text-white/35 hover:text-white/70' : 'invisible'}`}
          aria-label="展开/收起"
        >
          <ChevronIcon open={open} />
        </button>
        <button onClick={() => onSelect(folder)} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left">
          <FolderIcon size={14} className={active ? 'shrink-0 text-aura' : 'shrink-0 text-white/35'} />
          <span className={`truncate text-[13px] ${active ? 'text-white' : 'text-white/65'}`}>{folder.name}</span>
          <span className="ml-auto shrink-0 pr-1 text-[11px] text-white/25">{docCount(folder.id)}</span>
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onAddChild(folder.id)
          }}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white/0 transition-colors duration-300 group-hover:text-white/45 hover:!text-aura"
          title="在此文件夹下新建子文件夹"
          aria-label="新建子文件夹"
        >
          <PlusIcon size={12} />
        </button>
      </div>
      {hasKids && open && (
        <div>
          {kids.map((k) => (
            <TreeNode
              key={k.id}
              folder={k}
              depth={depth + 1}
              childrenOf={childrenOf}
              docCount={docCount}
              selectedId={selectedId}
              collapsed={collapsed}
              onToggle={onToggle}
              onSelect={onSelect}
              onAddChild={onAddChild}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function KnowledgeView({ user, onStatsChange }) {
  const [docs, setDocs] = useState([])
  const [folders, setFolders] = useState([])
  // 选择：{type:'all'} 全部 | {type:'root'} 未分组 | {type:'folder', id}
  const [selection, setSelection] = useState({ type: 'all' })
  const [collapsed, setCollapsed] = useState(new Set())
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState([])
  const [toast, setToast] = useState(null)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [scope, setScope] = useState('public')
  const [creating, setCreating] = useState(null) // { parentId } | null
  const [newName, setNewName] = useState('')
  const [preview, setPreview] = useState(null)
  const inputRef = useRef(null)
  const statsRef = useRef(onStatsChange)
  statsRef.current = onStatsChange

  const refresh = useCallback(async () => {
    try {
      const [ds, fs] = await Promise.all([fetchDocuments(), fetchFolders()])
      setDocs(ds)
      setFolders(fs)
      statsRef.current?.()
    } catch {
      /* 后端未启动时静默 */
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // 文档搜索（关键词 + 语义检索，服务端合并排序）
  useEffect(() => {
    const q = search.trim()
    if (!q) {
      setSearchResults(null)
      return
    }
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        setSearchResults(await fetchDocuments(q))
      } catch {
        setSearchResults([])
      } finally {
        setSearching(false)
      }
    }, 350)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const folderMap = useMemo(() => Object.fromEntries(folders.map((f) => [f.id, f])), [folders])
  const scopeFolders = useMemo(() => folders.filter((f) => (f.scope || 'public') === scope), [folders, scope])

  const childrenOf = useCallback(
    (parentId) => scopeFolders.filter((f) => (f.parent_id || null) === (parentId || null)),
    [scopeFolders],
  )

  const subtreeDocCount = useCallback(
    (fid) =>
      docs.filter((d) => {
        let cur = d.folder_id || null
        let guard = 0
        while (cur && guard < 32) {
          if (cur === fid) return true
          cur = folderMap[cur]?.parent_id || null
          guard += 1
        }
        return false
      }).length,
    [docs, folderMap],
  )

  const path = useMemo(() => {
    if (selection.type !== 'folder') return []
    const out = []
    let cur = selection.id
    let guard = 0
    while (cur && folderMap[cur] && guard < 32) {
      out.unshift(folderMap[cur])
      cur = folderMap[cur].parent_id || null
      guard += 1
    }
    return out
  }, [selection, folderMap])

  const currentFolderId = selection.type === 'folder' ? selection.id : null
  const currentFolder = currentFolderId ? folderMap[currentFolderId] : null
  const subFolders = selection.type === 'all' ? [] : childrenOf(currentFolderId)
  const currentDocs = useMemo(
    () => (selection.type === 'all' ? docs : docs.filter((d) => (d.folder_id || null) === currentFolderId)),
    [docs, selection, currentFolderId],
  )
  const ungrouped = useMemo(() => docs.filter((d) => !d.folder_id), [docs])

  const handleFiles = async (fileList) => {
    const files = [...fileList]
    if (!files.length) return
    const target = currentFolderId || ''
    setUploading(files.map((f) => f.name))
    try {
      const res = await uploadDocuments(files, scope, target)
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

  const startCreate = (parentId = null) => {
    setCreating({ parentId })
    setNewName('')
  }

  const submitFolder = async () => {
    const name = newName.trim()
    if (!name || !creating) return
    try {
      const f = await createFolder(name, scope, creating.parentId)
      setNewName('')
      setCreating(null)
      if (creating.parentId) setCollapsed((s) => {
        const next = new Set(s)
        next.delete(creating.parentId)
        return next
      })
      await refresh()
      setSelection({ type: 'folder', id: f.id })
      setToast({ ok: true, text: `文件夹「${f.name}」已创建` })
    } catch (e) {
      setToast({ ok: false, text: e.message })
    }
  }

  const removeFolder = async (f) => {
    if (!window.confirm(`删除文件夹「${f.name}」及其所有子文件夹？其中的文档会移到上一级，不会被删除。`)) return
    try {
      await deleteFolder(f.id)
      const parent = f.parent_id ? { type: 'folder', id: f.parent_id } : { type: 'root' }
      setSelection(parent)
      setToast({ ok: true, text: `文件夹「${f.name}」已删除` })
      refresh()
    } catch (e) {
      setToast({ ok: false, text: e.message })
    }
  }

  const selectFolder = (f) => {
    setSelection({ type: 'folder', id: f.id })
    setSearch('')
  }

  const selectRoot = () => {
    setSelection({ type: 'root' })
    setSearch('')
  }

  const uploadTargetLabel = currentFolder ? path.map((p) => p.name).join(' / ') : '未分组'

  const breadcrumb = (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[13px]">
      <button
        onClick={() => setSelection({ type: 'all' })}
        className={`rounded-md px-1.5 py-0.5 transition-colors duration-300 ${selection.type === 'all' ? 'text-white' : 'text-white/40 hover:text-white/80'}`}
      >
        全部文档
      </button>
      {selection.type === 'root' && (
        <>
          <span className="text-white/20">/</span>
          <span className="text-white/85">未分组</span>
        </>
      )}
      {path.map((p, i) => (
        <span key={p.id} className="flex items-center gap-1.5">
          <span className="text-white/20">/</span>
          <button
            onClick={() => setSelection({ type: 'folder', id: p.id })}
            className={`truncate rounded-md px-1.5 py-0.5 transition-colors duration-300 ${
              i === path.length - 1 ? 'text-white' : 'text-white/45 hover:text-white/80'
            }`}
          >
            {p.name}
          </button>
        </span>
      ))}
    </div>
  )

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-24 pt-28">
      <span className="animate-reveal rounded-full bg-white/[0.04] px-3.5 py-1.5 text-[10px] font-medium uppercase tracking-[0.25em] text-white/50 ring-1 ring-inset ring-white/[0.08]">
        KNOWLEDGE VAULT
      </span>
      <h1 className="mt-6 animate-reveal text-4xl font-bold tracking-tight text-white [animation-delay:100ms] md:text-5xl">知识库管理</h1>
      <p className="mt-4 animate-reveal text-[16px] text-white/40 [animation-delay:200ms]">
        多级文件夹组织公有 / 个人知识库，上传即完成解析、切分与 bge-m3 向量化；任意文档可点开在线查看原文。问答检索范围为「公有知识库 + 你的个人知识库」。
      </p>

      <div className="mt-8 grid animate-reveal grid-cols-1 gap-6 [animation-delay:250ms] md:grid-cols-[248px_1fr]">
        {/* 左侧：目录树 */}
        <aside className="md:sticky md:top-24 md:self-start">
          <div className="rounded-[1.75rem] bg-white/[0.03] p-1.5 ring-1 ring-inset ring-white/[0.06]">
            <div className="rounded-[calc(1.75rem-0.375rem)] bg-[#0b0b0d] p-3">
              {/* 归属切换 */}
              <div className="flex rounded-full bg-white/[0.04] p-1 ring-1 ring-inset ring-white/[0.07]">
                {[
                  { key: 'public', label: '公有' },
                  { key: 'private', label: '个人' },
                ].map((o) => (
                  <button
                    key={o.key}
                    onClick={() => {
                      setScope(o.key)
                      setSelection({ type: 'all' })
                    }}
                    className={`flex-1 rounded-full py-1.5 text-[12px] font-medium transition-all duration-500 ease-fluid ${
                      scope === o.key
                        ? o.key === 'public'
                          ? 'bg-ember/15 text-ember ring-1 ring-inset ring-ember/25'
                          : 'bg-aura/15 text-aura ring-1 ring-inset ring-aura/25'
                        : 'text-white/40 hover:text-white/75'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>

              <div className="mt-3 space-y-0.5">
                <button
                  onClick={() => setSelection({ type: 'all' })}
                  className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[13px] transition-all duration-300 ${
                    selection.type === 'all' ? 'bg-white/[0.08] text-white ring-1 ring-inset ring-white/[0.12]' : 'text-white/60 hover:bg-white/[0.05]'
                  }`}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70">
                    <path d="M4 6h16M4 12h16M4 18h10" />
                  </svg>
                  全部文档
                  <span className="ml-auto text-[11px] text-white/25">{docs.length}</span>
                </button>

                <div className="mt-2 flex items-center justify-between px-2.5 pb-1 pt-2">
                  <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/25">文件夹 · {scopeFolders.length}</span>
                  <button
                    onClick={() => startCreate(null)}
                    className="flex h-5 w-5 items-center justify-center rounded-md text-white/35 transition-colors duration-300 hover:text-aura"
                    title="新建根文件夹"
                    aria-label="新建根文件夹"
                  >
                    <PlusIcon size={12} />
                  </button>
                </div>

                {/* 未分组：作为根层级的文件夹节点渲染，与根文件夹同级对齐 */}
                <div
                  className={`group flex items-center gap-1 rounded-xl pr-1 transition-all duration-300 ease-fluid ${
                    selection.type === 'root' ? 'bg-aura/[0.12] ring-1 ring-inset ring-aura/25' : 'hover:bg-white/[0.05]'
                  }`}
                  style={{ paddingLeft: '6px' }}
                >
                  <span className="flex h-6 w-5 shrink-0" aria-hidden="true" />
                  <button onClick={selectRoot} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left">
                    <FolderIcon size={14} className={selection.type === 'root' ? 'shrink-0 text-aura' : 'shrink-0 text-white/35'} />
                    <span className={`truncate text-[13px] ${selection.type === 'root' ? 'text-white' : 'text-white/65'}`}>未分组</span>
                    <span className="ml-auto shrink-0 pr-1 text-[11px] text-white/25">{ungrouped.length}</span>
                  </button>
                </div>

                {creating && !creating.parentId && (
                  <div className="mb-1 flex items-center gap-1 rounded-xl bg-white/[0.05] p-1 ring-1 ring-inset ring-white/[0.1]">
                    <input
                      autoFocus
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') submitFolder()
                        if (e.key === 'Escape') setCreating(null)
                      }}
                      placeholder="文件夹名称，回车确认"
                      className="min-w-0 flex-1 bg-transparent px-1.5 text-[12px] text-white/85 outline-none placeholder:text-white/25"
                    />
                    <button onClick={submitFolder} className="rounded-md bg-aura/20 px-2 py-0.5 text-[11px] text-aura">建</button>
                  </div>
                )}

                <div className="max-h-[46vh] overflow-y-auto pr-0.5">
                  {childrenOf(null).map((f) => (
                    <div key={f.id}>
                      <div className="group relative">
                        <TreeNode
                          folder={f}
                          depth={0}
                          childrenOf={childrenOf}
                          docCount={subtreeDocCount}
                          selectedId={currentFolderId}
                          collapsed={collapsed}
                          onToggle={(id) =>
                            setCollapsed((s) => {
                              const next = new Set(s)
                              if (next.has(id)) next.delete(id)
                              else next.add(id)
                              return next
                            })
                          }
                          onSelect={selectFolder}
                          onAddChild={(pid) => startCreate(pid)}
                        />
                        {(user?.role === 'admin' || !f.owner || f.owner === user?.username) && currentFolderId === f.id && (
                          <button
                            onClick={() => removeFolder(f)}
                            className="absolute right-7 top-1.5 flex h-6 w-6 items-center justify-center rounded-md bg-black/40 text-red-300/70 transition-colors duration-300 hover:text-red-300"
                            title="删除该文件夹"
                            aria-label="删除该文件夹"
                          >
                            <IconTrash size={11} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {scopeFolders.length === 0 && !creating && (
                    <p className="px-2.5 py-3 text-[12px] leading-relaxed text-white/25">
                      还没有文件夹，点右上角 + 新建，或在文件夹上悬停点 + 建子文件夹。
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* 右侧：内容区 */}
        <main className="min-w-0">
          {/* 面包屑 + 操作 */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            {breadcrumb}
            <div className="ml-auto flex items-center gap-2">
              {selection.type !== 'all' && (
                <button
                  onClick={() => startCreate(currentFolderId)}
                  className="flex items-center gap-1.5 rounded-full bg-white/[0.05] px-3.5 py-1.5 text-[12px] text-white/65 ring-1 ring-inset ring-white/[0.08] transition-all duration-500 ease-fluid hover:text-white active:scale-[0.97]"
                >
                  <PlusIcon size={11} />
                  {currentFolderId ? '新建子文件夹' : '新建文件夹'}
                </button>
              )}
              {currentFolder && (user?.role === 'admin' || !currentFolder.owner || currentFolder.owner === user?.username) && (
                <button
                  onClick={() => removeFolder(currentFolder)}
                  className="flex items-center gap-1.5 rounded-full bg-white/[0.03] px-3 py-1.5 text-[12px] text-white/35 ring-1 ring-inset ring-white/[0.06] transition-all duration-500 ease-fluid hover:text-red-300 active:scale-[0.97]"
                >
                  删除文件夹
                </button>
              )}
            </div>
          </div>

          {/* 搜索栏 */}
          <div className="mb-4 flex items-center gap-2 rounded-2xl bg-white/[0.04] px-4 py-2.5 ring-1 ring-inset ring-white/[0.08] transition-all duration-500 ease-fluid focus-within:ring-aura/40">
            <span className="shrink-0 text-white/30"><SearchIcon size={14} /></span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索文档：名称关键词，或描述内容做语义检索…"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-white/85 outline-none placeholder:text-white/25"
            />
            {search && (
              <button onClick={() => setSearch('')} className="shrink-0 rounded-full px-2 text-[11px] text-white/30 hover:text-white/70">
                清空
              </button>
            )}
          </div>

          {/* 新建子文件夹输入 */}
          {creating && creating.parentId && (
            <div className="mb-4 flex items-center gap-2 rounded-2xl bg-white/[0.04] p-2 ring-1 ring-inset ring-white/[0.08]">
              <span className="pl-2 text-aura"><FolderIcon size={15} /></span>
              <span className="shrink-0 text-[12px] text-white/35">在「{folderMap[creating.parentId]?.name}」下新建：</span>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitFolder()
                  if (e.key === 'Escape') setCreating(null)
                }}
                placeholder="子文件夹名称，回车确认"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-white/85 outline-none placeholder:text-white/25"
              />
              <button onClick={submitFolder} className="rounded-full bg-aura/20 px-3.5 py-1.5 text-[12px] text-aura ring-1 ring-inset ring-aura/30">创建</button>
              <button onClick={() => setCreating(null)} className="rounded-full px-2.5 py-1.5 text-[12px] text-white/40 hover:text-white/70">取消</button>
            </div>
          )}

          {/* 上传区（拖拽） */}
          <div
            className={`rounded-[1.75rem] bg-white/[0.03] p-1.5 ring-1 ring-inset transition-all duration-500 ease-fluid ${
              dragging ? 'ring-aura/40' : 'ring-white/[0.06]'
            }`}
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
            <div className={`flex flex-wrap items-center gap-4 rounded-[calc(1.75rem-0.375rem)] bg-[#0b0b0d] px-5 py-4 ${dragging ? 'bg-aura/[0.06]' : ''}`}>
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-aura/20 to-ember/15 text-aura ring-1 ring-inset ring-white/10">
                <IconUpload size={19} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium text-white/85">{dragging ? '松开即刻入库' : '拖拽文档到这里，或点击上传'}</p>
                <p className="mt-1 text-[12px] text-white/35">
                  上传到
                  <span className={`mx-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
                    scope === 'public' ? 'bg-ember/10 text-ember ring-ember/25' : 'bg-aura/10 text-aura ring-aura/25'
                  }`}>
                    {scope === 'public' ? '公有' : '个人'}
                  </span>
                  / {uploadTargetLabel} · 支持 PDF · DOCX · MD · TXT · CSV · XLSX
                </p>
              </div>
              <button
                onClick={() => inputRef.current?.click()}
                className="shrink-0 rounded-full bg-white/[0.07] px-4 py-2 text-[12.5px] text-white/75 ring-1 ring-inset ring-white/[0.1] transition-all duration-500 ease-fluid hover:bg-white/[0.12] hover:text-white active:scale-[0.97]"
              >
                选择文件
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
          </div>

          {uploading.length > 0 && (
            <div className="mt-4 grid gap-3">
              {uploading.map((n) => (
                <UploadingCard key={n} name={n} />
              ))}
            </div>
          )}

          {/* 搜索结果 */}
          {search.trim() ? (
            <div className="mt-6">
              <div className="mb-3 flex items-center justify-between px-1">
                <h2 className="text-[14px] font-semibold tracking-wide text-white/70">
                  检索「{search.trim()}」· {searchResults?.length ?? 0} 份相关文档
                </h2>
                <span className="text-[12px] text-white/30">{searching ? '检索中…' : '全库范围 · 名称+语义排序'}</span>
              </div>
              <div className="grid gap-3">
                {searchResults?.map((d, i) => (
                  <DocRow key={d.doc_id} d={d} user={user} onOpen={setPreview} onRemove={remove} delay={`${Math.min(i, 10) * 60}ms`} />
                ))}
                {searchResults?.length === 0 && !searching && (
                  <p className="rounded-2xl bg-white/[0.03] px-4 py-6 text-center text-[13px] text-white/35">
                    没有匹配「{search.trim()}」的文档，换个说法或关键词试试
                  </p>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* 子文件夹卡片 */}
              {subFolders.length > 0 && (
                <div className="mt-6">
                  <p className="mb-2.5 px-1 text-[10px] font-medium uppercase tracking-[0.18em] text-white/25">子文件夹 · {subFolders.length}</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {subFolders.map((f) => (
                      <div key={f.id} className="group rounded-[1.35rem] bg-white/[0.03] p-1.5 ring-1 ring-inset ring-white/[0.06] transition-all duration-700 ease-fluid hover:bg-white/[0.05] hover:ring-white/[0.1]">
                        <div className="flex items-center gap-3 rounded-[calc(1.35rem-0.375rem)] bg-[#0b0b0d] px-4 py-3.5">
                          <button onClick={() => selectFolder(f)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-aura/10 text-aura ring-1 ring-inset ring-aura/20">
                              <FolderIcon size={18} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[14px] font-medium text-white/85">{f.name}</span>
                              <span className="mt-0.5 block text-[11.5px] text-white/30">
                                {subtreeDocCount(f.id)} 份文档 · {childrenOf(f.id).length} 个子文件夹
                              </span>
                            </span>
                          </button>
                          {(user?.role === 'admin' || !f.owner || f.owner === user?.username) && (
                            <button
                              onClick={() => removeFolder(f)}
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/20 transition-all duration-500 ease-fluid hover:bg-red-400/10 hover:text-red-300 active:scale-90"
                              aria-label="删除文件夹"
                            >
                              <IconTrash size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 文档列表 */}
              <div className="mt-6">
                <div className="mb-3 flex items-center justify-between px-1">
                  <h2 className="text-[14px] font-semibold tracking-wide text-white/70">
                    {selection.type === 'all' ? '全部文档' : '当前文件夹文档'}
                  </h2>
                  <span className="text-[12px] text-white/30">{currentDocs.length} 份</span>
                </div>
                <div className="grid gap-3">
                  {currentDocs.map((d, i) => (
                    <DocRow key={d.doc_id} d={d} user={user} onOpen={setPreview} onRemove={remove} delay={`${Math.min(i, 10) * 60}ms`} />
                  ))}
                  {currentDocs.length === 0 && (
                    <p className="rounded-2xl bg-white/[0.03] px-4 py-8 text-center text-[13px] leading-relaxed text-white/35">
                      {selection.type === 'all'
                        ? '还没有入库文档，拖拽文件到上方上传区即可'
                        : '该文件夹暂无文档，可上传时自动归入当前文件夹'}
                      <br />
                      <span className="text-[12px] text-white/25">也可以在左侧文件夹上悬停点 + 新建子文件夹，继续分层组织</span>
                    </p>
                  )}
                </div>
              </div>
            </>
          )}
        </main>
      </div>

      {preview && <DocumentPreview doc={preview} onClose={() => setPreview(null)} />}

      {toast && (
        <div className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2 animate-reveal">
          <div className={`max-w-[90vw] rounded-full p-1 ring-1 backdrop-blur-2xl ${toast.ok ? 'bg-ember/[0.08] ring-ember/25' : 'bg-red-400/[0.08] ring-red-400/25'}`}>
            <p className={`truncate rounded-full px-5 py-2 text-[13px] ${toast.ok ? 'text-ember' : 'text-red-300'}`}>{toast.text}</p>
          </div>
        </div>
      )}

      <style>{`@keyframes slide { 0% { transform: translateX(-120%) } 100% { transform: translateX(320%) } }`}</style>
    </div>
  )
}
