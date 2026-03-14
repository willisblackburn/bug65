import { DebugInfo } from './debug_info';
import { Opcode } from './opcodes';

export interface ProfileEntry {
    sp: number;
    name: string;
}

export const DEFAULT_FUNCTION = "(startup)";

export interface Profiler {
    totalCycles: number;
    record(opcode: number, cycles: number, currentSP: number, currentPC: number): void;
    reset(): void;
    kind?: string;
}

export class SimpleProfiler implements Profiler {
    public totalCycles: number = 0;

    public record(opcode: number, cycles: number, currentSP: number, currentPC: number) {
        this.totalCycles += cycles;
    }

    public reset() {
        this.totalCycles = 0;
    }
}

export class FunctionalProfiler implements Profiler {
    public totalCycles: number = 0;
    public kind = "functional";
    private stack: ProfileEntry[] = [];
    private cycleCounts: Map<string, number> = new Map();
    private debugInfo: DebugInfo | undefined;

    constructor(debugInfo?: DebugInfo) {
        this.debugInfo = debugInfo;
        this.cycleCounts.set(DEFAULT_FUNCTION, 0);
    }

    public record(opcode: number, cycles: number, currentSP: number, currentPC: number) {
        this.totalCycles += cycles;

        // 1. Discard entries from the top of the profile stack where the stack address is now less than SP
        while (this.stack.length > 0 && this.stack[this.stack.length - 1].sp < currentSP) {
            this.stack.pop();
        }

        // 2. Check for JSR or BRK to push a new function onto the profile stack
        if (opcode === Opcode.JSR_abs || opcode === Opcode.BRK_imp) {
            let funcName = `unknown_$${currentPC.toString(16).toUpperCase().padStart(4, '0')}`;
            if (this.debugInfo) {
                const sym = this.debugInfo.getSymbolForAddress(currentPC);
                if (sym) {
                    funcName = sym.name;
                }
            }
            this.stack.push({ sp: currentSP, name: funcName });
            if (!this.cycleCounts.has(funcName)) {
                this.cycleCounts.set(funcName, 0);
            }
        }

        // 3. Credit cycles to the current function, and all functions on the stack, and (startup)
        this.cycleCounts.set(DEFAULT_FUNCTION, (this.cycleCounts.get(DEFAULT_FUNCTION) || 0) + cycles);
        for (const entry of this.stack) {
            this.cycleCounts.set(entry.name, (this.cycleCounts.get(entry.name) || 0) + cycles);
        }
    }

    public reset() {
        this.totalCycles = 0;
        this.stack = [];
        this.cycleCounts.clear();
        this.cycleCounts.set(DEFAULT_FUNCTION, 0);
    }

    public getReport(): Map<string, number> {
        return this.cycleCounts;
    }
}
