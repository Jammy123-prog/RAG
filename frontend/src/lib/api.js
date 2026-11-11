const BASE = ''

let token = localStorage.getItem('kb_token')
let onUnauthorized = null

export const setToken = (t) => {
  token = t
  if (t) localStorage.setItem('kb_token', t)
  else localStorage.removeItem('kb_token')
}

export const hasToken = () => !!token

/** 401 时回调（App 用于登出并回到登录页） */
export const setUnauthorizedHandler = (fn) => {
  onUnauthorized = fn
}

async function req(path, opts = {}) {
  const headers = { ...(opts.headers || {}) }
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (opts.body && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${BASE}${path}`, { ...opts, headers })
  if (res.status === 401) {
    setToken(null)
    onUnauthorized?.()
    throw new Error('登录已过期，请重新登录')
  }
  return res
}

// ---------------- 认证 ----------------

export async function register(username, password) {
  const res = await req('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
  if (!res.ok) throw new Error((await res.json()).detail || '注册失败')
  return res.json()
}

export async function login(username, password) {
  const res = await req('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
  if (!res.ok) throw new Error((await res.json()).detail || '登录失败')
  return res.json()
}

export async function fetchMe() {
  if (!token) return null
  const res = await req('/api/auth/me')
  if (!res.ok) return null
  return res.json()
}

export async function fetchAdminUsers() {
  const res = await req('/api/admin/users')
  if (!res.ok) throw new Error('获取用户列表失败')
  return res.json()
}

export async function deleteAdminUser(uid) {
  const res = await req(`/api/admin/users/${uid}`, { method: 'DELETE' })
  if (!res.ok) throw new Error((await res.json()).detail || '删除失败')
}

// ---------------- 会话 ----------------

export async function listConversations() {
  const res = await req('/api/conversations')
  return res.json()
}

export async function deleteConversation(id) {
  const res = await req(`/api/conversations/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('删除会话失败')
}

export async function fetchMessages(id) {
  const res = await req(`/api/conversations/${id}/messages`)
  return res.json()
}

// ---------------- 文档与统计 ----------------

export async function fetchHealth() {
  const res = await fetch(`${BASE}/api/health`)
  return res.ok ? res.json() : null
}

export async function fetchStats() {
  const res = await req('/api/stats')
  return res.json()
}

export async function fetchDocuments(q = '', folderId = '') {
  const p = new URLSearchParams()
  if (q) p.set('q', q)
  if (folderId) p.set('folder_id', folderId)
  const qs = p.toString()
  const res = await req(`/api/documents${qs ? `?${qs}` : ''}`)
  return res.json()
}

export async function deleteDocument(id) {
  const res = await req(`/api/documents/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error((await res.json()).detail || '删除失败')
}

export async function uploadDocuments(files, scope = 'public', folderId = '') {
  const fd = new FormData()
  for (const f of files) fd.append('files', f)
  fd.append('scope', scope)
  fd.append('folder_id', folderId || '')
  const res = await req('/api/documents/upload', { method: 'POST', body: fd })
  return res.json()
}

// ---------------- 知识库文件夹 ----------------

export async function fetchFolders() {
  const res = await req('/api/folders')
  return res.ok ? res.json() : []
}

export async function createFolder(name, scope = 'public', parentId = null) {
  const res = await req('/api/folders', { method: 'POST', body: JSON.stringify({ name, scope, parent_id: parentId || null }) })
  if (!res.ok) throw new Error((await res.json()).detail || '创建文件夹失败')
  return res.json()
}

export async function deleteFolder(id) {
  const res = await req(`/api/folders/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error((await res.json()).detail || '删除文件夹失败')
  return res.json()
}

// ---------------- 文档预览 ----------------

export async function fetchDocumentPreview(docId) {
  const res = await req(`/api/documents/${docId}/preview`)
  if (!res.ok) throw new Error((await res.json()).detail || '无法预览该文档')
  return res.json()
}

/** 取原文件 blob（带鉴权），返回可直接给 iframe/img 用的本地 URL，调用方负责 revoke。 */
export async function fetchDocumentBlobUrl(docId) {
  const res = await req(`/api/documents/${docId}/file`)
  if (!res.ok) throw new Error((await res.json()).detail || '原文件未保留')
  return URL.createObjectURL(await res.blob())
}

/** 页面级预览元信息：{mode: 'pages'|'image'|'none', page_count} */
export async function fetchDocumentPages(docId) {
  const res = await req(`/api/documents/${docId}/pages`)
  if (!res.ok) throw new Error('该文档暂不支持页面预览')
  return res.json()
}

/** 渲染指定页为图片（带鉴权取 blob，调用方负责 revoke） */
export async function fetchDocumentPageBlobUrl(docId, pageNo, scale = 2) {
  const res = await req(`/api/documents/${docId}/page/${pageNo}?scale=${scale}`)
  if (!res.ok) throw new Error('该页无法加载')
  return URL.createObjectURL(await res.blob())
}

// ---------------- 知识图谱 ----------------

export async function fetchKgGraph() {
  const res = await req('/api/kg/graph')
  return res.json()
}

export async function buildKgGraph() {
  const res = await req('/api/kg/build', { method: 'POST' })
  if (!res.ok) throw new Error((await res.json()).detail || '构建请求失败')
  return res.json()
}

export async function searchKgEntities(q) {
  const res = await req(`/api/kg/entities?q=${encodeURIComponent(q)}`)
  if (!res.ok) throw new Error('实体搜索失败')
  return res.json()
}

export async function fetchKgEntity(name) {
  const res = await req(`/api/kg/entity/${encodeURIComponent(name)}`)
  if (!res.ok) throw new Error((await res.json()).detail || '获取实体详情失败')
  return res.json()
}

/**
 * SSE 流式对话。handlers: { conv, meta, delta, done, error }
 */
export async function streamChat({ message, conversationId }, handlers) {
  const res = await fetch(`${BASE}/api/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ message, conversation_id: conversationId }),
  })
  if (res.status === 401) {
    setToken(null)
    onUnauthorized?.()
    throw new Error('登录已过期，请重新登录')
  }
  if (!res.ok || !res.body) throw new Error('服务不可用，请检查后端与模型是否已启动')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const parts = buf.split('\n\n')
    buf = parts.pop()
    for (const part of parts) {
      let ev = 'message'
      let data = ''
      for (const line of part.split('\n')) {
        if (line.startsWith('event: ')) ev = line.slice(7).trim()
        else if (line.startsWith('data: ')) data += line.slice(6)
      }
      if (!data) continue
      try {
        handlers[ev]?.(JSON.parse(data))
      } catch {
        /* 忽略残包 */
      }
    }
  }
}
