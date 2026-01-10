import { Cpu6502 } from './cpu6502';
import { IMemory } from './memory';

export class Bug65Host {
    private cpu: Cpu6502;
    private memory: IMemory;

    private readonly EXIT_ADDR = 0xFFF9;
    private readonly WRITE_ADDR = 0xFFF3;
    // TODO: Verify other addresses

    constructor(cpu: Cpu6502, memory: IMemory) {
        this.cpu = cpu;
        this.memory = memory;
    }

    // Call this before cpu.step() or inside cpu logic?
    // Better to have Cpu emit an event or check PC.
    // Since we are building the CPU, we can add a 'trap' mechanism or check PC in step.

    // For now, let's expose a check method
    checkHooks(): boolean {
        const pc = this.cpu.getRegisters().PC;
        if (pc === this.EXIT_ADDR) {
            const exitCode = this.cpu.getRegisters().A;
            console.log(`Sim65 Exit code: ${exitCode}`);
            // In a real run, we might want to stop the loop or throw an exception to standardly exit
            return true; // Stop execution
        }
        return false;
    }
}
