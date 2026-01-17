import { IMemory } from './memory';
import { DebugInfo } from './debugInfo';
import { CpuType } from './cpu-interface';

export class Disassembler6502 {
    private debugInfo?: DebugInfo;
    private cpuType: CpuType = '6502';

    constructor(debugInfo?: DebugInfo, cpuType: CpuType = '6502') {
        this.debugInfo = debugInfo;
        this.cpuType = cpuType;
    }

    public setCpuType(type: CpuType) {
        this.cpuType = type;
    }

    public disassemble(memory: IMemory, pc: number): { asm: string, bytes: number[], count: number } {
        const opcode = memory.read(pc);
        const entry = OPCODES[opcode];

        if (!entry || (entry.cpu === '65C02' && this.cpuType !== '65C02')) {
            return { asm: `DB $${opcode.toString(16).toUpperCase().padStart(2, '0')} ???`, bytes: [opcode], count: 1 };
        }

        let len = 1;
        let operandStr = '';
        const bytes = [opcode];
        const isCodeStr = (entry.mode === 'rel' || entry.mode === 'ind' || (entry.mode === 'abs' && (entry.name === 'JMP' || entry.name === 'JSR')));

        // Fetch operands based on mode
        switch (entry.mode) {
            case 'imp':
            case 'acc':
                len = 1;
                break;
            case 'imm':
                len = 2;
                bytes.push(memory.read(pc + 1));
                operandStr = `#$${bytes[1].toString(16).toUpperCase().padStart(2, '0')}`;
                break;
            case 'zp':
                len = 2;
                bytes.push(memory.read(pc + 1));
                {
                    const addr = bytes[1];
                    const sym = this.resolveSymbol(addr, false);
                    operandStr = sym ? sym : `$${addr.toString(16).toUpperCase().padStart(2, '0')}`;
                }
                break;
            case 'zpx':
                len = 2;
                bytes.push(memory.read(pc + 1));
                {
                    const addr = bytes[1];
                    const sym = this.resolveSymbol(addr, false);
                    operandStr = (sym ? sym : `$${addr.toString(16).toUpperCase().padStart(2, '0')}`) + ',X';
                }
                break;
            case 'zpy':
                len = 2;
                bytes.push(memory.read(pc + 1));
                {
                    const addr = bytes[1];
                    const sym = this.resolveSymbol(addr, false);
                    operandStr = (sym ? sym : `$${addr.toString(16).toUpperCase().padStart(2, '0')}`) + ',Y';
                }
                break;
            case 'abs':
                len = 3;
                bytes.push(memory.read(pc + 1));
                bytes.push(memory.read(pc + 2));
                {
                    const addr = (bytes[2] << 8) | bytes[1];
                    const sym = this.resolveSymbol(addr, isCodeStr);
                    operandStr = sym ? sym : `$${addr.toString(16).toUpperCase().padStart(4, '0')}`;
                }
                break;
            case 'abx':
                len = 3;
                bytes.push(memory.read(pc + 1));
                bytes.push(memory.read(pc + 2));
                {
                    const addr = (bytes[2] << 8) | bytes[1];
                    const sym = this.resolveSymbol(addr, false);
                    operandStr = (sym ? sym : `$${addr.toString(16).toUpperCase().padStart(4, '0')}`) + ',X';
                }
                break;
            case 'aby':
                len = 3;
                bytes.push(memory.read(pc + 1));
                bytes.push(memory.read(pc + 2));
                {
                    const addr = (bytes[2] << 8) | bytes[1];
                    const sym = this.resolveSymbol(addr, false);
                    operandStr = (sym ? sym : `$${addr.toString(16).toUpperCase().padStart(4, '0')}`) + ',Y';
                }
                break;
            case 'ind': // JMP (abs)
                len = 3;
                bytes.push(memory.read(pc + 1));
                bytes.push(memory.read(pc + 2));
                {
                    const addr = (bytes[2] << 8) | bytes[1];
                    const sym = this.resolveSymbol(addr, true);
                    operandStr = `(${sym ? sym : '$' + addr.toString(16).toUpperCase().padStart(4, '0')})`;
                }
                break;
            case 'izx':
                len = 2;
                bytes.push(memory.read(pc + 1));
                {
                    const addr = bytes[1];
                    const sym = this.resolveSymbol(addr, false);
                    operandStr = `(${sym ? sym : '$' + addr.toString(16).toUpperCase().padStart(2, '0')},X)`;
                }
                break;
            case 'izy':
                len = 2;
                bytes.push(memory.read(pc + 1));
                {
                    const addr = bytes[1];
                    const sym = this.resolveSymbol(addr, false);
                    operandStr = `(${sym ? sym : '$' + addr.toString(16).toUpperCase().padStart(2, '0')}),Y`;
                }
                break;
            case 'rel':
                len = 2;
                bytes.push(memory.read(pc + 1));
                {
                    let offset = bytes[1];
                    if (offset > 127) offset -= 256;
                    const dest = (pc + 2 + offset) & 0xFFFF;
                    const sym = this.resolveSymbol(dest, true);
                    operandStr = sym ? sym : `$${dest.toString(16).toUpperCase().padStart(4, '0')}`;
                }
                break;
            case 'iax': // JMP (Abs,X)
                len = 3;
                bytes.push(memory.read(pc + 1));
                bytes.push(memory.read(pc + 2));
                {
                    const addr = (bytes[2] << 8) | bytes[1];
                    const sym = this.resolveSymbol(addr, true);
                    operandStr = `(${sym ? sym : '$' + addr.toString(16).toUpperCase().padStart(4, '0')},X)`;
                }
                break;
            case 'izp': // (ZP)
                len = 2;
                bytes.push(memory.read(pc + 1));
                {
                    const addr = bytes[1];
                    const sym = this.resolveSymbol(addr, false);
                    operandStr = `(${sym ? sym : '$' + addr.toString(16).toUpperCase().padStart(2, '0')})`;
                }
                break;
        }

        let asm = entry.name;
        if (operandStr) {
            asm += ' ' + operandStr;
        }

        // Pad asm to fixed width
        return { asm: asm.padEnd(20), bytes, count: len };
    }

    private resolveSymbol(addr: number, isCode: boolean): string | undefined {
        if (!this.debugInfo) return undefined;
        const sym = this.debugInfo.getSymbolForAddress(addr);

        // Exact match label logic
        // If we found a label (or segment-based symbol), use it immediately without +1 logic?
        // Actually user said: "if there is no label defined ... but ... immediately preceeding".
        // And "This is also wrong. It should be 'ROL ptr1+1'". (Where PVM_CALL was likely an equate).
        // So if sym is type 'equ' (or similar), we might prefer 'lab+1' if !isCode.

        if (sym && (sym.type === 'lab' || sym.symType === 'lab' || sym.segId !== undefined)) {
            return sym.name;
        }

        if (!isCode) {
            // Try addr - 1
            const prev = this.debugInfo.getSymbolForAddress(addr - 1);
            if (prev && (prev.type === 'lab' || prev.symType === 'lab' || prev.segId !== undefined)) {
                return `${prev.name}+1`;
            }
        }

        // Fallback to whatever symbol we had (even if equate)
        return sym ? sym.name : undefined;
    }
}

// Minimal Opcode Table (Name, Mode)
interface OpcodeEntry { name: string; mode: string; cpu?: CpuType; }

const OPCODES: { [key: number]: OpcodeEntry } = {
    0x00: { name: 'BRK', mode: 'imp' },
    0x01: { name: 'ORA', mode: 'izx' },
    0x05: { name: 'ORA', mode: 'zp' },
    0x06: { name: 'ASL', mode: 'zp' },
    0x08: { name: 'PHP', mode: 'imp' },
    0x09: { name: 'ORA', mode: 'imm' },
    0x0A: { name: 'ASL', mode: 'acc' },
    0x0D: { name: 'ORA', mode: 'abs' },
    0x0E: { name: 'ASL', mode: 'abs' },

    0x10: { name: 'BPL', mode: 'rel' },
    0x11: { name: 'ORA', mode: 'izy' },
    0x15: { name: 'ORA', mode: 'zpx' },
    0x16: { name: 'ASL', mode: 'zpx' },
    0x18: { name: 'CLC', mode: 'imp' },
    0x19: { name: 'ORA', mode: 'aby' },
    0x1D: { name: 'ORA', mode: 'abx' },
    0x1E: { name: 'ASL', mode: 'abx' },

    0x20: { name: 'JSR', mode: 'abs' },
    0x21: { name: 'AND', mode: 'izx' },
    0x24: { name: 'BIT', mode: 'zp' },
    0x25: { name: 'AND', mode: 'zp' },
    0x26: { name: 'ROL', mode: 'zp' },
    0x28: { name: 'PLP', mode: 'imp' },
    0x29: { name: 'AND', mode: 'imm' },
    0x2A: { name: 'ROL', mode: 'acc' },
    0x2C: { name: 'BIT', mode: 'abs' },
    0x2D: { name: 'AND', mode: 'abs' },
    0x2E: { name: 'ROL', mode: 'abs' },

    0x30: { name: 'BMI', mode: 'rel' },
    0x31: { name: 'AND', mode: 'izy' },
    0x35: { name: 'AND', mode: 'zpx' },
    0x36: { name: 'ROL', mode: 'zpx' },
    0x38: { name: 'SEC', mode: 'imp' },
    0x39: { name: 'AND', mode: 'aby' },
    0x3D: { name: 'AND', mode: 'abx' },
    0x3E: { name: 'ROL', mode: 'abx' },

    0x40: { name: 'RTI', mode: 'imp' },
    0x41: { name: 'EOR', mode: 'izx' },
    0x45: { name: 'EOR', mode: 'zp' },
    0x46: { name: 'LSR', mode: 'zp' },
    0x48: { name: 'PHA', mode: 'imp' },
    0x49: { name: 'EOR', mode: 'imm' },
    0x4A: { name: 'LSR', mode: 'acc' },
    0x4C: { name: 'JMP', mode: 'abs' },
    0x4D: { name: 'EOR', mode: 'abs' },
    0x4E: { name: 'LSR', mode: 'abs' },

    0x50: { name: 'BVC', mode: 'rel' },
    0x51: { name: 'EOR', mode: 'izy' },
    0x55: { name: 'EOR', mode: 'zpx' },
    0x56: { name: 'LSR', mode: 'zpx' },
    0x58: { name: 'CLI', mode: 'imp' },
    0x59: { name: 'EOR', mode: 'aby' },
    0x5D: { name: 'EOR', mode: 'abx' },
    0x5E: { name: 'LSR', mode: 'abx' },

    0x60: { name: 'RTS', mode: 'imp' },
    0x61: { name: 'ADC', mode: 'izx' },
    0x65: { name: 'ADC', mode: 'zp' },
    0x66: { name: 'ROR', mode: 'zp' },
    0x68: { name: 'PLA', mode: 'imp' },
    0x69: { name: 'ADC', mode: 'imm' },
    0x6A: { name: 'ROR', mode: 'acc' },
    0x6C: { name: 'JMP', mode: 'ind' },
    0x6D: { name: 'ADC', mode: 'abs' },
    0x6E: { name: 'ROR', mode: 'abs' },

    0x70: { name: 'BVS', mode: 'rel' },
    0x71: { name: 'ADC', mode: 'izy' },
    0x75: { name: 'ADC', mode: 'zpx' },
    0x76: { name: 'ROR', mode: 'zpx' },
    0x78: { name: 'SEI', mode: 'imp' },
    0x79: { name: 'ADC', mode: 'aby' },
    0x7D: { name: 'ADC', mode: 'abx' },
    0x7E: { name: 'ROR', mode: 'abx' },

    0x81: { name: 'STA', mode: 'izx' },
    0x84: { name: 'STY', mode: 'zp' },
    0x85: { name: 'STA', mode: 'zp' },
    0x86: { name: 'STX', mode: 'zp' },
    0x88: { name: 'DEY', mode: 'imp' },
    0x8A: { name: 'TXA', mode: 'imp' },
    0x8C: { name: 'STY', mode: 'abs' },
    0x8D: { name: 'STA', mode: 'abs' },
    0x8E: { name: 'STX', mode: 'abs' },

    0x90: { name: 'BCC', mode: 'rel' },
    0x91: { name: 'STA', mode: 'izy' },
    0x94: { name: 'STY', mode: 'zpx' },
    0x95: { name: 'STA', mode: 'zpx' },
    0x96: { name: 'STX', mode: 'zpy' },
    0x98: { name: 'TYA', mode: 'imp' },
    0x99: { name: 'STA', mode: 'aby' },
    0x9A: { name: 'TXS', mode: 'imp' },
    0x9D: { name: 'STA', mode: 'abx' },

    0xA0: { name: 'LDY', mode: 'imm' },
    0xA1: { name: 'LDA', mode: 'izx' },
    0xA2: { name: 'LDX', mode: 'imm' },
    0xA4: { name: 'LDY', mode: 'zp' },
    0xA5: { name: 'LDA', mode: 'zp' },
    0xA6: { name: 'LDX', mode: 'zp' },
    0xA8: { name: 'TAY', mode: 'imp' },
    0xA9: { name: 'LDA', mode: 'imm' },
    0xAA: { name: 'TAX', mode: 'imp' },
    0xAC: { name: 'LDY', mode: 'abs' },
    0xAD: { name: 'LDA', mode: 'abs' },
    0xAE: { name: 'LDX', mode: 'abs' },

    0xB0: { name: 'BCS', mode: 'rel' },
    0xB1: { name: 'LDA', mode: 'izy' },
    0xB4: { name: 'LDY', mode: 'zpx' },
    0xB5: { name: 'LDA', mode: 'zpx' },
    0xB6: { name: 'LDX', mode: 'zpy' },
    0xB8: { name: 'CLV', mode: 'imp' },
    0xB9: { name: 'LDA', mode: 'aby' },
    0xBA: { name: 'TSX', mode: 'imp' },
    0xBC: { name: 'LDY', mode: 'abx' },
    0xBD: { name: 'LDA', mode: 'abx' },
    0xBE: { name: 'LDX', mode: 'aby' },

    0xC0: { name: 'CPY', mode: 'imm' },
    0xC1: { name: 'CMP', mode: 'izx' },
    0xC4: { name: 'CPY', mode: 'zp' },
    0xC5: { name: 'CMP', mode: 'zp' },
    0xC6: { name: 'DEC', mode: 'zp' },
    0xC8: { name: 'INY', mode: 'imp' },
    0xC9: { name: 'CMP', mode: 'imm' },
    0xCA: { name: 'DEX', mode: 'imp' },
    0xCC: { name: 'CPY', mode: 'abs' },
    0xCD: { name: 'CMP', mode: 'abs' },
    0xCE: { name: 'DEC', mode: 'abs' },

    0xD0: { name: 'BNE', mode: 'rel' },
    0xD1: { name: 'CMP', mode: 'izy' },
    0xD5: { name: 'CMP', mode: 'zpx' },
    0xD6: { name: 'DEC', mode: 'zpx' },
    0xD8: { name: 'CLD', mode: 'imp' },
    0xD9: { name: 'CMP', mode: 'aby' },
    0xDD: { name: 'CMP', mode: 'abx' },
    0xDE: { name: 'DEC', mode: 'abx' },

    0xE0: { name: 'CPX', mode: 'imm' },
    0xE1: { name: 'SBC', mode: 'izx' },
    0xE4: { name: 'CPX', mode: 'zp' },
    0xE5: { name: 'SBC', mode: 'zp' },
    0xE6: { name: 'INC', mode: 'zp' },
    0xE8: { name: 'INX', mode: 'imp' },
    0xE9: { name: 'SBC', mode: 'imm' },
    0xEA: { name: 'NOP', mode: 'imp' },
    0xEC: { name: 'CPX', mode: 'abs' },
    0xED: { name: 'SBC', mode: 'abs' },
    0xEE: { name: 'INC', mode: 'abs' },

    0xF0: { name: 'BEQ', mode: 'rel' },
    0xF1: { name: 'SBC', mode: 'izy' },
    0xF5: { name: 'SBC', mode: 'zpx' },
    0xF6: { name: 'INC', mode: 'zpx' },
    0xF8: { name: 'SED', mode: 'imp' },
    0xF9: { name: 'SBC', mode: 'aby' },
    0xFD: { name: 'SBC', mode: 'abx' },
    0xFE: { name: 'INC', mode: 'abx' },

    // 65C02
    0x04: { name: 'TSB', mode: 'zp', cpu: '65C02' },
    0x0C: { name: 'TSB', mode: 'abs', cpu: '65C02' },
    0x12: { name: 'ORA', mode: 'izp', cpu: '65C02' },
    0x14: { name: 'TRB', mode: 'zp', cpu: '65C02' },
    0x1A: { name: 'INC', mode: 'acc', cpu: '65C02' },
    0x1C: { name: 'TRB', mode: 'abs', cpu: '65C02' },
    0x32: { name: 'AND', mode: 'izp', cpu: '65C02' },
    0x34: { name: 'BIT', mode: 'zpx', cpu: '65C02' },
    0x3A: { name: 'DEC', mode: 'acc', cpu: '65C02' },
    0x3C: { name: 'BIT', mode: 'abx', cpu: '65C02' },
    0x52: { name: 'EOR', mode: 'izp', cpu: '65C02' },
    0x5A: { name: 'PHY', mode: 'imp', cpu: '65C02' },
    0x64: { name: 'STZ', mode: 'zp', cpu: '65C02' },
    0x72: { name: 'ADC', mode: 'izp', cpu: '65C02' },
    0x74: { name: 'STZ', mode: 'zpx', cpu: '65C02' },
    0x7A: { name: 'PLY', mode: 'imp', cpu: '65C02' },
    0x7C: { name: 'JMP', mode: 'iax', cpu: '65C02' },
    0x80: { name: 'BRA', mode: 'rel', cpu: '65C02' },
    0x89: { name: 'BIT', mode: 'imm', cpu: '65C02' },
    0x92: { name: 'STA', mode: 'izp', cpu: '65C02' },
    0x9C: { name: 'STZ', mode: 'abs', cpu: '65C02' },
    0x9E: { name: 'STZ', mode: 'abx', cpu: '65C02' },
    0xB2: { name: 'LDA', mode: 'izp', cpu: '65C02' },
    0xD2: { name: 'CMP', mode: 'izp', cpu: '65C02' },
    0xDA: { name: 'PHX', mode: 'imp', cpu: '65C02' },
    0xF2: { name: 'SBC', mode: 'izp', cpu: '65C02' },
    0xFA: { name: 'PLX', mode: 'imp', cpu: '65C02' },
};
