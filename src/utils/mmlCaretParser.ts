import type { SoundEngineType } from './virtualSynth';

export interface MmlCaretContext {
  trackName: string;
  engine: SoundEngineType;
  octave: number;
  volume: number;
  voiceId?: number;
  volEnvId?: number;
  pitchEnvId?: number;
  detune: number;
  noiseType?: 'periodic' | 'white';
}

/**
 * MML文字列とカーソル位置（1-indexedの行・列）から、直前のコンテキスト（音源、音色、オクターブ、音量等）を解析
 */
export function parseMmlCaretContext(content: string, lineNumber: number, column: number): MmlCaretContext {
  const lines = content.split(/\r?\n/);
  const targetLines = lines.slice(0, lineNumber);
  if (targetLines.length > 0) {
    targetLines[targetLines.length - 1] = targetLines[targetLines.length - 1].slice(0, column);
  }

  // デフォルト値 (トラック表記は mml_reference.md 2節準拠: P1〜P6, N1〜N2, B1, F1〜F8)
  let trackName = 'P1';
  let engine: SoundEngineType = 'psg';
  let octave = 4;
  let volume = 12;
  let voiceId: number | undefined = 1;
  let volEnvId: number | undefined = undefined;
  let pitchEnvId: number | undefined = undefined;
  let detune = 0;
  let noiseType: 'periodic' | 'white' = 'periodic';

  // #OCTAVE REVERSE判定
  const isReverseOctave = /#OCTAVE\s+REVERSE\b/i.test(content);

  // コメントを除去 (行末コメント ; または //)
  const sanitizedLines = targetLines.map(line => {
    const commentIdx = line.search(/;|(\/\/)/);
    return commentIdx >= 0 ? line.slice(0, commentIdx) : line;
  });

  // 全トラック宣言とコマンドを順番に走査
  // トラック宣言パターン: P1〜P6, N1〜N2, B1, F1〜F8
  const trackRegex = /\b(P[1-6]|N[1-2]|B1|F[1-8])\b/gi;
  let currentTrack = 'P1';
  let trackStartIndex = 0;

  let match: RegExpExecArray | null;
  const fullSanitized = sanitizedLines.join(' ');
  while ((match = trackRegex.exec(fullSanitized)) !== null) {
    currentTrack = match[1].toUpperCase();
    trackStartIndex = match.index;
  }

  trackName = currentTrack;

  // トラック名から音源を判定
  if (/^F[1-8]$/i.test(currentTrack)) {
    engine = 'fm';
  } else if (/^B1$/i.test(currentTrack)) {
    engine = 'beep';
  } else if (/^N[1-2]$/i.test(currentTrack)) {
    engine = 'noise';
  } else {
    // P1〜P6 (DCSG矩形波)
    engine = 'psg';
  }

  // 直近トラック以降のテキストからコマンドを解析
  const trackText = fullSanitized.slice(trackStartIndex);

  // トークン解析用正規表現
  // o[1-8], <, >, v[0-15], @v\d+, @VE\d+, @PE\d+, @FM\d+, @\d+, D-?\d+, @WN[0-1]
  const cmdRegex = /(@FM\d+|@PE\d+|@VE\d+|@v\d+|@WN\d+|@[0-9]+|o[1-8]|[<>]|v\d+|D-?\d+)/gi;
  let cmdMatch: RegExpExecArray | null;

  while ((cmdMatch = cmdRegex.exec(trackText)) !== null) {
    const token = cmdMatch[1];
    const upper = token.toUpperCase();

    if (upper.startsWith('O')) {
      octave = parseInt(upper.slice(1), 10);
    } else if (upper === '<') {
      if (isReverseOctave) {
        octave = Math.min(8, octave + 1);
      } else {
        octave = Math.max(1, octave - 1);
      }
    } else if (upper === '>') {
      if (isReverseOctave) {
        octave = Math.max(1, octave - 1);
      } else {
        octave = Math.min(8, octave + 1);
      }
    } else if (upper.startsWith('V') && !upper.startsWith('VE')) {
      volume = Math.max(0, Math.min(15, parseInt(upper.slice(1), 10)));
    } else if (upper.startsWith('@V') || upper.startsWith('@VE')) {
      const num = parseInt(upper.replace(/@V(E)?/i, ''), 10);
      volEnvId = isNaN(num) ? undefined : num;
    } else if (upper.startsWith('@PE')) {
      const num = parseInt(upper.slice(3), 10);
      pitchEnvId = isNaN(num) ? undefined : num;
    } else if (upper.startsWith('@FM')) {
      voiceId = parseInt(upper.slice(3), 10);
      engine = 'fm';
    } else if (upper.startsWith('@WN')) {
      const w = parseInt(upper.slice(3), 10);
      noiseType = w === 1 ? 'white' : 'periodic';
    } else if (upper.startsWith('@') && /^\d+$/.test(upper.slice(1))) {
      voiceId = parseInt(upper.slice(1), 10);
      if (engine === 'psg' || engine === 'beep') {
        // FMが明示されていなければFMへ切り替え
        engine = 'fm';
      }
    } else if (upper.startsWith('D')) {
      const d = parseInt(upper.slice(1), 10);
      if (!isNaN(d)) detune = d;
    }
  }

  return {
    trackName,
    engine,
    octave,
    volume,
    voiceId,
    volEnvId,
    pitchEnvId,
    detune,
    noiseType,
  };
}
