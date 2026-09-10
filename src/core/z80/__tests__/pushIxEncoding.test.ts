import { describe, expect, it } from 'vitest';
import { assembleZ80 } from '../../assembler/Z80Assembler';
import type { Z80MemoryBus } from '../Z80Bus';
import { Z80Processor } from '../Z80Processor';

class VerifyMemory implements Z80MemoryBus {
  readonly data = new Uint8Array(0x10000);

  read(address: number): number {
    return this.data[address & 0xffff];
  }

  write(address: number, value: number): void {
    this.data[address & 0xffff] = value & 0xff;
  }
}

describe('push ix / iy エンコード (Z80Assembler bug fix 検証)', () => {
  it('push ix は DD E5 にエンコードされる (E5 = PUSH HL 単体ではない)', () => {
    const result = assembleZ80('        org     0x1200\n        push    ix');
    const start = result.origin;
    expect(Array.from(result.data.slice(start, start + 2))).toEqual([0xdd, 0xe5]);
  });

  it('pop ix は DD E1 にエンコードされる', () => {
    const result = assembleZ80('        org     0x1200\n        pop     ix');
    const start = result.origin;
    expect(Array.from(result.data.slice(start, start + 2))).toEqual([0xdd, 0xe1]);
  });

  it('push iy / pop iy は FD プレフィックス付きにエンコードされる', () => {
    const pushResult = assembleZ80('        org     0x1200\n        push    iy');
    const popResult = assembleZ80('        org     0x1200\n        pop     iy');
    const pushStart = pushResult.origin;
    const popStart = popResult.origin;
    expect(Array.from(pushResult.data.slice(pushStart, pushStart + 2))).toEqual([0xfd, 0xe5]);
    expect(Array.from(popResult.data.slice(popStart, popStart + 2))).toEqual([0xfd, 0xe1]);
  });

  it('push ix / pop hl で hl に ix が転送される (コア実行)', () => {
    const memory = new VerifyMemory();
    const cpu = new Z80Processor();
    cpu.memory = memory;
    cpu.reset();
    // LD IX,0xF860 / PUSH IX / POP HL
    memory.data.set([0xdd, 0x21, 0x60, 0xf8, 0xdd, 0xe5, 0xe1], 0);
    cpu.registers.sp = 0xfffe;
    for (let i = 0; i < 3; i++) {
      cpu.executeNextInstruction();
    }

    expect(cpu.registers.hl).toBe(0xf860);
    expect(cpu.registers.ix).toBe(0xf860);
  });
});
