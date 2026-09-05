import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages (https://hiromsa.github.io/mz1500_sound_ide/) 向けのサブパス設定
  base: '/mz1500_sound_ide/',
  plugins: [react(), tailwindcss()],
})
