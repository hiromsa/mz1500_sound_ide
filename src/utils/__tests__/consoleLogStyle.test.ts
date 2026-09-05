import { describe, expect, it } from 'vitest';
import { classifyConsoleLog, resolveConsoleLogStyle } from '../consoleLogStyle';

describe('classifyConsoleLog', () => {
  it('ERROR を含む行を error に分類する', () => {
    expect(classifyConsoleLog('[AUDIO] ERROR: AudioContext init failed.')).toBe('error');
  });

  it('BUILD 失敗サマリ (大文字 ERROR を含まない行) は build に分類する', () => {
    expect(classifyConsoleLog('[BUILD] FAILED: 2 error(s). See the PROBLEMS panel.')).toBe('build');
  });

  it('SUCCESS を含む行を success に分類する', () => {
    expect(classifyConsoleLog('[BUILD] SUCCESS: 5.00 sec / 4 tracks / LOOP ENABLED.')).toBe('success');
    expect(classifyConsoleLog('[EXPORT] SUCCESS: Exported "SONG.qdf" (81,936 bytes).')).toBe('success');
  });

  it('[BUILD] を含む通常行を build に分類する', () => {
    expect(classifyConsoleLog('[BUILD] Compiling main.mml...')).toBe('build');
    expect(classifyConsoleLog('[BUILD] ERROR 3:12 - unknown command')).toBe('error');
  });

  it('分類対象外の行を default に分類する', () => {
    expect(classifyConsoleLog('[AUDIO] Playback started (Z80 DRIVER / Web Audio).')).toBe('default');
    expect(classifyConsoleLog('[SETTINGS] Playback engine set to SOURCE INTERPRETER.')).toBe('default');
    expect(classifyConsoleLog('MZ-1500 IDE INITIALIZED.')).toBe('default');
  });
});

describe('resolveConsoleLogStyle', () => {
  it('トーン毎の文字色クラスを返す', () => {
    expect(resolveConsoleLogStyle('[AUDIO] ERROR: failed.')).toBe('text-red-400');
    expect(resolveConsoleLogStyle('[EXPORT] SUCCESS: done.')).toBe('text-emerald-400');
    expect(resolveConsoleLogStyle('[BUILD] Compiling...')).toBe('text-cyan-300');
    expect(resolveConsoleLogStyle('[AUDIO] Playback stopped.')).toBe('text-zinc-400');
  });
});
