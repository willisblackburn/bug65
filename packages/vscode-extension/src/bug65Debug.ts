
import {
    Logger, logger,
    LoggingDebugSession,
    InitializedEvent, TerminatedEvent, StoppedEvent, OutputEvent,
    Thread, Scope, Source, Handles, Breakpoint
} from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { Cpu6502, Memory, CpuRegisters, Bug65Host } from 'bug65-core';
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
    private _variableHandles = new Handles<string>();

    constructor() {
        super("bug65-debug.txt");

        this._memory = new Memory();
        this._cpu = new Cpu6502(this._memory);

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

    protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
        response.body = {
            threads: [
                new Thread(Bug65DebugSession.THREAD_ID, "thread 1")
            ]
        };
        this.sendResponse(response);
    }

    protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
        response.body = {
            stackFrames: [
                {
                    id: 0,
                    name: `PC: $${this._cpu.getRegisters().PC.toString(16).toUpperCase()}`,
                    line: 0,
                    column: 0,
                    source: {
                        name: "Memory",
                        path: "memory"
                    }
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
            // Bug65Host handles traps internally and triggers events
            // We just need to ensure we don't spin forever on terminated session
            // But we don't have a 'running' flag easily accessible here unless we track it
            if (cycles === 0) {
                // Should be handled by host?
                // But step() returns 0 if trap says 'stop'?
                // Verify.
                // Actually host hook returns true to stop.
                // cpu.step() returns 0.
                running = false;
                // Terminated event likely sent by host.onExit
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
