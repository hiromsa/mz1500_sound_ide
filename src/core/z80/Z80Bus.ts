/**
 * Z80 CPU が接続するメモリバス / I/O ポートバスのインターフェース。
 * アドレス / ポート番号は unsigned (0-65535)、値は unsigned (0-255)。
 *
 * Based on Z80dotNet (https://github.com/Konamiman/Z80dotNet) originally written by Konamiman.
 * Copyright (C) 2014 Konamiman, www.konamiman.com.
 * 本ファイルは Z80dotNet の LICENSE.txt 条項 (著作権 / 許諾表示の保持、改変の明示) に従って改変したものである。
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

