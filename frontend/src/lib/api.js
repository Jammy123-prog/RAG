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

export async function fetchDocuments() {
  const res = await req('/api/documents')
  return res.json()
}

export async function deleteDocument(id) {
  const res = await req(`/api/documents/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error((await res.json()).detail || '删除失败')
}

export async function uploadDocuments(files) {
  const fd = new FormData()
  for (const f of files) fd.append('files', f)
  const res = await req('/api/documents/upload', { method: 'POST', body: fd })
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
