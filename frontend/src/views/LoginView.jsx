import { useState } from 'react'
import { login, register, setToken } from '../lib/api'

export default function LoginView({ onLogin }) {
  const [mode, setMode] = useState('login') // login | register
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const fn = mode === 'login' ? login : register
      const { token, user } = await fn(username.trim(), password)
      setToken(token)
      onLogin(user)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grain relative flex min-h-[100dvh] items-center justify-center overflow-x-clip px-4 py-10">
      {/* 背景光晕 */}
      <div className="pointer-events-none fixed inset-0 z-0" aria-hidden="true">
        <div className="absolute -top-40 left-1/2 h-[34rem] w-[34rem] -translate-x-1/2 animate-orb rounded-full bg-aura/[0.14] blur-[130px]" />
        <div className="absolute bottom-[-12rem] right-[-8rem] h-[28rem] w-[28rem] animate-orb rounded-full bg-ember/[0.09] blur-[130px] [animation-delay:-9s]" />
      </div>

      {/* 登录卡（双层边框） */}
      <div className="relative z-10 w-full max-w-md animate-reveal">
        <div className="rounded-[2.25rem] bg-white/[0.05] p-2 ring-1 ring-white/[0.09] backdrop-blur-xl">
          <div className="rounded-[calc(2.25rem-0.5rem)] bg-[#0b0b0d] p-10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)] md:p-12">
            <div className="flex flex-col items-center text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-[1.3rem] bg-gradient-to-br from-aura to-ember text-xl font-extrabold text-black">
                N
              </span>
              <span className="mt-6 rounded-full bg-white/[0.04] px-3.5 py-1.5 text-[10px] font-medium uppercase tracking-[0.25em] text-white/50 ring-1 ring-inset ring-white/[0.08]">
                NEXUS ENTERPRISE KB
              </span>
              <h1 className="mt-5 text-3xl font-bold tracking-tight text-white">
                {mode === 'login' ? '欢迎回来' : '创建账号'}
              </h1>
              <p className="mt-2 text-[13px] text-white/40">
                {mode === 'login' ? '登录你的企业知识库工作台' : '首位注册用户将成为管理员'}
              </p>
            </div>

            <form onSubmit={submit} className="mt-10 flex flex-col gap-4">
              <div className="flex gap-3">
                <label className="flex flex-1 flex-col gap-2">
                  <span className="px-1 text-[11px] font-medium tracking-wide text-white/45">用户名</span>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    required
                    className="rounded-2xl bg-white/[0.04] px-5 py-3.5 text-[15px] text-white outline-none ring-1 ring-inset ring-white/[0.09] transition-all duration-500 ease-fluid placeholder:text-white/25 focus:ring-aura/50"
                    placeholder="你的用户名"
                  />
                </label>
              </div>
              <label className="flex flex-col gap-2">
                <span className="px-1 text-[11px] font-medium tracking-wide text-white/45">密码</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                  className="rounded-2xl bg-white/[0.04] px-5 py-3.5 text-[15px] text-white outline-none ring-1 ring-inset ring-white/[0.09] transition-all duration-500 ease-fluid placeholder:text-white/25 focus:ring-aura/50"
                  placeholder="••••••••"
                />
              </label>

              {error && (
                <p className="rounded-2xl bg-red-400/[0.08] px-4 py-3 text-[13px] text-red-300 ring-1 ring-inset ring-red-400/25">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={busy}
                className="group mt-2 flex items-center justify-center gap-3 rounded-full bg-gradient-to-br from-aura to-aura/70 py-3.5 text-[14px] font-semibold text-white shadow-[0_8px_28px_-8px_rgba(167,139,250,0.55)] transition-all duration-500 ease-fluid hover:shadow-[0_12px_32px_-8px_rgba(167,139,250,0.75)] active:scale-[0.97] disabled:opacity-40"
              >
                {busy ? '请稍候…' : mode === 'login' ? '登 录' : '注 册'}
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 transition-transform duration-500 ease-fluid group-hover:translate-x-0.5 group-hover:-translate-y-px">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </span>
              </button>
            </form>

            <button
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login')
                setError(null)
              }}
              className="mt-8 w-full text-center text-[13px] text-white/40 transition-colors duration-500 ease-fluid hover:text-white/80"
            >
              {mode === 'login' ? '没有账号？注册一个 →' : '← 已有账号，直接登录'}
            </button>
          </div>
        </div>
        <p className="mt-6 text-center text-[11px] text-white/25">
          Qwen3-14B + bge-m3 · 全链路私有化部署 · 数据不出企业内网
        </p>
      </div>
    </div>
  )
}
