import { Memory } from './memory';

export type CpuType = '6502' | '65C02';

export interface Cpu {
    reset(): void;
    step(): number; // Returns cycles taken
    getRegisters(): CpuRegisters;
}

export interface CpuRegisters {
    A: number;
    X: number;
    Y: number;
    SP: number;
    PC: number;
    Status: number;
}

export enum Flags {
    Carry = 0x01,
    Zero = 0x02,
    InterruptDisable = 0x04,
    Decimal = 0x08,
    Break = 0x10,
    Unused = 0x20, // Always 1
    Overflow = 0x40,
    Negative = 0x80
}
