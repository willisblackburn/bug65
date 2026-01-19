import { Cpu, CpuRegisters, Flags, CpuType } from './cpu_interface';
import { Memory } from './memory';
import { OPCODES, Opcode } from './opcodes';

export class Cpu6502 implements Cpu {
    protected memory: Memory;

    protected A: number = 0;
    protected X: number = 0;
    protected Y: number = 0;
    protected SP: number = 0xFF;
    protected PC: number = 0;
    protected Status: number = Flags.Unused | Flags.InterruptDisable;

    protected cycles: number = 0;

    public onTrap: ((pc: number) => boolean) | undefined;
    public breakpoints: Map<number, Set<string>> = new Map();
    private _cpuType: CpuType = '6502';

    constructor(memory: Memory, cpuType: CpuType = '6502') {
        this.memory = memory;
        this._cpuType = cpuType;
    }

    public setCpuType(type: CpuType) {
        this._cpuType = type;
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

    step(ignoreBreakpoint: boolean = false): number {
        // Check breakpoint before trap
        if (!ignoreBreakpoint && this.breakpoints.has(this.PC)) {
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

    protected addrZeroPageIndirect(): number {
        const ptr = this.memory.read(this.PC++);
        const low = this.memory.read(ptr);
        const high = this.memory.read((ptr + 1) & 0xFF);
        return (high << 8) | low;
    }

    protected fetchEffectiveAddress(mode: string): number {
        switch (mode) {
            case 'imm': return this.addrImmediate();
            case 'zp': return this.addrZeroPage();
            case 'zpx': return this.addrZeroPageX();
            case 'zpy': return this.addrZeroPageY();
            case 'abs': return this.addrAbsolute();
            case 'abx': return this.addrAbsoluteX();
            case 'aby': return this.addrAbsoluteY();
            case 'ind': return this.addrIndirect();
            case 'izx': return this.addrIndirectX();
            case 'izy': return this.addrIndirectY();
            case 'izp': return this.addrZeroPageIndirect();
            case 'acc': return 0; // Accumulator addressing doesn't need address, but for consistency
            case 'imp': return 0; // Implied
            case 'rel': return 0; // Branch handling is different
            default: throw new Error(`Unknown addressing mode: ${mode}`);
        }
    }

    protected executeOpcode(opcode: number): void {
        const entry = OPCODES[opcode];
        if (!entry) {
            throw new Error(`Unknown opcode: ${opcode.toString(16)}`);
        }

        // Check 65C02 constraints
        if (entry.cpu === '65C02' && this._cpuType !== '65C02') {
            // For now, fall through or treat as NOP/Error? Original code had specific checks inside cases.
            // If we group them, we must check here or inside groups.
            // Original: "default: throw Error".
            // Simple: if it matches a 65C02 opcode but we are not 65C02, throw Error (or act as NOP if that's undefined behavior preference, but Error is safer).
            // However, some opcodes might be valid 6502 but undefined?
            // No, my enum separates them.
            // BUT: 0x80 (BRA) is undefined on 6502.
            throw new Error(`Unknown opcode (65C02 only): ${opcode.toString(16)}`);
        }

        // Base cycles from metadata
        this.cycles += entry.cycles;

        switch (opcode) {
            case Opcode.NOP_imp:
                break;

            // Load/Store
            case Opcode.LDA_imm:
            case Opcode.LDA_zp:
            case Opcode.LDA_zpx:
            case Opcode.LDA_abs:
            case Opcode.LDA_abx:
            case Opcode.LDA_aby:
            case Opcode.LDA_izx:
            case Opcode.LDA_izy:
            case Opcode.LDA_izp: // 65C02
                this.LDA(this.memory.read(this.fetchEffectiveAddress(entry.mode)));
                break;

            case Opcode.LDX_imm:
            case Opcode.LDX_zp:
            case Opcode.LDX_zpy:
            case Opcode.LDX_abs:
            case Opcode.LDX_aby:
                this.LDX(this.memory.read(this.fetchEffectiveAddress(entry.mode)));
                break;

            case Opcode.LDY_imm:
            case Opcode.LDY_zp:
            case Opcode.LDY_zpx:
            case Opcode.LDY_abs:
            case Opcode.LDY_abx:
                this.LDY(this.memory.read(this.fetchEffectiveAddress(entry.mode)));
                break;

            case Opcode.STA_zp:
            case Opcode.STA_zpx:
            case Opcode.STA_abs:
            case Opcode.STA_abx:
            case Opcode.STA_aby:
            case Opcode.STA_izx:
            case Opcode.STA_izy:
            case Opcode.STA_izp: // 65C02
                this.memory.write(this.fetchEffectiveAddress(entry.mode), this.A);
                break;

            case Opcode.STX_zp:
            case Opcode.STX_zpy:
            case Opcode.STX_abs:
                this.memory.write(this.fetchEffectiveAddress(entry.mode), this.X);
                break;

            case Opcode.STY_zp:
            case Opcode.STY_zpx:
            case Opcode.STY_abs:
                this.memory.write(this.fetchEffectiveAddress(entry.mode), this.Y);
                break;

            case Opcode.STZ_zp:
            case Opcode.STZ_zpx:
            case Opcode.STZ_abs:
            case Opcode.STZ_abx:
                this.memory.write(this.fetchEffectiveAddress(entry.mode), 0);
                break;

            // Register Tranfers
            case Opcode.TAX_imp: this.TAX(); break;
            case Opcode.TAY_imp: this.TAY(); break;
            case Opcode.TSX_imp: this.TSX(); break;
            case Opcode.TXA_imp: this.TXA(); break;
            case Opcode.TXS_imp: this.TXS(); break;
            case Opcode.TYA_imp: this.TYA(); break;

            // Stack Operations
            case Opcode.PHA_imp: this.PHA(); break;
            case Opcode.PHP_imp: this.PHP(); break;
            case Opcode.PLA_imp: this.PLA(); break;
            case Opcode.PLP_imp: this.PLP(); break;
            case Opcode.PHX_imp: this.push(this.X); break; // 65C02
            case Opcode.PHY_imp: this.push(this.Y); break; // 65C02
            case Opcode.PLX_imp:
                this.X = this.pop();
                this.setFlag(Flags.Zero, this.X === 0);
                this.setFlag(Flags.Negative, (this.X & 0x80) !== 0);
                break; // 65C02
            case Opcode.PLY_imp:
                this.Y = this.pop();
                this.setFlag(Flags.Zero, this.Y === 0);
                this.setFlag(Flags.Negative, (this.Y & 0x80) !== 0);
                break; // 65C02

            // Logical
            case Opcode.AND_imm:
            case Opcode.AND_zp:
            case Opcode.AND_zpx:
            case Opcode.AND_abs:
            case Opcode.AND_abx:
            case Opcode.AND_aby:
            case Opcode.AND_izx:
            case Opcode.AND_izy:
            case Opcode.AND_izp:
                this.AND(this.memory.read(this.fetchEffectiveAddress(entry.mode)));
                break;

            case Opcode.ORA_imm:
            case Opcode.ORA_zp:
            case Opcode.ORA_zpx:
            case Opcode.ORA_abs:
            case Opcode.ORA_abx:
            case Opcode.ORA_aby:
            case Opcode.ORA_izx:
            case Opcode.ORA_izy:
            case Opcode.ORA_izp:
                this.ORA(this.memory.read(this.fetchEffectiveAddress(entry.mode)));
                break;

            case Opcode.EOR_imm:
            case Opcode.EOR_zp:
            case Opcode.EOR_zpx:
            case Opcode.EOR_abs:
            case Opcode.EOR_abx:
            case Opcode.EOR_aby:
            case Opcode.EOR_izx:
            case Opcode.EOR_izy:
            case Opcode.EOR_izp:
                this.EOR(this.memory.read(this.fetchEffectiveAddress(entry.mode)));
                break;

            case Opcode.BIT_zp:
            case Opcode.BIT_abs:
            case Opcode.BIT_zpx: // 65C02
            case Opcode.BIT_abx: // 65C02
                this.BIT(this.memory.read(this.fetchEffectiveAddress(entry.mode)));
                break;
            case Opcode.BIT_imm: // 65C02
                {
                    const val = this.fetchByte(); // Using fetchByte() or manual read?
                    // Original code: "const val = this.fetchByte();". 
                    // fetchByte wasn't visible in my view but used in BIT_imm case in original?
                    // Wait, step 427 lines 412: "const val = this.fetchByte();".
                    // I need to implement fetchByte or use `memory.read(PC++)`.
                    // But `fetchEffectiveAddress('imm')` returns PC++.
                    // So:
                    this.setFlag(Flags.Zero, (this.A & this.memory.read(this.fetchEffectiveAddress(entry.mode))) === 0);
                }
                break;

            case Opcode.TRB_zp:
            case Opcode.TRB_abs:
                this.trb(this.fetchEffectiveAddress(entry.mode)); // 65C02
                break;
            case Opcode.TSB_zp:
            case Opcode.TSB_abs:
                this.tsb(this.fetchEffectiveAddress(entry.mode)); // 65C02
                break;

            // Arithmetic
            case Opcode.ADC_imm:
            case Opcode.ADC_zp:
            case Opcode.ADC_zpx:
            case Opcode.ADC_abs:
            case Opcode.ADC_abx:
            case Opcode.ADC_aby:
            case Opcode.ADC_izx:
            case Opcode.ADC_izy:
            case Opcode.ADC_izp:
                this.ADC(this.memory.read(this.fetchEffectiveAddress(entry.mode)));
                break;

            case Opcode.SBC_imm:
            case Opcode.SBC_zp:
            case Opcode.SBC_zpx:
            case Opcode.SBC_abs:
            case Opcode.SBC_abx:
            case Opcode.SBC_aby:
            case Opcode.SBC_izx:
            case Opcode.SBC_izy:
            case Opcode.SBC_izp:
                this.SBC(this.memory.read(this.fetchEffectiveAddress(entry.mode)));
                break;

            case Opcode.CMP_imm:
            case Opcode.CMP_zp:
            case Opcode.CMP_zpx:
            case Opcode.CMP_abs:
            case Opcode.CMP_abx:
            case Opcode.CMP_aby:
            case Opcode.CMP_izx:
            case Opcode.CMP_izy:
            case Opcode.CMP_izp:
                this.CMP(this.memory.read(this.fetchEffectiveAddress(entry.mode)));
                break;

            case Opcode.CPX_imm:
            case Opcode.CPX_zp:
            case Opcode.CPX_abs:
                this.CPX(this.memory.read(this.fetchEffectiveAddress(entry.mode)));
                break;

            case Opcode.CPY_imm:
            case Opcode.CPY_zp:
            case Opcode.CPY_abs:
                this.CPY(this.memory.read(this.fetchEffectiveAddress(entry.mode)));
                break;

            // Inc/Dec
            case Opcode.INC_zp:
            case Opcode.INC_zpx:
            case Opcode.INC_abs:
            case Opcode.INC_abx:
                this.INC_Mem(this.fetchEffectiveAddress(entry.mode));
                break;
            case Opcode.INC_acc: // 65C02
                this.A = (this.A + 1) & 0xFF;
                this.setFlag(Flags.Zero, this.A === 0);
                this.setFlag(Flags.Negative, (this.A & 0x80) !== 0);
                break;

            case Opcode.DEC_zp:
            case Opcode.DEC_zpx:
            case Opcode.DEC_abs:
            case Opcode.DEC_abx:
                this.DEC_Mem(this.fetchEffectiveAddress(entry.mode));
                break;
            case Opcode.DEC_acc: // 65C02
                this.A = (this.A - 1) & 0xFF;
                this.setFlag(Flags.Zero, this.A === 0);
                this.setFlag(Flags.Negative, (this.A & 0x80) !== 0);
                break;

            case Opcode.INX_imp: this.INX(); break;
            case Opcode.INY_imp: this.INY(); break;
            case Opcode.DEX_imp: this.DEX(); break;
            case Opcode.DEY_imp: this.DEY(); break;

            // Shifts
            case Opcode.ASL_acc: this.ASL_A(); break;
            case Opcode.ASL_zp:
            case Opcode.ASL_zpx:
            case Opcode.ASL_abs:
            case Opcode.ASL_abx:
                this.ASL_Mem(this.fetchEffectiveAddress(entry.mode));
                break;

            case Opcode.LSR_acc: this.LSR_A(); break;
            case Opcode.LSR_zp:
            case Opcode.LSR_zpx:
            case Opcode.LSR_abs:
            case Opcode.LSR_abx:
                this.LSR_Mem(this.fetchEffectiveAddress(entry.mode));
                break;

            case Opcode.ROL_acc: this.ROL_A(); break;
            case Opcode.ROL_zp:
            case Opcode.ROL_zpx:
            case Opcode.ROL_abs:
            case Opcode.ROL_abx:
                this.ROL_Mem(this.fetchEffectiveAddress(entry.mode));
                break;

            case Opcode.ROR_acc: this.ROR_A(); break;
            case Opcode.ROR_zp:
            case Opcode.ROR_zpx:
            case Opcode.ROR_abs:
            case Opcode.ROR_abx:
                this.ROR_Mem(this.fetchEffectiveAddress(entry.mode));
                break;

            // Branching
            case Opcode.BPL_rel: this.branch(!this.getFlag(Flags.Negative)); break;
            case Opcode.BMI_rel: this.branch(this.getFlag(Flags.Negative)); break;
            case Opcode.BVC_rel: this.branch(!this.getFlag(Flags.Overflow)); break;
            case Opcode.BVS_rel: this.branch(this.getFlag(Flags.Overflow)); break;
            case Opcode.BCC_rel: this.branch(!this.getFlag(Flags.Carry)); break;
            case Opcode.BCS_rel: this.branch(this.getFlag(Flags.Carry)); break;
            case Opcode.BNE_rel: this.branch(!this.getFlag(Flags.Zero)); break;
            case Opcode.BEQ_rel: this.branch(this.getFlag(Flags.Zero)); break;
            case Opcode.BRA_rel: this.branch(true); break; // 65C02

            // Jumps/Calls
            case Opcode.JMP_abs:
            case Opcode.JMP_ind:
                // JMP does not modify cycles in original switch?
                // Original: "case 0x4C: this.PC = this.addrAbsolute(); this.cycles += 3; break;"
                // Original: "case 0x6C: this.PC = this.addrIndirect(); this.cycles += 5; break;"
                // My metadata has cycles included. Simple fetch address sets PC?
                // `addrAbsolute` returns address.
                this.PC = this.fetchEffectiveAddress(entry.mode);
                break;

            case Opcode.JMP_iax: // 65C02 JMP (Abs,X)
                const ptr = this.addrAbsoluteX();
                const low = this.memory.read(ptr);
                const high = this.memory.read((ptr + 1) & 0xFFFF);
                this.PC = (high << 8) | low;
                break;

            case Opcode.JSR_abs:
                this.JSR(this.fetchEffectiveAddress(entry.mode));
                break;

            case Opcode.RTS_imp: this.RTS(); break;
            case Opcode.RTI_imp: this.RTI(); break;
            case Opcode.BRK_imp: this.BRK(); break; // BRK cycles handled in BRK() method usually? Original says "Cycles handled in BRK (7)". My metadata adds 7. Double counting?
                // Original: "case 0x00: this.BRK(); break;" -> BRK adds 7.
                // My code here adds `entry.cycles` (7) at top.
                // So `BRK()` method should NOT add cycles anymore.
                // I need to check `BRK()` implementation.
                break;

            // Flags
            case Opcode.CLC_imp: this.CLC(); break;
            case Opcode.CLD_imp: this.CLD(); break;
            case Opcode.CLI_imp: this.CLI(); break;
            case Opcode.CLV_imp: this.CLV(); break;
            case Opcode.SEC_imp: this.SEC(); break;
            case Opcode.SED_imp: this.SED(); break;
            case Opcode.SEI_imp: this.SEI(); break;

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

    // ... constr ...

    public addBreakpoint(addr: number, group: string = "default"): void {
        let groups = this.breakpoints.get(addr);
        if (!groups) {
            groups = new Set();
            this.breakpoints.set(addr, groups);
        }
        groups.add(group);
    }

    public removeBreakpoint(addr: number, group: string = "default"): void {
        const groups = this.breakpoints.get(addr);
        if (groups) {
            groups.delete(group);
            if (groups.size === 0) {
                this.breakpoints.delete(addr);
            }
        }
    }

    public clearBreakpoints(group?: string): void {
        if (group) {
            for (const [addr, groups] of this.breakpoints) {
                groups.delete(group);
                if (groups.size === 0) {
                    this.breakpoints.delete(addr);
                }
            }
        } else {
            this.breakpoints.clear();
        }
    }

    // --- 65C02 Helpers ---
    protected fetchByte(): number {
        const val = this.memory.read(this.PC);
        this.PC = (this.PC + 1) & 0xFFFF;
        return val;
    }

    protected trb(addr: number): void {
        let val = this.memory.read(addr);
        const result = this.A & val;
        this.setFlag(Flags.Zero, result === 0);
        val &= ~this.A;
        this.memory.write(addr, val);
    }

    protected tsb(addr: number): void {
        let val = this.memory.read(addr);
        const result = this.A & val;
        this.setFlag(Flags.Zero, result === 0);
        val |= this.A;
        this.memory.write(addr, val);
    }

    protected bit(addr: number): void {
        const val = this.memory.read(addr);
        this.setFlag(Flags.Zero, (this.A & val) === 0);
        this.setFlag(Flags.Negative, (val & 0x80) !== 0);
        this.setFlag(Flags.Overflow, (val & 0x40) !== 0);
    }
}

