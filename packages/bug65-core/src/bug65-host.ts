import { Cpu6502 } from './cpu6502';
import { IMemory } from './memory';

export class Bug65Host {
    private cpu: Cpu6502;
    private memory: IMemory;
    public onExit: ((code: number) => void) | undefined;
    public onWrite: ((val: number) => void) | undefined;

    // sim65 addresses
    private readonly ADDR_EXIT = 0xFFF9;
    private readonly ADDR_PUTC = 0xFFF0;
    private readonly ADDR_WRITE = 0xFFF4;
    private readonly ADDR_OPEN = 0xFFF7;
    private readonly ADDR_CLOSE = 0xFFF6;
    private readonly ADDR_READ = 0xFFF5;

    constructor(cpu: Cpu6502, memory: IMemory) {
        this.cpu = cpu;
        this.memory = memory;
    }

    install(): void {
        this.cpu.onTrap = (pc: number) => this.handleTrap(pc);
    }

    private handleTrap(pc: number): boolean {
        // Handle Exit
        if (pc === this.ADDR_EXIT) {
            const exitCode = this.cpu.getRegisters().A;
            if (this.onExit) {
                this.onExit(exitCode);
            }
            return true; // Stop execution
        }

        if (pc === this.ADDR_PUTC) {
            const char = this.cpu.getRegisters().A;
            if (this.onWrite) {
                this.onWrite(char);
            }
            return false;
        }

        if (pc === this.ADDR_WRITE) {
            // cc65 sim65 `write` ABI:
            // AX = buffer address
            // Y = count
            const regs = this.cpu.getRegisters();
            const addr = (regs.X << 8) | regs.A;
            const len = regs.Y;

            // Check for indirect pointer at 'addr' (Zero page)
            const indirectPtr = (this.memory.read((addr + 1) & 0xFFFF) << 8) | this.memory.read(addr);

            console.error(`[Bug65Host] WRITE trap: AX=$${addr.toString(16)} (=$${addr}) Len=${len}`);
            console.error(`[Bug65Host] Indirect Ptr at AX: $${indirectPtr.toString(16)}`);

            // Try direct
            // Dump hex
            const bytes: number[] = [];
            for (let i = 0; i < Math.min(len, 16); i++) {
                bytes.push(this.memory.read(addr + i));
            }
            console.error(`[Bug65Host] Direct Content (first 16): ${bytes.map(b => b.toString(16).padStart(2, '0')).join(' ')}`);

            // Try indirect
            if (indirectPtr > 0) {
                const iBytes: number[] = [];
                for (let i = 0; i < Math.min(len, 16); i++) {
                    iBytes.push(this.memory.read(indirectPtr + i));
                }
                console.error(`[Bug65Host] Indirect Content: ${iBytes.map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
                console.error(`[Bug65Host] Indirect ASCII: ${iBytes.map(b => b >= 32 && b <= 126 ? String.fromCharCode(b) : '.').join('')}`);

                // If this looks like "Hello", print it!
                // Heuristic fix for sim65 indirect addressing
                // Assuming ptr1 usage
                if (indirectPtr >= 0x200 && len > 0) {
                    for (let i = 0; i < len; i++) {
                        const char = this.memory.read(indirectPtr + i);
                        if (this.onWrite) this.onWrite(char);
                    }
                    return false;
                }
            }

            // Fallback direct print (if failed above)
            for (let i = 0; i < len; i++) {
                const char = this.memory.read(addr + i);
                if (this.onWrite) {
                    this.onWrite(char);
                }
            }
            return false;
        }

        if (pc === this.ADDR_OPEN) {
            // Return success (0)
            this.cpu.setRegisters({ A: 0, X: 0 });
            return false;
        }

        return false;
    }
}
