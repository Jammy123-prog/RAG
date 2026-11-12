import { useEffect, useState } from 'react'
import ChatView from './views/ChatView.jsx'
import GraphView from './views/GraphView.jsx'
import KnowledgeView from './views/KnowledgeView.jsx'
import LoginView from './views/LoginView.jsx'
import OverviewView from './views/OverviewView.jsx'
import UsersView from './views/UsersView.jsx'
import { fetchMe, logout as logoutApi, setToken, setUnauthorizedHandler } from './lib/api'
import { setPendingAsk } from './lib/askBus'
import { IconChat, IconVault, IconPulse, IconUsers, IconGraph } from './components/icons.jsx'

export default function App() {
  const [user, setUser] = useState(null)
  const [checking, setChecking] = useState(true)
  const [tab, setTab] = useState('chat')
  const [statsVersion, setStatsVersion] = useState(0)

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null))
    fetchMe()
      .then((u) => u && setUser(u))
      .catch(() => {})
      .finally(() => setChecking(false))
  }, [])

  const logout = () => {
    logoutApi() // 服务端吊销令牌（异步，不阻塞界面）
    setToken(null)
    setUser(null)
    setTab('chat')
  }

  if (checking) {
    return (
      <div className="grain flex min-h-[100dvh] items-center justify-center bg-void">
        <div className="flex gap-2">
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-white/40" style={{ animationDelay: `${i * 150}ms` }} />
          ))}
        </div>
      </div>
    )
  }

  if (!user) return <LoginView onLogin={setUser} />

  const isAdmin = user.role === 'admin'
  const TABS = [
    { key: 'chat', label: '对话', icon: IconChat },
    { key: 'vault', label: '知识库', icon: IconVault },
    { key: 'graph', label: '图谱', icon: IconGraph },
    { key: 'overview', label: '概览', icon: IconPulse },
    ...(isAdmin ? [{ key: 'users', label: '用户', icon: IconUsers }] : []),
  ]

  return (
    <div className="grain relative min-h-[100dvh] overflow-x-clip">
      {/* 背景纹理：固定层径向网格光晕（紫 + 翠） */}
      <div className="pointer-events-none fixed inset-0 z-0" aria-hidden="true">
        <div className="absolute -top-40 left-1/2 h-[38rem] w-[38rem] -translate-x-[70%] animate-orb rounded-full bg-aura/[0.13] blur-[130px]" />
        <div className="absolute right-[-10rem] top-1/3 h-[30rem] w-[30rem] animate-orb rounded-full bg-ember/[0.09] blur-[130px] [animation-delay:-9s]" />
        <div className="absolute bottom-[-12rem] left-[15%] h-[26rem] w-[26rem] animate-orb rounded-full bg-sky-400/[0.06] blur-[120px] [animation-delay:-4s]" />
      </div>

      {/* 固定悬浮导航（脱离顶边，渐变遮罩防止内容越过顶栏） */}
      <nav className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center bg-gradient-to-b from-void via-void/85 to-transparent pb-10 pt-6">
        <div className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-[#0a0a0c]/70 p-1.5 ring-1 ring-white/[0.09] backdrop-blur-2xl">
          <span className="ml-3 mr-2 flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-aura to-ember text-[12px] font-extrabold text-black">
              N
            </span>
            <span className="hidden text-[15px] font-bold tracking-wide text-white/90 sm:block">Nexus KB</span>
          </span>
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`group relative flex items-center gap-2 rounded-full px-[18px] py-2.5 text-[14px] font-medium transition-all duration-500 ease-fluid active:scale-[0.96] ${
                tab === key ? 'text-white' : 'text-white/40 hover:text-white/75'
              }`}
            >
              {tab === key && <span className="absolute inset-0 rounded-full bg-white/[0.09] ring-1 ring-inset ring-white/[0.12]" />}
              <Icon size={17} className="relative" />
              <span className="relative hidden sm:block">{label}</span>
            </button>
          ))}
          {/* 用户身份 + 登出 */}
          <span className="mx-1 hidden h-5 w-px bg-white/10 md:block" />
          <button
            onClick={logout}
            className="group ml-1 mr-2 flex items-center gap-2 rounded-full py-2 pl-3.5 pr-2 text-[13px] text-white/50 transition-colors duration-500 ease-fluid hover:text-white/90 active:scale-[0.96]"
            title="退出登录"
          >
            <span className="max-w-28 truncate">{user.username}</span>
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.06] ring-1 ring-inset ring-white/[0.1] transition-transform duration-500 ease-fluid group-hover:translate-x-0.5">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 3H5c-.6 0-1 .4-1 1v16c0 .6.4 1 1 1h4M16 17l5-5-5-5M21 12H9" />
              </svg>
            </span>
          </button>
        </div>
      </nav>

      {/* 视图层 */}
      <main key={tab} className="relative z-10 animate-reveal">
        {tab === 'overview' && <OverviewView statsVersion={statsVersion} />}
        {tab === 'chat' && <ChatView />}
        {tab === 'vault' && <KnowledgeView user={user} onStatsChange={() => setStatsVersion((v) => v + 1)} />}
        {tab === 'graph' && (
          <GraphView
            user={user}
            onAsk={(text) => {
              setPendingAsk(text)
              setTab('chat')
            }}
          />
        )}
        {tab === 'users' && isAdmin && <UsersView me={user} />}
      </main>
    </div>
  )
}
