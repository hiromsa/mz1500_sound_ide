/**
 * Z80 CPU のメインレジスタセット (AF / BC / DE / HL)。
 * 8bit 値は unsigned (0-255)、16bit 合成値は unsigned (0-65535) で扱う。
 *
 * This file is a TypeScript port of Z80.Net (Z80dotNet, https://github.com/Konamiman/Z80dotNet)
 * originally written by Konamiman. Modified by hiromsa on 2026-09-06.
 * Copyright (C) 2014 Konamiman, www.konamiman.com.
 * 本ファイルは Z80dotNet の LICENSE.txt 条項 (著作権 / 許諾表示の保持、改変の明示) に従って改変したものである。
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, and/or sell copies of the
 * Software, and to permit persons to whom the Software are furnished to do so,
 * provided that (a) the above copyright notice(s) and this permission notice
 * appear with all copies of the Software, (b) both the above copyright notice(s)
 * and this permission notice appear in associated documentation, and (c) there is
 * clear notice in modified pieces of the Software as well as in the documentation
 * associated with the Software that the Software has been modified.
 * TypeScript 移植にあたり構造を変更している (MainZ80Registers.cs 相当)。
 */
export class MainRegisters {
  a = 0;

  f = 0;

  b = 0;

  c = 0;

  d = 0;

  e = 0;

  h = 0;

  l = 0;

  get af(): number {
    return ((this.a << 8) | this.f) & 0xffff;
  }

  set af(value: number) {
    this.a = (value >> 8) & 0xff;
    this.f = value & 0xff;
  }

  get bc(): number {
    return ((this.b << 8) | this.c) & 0xffff;
  }

  set bc(value: number) {
    this.b = (value >> 8) & 0xff;
    this.c = value & 0xff;
  }

  get de(): number {
    return ((this.d << 8) | this.e) & 0xffff;
  }

  set de(value: number) {
    this.d = (value >> 8) & 0xff;
    this.e = value & 0xff;
  }

  get hl(): number {
    return ((this.h << 8) | this.l) & 0xffff;
  }

  set hl(value: number) {
    this.h = (value >> 8) & 0xff;
    this.l = value & 0xff;
  }
}

