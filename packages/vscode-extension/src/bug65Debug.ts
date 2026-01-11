
import {
    Logger, logger,
    LoggingDebugSession,
    InitializedEvent, TerminatedEvent, StoppedEvent, OutputEvent,
    Thread, Scope, Source, Handles, Breakpoint
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

    protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments) {
        logger.setup(Logger.LogLevel.Verbose, false);
        this.sendEvent(new OutputEvent(`[Bug65] Launching program: ${args.program}\n`, 'console'));

        const programPath = args.program;
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

        if (args.stopOnEntry) {
            this.sendEvent(new StoppedEvent('entry', Bug65DebugSession.THREAD_ID));
        } else {
            this.continueRequest(<DebugProtocol.ContinueResponse>response, { threadId: Bug65DebugSession.THREAD_ID });
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
        // In reality, we should map all breakpoints again?
        // Cpu breakpoints are by address.
        // We need to manage address->breakpoint mapping.
        // For now, let's just clear all and re-add? No, that clears other files.
        // But since we only have single file programs mostly...
        // Let's assume re-setting all is okay or unimplemented for multi-file properly yet.

        // Actually, we must use DebugInfo to find addresses.
        this._cpu.clearBreakpoints(); // TODO: Only clear for this file?

        const actualBreakpoints = new Array<Breakpoint>();

        if (this._debugInfo) {
            const fileId = this.getFileId(path);
            if (fileId !== -1) {
                for (const l of clientLines) {
                    // Find address for fileId/line
                    // DebugInfo has addressToLine, but we need lineToAddress.
                    // We can iterate lines.
                    // Optimization: Build line->address map in DebugInfo or here.
                    // For now, simple search.

                    // Find all lines that match fileId and line
                    // Note: multiple addresses might map to one line?
                    // Or one line maps to a span (range).
                    // We should set breakpoint at start of the span?

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
            // No debug info, cannot verify breakpoints?
            // Or maybe user provided raw address? No, VS Code sends lines.
            // Allow unverified breakpoints?
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
        const pc = this._cpu.getRegisters().PC;
        let source: Source | undefined;
        let line = 0;

        if (this._debugInfo) {
            const lineInfo = this._debugInfo.getLineForAddress(pc);
            if (lineInfo) {
                line = lineInfo.line;
                const textFile = this._debugInfo.files.get(lineInfo.fileId);
                if (textFile) {
                    // Try to resolve absolute path
                    // .dbg file usually has relative paths or just names.
                    // We need to match it to workspace file.
                    // If we loaded debug info from a file next to the program, we can use that directory?
                    // Or if we know the workspace root.
                    // Simple heuristic: if name is relative, join with program directory?
                    // But 'name' might be just "hello.c".
                    // The 'programPath' was passed in launchRequest. We could store it (root dir).
                    // But we don't have it easily here unless we saved it.
                    // Let's assume we can use the 'path' from the source file if it looks absolute, default to name.
                    // But vscode expects absolute path for Source to work well.

                    // Hack: assume source is next to .dbg file if relative.
                    // We don't have dbg file path stored.
                    // Let's rely on client lines providing matched paths? No, this is server sending stack.
                    // We need to recreate the path we used in setBreakpointsRequest?
                    // In setBreakpointsRequest we received 'path'.
                    // Maybe we can cache fileId -> path mapping?

                    // For now, send the name as path and name. VS Code might fuzzy match?
                    // Better: DebugInfo filenames are usually relative to build dir.
                    source = new Source(textFile.name, textFile.name);
                }
            }
        }

        const dasm = this._disassembler.disassemble(this._memory, pc);

        response.body = {
            stackFrames: [
                {
                    id: 0,
                    name: `PC: $${pc.toString(16).toUpperCase()}  ${dasm.asm}`,
                    line: line,
                    column: 0,
                    source: source
                }
            ],
            totalFrames: 1
        };
        this.sendResponse(response);
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
        for (let i = 0; i < batch; i++) {
            const cycles = this._cpu.step();
            if (cycles === 0) {
                // Stopped
                running = false;

                // Was it a breakpoint?
                if (this._cpu.breakpoints.has(this._cpu.getRegisters().PC)) {
                    this.sendEvent(new StoppedEvent('breakpoint', Bug65DebugSession.THREAD_ID));
                } else {
                    this.sendEvent(new StoppedEvent('pause', Bug65DebugSession.THREAD_ID));
                }
                break;
            }
        }

        if (running) {
            setTimeout(() => this.runLoop(), 1);
        }
    }

    protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
        this._cpu.step();
        this.sendResponse(response);
        this.sendEvent(new StoppedEvent('step', Bug65DebugSession.THREAD_ID));
    }

    protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
        this._cpu.step();
        this.sendResponse(response);
        this.sendEvent(new StoppedEvent('step', Bug65DebugSession.THREAD_ID));
    }
}
