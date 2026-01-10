import { Cpu6502 } from './cpu6502';
import { IMemory } from './memory';

export class Bug65Host {
    private cpu: Cpu6502;
    private memory: IMemory;
    public onExit: ((code: number) => void) | undefined;
    public onWrite: ((val: number) => void) | undefined;

    // sim65 addresses
    private readonly ADDR_LSEEK = 0xFFF1;
    private readonly ADDR_REMOVE = 0xFFF2;
    private readonly ADDR_MAPERRNO = 0xFFF3;
    private readonly ADDR_OPEN = 0xFFF4;
    private readonly ADDR_CLOSE = 0xFFF5;
    private readonly ADDR_READ = 0xFFF6;
    private readonly ADDR_WRITE = 0xFFF7;
    private readonly ADDR_ARGS = 0xFFF8;
    private readonly ADDR_EXIT = 0xFFF9;

    constructor(cpu: Cpu6502, memory: IMemory) {
        this.cpu = cpu;
        this.memory = memory;
    }

    install(): void {
        this.cpu.onTrap = (pc: number) => this.handleTrap(pc);
    }

    private handleTrap(pc: number): boolean {
        if (pc === this.ADDR_EXIT) {
            const exitCode = this.cpu.getRegisters().A;
            if (this.onExit) {
                this.onExit(exitCode);
            }
            return true;
        }

        if (pc === this.ADDR_WRITE) {
            const regs = this.cpu.getRegisters();
            const count = (regs.X << 8) | regs.A; // Count in AX

            // Read C Stack Pointer from ZP $00/$01 (Standard cc65)
            const sp = (this.memory.read(0x01) << 8) | this.memory.read(0x00);

            // Stack layout for fastcall write(fd, buf, count):
            // count (AX)
            // buf (sp+0) - 2 bytes
            // fd (sp+2) - 2 bytes

            // Note: Since sp points to the last pushed byte?
            // "The parameter stack is located at the highest available memory address and grows downwards."
            // Parameters pushed: fd (2 bytes), then buf (2 bytes).
            // Stack: 
            // [....]
            // +1: Buf High
            // +0: Buf Low  <-- sp
            // +3: Fd High
            // +2: Fd Low

            const buf = (this.memory.read(sp + 1) << 8) | this.memory.read(sp);
            const fd = (this.memory.read(sp + 3) << 8) | this.memory.read(sp + 2);

            if (buf > 0 && count > 0) {
                const output: number[] = [];
                for (let i = 0; i < count; i++) {
                    output.push(this.memory.read(buf + i));
                }
                // Send to onWrite
                if (this.onWrite) {
                    output.forEach(c => this.onWrite!(c));
                }
            }

            // We should pop the arguments from the software stack.
            // sp += 4
            const newSp = (sp + 4) & 0xFFFF;
            this.memory.write(0x00, newSp & 0xFF);
            this.memory.write(0x01, (newSp >> 8) & 0xFF);

            return false;
        }

        if (pc === this.ADDR_OPEN) {
            this.cpu.setRegisters({ A: 0, X: 0 });
            return false;
        }

        return false;
    }
}
