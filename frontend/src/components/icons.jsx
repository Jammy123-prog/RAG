/* 超细线图标库（stroke=1），避免粗笔画默认图标 */
const I = ({ children, size = 20, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    {children}
  </svg>
)

export const IconChat = (p) => (
  <I {...p}>
    <path d="M21 12a8.5 8.5 0 0 1-8.5 8.5c-1.4 0-2.73-.34-3.9-.94L3.5 21l1.44-5.1A8.5 8.5 0 1 1 21 12Z" />
  </I>
)

export const IconVault = (p) => (
  <I {...p}>
    <path d="M4 6c0-.6.4-1 1-1h14c.6 0 1 .4 1 1v12c0 .6-.4 1-1 1H5c-.6 0-1-.4-1-1V6Z" />
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 8.8V7.5M12 16.5v-1.3M15.2 12h1.3M7.5 12h1.3" />
  </I>
)

export const IconPulse = (p) => (
  <I {...p}>
    <path d="M3 12h4l2.5-6 4 12 2.5-6h5" />
  </I>
)

export const IconSend = (p) => (
  <I {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </I>
)

export const IconUpload = (p) => (
  <I {...p}>
    <path d="M12 16V4m0 0 4 4m-4-4L8 8" />
    <path d="M4 15v3c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-3" />
  </I>
)

export const IconTrash = (p) => (
  <I {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12c0 1.1.9 2 2 2h6c1.1 0 2-.9 2-2l1-12M9 7V5c0-.6.4-1 1-1h4c.6 0 1 .4 1 1v2" />
  </I>
)

export const IconDoc = (p) => (
  <I {...p}>
    <path d="M6 3c-.6 0-1 .4-1 1v16c0 .6.4 1 1 1h12c.6 0 1-.4 1-1V8l-5-5H6Z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </I>
)

export const IconSpark = (p) => (
  <I {...p}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />
    <path d="M19 16l.9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9L19 16Z" />
  </I>
)

export const IconShield = (p) => (
  <I {...p}>
    <path d="M12 3 5 6v5c0 4.4 3 8.4 7 10 4-1.6 7-5.6 7-10V6l-7-3Z" />
    <path d="m9.5 12 1.8 1.8 3.2-3.6" />
  </I>
)

export const IconLayers = (p) => (
  <I {...p}>
    <path d="m12 3 9 5-9 5-9-5 9-5Z" />
    <path d="m3 13 9 5 9-5M3 17l9 5 9-5" />
  </I>
)

export const IconUsers = (p) => (
  <I {...p}>
    <path d="M16 19c0-2.2-2.2-4-5-4s-5 1.8-5 4M12 11a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" />
    <path d="M17.5 11.5a2.7 2.7 0 1 0-2-4.9M21 19c0-1.8-1.4-3.3-3.5-3.9" />
  </I>
)

export const IconQuote = (p) => (
  <I {...p}>
    <path d="M5 15c0-4.5 2.5-7 6-8l.5 1C9 9.5 8 10.8 8 12h2v6H5v-3ZM13 15c0-4.5 2.5-7 6-8l.5 1c-2.5 1.5-3.5 2.8-3.5 4h2v6h-5v-3Z" />
  </I>
)
