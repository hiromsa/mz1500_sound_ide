# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## Credits (Z80 CPU コア)

`src/core/z80/` は Konamiman 氏の **[Z80dotNet (Z80.Net)](https://github.com/Konamiman/Z80dotNet)** を
C# から TypeScript へ移植・改変したものです。

- Based on Z80dotNet, Copyright (C) 2014 Konamiman, www.konamiman.com.
- Z80dotNet のライセンス (改変版 MIT) の条項に従い、著作権表示・許諾表示の保持と改変の明示を行っています。
  ライセンス全文は [LICENSE](./LICENSE) を、移植ファイルのヘッダーは各 `.ts` ファイルの冒頭を参照してください。
