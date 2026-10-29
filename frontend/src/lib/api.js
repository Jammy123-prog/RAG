const BASE = ''

export async function fetchHealth() {
  const res = await fetch(`${BASE}/api/health`)
  return res.json()
}

export async function fetchStats() {
  const res = await fetch(`${BASE}/api/stats`)
  return res.json()
}

export async function fetchDocuments() {
  const res = await fetch(`${BASE}/api/documents`)
  return res.json()
}

export async function deleteDocument(id) {
  const res = await fetch(`${BASE}/api/documents/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('删除失败')
}

export async function uploadDocuments(files) {
  const fd = new FormData()
  for (const f of files) fd.append('files', f)
  const res = await fetch(`${BASE}/api/documents/upload`, { method: 'POST', body: fd })
  return res.json()
}

/**
 * SSE 流式对话。handlers: { meta, delta, done, error }
 */
export async function streamChat({ message, history }, handlers) {
  const res = await fetch(`${BASE}/api/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history }),
  })
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
