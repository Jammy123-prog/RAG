import { useCallback, useEffect, useState } from 'react'
import { deleteAdminUser, fetchAdminUsers } from '../lib/api'
import { IconTrash, IconUsers } from '../components/icons.jsx'

export default function UsersView({ me }) {
  const [users, setUsers] = useState([])
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    try {
      setUsers(await fetchAdminUsers())
      setError(null)
    } catch (e) {
      setError(e.message)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const remove = async (u) => {
    if (!window.confirm(`删除用户「${u.username}」？其全部会话记录将一并清除。`)) return
    try {
      await deleteAdminUser(u.id)
      refresh()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-16 md:pt-24">
      <span className="animate-reveal rounded-full bg-white/[0.04] px-3.5 py-1.5 text-[10px] font-medium uppercase tracking-[0.25em] text-white/50 ring-1 ring-inset ring-white/[0.08]">
        USER MANAGEMENT
      </span>
      <h1 className="mt-6 animate-reveal text-4xl font-bold tracking-tight text-white [animation-delay:100ms] md:text-5xl">
        用户管理
      </h1>
      <p className="mt-4 animate-reveal text-[15px] text-white/40 [animation-delay:200ms]">
        共 {users.length} 个账号。首个注册用户为管理员；每个用户的提问与会话数据完全隔离。
      </p>

      {error && (
        <p className="mt-8 rounded-2xl bg-red-400/[0.08] px-4 py-3 text-[13px] text-red-300 ring-1 ring-inset ring-red-400/25">
          {error}
        </p>
      )}

      <div className="mt-10 grid gap-3">
        {users.map((u, i) => (
          <div
            key={u.id}
            className="group flex items-center gap-4 rounded-[1.5rem] bg-white/[0.03] p-1.5 ring-1 ring-inset ring-white/[0.06] transition-all duration-700 ease-fluid animate-reveal hover:bg-white/[0.05] hover:ring-white/[0.1]"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className="flex w-full items-center gap-4 rounded-[calc(1.5rem-0.375rem)] bg-[#0b0b0d] px-5 py-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/[0.05] text-white/70 ring-1 ring-inset ring-white/[0.08]">
                {u.role === 'admin' ? <IconUsers size={19} /> : <IconUsers size={19} className="text-white/40" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-[14px] font-medium text-white/85">
                  <span className="truncate">{u.username}</span>
                  {u.role === 'admin' && (
                    <span className="shrink-0 rounded-full bg-aura/10 px-2 py-0.5 text-[10px] font-medium text-aura ring-1 ring-inset ring-aura/25">
                      管理员
                    </span>
                  )}
                  {u.id === me.uid && <span className="shrink-0 text-[10px] text-white/30">（我）</span>}
                </p>
                <p className="mt-1 text-[12px] text-white/35">注册于 {u.created_at}</p>
              </div>
              {u.id !== me.uid && (
                <button
                  onClick={() => remove(u)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/25 transition-all duration-500 ease-fluid hover:bg-red-400/10 hover:text-red-300 active:scale-90"
                  aria-label="删除用户"
                >
                  <IconTrash size={16} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
