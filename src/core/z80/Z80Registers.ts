/**
 * Z80 CPU の全レジスタ (メイン + 代替 + インデックスレジスタ + 割り込み状態)。
 * 値はすべて unsigned で保持する (C# 版の short との差分は符号ビットのみで等価)。
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
 * TypeScript 移植にあたり構造を変更している (Z80Registers.cs 相当)。
 */
import { MainRegisters } from './MainRegisters';

export class Z80Registers extends MainRegisters {
  /** 代替レジスタセット (AF' / BC' / DE' / HL')。 */
  readonly alternate = new MainRegisters();

  ix = 0;

  iy = 0;

  pc = 0;

  sp = 0;

  /** 割り込みベクタレジスタ (IR の上位バイト)。 */
  i = 0;

  /** リフレッシュレジスタ (下位 7bit のみインクリメントされる)。 */
  r = 0;

  iff1 = false;

  iff2 = false;

  interruptMode = 0;

  get ixh(): number {
    return (this.ix >> 8) & 0xff;
  }

  set ixh(value: number) {
    this.ix = (this.ix & 0x00ff) | ((value & 0xff) << 8);
  }

  get ixl(): number {
    return this.ix & 0xff;
  }

  set ixl(value: number) {
    this.ix = (this.ix & 0xff00) | (value & 0xff);
  }

  get iyh(): number {
    return (this.iy >> 8) & 0xff;
  }

  set iyh(value: number) {
    this.iy = (this.iy & 0x00ff) | ((value & 0xff) << 8);
  }

  get iyl(): number {
    return this.iy & 0xff;
  }

  set iyl(value: number) {
    this.iy = (this.iy & 0xff00) | (value & 0xff);
  }
}

