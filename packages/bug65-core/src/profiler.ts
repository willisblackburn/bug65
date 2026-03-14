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
        // (This handles returns: cycles of an RTS go to the caller)
        while (this.stack.length > 0 && this.stack[this.stack.length - 1].sp < currentSP) {
            this.stack.pop();
        }

        // 2. Credit cycles to the current path BEFORE pushing a new function
        // (This ensures JSR/BRK cycles go to the caller)
        if (this.stack.length === 0) {
            this.cycleCounts.set(DEFAULT_FUNCTION, (this.cycleCounts.get(DEFAULT_FUNCTION) || 0) + cycles);
        } else {
            const currentPath = this.stack.map(e => e.name).join('/');
            this.cycleCounts.set(currentPath, (this.cycleCounts.get(currentPath) || 0) + cycles);
        }

        // 3. Check for JSR or BRK to push a new function onto the profile stack
        if (opcode === Opcode.JSR_abs || opcode === Opcode.BRK_imp) {
            let funcName = `unknown_$${currentPC.toString(16).toUpperCase().padStart(4, '0')}`;
            if (this.debugInfo) {
                const sym = this.debugInfo.getSymbolForAddress(currentPC);
                if (sym) {
                    funcName = sym.name;
                }
            }
            this.stack.push({ sp: currentSP, name: funcName });
        } else {
            // 4. Handle tail-calls and RTS-to-function transitions
            // If the stack is empty and we hit a symbol, push it as a root.
            // If we are already at the same or deeper stack level, but PC points to a different function,
            // replace the current function name.
            const symbol = this.debugInfo?.getSymbolForAddress(currentPC);
            if (symbol) {
                if (this.stack.length === 0) {
                    this.stack.push({ sp: currentSP, name: symbol.name });
                } else {
                    const currentTop = this.stack[this.stack.length - 1];
                    if (currentSP <= currentTop.sp && symbol.name !== currentTop.name) {
                        currentTop.name = symbol.name;
                    }
                }
            }
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
