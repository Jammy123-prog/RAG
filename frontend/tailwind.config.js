/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        // 无外网字体依赖：本机装有 Plus Jakarta Sans 则用之，否则回退系统字体
        display: ['"Plus Jakarta Sans"', 'system-ui', '-apple-system', '"PingFang SC"', '"Microsoft YaHei"', '"Noto Sans SC"', 'sans-serif'],
      },
      colors: {
        void: '#050505',
        ember: '#34d399',
        aura: '#a78bfa',
      },
      transitionTimingFunction: {
        fluid: 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
      keyframes: {
        reveal: {
          from: { opacity: 0, transform: 'translateY(1rem)', filter: 'blur(6px)' },
          to: { opacity: 1, transform: 'translateY(0)', filter: 'blur(0)' },
        },
        orb: {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '50%': { transform: 'translate(4%, -6%) scale(1.12)' },
        },
      },
      animation: {
        reveal: 'reveal 0.8s cubic-bezier(0.32,0.72,0,1) both',
        orb: 'orb 18s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
