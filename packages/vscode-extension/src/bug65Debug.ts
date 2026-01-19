
import * as vscode from 'vscode';

import {
    Logger, logger,
    LoggingDebugSession,
    InitializedEvent, TerminatedEvent, StoppedEvent, OutputEvent,
    Thread, Scope, Source, Handles, Breakpoint, StackFrame
} from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { Cpu6502, Memory, CpuRegisters, Bug65Host, DebugInfo, DebugInfoParser, Disassembler6502, ProgramLoader, CpuType, VariableResolver, TypeInfo } from 'bug65-core';
import * as fs from 'fs';
import * as path from 'path';


// Clean up terminals on close
vscode.window.onDidCloseTerminal(term => {
    // We can't access TerminalManager class easily if it's protected inside the module scope but not exported?
    // It is in module scope.
    // Try to find key
    // We need to iterate the entries
    // For now we will implement cleanup logic later or make TerminalManager expose a collection
});

interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    program: string;
    stopOnEntry?: boolean;
    cpu?: string;
    args?: string[];
}

interface StepMode {
    step(session: Bug65DebugSession, pc: number, opcode: number): StepMode | undefined;
}

class StepInMode implements StepMode {
    constructor(private allowedRanges: { start: number, end: number }[]) { }

    step(session: Bug65DebugSession, pc: number, opcode: number): StepMode | undefined {
        for (const range of this.allowedRanges) {
            if (pc >= range.start && pc <= range.end) {
                return this;
            }
        }
        return undefined;
    }
}

class NextMode implements StepMode {
    constructor(private allowedRanges: { start: number, end: number }[]) { }

    step(session: Bug65DebugSession, pc: number, opcode: number): StepMode | undefined {
        for (const range of this.allowedRanges) {
            if (pc >= range.start && pc <= range.end) {
                // If we encounter a JSR (opcode 0x20)
                // We replace with RunToMode targeting instruction after JSR (PB + 3)
                // And we continue execution.
                if (opcode === 0x20) { // JSR
                    return new RunToMode(pc + 3, this);
                }
                // Continue with this mode
                return this;
            }
        }
        // Stop
        return undefined;
    }
}

class RunToMode implements StepMode {
    constructor(private targetPC: number, private restoreMode: StepMode | undefined) { }

    step(session: Bug65DebugSession, pc: number, opcode: number): StepMode | undefined {
        if (pc === this.targetPC) {
            // We reached target. Switch to the previous mode.
            return this.restoreMode !== undefined ? this.restoreMode.step(session, pc, opcode) : undefined;
        }
        // Continue with this mode (running to target)
        return this;
    }
}

class StepOutMode implements StepMode {
    constructor(private targetSP: number) { }

    step(session: Bug65DebugSession, pc: number, opcode: number): StepMode | undefined {
        if (opcode === 0x60) { // RTS
            const sp = session.getAllRegisters().SP;
            // Calculate hypothetical SP after RTS
            // Pull PCL, Pull PCH => SP + 2
            const newSP = sp + 2;

            if (newSP > this.targetSP) {
                // We are returning to a caller (or higher)
                // Read return address from stack to know where we land
                // Stack is at 0x100 + SP
                // PCL at SP+1, PCH at SP+2

                // Note: session.getAllRegisters().SP is current SP (before RTS)
                const memory = session.getMemory();

                const low = memory.read(0x100 + sp + 1);
                const high = memory.read(0x100 + sp + 2);
                const retAddr = ((high << 8) | low) + 1;

                return new RunToMode(retAddr, undefined);
            }
        }
        return this;
    }
}


// Manager to reuse terminals
class TerminalManager {
    private static terminals = new Map<string, { terminal: vscode.Terminal, pty: Bug65Terminal }>();

    public static get(key: string): { terminal: vscode.Terminal, pty: Bug65Terminal } | undefined {
        return this.terminals.get(key);
    }

    public static register(key: string, term: vscode.Terminal, pty: Bug65Terminal) {
        this.terminals.set(key, { terminal: term, pty: pty });

        // Listen for close to cleanup
        // Note: VS Code API close event is global, but we can't easily hook it per instance here 
        // without passing the disposable. 
        // Actually, we can rely on pty.onClose if we trigger it? 
        // No, pty.onClose is when the pty itself closes (e.g. process exit).
        // VS Code terminal close is UI action.
    }

    // Call this if we detect the terminal is closed
    public static remove(key: string) {
        this.terminals.delete(key);
    }
}

// Hook into global terminal close event to cleanup
vscode.window.onDidCloseTerminal((term) => {
    // Iterate map and remove
    // Start with simple check by name or caching reference
    // Ideally we iterate our map values and compare 'terminal' object
    // Since 'term' is the object closed.
    // This is inefficient but fine for small number of terms.
});


export class Bug65DebugSession extends LoggingDebugSession {

    private static THREAD_ID = 1;

    private _cpu: Cpu6502;
    private _memory: Memory;
    private _disassembler: Disassembler6502;
    private _variableHandles = new Handles<string>();
    private _stopOnEntry = false;

    private _stepMode: StepMode | undefined;

    private _cpuType: CpuType = '6502';

    private _host: Bug65Host;

    constructor() {
        super("bug65-debug.txt");

        this._memory = new Memory();
        this._cpu = new Cpu6502(this._memory);
        this._disassembler = new Disassembler6502();
        this._host = new Bug65Host(this._cpu, this._memory);

        // Setup Host events once
        this._host.onWrite = (char) => {
            this.sendEvent(new OutputEvent(String.fromCharCode(char), 'stdout'));
        };

        this._host.onExit = (code) => {
            this.sendEvent(new OutputEvent(`[Bug65] Program exited with code ${code}\n`, 'console'));
            this.sendEvent(new TerminatedEvent());
        };
    }

    // Helper for StepMode classes
    public getAllRegisters() {
        return this._cpu.getRegisters();
    }

    public getMemory() {
        return this._memory;
    }

    protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
        response.body = response.body || {};
        response.body.supportsConfigurationDoneRequest = true;
        response.body.supportsEvaluateForHovers = true;
        response.body.supportsStepBack = false;
        this.sendResponse(response);
        this.sendEvent(new InitializedEvent());
    }

    private runLoop(ignoreInitialBreakpoint: boolean = false) {
        const batch = 1000;
        let running = true;

        for (let i = 0; i < batch; i++) {
            const pc = this._cpu.getRegisters().PC;
            const opcode = this._memory.read(pc); // Peek opcode

            // 1. Check Step Mode
            if (this._stepMode) {
                this._stepMode = this._stepMode.step(this, pc, opcode);

                if (!this._stepMode) {
                    this.sendEvent(new StoppedEvent('step', Bug65DebugSession.THREAD_ID));
                    running = false;
                    break;
                }
            }

            // 2. Execute
            // Ignore breakpoint only if explicitly requested and it's the first instruction
            const cycles = this._cpu.step(ignoreInitialBreakpoint && i === 0);

            if (cycles === 0) {
                // Hit a breakpoint (or trap)

                if (this._host.waitingForInput) {
                    // Blocked on I/O
                    running = false;
                } else {
                    // Breakpoint or Step
                    this._stepMode = undefined;
                    this.sendEvent(new StoppedEvent('breakpoint', Bug65DebugSession.THREAD_ID));
                    running = false;
                }
                break;
            }
        }

        if (running) {
            setTimeout(() => this.runLoop(false), 1);
        }
    }

    private getCurrentSpan(pc: number): { start: number, end: number } | undefined {
        if (!this._debugInfo) return undefined;

        // 1. Try to find the "best" line info (prioritizing C source)
        const lineInfo = this._debugInfo.getLineForAddress(pc);
        if (lineInfo && lineInfo.spanId !== undefined) {
            const span = this._debugInfo.spans.get(lineInfo.spanId);
            if (span) {
                const seg = this._debugInfo.segments.get(span.segId);
                if (seg) {
                    const start = seg.start + span.start;
                    const end = start + span.size - 1;
                    // Double check PC is in range (it should be if mapped)
                    if (pc >= start && pc <= end) {
                        return { start, end };
                    }
                }
            }
        }

        // 2. Fallback: Search all spans (spatial) if no line mapping found
        for (const seg of this._debugInfo.segments.values()) {
            if (pc >= seg.start && pc < (seg.start + seg.size)) {
                for (const span of this._debugInfo.spans.values()) {
                    if (span.segId === seg.id) {
                        const start = seg.start + span.start;
                        const end = start + span.size - 1; // Inclusive
                        if (pc >= start && pc <= end) {
                            return { start, end };
                        }
                    }
                }
            }
        }
        return undefined;
    }

    protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
        const pc = this._cpu.getRegisters().PC;
        const span = this.getCurrentSpan(pc);
        this._stepMode = new NextMode(span ? [span] : []);
        // Ignore potentially current breakpoint
        this.runLoop(true);
        this.sendResponse(response);
    }

    protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
        const pc = this._cpu.getRegisters().PC;
        const span = this.getCurrentSpan(pc);
        this._stepMode = new StepInMode(span ? [span] : []);
        this.runLoop(true);
        this.sendResponse(response);
    }

    protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments): void {
        const sp = this._cpu.getRegisters().SP;
        this._stepMode = new StepOutMode(sp);
        this.runLoop(true);
        this.sendResponse(response);
    }

    protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {
        const expression = args.expression;

        // Simple variable lookup by name
        if (this._debugInfo) {
            const sym = this._debugInfo.symbolsByName.get(expression);
            if (sym && sym.addr !== undefined) {
                // Determine size
                // If size is present, use it. Default to 1 byte.
                // If size is 2, read word.
                const size = sym.size || 1;
                let val = 0;
                let valStr = "";

                if (size === 2) {
                    val = this._memory.readWord(sym.addr);
                    valStr = `$${val.toString(16).toUpperCase().padStart(4, '0')} (${val})`;
                } else {
                    val = this._memory.read(sym.addr);
                    valStr = `$${val.toString(16).toUpperCase().padStart(2, '0')} (${val})`;
                }

                response.body = {
                    result: valStr,
                    variablesReference: 0
                };
                this.sendResponse(response);
                return;
            }
        }

        // If not found or no debug info
        // We do not fail the request necessarily, but we can return null result
        // But throwing error is standard if not evaluatable
        this.sendErrorResponse(response, 0, `Variable ${expression} not found.`);
    }






    private _programDir: string = "";
    private _cwd: string = "";

    protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments) {
        logger.setup(Logger.LogLevel.Verbose, false);
        this.sendEvent(new OutputEvent(`[Bug65] Launching program: ${args.program}\n`, 'console'));

        const programPath = args.program;
        this._programDir = path.dirname(programPath);

        // Use args.cwd from configurationAttributes (needs update in LaunchRequestArguments interface)
        // Note: args is LaunchRequestArguments which extends Map<string, any>.
        // We can access properties not in the interface if we cast or access by string.
        const cwd = (args as any).cwd || this._programDir;
        this._cwd = cwd;

        this.sendEvent(new OutputEvent(`[Bug65] CWD: ${this._cwd}\n`, 'console'));

        if (!fs.existsSync(programPath)) {
            this.sendErrorResponse(response, 0, `Program file ${programPath} not found.`);
            return;
        }

        const data = fs.readFileSync(programPath);
        const { loadAddr, resetAddr, spAddr, cpuType: headerCpuType } = ProgramLoader.load(this._memory, data);

        // Determine CPU Type
        // args.cpu overrides header
        let effectiveCpuType: CpuType = '6502';
        if (args.cpu && (args.cpu === '6502' || args.cpu === '65C02')) {
            effectiveCpuType = args.cpu as CpuType;
        } else if (headerCpuType) {
            effectiveCpuType = headerCpuType;
        }

        this._cpuType = effectiveCpuType;
        this._cpu.setCpuType(this._cpuType);
        this.sendEvent(new OutputEvent(`[Bug65] CPU Type: ${this._cpuType}\n`, 'console'));

        this.loadDebugInfo(programPath);

        this.sendEvent(new OutputEvent(`[Bug65] Program loaded: Load=$${loadAddr.toString(16)} Reset=$${resetAddr.toString(16)} SP=$${spAddr.toString(16)}\n`, 'console'));

        this._cpu.reset();

        // Configure Host for this run
        this._host.setSpAddress(spAddr);
        this._host.commandLineArgs = [programPath, ...(args.args || [])];

        // --- Terminal Integration ---
        // Reuse terminal if exists for this program
        const termKey = programPath;
        let existing = TerminalManager.get(termKey);

        // Check if existing terminal is still valid (not disposed)
        if (existing && existing.terminal.exitStatus !== undefined) {
            // It exited? VS Code terminals don't really have 'exitStatus' unless the shell exited.
            // But if user killed it, onDidCloseTerminal handled map cleanup?
            // We'll rely on our onDidCloseTerminal hook (implemented below/above).
        }

        let terminal: Bug65Terminal;
        let vscTerminal: vscode.Terminal;

        if (existing) {
            terminal = existing.pty;
            vscTerminal = existing.terminal;
            terminal.reset(); // Clear previous buffer/state
            vscTerminal.show(true);
            terminal.write(`\r\n--- Restarting ${path.basename(programPath)} ---\r\n`);
        } else {
            terminal = new Bug65Terminal();
            vscTerminal = vscode.window.createTerminal({
                name: `Bug65: ${path.basename(programPath)}`,
                pty: terminal,
                iconPath: new vscode.ThemeIcon('debug-console')
            });
            TerminalManager.register(termKey, vscTerminal, terminal);
            vscTerminal.show(true);
        }

        // Hook up output
        this._host.onWrite = (val: number) => {
            terminal.write(String.fromCharCode(val));
        };

        // Hook up input
        terminal.onInput((data) => {
            const bytes = new Uint8Array(data.length);
            for (let i = 0; i < data.length; i++) {
                bytes[i] = data.charCodeAt(i);
            }
            this._host.writeInput(bytes);

            // If we were waiting for input, resume execution
            if (this._host.waitingForInput) {
                this.runLoop();
            }
        });

        terminal.onClose(() => {
            // Optional: Terminate session if terminal closes?
        });
        // -----------------------------



        // Fill hooks with RTS
        for (let a = 0xFFF0; a <= 0xFFF9; a++) {
            this._memory.write(a, 0x60);
        }

        this.sendResponse(response);
        this.sendEvent(new OutputEvent(`[Bug65] System initialized. PC=$${this._cpu.getRegisters().PC.toString(16)}\n`, 'console'));

        this._stopOnEntry = !!args.stopOnEntry;
        if (args.stopOnEntry) {
            this.sendEvent(new StoppedEvent('entry', Bug65DebugSession.THREAD_ID));
        } else {
            // Defer until configurationDone
        }
    }

    protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
        super.configurationDoneRequest(response, args);
        if (!this._stopOnEntry) {
            this.runLoop();
        }
    }

    protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
        // Clear any step mode
        this._stepMode = undefined;
        // Ignore potentially current breakpoint
        this.runLoop(true);
        this.sendResponse(response);
    }



    protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {
        const path = args.source.path as string;
        const clientLines = args.lines || [];

        // Clear existing breakpoints for this file (simplification)
        this._cpu.clearBreakpoints(path);

        const actualBreakpoints = new Array<Breakpoint>();

        if (this._debugInfo) {
            const fileId = this.getFileId(path);
            if (fileId !== -1) {
                for (const l of clientLines) {
                    const lineInfo = this._debugInfo.lines.find(li => li.fileId === fileId && li.line === l);

                    if (lineInfo && lineInfo.spanId !== undefined) {
                        const span = this._debugInfo.spans.get(lineInfo.spanId);
                        if (span) {
                            const seg = this._debugInfo.segments.get(span.segId);
                            if (seg) {
                                const addr = seg.start + span.start;
                                this._cpu.addBreakpoint(addr, path);
                                actualBreakpoints.push(new Breakpoint(true, l, 0, new Source(path, path)));
                                continue;
                            }
                        }
                    }
                    actualBreakpoints.push(new Breakpoint(false, l, 0, new Source(path, path)));
                }
            }
        } else {
            for (const l of clientLines) {
                actualBreakpoints.push(new Breakpoint(false, l, 0, new Source(path, path)));
            }
        }

        response.body = {
            breakpoints: actualBreakpoints
        };
        this.sendResponse(response);
    }

    private _debugInfo: DebugInfo | undefined;

    private loadDebugInfo(programPath: string) {
        const dbgPath = DebugInfoParser.resolveDebugFile(programPath);
        if (dbgPath) {
            try {
                const debugObj = DebugInfoParser.parse(fs.readFileSync(dbgPath, 'utf8'));
                this._debugInfo = debugObj;
                this._disassembler = new Disassembler6502(this._debugInfo, this._cpuType);
                this.sendEvent(new OutputEvent(`[Bug65] Loaded debug info: ${dbgPath}\n`, 'console'));
            } catch (e) {
                this.sendEvent(new OutputEvent(`[Bug65] Failed to parse debug info: ${e}\n`, 'stderr'));
            }
        } else {
            this._disassembler = new Disassembler6502(undefined, this._cpuType);
        }
    }

    private getFileId(filePath: string): number {
        if (!this._debugInfo) return -1;
        // Map absolute path to debug info file entry
        // Debug info usually has relative paths or basenames.
        // We might need fuzzy matching.
        const basename = path.basename(filePath);
        for (const [id, file] of this._debugInfo.files) {
            // Check if name matches basename (hacky but works for flat projects)
            // Or check if filePath ends with file.name
            if (file.name === basename || (file.name.includes(basename))) { // Very loose matching
                return id;
            }
            if (filePath.endsWith(file.name)) return id;
        }
        return -1;
    }
    protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
        response.body = {
            threads: [
                new Thread(Bug65DebugSession.THREAD_ID, "thread 1")
            ]
        };
        this.sendResponse(response);
    }

    protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
        const startFrame = args.startFrame || 0;
        const maxLevels = args.levels || 20;

        const { frames } = this.scanStack(maxLevels + startFrame);

        // Slice requested frames
        const totalFrames = frames.length;
        const sentFrames = frames.slice(startFrame, startFrame + maxLevels);

        response.body = {
            stackFrames: sentFrames,
            totalFrames: totalFrames
        };
        this.sendResponse(response);
    }

    private scanStack(maxFrames: number): { frames: StackFrame[], usedAddresses: Set<number> } {
        const stackFrames = new Array<StackFrame>();
        const usedAddresses = new Set<number>();
        const pc = this._cpu.getRegisters().PC;
        const sp = this._cpu.getRegisters().SP;

        // 1. Current Frame
        this.addStackFrame(stackFrames, pc, 0);

        // 2. Scan Stack for Return Addresses
        // Stack grows down. Return addresses are pushed as (PC_high, PC_low).
        // The value pushed is the address of the 3rd byte of JSR (instruction address + 2).
        // JSR opcode is at address - 2.
        // We scan from SP+1 up to 0xFE (0xFF is top, we need 2 bytes).
        let stackPtr = sp + 1;
        let frameId = 1;

        while (stackPtr < 0xFE && stackFrames.length < maxFrames) {
            // Check for potential return address (2 bytes)
            // Stack is in page 1 (0x100 - 0x1FF)
            const low = this._memory.read(0x100 + stackPtr);
            const high = this._memory.read(0x100 + stackPtr + 1);

            // Reconstruct address 
            const retAddrOnStack = (high << 8) | low;

            // The JSR instruction itself started at (ValueOnStack - 2).
            const jsrAddr = retAddrOnStack - 2;

            // Check validity
            if (jsrAddr >= 0 && jsrAddr <= 0xFFFF) {
                // Check if opcode at jsrAddr is JSR (0x20)
                const opcode = this._memory.read(jsrAddr);
                if (opcode === 0x20) {
                    const added = this.addStackFrame(stackFrames, jsrAddr, frameId);
                    if (added) {
                        usedAddresses.add(0x100 + stackPtr);
                        usedAddresses.add(0x100 + stackPtr + 1);
                        frameId++;
                    }
                }
            }
            stackPtr++;
        }
        return { frames: stackFrames, usedAddresses };
    }

    private addStackFrame(frames: StackFrame[], addr: number, id: number): boolean {
        let source: Source | undefined;
        let line = 0;
        let name = `PC: $${addr.toString(16).toUpperCase()}`;

        // Disassemble for context
        const dasm = this._disassembler.disassemble(this._memory, addr);
        name = `PC: $${addr.toString(16).toUpperCase()} ${dasm.asm}`;

        if (this._debugInfo) {
            const lineInfo = this._debugInfo.getLineForAddress(addr);
            if (lineInfo) {
                line = lineInfo.line;
                const textFile = this._debugInfo.files.get(lineInfo.fileId);
                const isLib = this._debugInfo.fileIsLibrary.get(lineInfo.fileId);

                if (textFile && !isLib) {
                    let sourcePath = textFile.name;
                    if (!path.isAbsolute(sourcePath)) {
                        let candidate = path.join(this._cwd, sourcePath);
                        if (!fs.existsSync(candidate)) {
                            const parentCwd = path.dirname(this._cwd);
                            const candidate2 = path.join(parentCwd, sourcePath);
                            if (fs.existsSync(candidate2)) candidate = candidate2;
                        }
                        sourcePath = candidate;
                    }
                    source = new Source(path.basename(sourcePath), sourcePath);

                    // Check for C function scope
                    const scopes = this._debugInfo.getScopesForAddress(addr);
                    if (scopes.length > 0) {
                        // Use the innermost scope name? Or outer function?
                        // If innermost is a block, maybe we want the function name?
                        // Let's just use the innermost for now, or find one with type 'scope'?
                        // cc65 debug output: type=scope for functions in sample.
                        const funcScope = scopes.find(s => s.type === 1 || s.type === undefined); // Check type meaning properly later
                        if (funcScope) {
                            // If it starts with underscore, strip it (C name mangling)
                            let funcName = funcScope.name;
                            if (funcName.startsWith('_')) funcName = funcName.substring(1);
                            name = funcName;
                        } else if (scopes[0]) {
                            let funcName = scopes[0].name;
                            if (funcName.startsWith('_')) funcName = funcName.substring(1);
                            if (funcName) name = funcName;
                        }
                    }
                }
            }
        }

        frames.push(new StackFrame(id, name, source, line));
        return true;
    }

    protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
        const frameId = args.frameId;
        const scopes = new Array<Scope>();
        scopes.push(new Scope("Registers", this._variableHandles.create("registers"), false));
        scopes.push(new Scope("Flags", this._variableHandles.create("flags"), false));
        scopes.push(new Scope("Locals", this._variableHandles.create("loc"), false));
        scopes.push(new Scope("Stack", this._variableHandles.create("stack"), false));

        response.body = {
            scopes: scopes
        };
        this.sendResponse(response);
    }

    protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {
        const id = this._variableHandles.get(args.variablesReference);
        const variables = [];

        if (id === "registers") {
            const regs = this._cpu.getRegisters();
            variables.push({
                name: "A",
                type: "integer",
                value: `$${regs.A.toString(16).toUpperCase().padStart(2, '0')}`,
                variablesReference: 0
            });
            variables.push({
                name: "X",
                type: "integer",
                value: `$${regs.X.toString(16).toUpperCase().padStart(2, '0')}`,
                variablesReference: 0
            });
            variables.push({
                name: "Y",
                type: "integer",
                value: `$${regs.Y.toString(16).toUpperCase().padStart(2, '0')}`,
                variablesReference: 0
            });
            variables.push({
                name: "PC",
                type: "integer",
                value: `$${regs.PC.toString(16).toUpperCase().padStart(4, '0')}`,
                variablesReference: 0
            });
            variables.push({
                name: "SP",
                type: "integer",
                value: `$${regs.SP.toString(16).toUpperCase().padStart(2, '0')}`,
                variablesReference: 0
            });

            // Format Status with Unicode indicators
            // N V U B D I Z C
            const s = regs.Status;
            const flagsStr = [
                (s & 0x80) ? '🅝' : 'Ⓝ',
                (s & 0x40) ? '🅥' : 'Ⓥ',
                (s & 0x20) ? '🅤' : 'Ⓤ',
                (s & 0x10) ? '🅑' : 'Ⓑ',
                (s & 0x08) ? '🅓' : 'Ⓓ',
                (s & 0x04) ? '🅘' : 'Ⓘ',
                (s & 0x02) ? '🅩' : 'Ⓩ',
                (s & 0x01) ? '🅒' : 'Ⓒ'
            ].join(' ');

            variables.push({
                name: "Status",
                type: "string",
                value: `$${s.toString(16).toUpperCase().padStart(2, '0')}  ${flagsStr}`,
                variablesReference: 0
            });

        } else if (id === "flags") {
            const s = this._cpu.getRegisters().Status;
            const addFlag = (name: string, mask: number) => {
                variables.push({
                    name,
                    type: "boolean",
                    value: (s & mask) ? "true" : "false",
                    variablesReference: 0
                });
            };
            addFlag("Negative (N)", 0x80);
            addFlag("Overflow (V)", 0x40);
            addFlag("Unused (U)", 0x20);
            addFlag("Break (B)", 0x10);
            addFlag("Decimal (D)", 0x08);
            addFlag("Interrupt (I)", 0x04);
            addFlag("Zero (Z)", 0x02);
            addFlag("Carry (C)", 0x01);
        } else if (id === "stack") {
            const sp = this._cpu.getRegisters().SP;

            // Scan stack to identify return addresses
            const { usedAddresses } = this.scanStack(100);

            // Iterate 0x100 range from SP+1
            for (let ptr = sp + 1; ptr <= 0xFF; ptr++) {
                const addr = 0x100 + ptr;
                if (!usedAddresses.has(addr)) {
                    const val = this._memory.read(addr);
                    variables.push({
                        name: `$${addr.toString(16).toUpperCase()}`,
                        type: "integer",
                        value: `$${val.toString(16).toUpperCase()}`,
                        variablesReference: 0
                    });
                }
            }
        } else if (id === "loc") {
            const pc = this._cpu.getRegisters().PC;
            const scopes = this._debugInfo?.getScopesForAddress(pc);

            if (scopes && scopes.length > 0) {
                // Find deepest function scope or block
                // For now, iterate all scopes (including nested) and show vars
                // User requirement: "current scope may be inside a while loop... and ... enclosed in a function"
                // So we want to union variables from all active scopes for this PC.

                // Read C Stack Pointer
                // Bug65Host.spAddress is the ZP address.
                // We need to read the 16-bit value AT that address.
                const spZp = this._host.getSpAddress();
                const mem = this._memory;
                const sp = (mem.read(spZp + 1) << 8) | mem.read(spZp);

                const varsToShow = new Map<string, any>(); // Name -> CSymbolInfo

                // Iterate scopes from leaf (deepest) to root
                for (const scope of scopes) {
                    const vars = this._debugInfo!.getVariablesForScope(scope.id);
                    for (const v of vars) {
                        if (v.sc === 'auto') {
                            // Shadowing check: if already exists, skip? Or show?
                            // Typically debugger shows innermost.
                            if (!varsToShow.has(v.name)) {
                                varsToShow.set(v.name, v);
                            }
                        }
                    }
                }

                for (const v of varsToShow.values()) {
                    // Calculate address: SP + offset
                    // Note: offset can be negative (local) or positive (arg)
                    // But effectively it is just SP + offset.
                    // const addr = (sp + v.offset) & 0xFFFF;

                    let typeInfo: TypeInfo | undefined;
                    if (this._debugInfo) {
                        typeInfo = this._debugInfo.types.get(v.typeId);
                    }

                    const resolved = VariableResolver.resolveValue(mem, sp, v, typeInfo);

                    variables.push({
                        name: v.name,
                        type: resolved.type,
                        value: resolved.str,
                        variablesReference: 0
                    });
                }
            }
        }

        response.body = {
            variables: variables
        };
        this.sendResponse(response);
    }


}

class Bug65Terminal implements vscode.Pseudoterminal {
    private writeEmitter = new vscode.EventEmitter<string>();
    onDidWrite: vscode.Event<string> = this.writeEmitter.event;


    private lineBuffer: string = "";

    private closeEmitter = new vscode.EventEmitter<void>();
    onDidClose: vscode.Event<void> = this.closeEmitter.event;

    public reset() {
        this.lineBuffer = "";
    }

    private inputEmitter = new vscode.EventEmitter<string>();

    // Custom event to subscribe to input
    public onInput(listener: (data: string) => void) {
        this.inputEmitter.event(listener);
    }

    public onClose(listener: () => void) {
        this.closeEmitter.event(listener);
    }

    open(initialDimensions: vscode.TerminalDimensions | undefined): void {
        this.writeEmitter.fire('Bug65 Terminal Active\r\n');
    }

    close(): void {
        this.closeEmitter.fire();
    }

    handleInput(data: string): void {
        // Line discipline implementation

        for (let i = 0; i < data.length; i++) {
            const char = data[i];

            if (char === '\r') {
                // Enter
                this.writeEmitter.fire('\r\n');
                this.inputEmitter.fire(this.lineBuffer + '\n');
                this.lineBuffer = "";
            } else if (char === '\x7f' || char === '\b') {
                // Backspace
                if (this.lineBuffer.length > 0) {
                    this.lineBuffer = this.lineBuffer.slice(0, -1);
                    // Move back, space, move back to erase character
                    this.writeEmitter.fire('\b \b');
                }
            } else if (char >= ' ') {
                // Printable
                this.lineBuffer += char;
                this.writeEmitter.fire(char);
            }
            // Ignore other control codes for now
        }
    }

    write(data: string) {
        // Handle newlines: default to CRLF expectation.
        // If we receive \n, map to \r\n. 
        // If the source was already \r\n, we get \r then \n -> \r then \r\n. (\r\r\n).
        // This is visually harmless (double CR).
        const formatted = data.replace(/\n/g, '\r\n');
        this.writeEmitter.fire(formatted);
    }
}
