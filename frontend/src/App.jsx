import { useState } from 'react'
import ChatView from './views/ChatView.jsx'
import KnowledgeView from './views/KnowledgeView.jsx'
import OverviewView from './views/OverviewView.jsx'
import { IconChat, IconVault, IconPulse } from './components/icons.jsx'

const TABS = [
  { key: 'overview', label: '概览', icon: IconPulse },
  { key: 'chat', label: '对话', icon: IconChat },
  { key: 'vault', label: '知识库', icon: IconVault },
]

export default function App() {
  const [tab, setTab] = useState('overview')
  const [statsVersion, setStatsVersion] = useState(0)

  return (
    <div className="grain relative min-h-[100dvh] overflow-x-clip">
      {/* 背景纹理：固定层径向网格光晕（紫 + 翠） */}
      <div className="pointer-events-none fixed inset-0 z-0" aria-hidden="true">
        <div className="absolute -top-40 left-1/2 h-[38rem] w-[38rem] -translate-x-[70%] animate-orb rounded-full bg-aura/[0.13] blur-[130px]" />
        <div className="absolute right-[-10rem] top-1/3 h-[30rem] w-[30rem] animate-orb rounded-full bg-ember/[0.09] blur-[130px] [animation-delay:-9s]" />
        <div className="absolute bottom-[-12rem] left-[15%] h-[26rem] w-[26rem] animate-orb rounded-full bg-sky-400/[0.06] blur-[120px] [animation-delay:-4s]" />
      </div>

      {/* 浮动玻璃胶囊导航（脱离顶边） */}
      <nav className="sticky top-0 z-50 flex justify-center px-4 pt-6">
        <div className="flex items-center gap-1.5 rounded-full bg-[#0a0a0c]/70 p-1.5 ring-1 ring-white/[0.09] backdrop-blur-2xl">
          <span className="ml-3 mr-2 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-aura to-ember text-[11px] font-extrabold text-black">
              N
            </span>
            <span className="hidden text-[13px] font-bold tracking-wide text-white/90 sm:block">Nexus KB</span>
          </span>
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`group relative flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium transition-all duration-500 ease-fluid active:scale-[0.96] ${
                tab === key ? 'text-white' : 'text-white/40 hover:text-white/75'
              }`}
            >
              {tab === key && (
                <span className="absolute inset-0 rounded-full bg-white/[0.09] ring-1 ring-inset ring-white/[0.12]" />
              )}
              <Icon size={15} className="relative" />
              <span className="relative">{label}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* 视图层 */}
      <main key={tab} className="relative z-10 animate-reveal">
        {tab === 'overview' && <OverviewView statsVersion={statsVersion} />}
        {tab === 'chat' && <ChatView />}
        {tab === 'vault' && <KnowledgeView onStatsChange={() => setStatsVersion((v) => v + 1)} />}
      </main>
    </div>
  )
}
