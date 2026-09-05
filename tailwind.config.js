/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        mz: {
          dark: '#0f172a', // slate-900 (チャコールブラックベース)
          black: '#000000', // 真っ黒
          blue: '#06b6d4', // cyan-500 (QDブルー)
          red: '#dc2626', // red-600 (MZレッド)
          white: '#f8fafc', // slate-50 (オフホワイト)
          fkey: '#334155', // slate-700 (Fキーのくすんだブルー/グレー系)
          panel: '#1e293b', // slate-800 (パネルの背景)
          border: '#334155', // ボーダー色
        }
      },
      backgroundImage: {
        'qd-grid': 'linear-gradient(rgba(6, 182, 212, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(6, 182, 212, 0.1) 1px, transparent 1px)',
      },
      backgroundSize: {
        'qd-grid': '20px 20px', // グリッドのサイズ
      },
    },
  },
  plugins: [],
}
