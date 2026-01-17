
import { Cpu6502, Memory, Flags, Bug65Host, Disassembler6502, DebugInfo, DebugInfoParser, ProgramLoader, CpuType } from 'bug65-core';
import * as fs from 'fs';
import * as path from 'path';

function printHelp() {
    console.log("Usage: bug65 [--trace|-t] [--cpu <type>] <program.bin> [start_address_hex]");
    console.log("Example: bug65 --trace --cpu 65C02 program.bin 0200");
}

function main() {
    const args = process.argv.slice(2);

    let traceMode: 'off' | 'source' | 'disassemble' = 'off';
    let programPath: string | null = null;
    let specifiedLoadAddr: number | null = null;
    let specifiedCpuType: CpuType | null = null;

    // Parse args
    let dbgFileArg: string | null = null;

    // Parse args
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--trace' || args[i] === '-t') {
            traceMode = 'source';
        } else if (args[i].startsWith('--trace=')) {
            const mode = args[i].split('=')[1];
            if (mode === 'source' || mode === 'disassemble') {
                traceMode = mode;
            } else {
                console.error(`Invalid trace mode: ${mode}`);
                process.exit(1);
            }
        } else if (args[i] === '--dbgfile') {
            if (i + 1 < args.length) {
                dbgFileArg = args[++i];
            } else {
                console.error("Error: --dbgfile requires an argument");
                process.exit(1);
            }
        } else if (args[i] === '--cpu') {
            if (i + 1 < args.length) {
                const type = args[++i];
                if (type === '6502' || type === '65C02') {
                    specifiedCpuType = type;
                } else {
                    console.error(`Invalid CPU type: ${type}`);
                    process.exit(1);
                }
            } else {
                console.error("Error: --cpu requires an argument");
                process.exit(1);
            }
        } else if (!programPath) {
            programPath = args[i];
        } else if (specifiedLoadAddr === null) {
            specifiedLoadAddr = parseInt(args[i], 16);
        }
    }

    if (!programPath) {
        printHelp();
        process.exit(1);
    }

    if (!fs.existsSync(programPath)) {
        console.error(`Error: File not found: ${programPath}`);
        process.exit(1);
    }

    let cpu: Cpu6502 | null = null;
    let memory: Memory | null = null;

    console.error("Starting...");

    try {
        console.error("Reading file:", programPath);
        const data = fs.readFileSync(programPath);
        console.error("File read size:", data.length);

        memory = new Memory();
        cpu = new Cpu6502(memory);

        // Header check for 'sim65'
        // Header check for 'sim65'
        // Program Loader
        // Program Loader
        const loadOptions = specifiedLoadAddr !== null ? { loadAddr: specifiedLoadAddr } : undefined;
        const { loadAddr, resetAddr, spAddr, cpuType: headerCpuType } = ProgramLoader.load(memory, data, loadOptions);

        const effectiveCpuType = specifiedCpuType || headerCpuType || '6502';
        console.error(`CPU Type: ${effectiveCpuType}`);
        cpu.setCpuType(effectiveCpuType);

        console.error(`  SP Address: $${spAddr.toString(16).padStart(2, '0')}`);
        console.error(`  Load Address: $${loadAddr.toString(16).padStart(4, '0')}`);
        console.error(`  Reset Address: $${resetAddr.toString(16).padStart(4, '0')}`);

        // Reset and Run
        cpu.reset();


        console.error("CPU Reset complete. PC:", cpu.getRegisters().PC.toString(16));

        // Initializing host
        const host = new Bug65Host(cpu, memory);
        host.setSpAddress(spAddr);


        host.onExit = (code) => {
            process.exit(code);
        };

        host.onWrite = (char) => {
            process.stdout.write(String.fromCharCode(char));
        };

        // Ensure RTS at hook addresses
        // This allows 'virtual' subroutine calls to return if we don't return true in trap
        // Map all common sim65 vectors to RTS
        for (let addr = 0xFFF0; addr <= 0xFFF9; addr++) {
            memory.write(addr, 0x60); // RTS
        }

        // Run loop

        // Try loading debug info
        let debugInfo: DebugInfo | undefined;
        let dbgPath: string | null = null;

        // Check for .dbg file (replace extension or append)
        if (dbgFileArg) {
            if (fs.existsSync(dbgFileArg)) {
                dbgPath = dbgFileArg;
            } else {
                console.error(`Warning: Specified debug file not found: ${dbgFileArg}`);
            }
        } else {

            dbgPath = DebugInfoParser.resolveDebugFile(programPath) || null;
        }



        if (dbgPath) {
            console.error(`Loading debug info from: ${dbgPath}`);
            const dbgContent = fs.readFileSync(dbgPath, 'utf-8');
            debugInfo = DebugInfoParser.parse(dbgContent);
            console.error(`  Loaded ${debugInfo.symbols.size} symbols, ${debugInfo.lines.length} lines.`);
        } else {
            console.error("No debug info file found.");
        }

        const disassembler = new Disassembler6502(debugInfo, effectiveCpuType);

        // Source cache
        const sourceCache = new Map<number, string[]>();
        let lastSourceLine: string | null = null;
        let lastSourceFileId: number = -1;
        let lastSourceLineNum: number = -1;

        function getSourceLine(fileId: number, lineNum: number): string | undefined {
            let lines = sourceCache.get(fileId);
            if (!lines) {
                if (debugInfo && debugInfo.files.has(fileId)) {
                    const fileEntry = debugInfo.files.get(fileId);
                    if (fileEntry) {
                        // Try to resolve path. debugInfo often has relative paths.
                        // Try relative to dbg file location, then program location.
                        // Or maybe it is relative to cwd?
                        let srcPath = fileEntry.name;
                        if (!path.isAbsolute(srcPath) && dbgPath) {
                            srcPath = path.resolve(path.dirname(dbgPath), srcPath);
                        }

                        if (fs.existsSync(srcPath)) {
                            try {
                                const content = fs.readFileSync(srcPath, 'utf-8');
                                lines = content.split(/\r?\n/);
                                sourceCache.set(fileId, lines);
                            } catch (e) {
                                // Ignore read errors
                            }
                        }
                    }
                }
            }


            if (lines && lineNum > 0 && lineNum <= lines.length) {
                return lines[lineNum - 1]; // Line numbers are 1-based
            }
            return undefined;
        }

        // Run loop

        while (true) {
            if (traceMode !== 'off' && cpu) {
                const regs = cpu.getRegisters();

                if (traceMode === 'source') {
                    if (debugInfo) {
                        const lineInfo = debugInfo.getLineForAddress(regs.PC);
                        if (lineInfo) {
                            if (lineInfo.fileId !== lastSourceFileId || lineInfo.line !== lastSourceLineNum) {
                                const srcLine = getSourceLine(lineInfo.fileId, lineInfo.line);
                                if (srcLine) {
                                    // Clean up the line for printing
                                    console.error(`${srcLine.trim()}`);
                                    lastSourceFileId = lineInfo.fileId;
                                    lastSourceLineNum = lineInfo.line;
                                }
                            }
                        }
                    }
                } else {
                    // Disassemble mode
                    printDisassembly(cpu, memory, disassembler, debugInfo);
                }
            }
            // Check for FFF7 manually here or add to host
            cpu.step();
        }

    } catch (e: any) {
        console.error(`\nError executing program: ${e.message}`);

        if (cpu && memory) {
            const pc = cpu.getRegisters().PC;
            console.error(`PC: $${pc.toString(16).toUpperCase()}`);
            console.error(`Registers: A=$${cpu.getRegisters().A.toString(16).toUpperCase()} X=$${cpu.getRegisters().X.toString(16).toUpperCase()} Y=$${cpu.getRegisters().Y.toString(16).toUpperCase()} SP=$${cpu.getRegisters().SP.toString(16).toUpperCase()} P=$${cpu.getRegisters().Status.toString(16).toUpperCase()}`);

            // Dump memory around PC
            console.error("Memory near PC:");
            const start = Math.max(0, pc - 8);
            const end = Math.min(0xFFFF, pc + 8);
            let dump = "";
            for (let i = start; i <= end; i++) {
                const val = memory.read(i).toString(16).toUpperCase().padStart(2, '0');
                if (i === pc) dump += ` [${val}]`;
                else dump += ` ${val}`;
            }
            console.error(`$${start.toString(16).toUpperCase()}: ${dump}`);
        }

        process.exit(1);
    }
}

function printDisassembly(cpu: Cpu6502, memory: Memory, disassembler: Disassembler6502, debugInfo: DebugInfo | undefined) {
    const regs = cpu.getRegisters();
    const { asm, bytes } = disassembler.disassemble(memory, regs.PC);

    let symbolStr = '            '; // 12 spaces
    if (debugInfo) {
        const sym = debugInfo.getSymbolForAddress(regs.PC);
        if (sym) {
            symbolStr = `  ${sym.name}`.padEnd(12).slice(0, 12);
        }
    }

    const bytesStr = bytes.map((b: number) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ').padEnd(9);

    console.error(`${regs.PC.toString(16).toUpperCase().padStart(4, '0')}${symbolStr}  ${bytesStr} ${asm}   A:${regs.A.toString(16).toUpperCase().padStart(2, '0')} X:${regs.X.toString(16).toUpperCase().padStart(2, '0')} Y:${regs.Y.toString(16).toUpperCase().padStart(2, '0')} P:${regs.Status.toString(16).toUpperCase().padStart(2, '0')} SP:${regs.SP.toString(16).toUpperCase().padStart(2, '0')}`);
}

main();
