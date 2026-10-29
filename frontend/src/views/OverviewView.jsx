import { useEffect, useState } from 'react'
import { fetchHealth, fetchStats } from '../lib/api'
import { IconLayers, IconSpark, IconShield, IconPulse } from '../components/icons.jsx'

const PIPELINE = [
  { step: '01', name: '文档加载', desc: 'PDF / Word / Markdown / 表格统一解析' },
  { step: '02', name: '智能切分', desc: '中文友好递归分片，500 字 · 80 字重叠' },
  { step: '03', name: '向量化', desc: 'bge-m3 嵌入，1024 维语义向量' },
  { step: '04', name: '语义检索', desc: 'Chroma cosine 召回 Top-K 分片' },
  { step: '05', name: '增强生成', desc: 'Qwen3-14B 引用式流式回答' },
]

function StatBig({ value, label, sub, delay }) {
  return (
    <div
      className="animate-reveal rounded-[2rem] bg-white/[0.04] p-2 ring-1 ring-white/[0.07] transition-all duration-700 ease-fluid hover:bg-white/[0.06]"
      style={{ animationDelay: delay }}
    >
      <div className="flex h-full flex-col justify-between rounded-[calc(2rem-0.5rem)] bg-[#0b0b0d] p-7 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]">
        <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-white/35">{label}</span>
        <div className="mt-10">
          <p className="text-5xl font-bold tracking-tight text-white md:text-6xl">{value}</p>
          <p className="mt-2 text-[13px] text-white/40">{sub}</p>
        </div>
      </div>
    </div>
  )
}

export default function OverviewView({ statsVersion }) {
  const [stats, setStats] = useState({ documents: 0, chunks: 0 })
  const [health, setHealth] = useState(null)

  useEffect(() => {
    fetchStats().then(setStats).catch(() => {})
    fetchHealth().then(setHealth).catch(() => setHealth(null))
  }, [statsVersion])

  const alive = !!health

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-24 pt-16 md:pt-24">
      <span className="animate-reveal rounded-full bg-white/[0.04] px-3.5 py-1.5 text-[10px] font-medium uppercase tracking-[0.25em] text-white/50 ring-1 ring-inset ring-white/[0.08]">
        SYSTEM OVERVIEW
      </span>
      <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
        <h1 className="max-w-xl animate-reveal text-4xl font-bold leading-[1.1] tracking-tight text-white [animation-delay:100ms] md:text-6xl">
          私有化部署的
          <span className="bg-gradient-to-r from-aura via-white to-ember bg-clip-text text-transparent">企业大脑</span>
        </h1>
        <div
          className={`flex animate-reveal items-center gap-2.5 rounded-full bg-white/[0.04] py-2 pl-3 pr-4 text-[12px] ring-1 ring-inset [animation-delay:200ms] ${
            alive ? 'text-ember ring-ember/25' : 'text-white/40 ring-white/10'
          }`}
        >
          <span className={`relative flex h-2 w-2`}>
            <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${alive ? 'bg-ember' : 'bg-white/30'}`} />
            <span className={`relative inline-flex h-2 w-2 rounded-full ${alive ? 'bg-ember' : 'bg-white/40'}`} />
          </span>
          {alive ? `服务正常 · ${health.llm}` : '后端未连接（请启动 uvicorn）'}
        </div>
      </div>

      {/* 非对称 Bento */}
      <div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-12 md:gap-5">
        <div className="md:col-span-5 md:row-span-2">
          <StatBig value={stats.documents} label="知识文档" sub="已入库并向量化的企业文档" delay="300ms" />
        </div>
        <div className="md:col-span-7">
          <StatBig value={stats.chunks} label="知识分片" sub="可被语义检索召回的向量单元" delay="400ms" />
        </div>
        <div className="md:col-span-7">
          <div className="animate-reveal rounded-[2rem] bg-white/[0.04] p-2 ring-1 ring-white/[0.07] [animation-delay:500ms]">
            <div className="rounded-[calc(2rem-0.5rem)] bg-[#0b0b0d] p-7 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-aura/15 text-aura ring-1 ring-inset ring-aura/25">
                  <IconLayers size={17} />
                </span>
                <h3 className="text-[15px] font-semibold text-white/85">RAG 增强链路</h3>
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-2">
                {PIPELINE.map((p, i) => (
                  <div key={p.step} className="flex items-center gap-2">
                    <div className="rounded-2xl bg-white/[0.04] px-4 py-2.5 ring-1 ring-inset ring-white/[0.07] transition-all duration-700 ease-fluid hover:bg-white/[0.07]">
                      <p className="text-[12px] font-medium text-white/80">
                        <span className="mr-1.5 text-[10px] text-aura">{p.step}</span>
                        {p.name}
                      </p>
                    </div>
                    {i < PIPELINE.length - 1 && <span className="text-white/20">→</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 特性卡：非对称三卡 */}
      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-12 md:gap-5">
        <div className="animate-reveal rounded-[2rem] bg-white/[0.04] p-2 ring-1 ring-white/[0.07] [animation-delay:600ms] md:col-span-4">
          <div className="h-full rounded-[calc(2rem-0.5rem)] bg-[#0b0b0d] p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-ember/10 text-ember ring-1 ring-inset ring-ember/20">
              <IconSpark size={18} />
            </span>
            <h3 className="mt-5 text-[15px] font-semibold text-white/85">引用式回答</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-white/40">
              答案逐句标注 [n] 来源，检索分数可视化，拒绝黑盒幻觉。
            </p>
          </div>
        </div>
        <div className="animate-reveal rounded-[2rem] bg-white/[0.04] p-2 ring-1 ring-white/[0.07] [animation-delay:700ms] md:col-span-4">
          <div className="h-full rounded-[calc(2rem-0.5rem)] bg-[#0b0b0d] p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-aura/10 text-aura ring-1 ring-inset ring-aura/20">
              <IconPulse size={18} />
            </span>
            <h3 className="mt-5 text-[15px] font-semibold text-white/85">智能召回编排</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-white/40">
              多轮对话自动查询改写；检索未命中时无缝切换模型兜底。
            </p>
          </div>
        </div>
        <div className="animate-reveal rounded-[2rem] bg-white/[0.04] p-2 ring-1 ring-white/[0.07] [animation-delay:800ms] md:col-span-4">
          <div className="h-full rounded-[calc(2rem-0.5rem)] bg-[#0b0b0d] p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-400/10 text-sky-300 ring-1 ring-inset ring-sky-300/20">
              <IconShield size={18} />
            </span>
            <h3 className="mt-5 text-[15px] font-semibold text-white/85">全链路私有化</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-white/40">
              Qwen3-14B + bge-m3 + Chroma 全部本地运行，数据不出企业内网。
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
