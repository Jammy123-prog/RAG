import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createTeam,
  deleteAdminUser,
  deleteTeam,
  fetchAdminUsers,
  fetchTeams,
  fetchUserDirectory,
  updateTeam,
} from '../lib/api'
import { IconTrash, IconUsers, IconShield } from '../components/icons.jsx'

/* ---------------- 团队管理（管理员把成员打包成团队，权限可整体授予团队） ---------------- */

function TeamsSection({ usernames }) {
  const [teams, setTeams] = useState([])
  const [name, setName] = useState('')
  const [picked, setPicked] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const refresh = useCallback(async () => {
    try {
      setTeams(await fetchTeams())
    } catch (e) {
      setErr(e.message)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const toggle = (u) =>
    setPicked((ps) => (ps.includes(u) ? ps.filter((x) => x !== u) : [...ps, u]))

  const submit = async () => {
    const n = name.trim()
    if (!n) return
    setBusy(true)
    setErr('')
    try {
      await createTeam(n, picked)
      setName('')
      setPicked([])
      refresh()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const patchMembers = async (team, members) => {
    setErr('')
    try {
      await updateTeam(team.id, team.name, members)
      refresh()
    } catch (e) {
      setErr(e.message)
    }
  }

  const removeTeam = async (team) => {
    setErr('')
    try {
      await deleteTeam(team.id)
      refresh()
    } catch (e) {
      setErr(e.message)
    }
  }

  const available = useMemo(() => usernames.filter((u) => !picked.includes(u)), [usernames, picked])

  return (
    <section className="mt-12">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[17px] font-semibold text-white/85">团队</h2>
          <p className="mt-1 text-[12px] text-white/35">
            把成员打包成团队，在文件夹/文档的「成员权限」里直接授权团队：团队成员自动获得对应查看或编辑权限。
          </p>
        </div>
        <span className="shrink-0 text-[12px] text-white/25">{teams.length} 个团队</span>
      </div>

      {/* 新建团队 */}
      <div className="mt-5 rounded-[1.5rem] bg-white/[0.03] p-1.5 ring-1 ring-inset ring-white/[0.06]">
        <div className="rounded-[calc(1.5rem-0.375rem)] bg-[#0b0b0d] px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="团队名称，例如：希腊项目组"
              className="min-w-[12rem] flex-1 rounded-xl bg-white/[0.04] px-3.5 py-2 text-[13px] text-white/85 ring-1 ring-inset ring-white/[0.08] outline-none transition-colors duration-300 placeholder:text-white/25 focus:ring-aura/40"
            />
            <button
              onClick={submit}
              disabled={busy || !name.trim()}
              className="shrink-0 rounded-full bg-gradient-to-br from-aura to-aura/70 px-5 py-2 text-[13px] font-medium text-white shadow-[0_8px_24px_-8px_rgba(167,139,250,0.55)] transition-all duration-500 ease-fluid active:scale-[0.97] disabled:opacity-40"
            >
              {busy ? '创建中…' : '创建团队'}
            </button>
          </div>
          <p className="mb-2 mt-4 text-[12px] text-white/45">
            选择成员 · {picked.length}
            {picked.length > 0 && (
              <button onClick={() => setPicked([])} className="ml-3 text-[11px] text-white/30 hover:text-white/60">
                清空
              </button>
            )}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {usernames.length === 0 && <span className="text-[12px] text-white/25">暂无可选用户</span>}
            {usernames.map((u) => {
              const on = picked.includes(u)
              return (
                <button
                  key={u}
                  onClick={() => toggle(u)}
                  className={`rounded-full px-3 py-1.5 text-[12px] transition-all duration-300 ease-fluid active:scale-95 ${
                    on
                      ? 'bg-aura/15 text-aura ring-1 ring-inset ring-aura/30'
                      : 'bg-white/[0.04] text-white/45 ring-1 ring-inset ring-white/[0.07] hover:text-white/75'
                  }`}
                >
                  {u}
                </button>
              )
            })}
          </div>
          {available.length === 0 && usernames.length > 0 && (
            <p className="mt-2 text-[11px] text-white/25">已选择全部用户</p>
          )}
        </div>
      </div>

      {err && (
        <p className="mt-4 rounded-2xl bg-red-400/[0.08] px-4 py-3 text-[13px] text-red-300 ring-1 ring-inset ring-red-400/25">
          {err}
        </p>
      )}

      {/* 团队列表 */}
      <div className="mt-5 grid gap-3">
        {teams.length === 0 && (
          <p className="rounded-[1.5rem] bg-white/[0.03] px-5 py-6 text-[12px] leading-relaxed text-white/30 ring-1 ring-inset ring-white/[0.06]">
            还没有团队。创建后即可在文件夹或文档的「成员权限」里，把访问权限一次性授予整个团队。
          </p>
        )}
        {teams.map((t, i) => (
          <div
            key={t.id}
            className="group flex items-center gap-4 rounded-[1.5rem] bg-white/[0.03] p-1.5 ring-1 ring-inset ring-white/[0.06] transition-all duration-700 ease-fluid animate-reveal hover:bg-white/[0.05] hover:ring-white/[0.1]"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className="flex w-full flex-col gap-3 rounded-[calc(1.5rem-0.375rem)] bg-[#0b0b0d] px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sky-400/10 text-sky-300 ring-1 ring-inset ring-sky-400/20">
                  <IconShield size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-white/85">{t.name}</p>
                  <p className="mt-0.5 text-[12px] text-white/35">{t.members?.length || 0} 名成员</p>
                </div>
                <button
                  onClick={() => removeTeam(t)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/25 transition-all duration-500 ease-fluid hover:bg-red-400/10 hover:text-red-300 active:scale-90"
                  aria-label="删除团队"
                  title="删除团队（同时清理该团队的全部授权）"
                >
                  <IconTrash size={16} />
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(t.members || []).length === 0 && <span className="text-[12px] text-white/25">暂无成员</span>}
                {(t.members || []).map((m) => (
                  <button
                    key={m}
                    onClick={() => patchMembers(t, (t.members || []).filter((x) => x !== m))}
                    className="group/chip flex items-center gap-1.5 rounded-full bg-white/[0.05] px-2.5 py-1 text-[12px] text-white/60 ring-1 ring-inset ring-white/[0.08] transition-colors duration-300 hover:text-red-300"
                    title="点击移出团队"
                  >
                    {m}
                    <span className="text-white/25 group-hover/chip:text-red-300">×</span>
                  </button>
                ))}
                {usernames
                  .filter((u) => !(t.members || []).includes(u))
                  .map((u) => (
                    <button
                      key={`add-${u}`}
                      onClick={() => patchMembers(t, [...(t.members || []), u])}
                      className="rounded-full border border-dashed border-white/15 px-2.5 py-1 text-[12px] text-white/25 transition-colors duration-300 hover:border-aura/40 hover:text-aura"
                      title={`把 ${u} 加入团队`}
                    >
                      + {u}
                    </button>
                  ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export default function UsersView({ me }) {
  const [users, setUsers] = useState([])
  const [directory, setDirectory] = useState([])
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const [list, dir] = await Promise.all([fetchAdminUsers(), fetchUserDirectory().catch(() => [])])
      setUsers(list)
      setDirectory(Array.isArray(dir) ? dir.map((u) => u.username) : [])
      setError(null)
    } catch (e) {
      setError(e.message)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const remove = async (u) => {
    try {
      await deleteAdminUser(u.id)
      refresh()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-28">
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

      <TeamsSection usernames={directory} />
    </div>
  )
}
