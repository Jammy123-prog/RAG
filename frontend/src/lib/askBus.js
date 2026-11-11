// 跨页提问总线：图谱页「就这个实体提问」→ 切到对话页自动发送。
// ChatView 挂载时消费一次（切换 tab 会卸载/重挂 ChatView，故用模块级暂存而非事件）。
let pending = null

export const setPendingAsk = (text) => {
  pending = text
}

export const consumePendingAsk = () => {
  const t = pending
  pending = null
  return t
}
