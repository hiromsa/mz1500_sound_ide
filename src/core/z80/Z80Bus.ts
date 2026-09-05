/**
 * Z80 CPU が接続するメモリバス / I/O ポートバスのインターフェース。
 * アドレス / ポート番号は unsigned (0-65535)、値は unsigned (0-255)。
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
 * TypeScript 移植にあたり構造を変更している (IMemory.cs 相当)。
 */

/** 64KB メモリ空間のバス。 */
export interface Z80MemoryBus {
  read(address: number): number;

  write(address: number, value: number): void;
}

/** I/O ポート空間のバス (16bit ポート番号対応)。 */
export interface Z80PortBus {
  read(port: number): number;

  write(port: number, value: number): void;
}

