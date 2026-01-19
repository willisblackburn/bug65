import { IMemory } from './memory';
import { DebugInfo } from './debugInfo';
import { CpuType } from './cpu-interface';
import { OPCODES, OpcodeInfo } from './opcodes';

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

        return sym ? sym.name : undefined;
    }
}
