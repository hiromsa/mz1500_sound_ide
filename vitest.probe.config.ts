import { defineConfig } from 'vitest/config'

/**
 * 実測プローブ専用の Vitest 設定。
 * tools/qdf-probe 配下のプローブテストは .qdf / .bin を tools/cs-probe/out/ へ
 * 書き込む (副作用あり) ため、通常の `npm test` からは分離している。
 * 実行: `npm run test:probe`
 */
export default defineConfig({
  test: {
    include: ['tools/**/*.test.ts'],
  },
})