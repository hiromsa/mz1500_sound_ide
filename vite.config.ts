import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages (https://hiromsa.github.io/mz1500_sound_ide/) 向けのサブパス設定
  base: '/mz1500_sound_ide/',
  plugins: [react(), tailwindcss()],
  test: {
    // 単体テストは src/ 配下のみを対象とする。
    // tools/qdf-probe の実測プローブ (.qdf / .bin を tools/cs-probe/out/ へ書き込む) は
    // `npm run test:probe` で明示実行する (vitest.probe.config.ts)。
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
