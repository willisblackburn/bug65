
import {
    Logger, logger,
    LoggingDebugSession,
    InitializedEvent, TerminatedEvent, StoppedEvent, OutputEvent,
    Thread, Scope, Source, Handles, Breakpoint
} from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { Cpu6502, Memory, CpuRegisters } from 'bug65-core';
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
        this._cpu.onTrap = (pc) => this.handleTrap(pc);
    }

    private handleTrap(pc: number): boolean {
        if (pc === 0xFFF9) { // Exit
            // this.sendEvent(new TerminatedEvent());
            return true;
        }
        return false;
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

        const programPath = args.program;
        if (!fs.existsSync(programPath)) {
            this.sendErrorResponse(response, 0, `Program file ${programPath} not found.`);
            return;
        }

        const data = fs.readFileSync(programPath);
        this.loadProgram(data);

        this._cpu.reset();

        this.sendResponse(response);

        if (args.stopOnEntry) {
            this.sendEvent(new StoppedEvent('entry', Bug65DebugSession.THREAD_ID));
        } else {
            this.continueRequest(<DebugProtocol.ContinueResponse>response, { threadId: Bug65DebugSession.THREAD_ID });
        }
    }

    private loadProgram(data: Buffer) {
        // Simple loading logic
        const header = data.slice(0, 5).toString('ascii');
        let loadAddr = 0x0200;
        let offset = 0;

        if (header === 'sim65') {
            offset = 12;
        }

        const programData = new Uint8Array(data.slice(offset));
        this._memory.load(loadAddr, programData);
        this._memory.writeWord(0xFFFC, loadAddr);
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
            if (cycles === 0) { // Trap
                // Exit
                this.sendEvent(new TerminatedEvent());
                running = false;
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
