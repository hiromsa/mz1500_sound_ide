/// <reference types="node" />
/**
 * samples/ 配下の全 .mml サンプルがエラー・警告ゼロでコンパイルできることを検証する。
 * (サンプルはリファレンス実装であるため、仕様変更時の回帰検出も兼ねる)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MmlCompiler } from '../MmlCompiler';

const samplesDir = join(
  fileURLToPath(new URL('../../../../', import.meta.url)),
  'samples',
  'mml_reference',
);

function collectMmlFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectMmlFiles(path));
    } else if (entry.name.endsWith('.mml')) {
      files.push(path);
    }
  }

  return files;
}

describe('samples/*.mml compile without errors or warnings', () => {
  const files = collectMmlFiles(samplesDir);

  it('finds sample files', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const relative = file.slice(samplesDir.length + 1);
    it(relative, () => {
      const source = readFileSync(file, 'utf-8');
      const result = new MmlCompiler().compile(source);
      const diagnostics = result.diagnostics.map((d) => d.toString()).join('\n');
      expect(result.success, diagnostics).toBe(true);
      expect(result.diagnostics.length, diagnostics).toBe(0);
    });
  }
});