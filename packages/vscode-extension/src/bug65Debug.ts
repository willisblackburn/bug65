
import {
    Logger, logger,
    LoggingDebugSession,
    InitializedEvent, TerminatedEvent, StoppedEvent, OutputEvent,
    Thread, Scope, Source, Handles, Breakpoint, StackFrame
} from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { Cpu6502, Memory, CpuRegisters, Bug65Host, DebugInfo, DebugInfoParser, Disassembler6502 } from 'bug65-core';
import * as fs from 'fs';
import * as path from 'path';

interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    program: string;
    stopOnEntry?: boolean;
}

export class Bug65DebugSession extends LoggingDebugSession {

    private static THREAD_ID = 1;

    private _cpu: Cpu6502;
    private _memory: Memory;
    private _disassembler: Disassembler6502;
    private _variableHandles = new Handles<string>();
    private _stopOnEntry = false;

    private _stepMode: 'instruction' | 'line' | 'over' = 'instruction';
    private _stepStartLine: number = 0;
    private _stepStartFile: number = 0;
    private _tempBreakpoint: number | undefined;

    constructor() {
        super("bug65-debug.txt");

        this._memory = new Memory();
        this._cpu = new Cpu6502(this._memory);
        this._disassembler = new Disassembler6502();

    }



    protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
        response.body = response.body || {};
        response.body.supportsConfigurationDoneRequest = true;
        response.body.supportsEvaluateForHovers = true;
        response.body.supportsStepBack = false;
        this.sendResponse(response);
        this.sendEvent(new InitializedEvent());
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
        const { loadAddr, resetAddr, spAddr } = this.loadProgram(data);
        this.loadDebugInfo(programPath);

        this._cpu.reset();

        // Initialize Host
        const host = new Bug65Host(this._cpu, this._memory);
        host.setSpAddress(spAddr);
        host.install();

        host.onWrite = (char) => {
            this.sendEvent(new OutputEvent(String.fromCharCode(char), 'stdout'));
        };

        host.onExit = (code) => {
            this.sendEvent(new OutputEvent(`[Bug65] Program exited with code ${code}\n`, 'console'));
            this.sendEvent(new TerminatedEvent());
        };

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

    private loadProgram(data: Buffer): { loadAddr: number, resetAddr: number, spAddr: number } {
        const header = data.slice(0, 5).toString('ascii');
        let loadAddr = 0x0200;
        let resetAddr = 0x0200;
        let spAddr = 0x00;
        let offset = 0;

        if (header === 'sim65') {
            offset = 12;
            spAddr = data[7];
            const fileLoadAddr = (data[9] << 8) | data[8];
            const fileResetAddr = (data[11] << 8) | data[10];
            loadAddr = fileLoadAddr;
            resetAddr = fileResetAddr;
            this.sendEvent(new OutputEvent(`[Bug65] Header detected: Load=$${loadAddr.toString(16)} Reset=$${resetAddr.toString(16)} SP=$${spAddr.toString(16)}\n`, 'console'));
        }

        const programData = new Uint8Array(data.slice(offset));
        this._memory.load(loadAddr, programData);
        this._memory.writeWord(0xFFFC, resetAddr);

        return { loadAddr, resetAddr, spAddr };
    }

    protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {
        const path = args.source.path as string;
        const clientLines = args.lines || [];

        // Clear existing breakpoints for this file (simplification)
        this._cpu.clearBreakpoints(); // TODO: Only clear for this file?

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
                                this._cpu.addBreakpoint(addr);
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
                this._disassembler = new Disassembler6502(this._debugInfo);
                this.sendEvent(new OutputEvent(`[Bug65] Loaded debug info: ${dbgPath}\n`, 'console'));
            } catch (e) {
                this.sendEvent(new OutputEvent(`[Bug65] Failed to parse debug info: ${e}\n`, 'stderr'));
            }
        } else {
            this._disassembler = new Disassembler6502();
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
                value: `$${regs.A.toString(16).toUpperCase()}`,
                variablesReference: 0
            });
            variables.push({
                name: "X",
                type: "integer",
                value: `$${regs.X.toString(16).toUpperCase()}`,
                variablesReference: 0
            });
            variables.push({
                name: "Y",
                type: "integer",
                value: `$${regs.Y.toString(16).toUpperCase()}`,
                variablesReference: 0
            });
            variables.push({
                name: "PC",
                type: "integer",
                value: `$${regs.PC.toString(16).toUpperCase()}`,
                variablesReference: 0
            });
            variables.push({
                name: "SP",
                type: "integer",
                value: `$${regs.SP.toString(16).toUpperCase()}`,
                variablesReference: 0
            });
            variables.push({
                name: "Status",
                type: "integer",
                value: `$${regs.Status.toString(16).toUpperCase()}`,
                variablesReference: 0
            });
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
        }

        response.body = {
            variables: variables
        };
        this.sendResponse(response);
    }

    protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
        // Run until trap or breakpoint
        // Simple synchronous loop for now
        // Ideally should be async or strict time sliced
        // For MVP: run X instructions or until trap

        // This blocks the event loop!
        // We should use setImmediate loop

        this.runLoop();

        this.sendResponse(response);
    }

    private runLoop() {
        const batch = 1000;
        let running = true;

        // If we are currently at a breakpoint, step over it first (ignoring the breakpoint)
        if (this._cpu.breakpoints.has(this._cpu.getRegisters().PC)) {
            // Check if it is a JSR before we step!
            if (this._stepMode === 'over' && this._tempBreakpoint === undefined) {
                const pc = this._cpu.getRegisters().PC;
                const opcode = this._memory.read(pc);
                if (opcode === 0x20) { // JSR
                    this._tempBreakpoint = pc + 3;
                }
            }

            const cycles = this._cpu.step(true);
            if (cycles === 0) {
                this.sendEvent(new StoppedEvent('pause', Bug65DebugSession.THREAD_ID));
                return;
            }
        }

        for (let i = 0; i < batch; i++) {
            const pc = this._cpu.getRegisters().PC;

            // Check temp breakpoint
            if (this._tempBreakpoint !== undefined && pc === this._tempBreakpoint) {
                // Hit our step-over return point.
                this._tempBreakpoint = undefined;
            }

            // Execute one instruction
            // If stepping over, and JSR, and not already waiting for return:
            if (this._stepMode === 'over' && this._tempBreakpoint === undefined) {
                const opcode = this._memory.read(pc);
                if (opcode === 0x20) { // JSR
                    this._tempBreakpoint = pc + 3;
                }
            }

            // If we have a temp breakpoint set, we are running freely until we hit it or another BP.
            if (this._tempBreakpoint !== undefined && pc !== this._tempBreakpoint) {
                if (this._cpu.breakpoints.has(pc)) {
                    this.sendEvent(new StoppedEvent('breakpoint', Bug65DebugSession.THREAD_ID));
                    running = false;
                    break;
                }
                this._cpu.step(true);
                continue;
            }

            // Standard step
            const cycles = this._cpu.step(true);
            if (cycles === 0) {
                running = false;
                this.sendEvent(new StoppedEvent('pause', Bug65DebugSession.THREAD_ID));
                break;
            }

            if (this._cpu.breakpoints.has(this._cpu.getRegisters().PC)) {
                this.sendEvent(new StoppedEvent('breakpoint', Bug65DebugSession.THREAD_ID));
                running = false;
                break;
            }

            // Check Step Logic
            if (this._stepMode === 'line' || this._stepMode === 'over') {
                if (this._debugInfo) {
                    const lineInfo = this._debugInfo.getLineForAddress(this._cpu.getRegisters().PC);
                    if (lineInfo) {
                        if (lineInfo.fileId !== this._stepStartFile || lineInfo.line !== this._stepStartLine) {
                            this.sendEvent(new StoppedEvent('step', Bug65DebugSession.THREAD_ID));
                            running = false;
                            break;
                        }
                    }
                }
            }
        }

        if (running) {
            setTimeout(() => this.runLoop(), 1);
        }
    }

    protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
        this.setupStep('over');
        this.runLoop();
        this.sendResponse(response);
    }

    protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
        this.setupStep('line');
        this.runLoop();
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

    private setupStep(mode: 'line' | 'over') {
        const pc = this._cpu.getRegisters().PC;
        this._stepMode = mode;
        this._stepStartFile = -1;
        this._stepStartLine = -1;
        this._tempBreakpoint = undefined;

        if (this._debugInfo) {
            const lineInfo = this._debugInfo.getLineForAddress(pc);
            if (lineInfo) {
                this._stepStartFile = lineInfo.fileId;
                this._stepStartLine = lineInfo.line;
            }
        }
    }
}
