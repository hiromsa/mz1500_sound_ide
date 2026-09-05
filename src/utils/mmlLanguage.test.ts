import { describe, it, expect, vi } from 'vitest';
import { 
  MML_LANGUAGE_ID, 
  MML_THEME_NAME, 
  mmlLanguageConfiguration, 
  mmlMonarchTokensProvider, 
  mmlThemeData, 
  setupMmlLanguage 
} from './mmlLanguage';
import type { Monaco } from '@monaco-editor/react';

describe('mmlLanguage', () => {
  it('defines correct language ID and theme name', () => {
    expect(MML_LANGUAGE_ID).toBe('mz1500-mml');
    expect(MML_THEME_NAME).toBe('mz1500-mml-theme');
  });

  it('configures language comments and brackets', () => {
    expect(mmlLanguageConfiguration.comments?.lineComment).toBe(';');
    expect(mmlLanguageConfiguration.brackets).toContainEqual(['{', '}']);
    expect(mmlLanguageConfiguration.brackets).toContainEqual(['[', ']']);
  });

  it('defines monarch token provider rules covering mml_reference.md specs', () => {
    const rootRules = mmlMonarchTokensProvider.tokenizer?.root;
    expect(rootRules).toBeDefined();

    const rulesStr = JSON.stringify(rootRules);

    // 全17トラック (P1〜P6, N1〜N2, B1, F1〜F8)
    expect(rulesStr).toContain('track.psg');
    expect(rulesStr).toContain('track.noise');
    expect(rulesStr).toContain('track.beep');
    expect(rulesStr).toContain('track.fm');

    // ディレクティブ
    expect(rulesStr).toContain('keyword.directive');

    // マクロ
    expect(rulesStr).toContain('macro.fm');
    expect(rulesStr).toContain('macro.vol');
    expect(rulesStr).toContain('macro.pitch');
    expect(rulesStr).toContain('macro.noise');

    // 音符 & 休符 & オクターブ & テンポ & ループ
    expect(rulesStr).toContain('note');
    expect(rulesStr).toContain('rest');
    expect(rulesStr).toContain('octave');
    expect(rulesStr).toContain('tempo');
    expect(rulesStr).toContain('volume');
    expect(rulesStr).toContain('loop.global');
  });

  it('defines theme colors with rich palette matching specs', () => {
    const rules = mmlThemeData.rules;
    expect(rules).toBeDefined();

    const tokenNames = rules.map(r => r.token);
    expect(tokenNames).toContain('comment');
    expect(tokenNames).toContain('keyword.directive');
    expect(tokenNames).toContain('track.psg');
    expect(tokenNames).toContain('track.fm');
    expect(tokenNames).toContain('note');
    expect(tokenNames).toContain('loop.global');

    // 永久ループ L は bold
    const loopRule = rules.find(r => r.token === 'loop.global');
    expect(loopRule?.fontStyle).toBe('bold');
  });

  it('registers language, config, tokens provider, and theme via setupMmlLanguage', () => {
    const registerMock = vi.fn();
    const setLanguageConfigurationMock = vi.fn();
    const setMonarchTokensProviderMock = vi.fn();
    const defineThemeMock = vi.fn();

    const monacoMock = {
      languages: {
        register: registerMock,
        setLanguageConfiguration: setLanguageConfigurationMock,
        setMonarchTokensProvider: setMonarchTokensProviderMock,
      },
      editor: {
        defineTheme: defineThemeMock,
      },
    } as unknown as Monaco;

    setupMmlLanguage(monacoMock);

    // 初回呼び出しで登録される（2回目以降はスキップ）
    expect(registerMock).toHaveBeenCalledWith({ id: MML_LANGUAGE_ID });
    expect(setLanguageConfigurationMock).toHaveBeenCalledWith(MML_LANGUAGE_ID, mmlLanguageConfiguration);
    expect(setMonarchTokensProviderMock).toHaveBeenCalledWith(MML_LANGUAGE_ID, mmlMonarchTokensProvider);
    expect(defineThemeMock).toHaveBeenCalledWith(MML_THEME_NAME, mmlThemeData);
  });
});
