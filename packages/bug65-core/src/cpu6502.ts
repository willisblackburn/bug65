import { ICpu, CpuRegisters, Flags } from './cpu-interface';
import { IMemory } from './memory';

export class Cpu6502 implements ICpu {
    protected memory: IMemory;

    protected A: number = 0;
    protected X: number = 0;
    protected Y: number = 0;
    protected SP: number = 0xFF;
    protected PC: number = 0;
    protected Status: number = Flags.Unused | Flags.InterruptDisable;

    protected cycles: number = 0;

    public onTrap: ((pc: number) => boolean) | undefined;
    public breakpoints: Set<number> = new Set();

    constructor(memory: IMemory) {
        this.memory = memory;
    }

    reset(): void {
        this.A = 0;
        this.X = 0;
        this.Y = 0;
        this.SP = 0xFF;
        this.Status = Flags.Unused | Flags.InterruptDisable;
        this.PC = this.memory.readWord(0xFFFC);
        this.cycles = 0;
    }

    getRegisters(): CpuRegisters {
        return {
            A: this.A,
            X: this.X,
            Y: this.Y,
            SP: this.SP,
            PC: this.PC,
            Status: this.Status
        };
    }

    step(): number {
        // Check breakpoint before trap
        if (this.breakpoints.has(this.PC)) {
            return 0;
        }

        if (this.onTrap) {
            if (this.onTrap(this.PC)) {
                return 0;
            }
        }

        const opcode = this.memory.read(this.PC++);
        const startCycles = this.cycles;

        this.executeOpcode(opcode);

        return this.cycles - startCycles;
    }

    // Addressing Modes
    protected addrImmediate(): number {
        return this.PC++;
    }

    protected addrZeroPage(): number {
        return this.memory.read(this.PC++);
    }

    protected addrZeroPageX(): number {
        const addr = this.memory.read(this.PC++);
        return (addr + this.X) & 0xFF;
    }

    protected addrZeroPageY(): number {
        const addr = this.memory.read(this.PC++);
        return (addr + this.Y) & 0xFF;
    }

    protected addrAbsolute(): number {
        const low = this.memory.read(this.PC++);
        const high = this.memory.read(this.PC++);
        return (high << 8) | low;
    }

    protected addrAbsoluteX(): number {
        const low = this.memory.read(this.PC++);
        const high = this.memory.read(this.PC++);
        const addr = ((high << 8) | low) + this.X;
        return addr & 0xFFFF;
    }

    protected addrAbsoluteY(): number {
        const low = this.memory.read(this.PC++);
        const high = this.memory.read(this.PC++);
        const addr = ((high << 8) | low) + this.Y;
        return addr & 0xFFFF;
    }

    protected addrIndirect(): number {
        const low = this.memory.read(this.PC++);
        const high = this.memory.read(this.PC++);
        const ptr = (high << 8) | low;
        const lowAddr = this.memory.read(ptr);
        const highAddr = this.memory.read((ptr & 0xFF00) | ((ptr + 1) & 0xFF));
        return (highAddr << 8) | lowAddr;
    }

    protected addrIndirectX(): number {
        const ptr = (this.memory.read(this.PC++) + this.X) & 0xFF;
        const low = this.memory.read(ptr);
        const high = this.memory.read((ptr + 1) & 0xFF);
        return (high << 8) | low;
    }

    protected addrIndirectY(): number {
        const ptr = this.memory.read(this.PC++);
        const low = this.memory.read(ptr);
        const high = this.memory.read((ptr + 1) & 0xFF);
        const addr = ((high << 8) | low) + this.Y;
        return addr & 0xFFFF;
    }

    protected executeOpcode(opcode: number): void {
        switch (opcode) {
            case 0xEA: // NOP
                this.cycles += 2;
                break;

            // LDA
            case 0xA9: this.LDA(this.memory.read(this.addrImmediate())); this.cycles += 2; break;
            case 0xA5: this.LDA(this.memory.read(this.addrZeroPage())); this.cycles += 3; break;
            case 0xB5: this.LDA(this.memory.read(this.addrZeroPageX())); this.cycles += 4; break;
            case 0xAD: this.LDA(this.memory.read(this.addrAbsolute())); this.cycles += 4; break;
            case 0xBD: this.LDA(this.memory.read(this.addrAbsoluteX())); this.cycles += 4; break;
            case 0xB9: this.LDA(this.memory.read(this.addrAbsoluteY())); this.cycles += 4; break;
            case 0xA1: this.LDA(this.memory.read(this.addrIndirectX())); this.cycles += 6; break;
            case 0xB1: this.LDA(this.memory.read(this.addrIndirectY())); this.cycles += 5; break;

            // STA
            case 0x85: this.memory.write(this.addrZeroPage(), this.A); this.cycles += 3; break;
            case 0x95: this.memory.write(this.addrZeroPageX(), this.A); this.cycles += 4; break;
            case 0x8D: this.memory.write(this.addrAbsolute(), this.A); this.cycles += 4; break;
            case 0x9D: this.memory.write(this.addrAbsoluteX(), this.A); this.cycles += 5; break;
            case 0x99: this.memory.write(this.addrAbsoluteY(), this.A); this.cycles += 5; break;
            case 0x81: this.memory.write(this.addrIndirectX(), this.A); this.cycles += 6; break;
            case 0x91: this.memory.write(this.addrIndirectY(), this.A); this.cycles += 6; break;

            // JMP
            case 0x4C: this.PC = this.addrAbsolute(); this.cycles += 3; break;
            case 0x6C: this.PC = this.addrIndirect(); this.cycles += 5; break;

            // JSR
            case 0x20: this.JSR(this.addrAbsolute()); this.cycles += 6; break;

            // RTS
            case 0x60: this.RTS(); this.cycles += 6; break;

            // LDX
            case 0xA2: this.LDX(this.memory.read(this.addrImmediate())); this.cycles += 2; break;
            case 0xA6: this.LDX(this.memory.read(this.addrZeroPage())); this.cycles += 3; break;
            case 0xB6: this.LDX(this.memory.read(this.addrZeroPageY())); this.cycles += 4; break;
            case 0xAE: this.LDX(this.memory.read(this.addrAbsolute())); this.cycles += 4; break;
            case 0xBE: this.LDX(this.memory.read(this.addrAbsoluteY())); this.cycles += 4; break;

            // LDY
            case 0xA0: this.LDY(this.memory.read(this.addrImmediate())); this.cycles += 2; break;
            case 0xA4: this.LDY(this.memory.read(this.addrZeroPage())); this.cycles += 3; break;
            case 0xB4: this.LDY(this.memory.read(this.addrZeroPageX())); this.cycles += 4; break;
            case 0xAC: this.LDY(this.memory.read(this.addrAbsolute())); this.cycles += 4; break;
            case 0xBC: this.LDY(this.memory.read(this.addrAbsoluteX())); this.cycles += 4; break;

            // INX, INY, DEX, DEY
            case 0xE8: this.INX(); this.cycles += 2; break;
            case 0xC8: this.INY(); this.cycles += 2; break;
            case 0xCA: this.DEX(); this.cycles += 2; break;
            case 0x88: this.DEY(); this.cycles += 2; break;


            // Transfers
            case 0xAA: this.TAX(); this.cycles += 2; break;
            case 0xA8: this.TAY(); this.cycles += 2; break;
            case 0xBA: this.TSX(); this.cycles += 2; break;
            case 0x8A: this.TXA(); this.cycles += 2; break;
            case 0x9A: this.TXS(); this.cycles += 2; break;
            case 0x98: this.TYA(); this.cycles += 2; break;

            // Flags
            case 0x18: this.CLC(); this.cycles += 2; break;
            case 0xD8: this.CLD(); this.cycles += 2; break;
            case 0x58: this.CLI(); this.cycles += 2; break;
            case 0xB8: this.CLV(); this.cycles += 2; break;
            case 0x38: this.SEC(); this.cycles += 2; break;
            case 0xF8: this.SED(); this.cycles += 2; break;
            case 0x78: this.SEI(); this.cycles += 2; break;


            // Branches
            case 0x10: this.branch(!this.getFlag(Flags.Negative)); break; // BPL
            case 0x30: this.branch(this.getFlag(Flags.Negative)); break;  // BMI
            case 0x50: this.branch(!this.getFlag(Flags.Overflow)); break; // BVC
            case 0x70: this.branch(this.getFlag(Flags.Overflow)); break;  // BVS
            case 0x90: this.branch(!this.getFlag(Flags.Carry)); break;    // BCC
            case 0xB0: this.branch(this.getFlag(Flags.Carry)); break;     // BCS
            case 0xD0: this.branch(!this.getFlag(Flags.Zero)); break;     // BNE
            case 0xF0: this.branch(this.getFlag(Flags.Zero)); break;      // BEQ

            // Stack
            case 0x48: this.PHA(); this.cycles += 3; break;
            case 0x08: this.PHP(); this.cycles += 3; break;
            case 0x68: this.PLA(); this.cycles += 4; break;
            case 0x28: this.PLP(); this.cycles += 4; break;

            // System
            case 0x00: this.BRK(); break; // Cycles handled in BRK (7)
            case 0x40: this.RTI(); this.cycles += 6; break;


            // Logical
            case 0x29: this.AND(this.memory.read(this.addrImmediate())); this.cycles += 2; break;
            case 0x25: this.AND(this.memory.read(this.addrZeroPage())); this.cycles += 3; break;
            case 0x35: this.AND(this.memory.read(this.addrZeroPageX())); this.cycles += 4; break;
            case 0x2D: this.AND(this.memory.read(this.addrAbsolute())); this.cycles += 4; break;
            case 0x3D: this.AND(this.memory.read(this.addrAbsoluteX())); this.cycles += 4; break;
            case 0x39: this.AND(this.memory.read(this.addrAbsoluteY())); this.cycles += 4; break;
            case 0x21: this.AND(this.memory.read(this.addrIndirectX())); this.cycles += 6; break;
            case 0x31: this.AND(this.memory.read(this.addrIndirectY())); this.cycles += 5; break;

            case 0x09: this.ORA(this.memory.read(this.addrImmediate())); this.cycles += 2; break;
            case 0x05: this.ORA(this.memory.read(this.addrZeroPage())); this.cycles += 3; break;
            case 0x15: this.ORA(this.memory.read(this.addrZeroPageX())); this.cycles += 4; break;
            case 0x0D: this.ORA(this.memory.read(this.addrAbsolute())); this.cycles += 4; break;
            case 0x1D: this.ORA(this.memory.read(this.addrAbsoluteX())); this.cycles += 4; break;
            case 0x19: this.ORA(this.memory.read(this.addrAbsoluteY())); this.cycles += 4; break;
            case 0x01: this.ORA(this.memory.read(this.addrIndirectX())); this.cycles += 6; break;
            case 0x11: this.ORA(this.memory.read(this.addrIndirectY())); this.cycles += 5; break;

            case 0x49: this.EOR(this.memory.read(this.addrImmediate())); this.cycles += 2; break;
            case 0x45: this.EOR(this.memory.read(this.addrZeroPage())); this.cycles += 3; break;
            case 0x55: this.EOR(this.memory.read(this.addrZeroPageX())); this.cycles += 4; break;
            case 0x4D: this.EOR(this.memory.read(this.addrAbsolute())); this.cycles += 4; break;
            case 0x5D: this.EOR(this.memory.read(this.addrAbsoluteX())); this.cycles += 4; break;
            case 0x59: this.EOR(this.memory.read(this.addrAbsoluteY())); this.cycles += 4; break;
            case 0x41: this.EOR(this.memory.read(this.addrIndirectX())); this.cycles += 6; break;
            case 0x51: this.EOR(this.memory.read(this.addrIndirectY())); this.cycles += 5; break;

            case 0x24: this.BIT(this.memory.read(this.addrZeroPage())); this.cycles += 3; break;
            case 0x2C: this.BIT(this.memory.read(this.addrAbsolute())); this.cycles += 4; break;

            // Shifts/Rotates - Accumulator
            case 0x0A: this.ASL_A(); this.cycles += 2; break;
            case 0x4A: this.LSR_A(); this.cycles += 2; break;
            case 0x2A: this.ROL_A(); this.cycles += 2; break;
            case 0x6A: this.ROR_A(); this.cycles += 2; break;

            // Shifts/Rotates - Memory
            case 0x06: this.ASL_Mem(this.addrZeroPage()); this.cycles += 5; break;
            case 0x16: this.ASL_Mem(this.addrZeroPageX()); this.cycles += 6; break;
            case 0x0E: this.ASL_Mem(this.addrAbsolute()); this.cycles += 6; break;
            case 0x1E: this.ASL_Mem(this.addrAbsoluteX()); this.cycles += 7; break;

            case 0x46: this.LSR_Mem(this.addrZeroPage()); this.cycles += 5; break;
            case 0x56: this.LSR_Mem(this.addrZeroPageX()); this.cycles += 6; break;
            case 0x4E: this.LSR_Mem(this.addrAbsolute()); this.cycles += 6; break;
            case 0x5E: this.LSR_Mem(this.addrAbsoluteX()); this.cycles += 7; break;

            case 0x26: this.ROL_Mem(this.addrZeroPage()); this.cycles += 5; break;
            case 0x36: this.ROL_Mem(this.addrZeroPageX()); this.cycles += 6; break;
            case 0x2E: this.ROL_Mem(this.addrAbsolute()); this.cycles += 6; break;
            case 0x3E: this.ROL_Mem(this.addrAbsoluteX()); this.cycles += 7; break;

            case 0x66: this.ROR_Mem(this.addrZeroPage()); this.cycles += 5; break;
            case 0x76: this.ROR_Mem(this.addrZeroPageX()); this.cycles += 6; break;
            case 0x6E: this.ROR_Mem(this.addrAbsolute()); this.cycles += 6; break;
            case 0x7E: this.ROR_Mem(this.addrAbsoluteX()); this.cycles += 7; break;


            // Arithmetic
            case 0x69: this.ADC(this.memory.read(this.addrImmediate())); this.cycles += 2; break;
            case 0x65: this.ADC(this.memory.read(this.addrZeroPage())); this.cycles += 3; break;
            case 0x75: this.ADC(this.memory.read(this.addrZeroPageX())); this.cycles += 4; break;
            case 0x6D: this.ADC(this.memory.read(this.addrAbsolute())); this.cycles += 4; break;
            case 0x7D: this.ADC(this.memory.read(this.addrAbsoluteX())); this.cycles += 4; break;
            case 0x79: this.ADC(this.memory.read(this.addrAbsoluteY())); this.cycles += 4; break;
            case 0x61: this.ADC(this.memory.read(this.addrIndirectX())); this.cycles += 6; break;
            case 0x71: this.ADC(this.memory.read(this.addrIndirectY())); this.cycles += 5; break;

            case 0xE9: this.SBC(this.memory.read(this.addrImmediate())); this.cycles += 2; break;
            case 0xE5: this.SBC(this.memory.read(this.addrZeroPage())); this.cycles += 3; break;
            case 0xF5: this.SBC(this.memory.read(this.addrZeroPageX())); this.cycles += 4; break;
            case 0xED: this.SBC(this.memory.read(this.addrAbsolute())); this.cycles += 4; break;
            case 0xFD: this.SBC(this.memory.read(this.addrAbsoluteX())); this.cycles += 4; break;
            case 0xF9: this.SBC(this.memory.read(this.addrAbsoluteY())); this.cycles += 4; break;
            case 0xE1: this.SBC(this.memory.read(this.addrIndirectX())); this.cycles += 6; break;
            case 0xF1: this.SBC(this.memory.read(this.addrIndirectY())); this.cycles += 5; break;

            case 0xC9: this.CMP(this.memory.read(this.addrImmediate())); this.cycles += 2; break;
            case 0xC5: this.CMP(this.memory.read(this.addrZeroPage())); this.cycles += 3; break;
            case 0xD5: this.CMP(this.memory.read(this.addrZeroPageX())); this.cycles += 4; break;
            case 0xCD: this.CMP(this.memory.read(this.addrAbsolute())); this.cycles += 4; break;
            case 0xDD: this.CMP(this.memory.read(this.addrAbsoluteX())); this.cycles += 4; break;
            case 0xD9: this.CMP(this.memory.read(this.addrAbsoluteY())); this.cycles += 4; break;
            case 0xC1: this.CMP(this.memory.read(this.addrIndirectX())); this.cycles += 6; break;
            case 0xD1: this.CMP(this.memory.read(this.addrIndirectY())); this.cycles += 5; break;

            case 0xE0: this.CPX(this.memory.read(this.addrImmediate())); this.cycles += 2; break;
            case 0xE4: this.CPX(this.memory.read(this.addrZeroPage())); this.cycles += 3; break;
            case 0xEC: this.CPX(this.memory.read(this.addrAbsolute())); this.cycles += 4; break;

            case 0xC0: this.CPY(this.memory.read(this.addrImmediate())); this.cycles += 2; break;
            case 0xC4: this.CPY(this.memory.read(this.addrZeroPage())); this.cycles += 3; break;
            case 0xCC: this.CPY(this.memory.read(this.addrAbsolute())); this.cycles += 4; break;


            // INC/DEC Memory
            case 0xE6: this.INC_Mem(this.addrZeroPage()); this.cycles += 5; break;
            case 0xF6: this.INC_Mem(this.addrZeroPageX()); this.cycles += 6; break;
            case 0xEE: this.INC_Mem(this.addrAbsolute()); this.cycles += 6; break;
            case 0xFE: this.INC_Mem(this.addrAbsoluteX()); this.cycles += 7; break;

            case 0xC6: this.DEC_Mem(this.addrZeroPage()); this.cycles += 5; break;
            case 0xD6: this.DEC_Mem(this.addrZeroPageX()); this.cycles += 6; break;
            case 0xCE: this.DEC_Mem(this.addrAbsolute()); this.cycles += 6; break;
            case 0xDE: this.DEC_Mem(this.addrAbsoluteX()); this.cycles += 7; break;

            // STX
            case 0x86: this.memory.write(this.addrZeroPage(), this.X); this.cycles += 3; break;
            case 0x96: this.memory.write(this.addrZeroPageY(), this.X); this.cycles += 4; break;
            case 0x8E: this.memory.write(this.addrAbsolute(), this.X); this.cycles += 4; break;

            // STY
            case 0x84: this.memory.write(this.addrZeroPage(), this.Y); this.cycles += 3; break;
            case 0x94: this.memory.write(this.addrZeroPageX(), this.Y); this.cycles += 4; break;
            case 0x8C: this.memory.write(this.addrAbsolute(), this.Y); this.cycles += 4; break;

            default:
                throw new Error(`Unknown opcode: ${opcode.toString(16)}`);
        }
    }

    // Instructions helpers
    protected LDA(value: number): void {
        this.A = value;
        this.setFlag(Flags.Zero, this.A === 0);
        this.setFlag(Flags.Negative, (this.A & 0x80) !== 0);
    }

    protected LDX(value: number): void {
        this.X = value;
        this.setFlag(Flags.Zero, this.X === 0);
        this.setFlag(Flags.Negative, (this.X & 0x80) !== 0);
    }

    protected LDY(value: number): void {
        this.Y = value;
        this.setFlag(Flags.Zero, this.Y === 0);
        this.setFlag(Flags.Negative, (this.Y & 0x80) !== 0);
    }

    protected INX(): void {
        this.X = (this.X + 1) & 0xFF;
        this.setFlag(Flags.Zero, this.X === 0);
        this.setFlag(Flags.Negative, (this.X & 0x80) !== 0);
    }

    protected INY(): void {
        this.Y = (this.Y + 1) & 0xFF;
        this.setFlag(Flags.Zero, this.Y === 0);
        this.setFlag(Flags.Negative, (this.Y & 0x80) !== 0);
    }

    protected DEX(): void {
        this.X = (this.X - 1) & 0xFF;
        this.setFlag(Flags.Zero, this.X === 0);
        this.setFlag(Flags.Negative, (this.X & 0x80) !== 0);
    }

    protected DEY(): void {
        this.Y = (this.Y - 1) & 0xFF;
        this.setFlag(Flags.Zero, this.Y === 0);
        this.setFlag(Flags.Negative, (this.Y & 0x80) !== 0);
    }

    protected INC_Mem(addr: number): void {
        let val = this.memory.read(addr);
        val = (val + 1) & 0xFF;
        this.memory.write(addr, val);
        this.setFlag(Flags.Zero, val === 0);
        this.setFlag(Flags.Negative, (val & 0x80) !== 0);
    }

    protected DEC_Mem(addr: number): void {
        let val = this.memory.read(addr);
        val = (val - 1) & 0xFF;
        this.memory.write(addr, val);
        this.setFlag(Flags.Zero, val === 0);
        this.setFlag(Flags.Negative, (val & 0x80) !== 0);
    }

    protected TAX(): void {
        this.X = this.A;
        this.setFlag(Flags.Zero, this.X === 0);
        this.setFlag(Flags.Negative, (this.X & 0x80) !== 0);
    }

    protected TAY(): void {
        this.Y = this.A;
        this.setFlag(Flags.Zero, this.Y === 0);
        this.setFlag(Flags.Negative, (this.Y & 0x80) !== 0);
    }

    protected TSX(): void {
        this.X = this.SP;
        this.setFlag(Flags.Zero, this.X === 0);
        this.setFlag(Flags.Negative, (this.X & 0x80) !== 0);
    }

    protected TXA(): void {
        this.A = this.X;
        this.setFlag(Flags.Zero, this.A === 0);
        this.setFlag(Flags.Negative, (this.A & 0x80) !== 0);
    }

    protected TXS(): void {
        this.SP = this.X;
    }

    protected TYA(): void {
        this.A = this.Y;
        this.setFlag(Flags.Zero, this.A === 0);
        this.setFlag(Flags.Negative, (this.A & 0x80) !== 0);
    }

    protected CLC(): void { this.setFlag(Flags.Carry, false); }
    protected CLD(): void { this.setFlag(Flags.Decimal, false); }
    protected CLI(): void { this.setFlag(Flags.InterruptDisable, false); }
    protected CLV(): void { this.setFlag(Flags.Overflow, false); }

    // Arithmetic
    protected ADC(value: number): void {
        if (this.getFlag(Flags.Decimal)) {
            // BCD Not implemented yet, falling back to binary
            // TODO: Implement BCD
        }

        const carry = this.getFlag(Flags.Carry) ? 1 : 0;
        const sum = this.A + value + carry;

        this.setFlag(Flags.Carry, sum > 0xFF);
        this.setFlag(Flags.Overflow, (~(this.A ^ value) & (this.A ^ sum) & 0x80) !== 0);

        this.A = sum & 0xFF;
        this.setFlag(Flags.Zero, this.A === 0);
        this.setFlag(Flags.Negative, (this.A & 0x80) !== 0);
    }

    protected SBC(value: number): void {
        // SBC is effectively ADC with ones-complement of value
        // But logic is slightly easier to write directly or use ADC(~value)
        // M - 1 = ~M (in two's complement? No) -> ~M
        // A - M - ~C = A + ~M + C
        this.ADC(value ^ 0xFF);
    }

    protected CMP(value: number): void {
        const result = this.A - value;
        this.setFlag(Flags.Carry, this.A >= value);
        this.setFlag(Flags.Zero, (result & 0xFF) === 0);
        this.setFlag(Flags.Negative, (result & 0x80) !== 0);
    }

    protected CPX(value: number): void {
        const result = this.X - value;
        this.setFlag(Flags.Carry, this.X >= value);
        this.setFlag(Flags.Zero, (result & 0xFF) === 0);
        this.setFlag(Flags.Negative, (result & 0x80) !== 0);
    }

    protected CPY(value: number): void {
        const result = this.Y - value;
        this.setFlag(Flags.Carry, this.Y >= value);
        this.setFlag(Flags.Zero, (result & 0xFF) === 0);
        this.setFlag(Flags.Negative, (result & 0x80) !== 0);
    }

    public setRegisters(regs: Partial<CpuRegisters>): void {
        if (regs.A !== undefined) this.A = regs.A;
        if (regs.X !== undefined) this.X = regs.X;
        if (regs.Y !== undefined) this.Y = regs.Y;
        if (regs.PC !== undefined) this.PC = regs.PC;
        if (regs.SP !== undefined) this.SP = regs.SP;
        // Status?
        if (regs.Status !== undefined) this.setFlags(regs.Status);
    }

    private setFlags(flags: number): void {
        this.Status = flags; // Directly set the status register
    }

    // Logical
    protected AND(value: number): void {
        this.A &= value;
        this.setFlag(Flags.Zero, this.A === 0);
        this.setFlag(Flags.Negative, (this.A & 0x80) !== 0);
    }

    protected ORA(value: number): void {
        this.A |= value;
        this.setFlag(Flags.Zero, this.A === 0);
        this.setFlag(Flags.Negative, (this.A & 0x80) !== 0);
    }

    protected EOR(value: number): void {
        this.A ^= value;
        this.setFlag(Flags.Zero, this.A === 0);
        this.setFlag(Flags.Negative, (this.A & 0x80) !== 0);
    }

    protected BIT(value: number): void {
        this.setFlag(Flags.Zero, (this.A & value) === 0);
        this.setFlag(Flags.Negative, (value & 0x80) !== 0);
        this.setFlag(Flags.Overflow, (value & 0x40) !== 0);
    }

    // Shifts
    protected ASL_A(): void {
        this.setFlag(Flags.Carry, (this.A & 0x80) !== 0);
        this.A = (this.A << 1) & 0xFF;
        this.setFlag(Flags.Zero, this.A === 0);
        this.setFlag(Flags.Negative, (this.A & 0x80) !== 0);
    }

    protected ASL_Mem(addr: number): void {
        let val = this.memory.read(addr);
        this.setFlag(Flags.Carry, (val & 0x80) !== 0);
        val = (val << 1) & 0xFF;
        this.memory.write(addr, val);
        this.setFlag(Flags.Zero, val === 0);
        this.setFlag(Flags.Negative, (val & 0x80) !== 0);
    }

    protected LSR_A(): void {
        this.setFlag(Flags.Carry, (this.A & 0x01) !== 0);
        this.A = (this.A >> 1) & 0xFF;
        this.setFlag(Flags.Zero, this.A === 0);
        this.setFlag(Flags.Negative, false); // Bit 7 always 0
    }

    protected LSR_Mem(addr: number): void {
        let val = this.memory.read(addr);
        this.setFlag(Flags.Carry, (val & 0x01) !== 0);
        val = (val >> 1) & 0xFF;
        this.memory.write(addr, val);
        this.setFlag(Flags.Zero, val === 0);
        this.setFlag(Flags.Negative, false);
    }

    protected ROL_A(): void {
        const oldCarry = this.getFlag(Flags.Carry) ? 1 : 0;
        this.setFlag(Flags.Carry, (this.A & 0x80) !== 0);
        this.A = ((this.A << 1) | oldCarry) & 0xFF;
        this.setFlag(Flags.Zero, this.A === 0);
        this.setFlag(Flags.Negative, (this.A & 0x80) !== 0);
    }

    protected ROL_Mem(addr: number): void {
        let val = this.memory.read(addr);
        const oldCarry = this.getFlag(Flags.Carry) ? 1 : 0;
        this.setFlag(Flags.Carry, (val & 0x80) !== 0);
        val = ((val << 1) | oldCarry) & 0xFF;
        this.memory.write(addr, val);
        this.setFlag(Flags.Zero, val === 0);
        this.setFlag(Flags.Negative, (val & 0x80) !== 0);
    }

    protected ROR_A(): void {
        const oldCarry = this.getFlag(Flags.Carry) ? 0x80 : 0;
        this.setFlag(Flags.Carry, (this.A & 0x01) !== 0);
        this.A = ((this.A >> 1) | oldCarry) & 0xFF;
        this.setFlag(Flags.Zero, this.A === 0);
        this.setFlag(Flags.Negative, (this.A & 0x80) !== 0);
    }

    protected ROR_Mem(addr: number): void {
        let val = this.memory.read(addr);
        const oldCarry = this.getFlag(Flags.Carry) ? 0x80 : 0;
        this.setFlag(Flags.Carry, (val & 0x01) !== 0);
        val = ((val >> 1) | oldCarry) & 0xFF;
        this.memory.write(addr, val);
        this.setFlag(Flags.Zero, val === 0);
        this.setFlag(Flags.Negative, (val & 0x80) !== 0);
    }

    protected SEC(): void { this.setFlag(Flags.Carry, true); }
    protected SED(): void { this.setFlag(Flags.Decimal, true); }
    protected SEI(): void { this.setFlag(Flags.InterruptDisable, true); }

    // Stack & System
    protected PHA(): void {
        this.push(this.A);
    }

    protected PHP(): void {
        // Pushes Status with B(4) and Unused(5) set
        this.push(this.Status | Flags.Break | Flags.Unused);
    }

    protected PLA(): void {
        this.A = this.pop();
        this.setFlag(Flags.Zero, this.A === 0);
        this.setFlag(Flags.Negative, (this.A & 0x80) !== 0);
    }

    protected PLP(): void {
        const p = this.pop();
        // Ignore bits 5 and 4 when pulling?
        // Actually 6502 pulls them but B is hardware-only concept often.
        // Usually we respect what's on stack but force Unused(5) to 1.
        // B flag is ignored.
        this.Status = (p & ~Flags.Break) | Flags.Unused;
    }

    protected BRK(): void {
        this.PC++; // Skip padding byte (BRK is 1 byte, but acts as 2)
        this.pushWord(this.PC);
        this.push(this.Status | Flags.Break | Flags.Unused);
        this.setFlag(Flags.InterruptDisable, true);
        this.PC = this.memory.readWord(0xFFFE);
        this.cycles += 7;
    }

    protected RTI(): void {
        this.PLP();
        this.PC = this.popWord();
    }

    protected branch(condition: boolean): void {
        this.cycles += 2;
        const offset = this.memory.read(this.PC++); // Fetch operand
        // Value is unsigned 0-255, treat as signed integer
        const signedOffset = offset > 127 ? offset - 256 : offset;

        if (condition) {
            this.cycles += 1;
            const oldPC = this.PC;
            this.PC = (this.PC + signedOffset) & 0xFFFF;

            // Check page cross
            if ((oldPC & 0xFF00) !== (this.PC & 0xFF00)) {
                this.cycles += 1;
            }
        }
    }

    protected JSR(addr: number): void {
        const returnAddr = this.PC - 1;
        this.pushWord(returnAddr);
        this.PC = addr;
    }

    protected RTS(): void {
        const returnAddr = this.popWord();
        this.PC = returnAddr + 1;
    }

    protected push(value: number): void {
        this.memory.write(0x100 + this.SP, value);
        this.SP = (this.SP - 1) & 0xFF;
    }

    protected pop(): number {
        this.SP = (this.SP + 1) & 0xFF;
        return this.memory.read(0x100 + this.SP);
    }

    protected pushWord(value: number): void {
        this.push((value >> 8) & 0xFF);
        this.push(value & 0xFF);
    }

    protected popWord(): number {
        const low = this.pop();
        const high = this.pop();
        return (high << 8) | low;
    }

    // Helper methods for flags
    protected setFlag(flag: Flags, value: boolean): void {
        if (value) {
            this.Status |= flag;
        } else {
            this.Status &= ~flag;
        }
    }

    protected getFlag(flag: Flags): boolean {
        return (this.Status & flag) !== 0;
    }

    public addBreakpoint(addr: number): void {
        this.breakpoints.add(addr);
    }

    public removeBreakpoint(addr: number): void {
        this.breakpoints.delete(addr);
    }

    public clearBreakpoints(): void {
        this.breakpoints.clear();
    }
}
