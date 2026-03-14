import { DebugInfo } from './debug_info';
import { Opcode } from './opcodes';

export interface ProfileEntry {
    sp: number;
    symbol: string;
    cheapLabel?: string;
}

export const DEFAULT_FUNCTION = "(startup)";

export interface Profiler {
    totalCycles: number;
    record(opcode: number, cycles: number, currentSP: number, currentPC: number): void;
    printReport(): void;
    reset(): void;
}

export class SimpleProfiler implements Profiler {
    public totalCycles: number = 0;

    public record(opcode: number, cycles: number, currentSP: number, currentPC: number) {
        this.totalCycles += cycles;
    }

    public printReport(): void {
        process.stdout.write("Total cycles: " + this.totalCycles + "\n")
    }

    public reset() {
        this.totalCycles = 0;
    }
}

export class FunctionalProfiler implements Profiler {
    public totalCycles: number = 0;
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
            const currentPath = this.stack.map(e => e.cheapLabel ? `${e.symbol}${e.cheapLabel}` : e.symbol).join('/');
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
            this.stack.push({ sp: currentSP, symbol: funcName });
        } else {
            // 4. Handle tail-calls and RTS-to-function transitions
            // If the stack is empty and we hit a symbol, push it as a root.
            // If we are already at the same or deeper stack level, but PC points to a different function,
            // replace the current function name or set cheapLabel.
            const symbol = this.debugInfo?.getSymbolForAddress(currentPC);
            if (symbol) {
                if (this.stack.length === 0) {
                    this.stack.push({ sp: currentSP, symbol: symbol.name });
                } else {
                    const top = this.stack[this.stack.length - 1];
                    if (currentSP <= top.sp) {
                        if (symbol.name.startsWith('@')) {
                            top.cheapLabel = symbol.name;
                        } else if (symbol.name !== top.symbol) {
                            // Replace the entry with a new one to clear cheapLabel
                            this.stack[this.stack.length - 1] = { sp: top.sp, symbol: symbol.name };
                        }
                    }
                }
            }
        }
    }

    public printReport(): void {
        const DEFAULT_FUNCTION = "(startup)"; // Redeclare for simplicity or import if possible

        process.stdout.write("\nProfiling Report:\npath,name,cycles,cycles_with_children\n");

        // Print (startup) separately
        const startupCycles = this.cycleCounts.get(DEFAULT_FUNCTION) || 0;
        process.stdout.write(`${DEFAULT_FUNCTION},${DEFAULT_FUNCTION},${startupCycles},${this.totalCycles}\n`);

        // Get all paths except (startup)
        const paths = Array.from(this.cycleCounts.keys()).filter(p => p !== DEFAULT_FUNCTION);
        
        // Calculate total cycles for each path (self + all children)
        const pathTotalCycles = new Map<string, number>();
        for (const path of paths) {
            let total = 0;
            for (const otherPath of paths) {
                if (otherPath === path || otherPath.startsWith(path + '/')) {
                    total += this.cycleCounts.get(otherPath) || 0;
                }
            }
            pathTotalCycles.set(path, total);
        }

        // Sort by total cycles descending
        const sortedPaths = paths.sort((a, b) => (pathTotalCycles.get(b) || 0) - (pathTotalCycles.get(a) || 0));

        for (const path of sortedPaths) {
            const funcName = path.split('/').pop() || "";
            const self = this.cycleCounts.get(path) || 0;
            const total = pathTotalCycles.get(path) || 0;
            process.stdout.write(`${path},${funcName},${self},${total}\n`);
        }
    }

    public reset() {
        this.totalCycles = 0;
        this.stack = [];
        this.cycleCounts.clear();
        this.cycleCounts.set(DEFAULT_FUNCTION, 0);
    }
}
