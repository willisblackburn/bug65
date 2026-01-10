
import { Cpu6502, Memory, Flags, Bug65Host } from 'bug65-core';
import * as fs from 'fs';
import * as path from 'path';

function printHelp() {
    console.log("Usage: bug65 [--trace|-t] <program.bin> [start_address_hex]");
    console.log("Example: bug65 --trace program.bin 0200");
}

function main() {
    const args = process.argv.slice(2);

    let trace = false;
    let programPath: string | null = null;
    let specifiedLoadAddr: number | null = null;

    // Parse args
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--trace' || args[i] === '-t') {
            trace = true;
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
        const header = data.slice(0, 5).toString('ascii');
        let loadAddr = specifiedLoadAddr !== null ? specifiedLoadAddr : 0x0200;
        let resetAddr = 0x0200; // Default
        let spAddr = 0x00; // Default
        let offset = 0;

        if (header === 'sim65') {
            offset = 12;
            console.error("Detected sim65 header. Parsing...");

            // Byte 7: SP Address
            spAddr = data[7];

            // Bytes 8-9: Load Address (Little Endian)
            const fileLoadAddr = (data[9] << 8) | data[8];

            // Bytes 10-11: Reset Address (Little Endian)
            const fileResetAddr = (data[11] << 8) | data[10];

            console.error(`  SP Address: $${spAddr.toString(16).padStart(2, '0')}`);
            console.error(`  Load Address: $${fileLoadAddr.toString(16).padStart(4, '0')}`);
            console.error(`  Reset Address: $${fileResetAddr.toString(16).padStart(4, '0')}`);

            if (specifiedLoadAddr === null) {
                loadAddr = fileLoadAddr;
                resetAddr = fileResetAddr;
            } else {
                // If user specified load address, assume they know what they are doing.
                // Reset address should probably match load address unless specified otherwise?
                // Just keep resetAddr as default or file provided?
                resetAddr = loadAddr; // Force reset to load addr if manual override
            }
        }

        console.error(`Loading at $${loadAddr.toString(16)} (Offset ${offset})`);

        const programData = new Uint8Array(data.slice(offset));
        memory.load(loadAddr, programData);

        // Set Reset Vector to load address
        memory.writeWord(0xFFFC, resetAddr);

        // Reset and Run
        cpu.reset();


        console.error("CPU Reset complete. PC:", cpu.getRegisters().PC.toString(16));

        // Initializing host
        const host = new Bug65Host(cpu, memory);
        host.setSpAddress(spAddr);
        host.install();

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

        while (true) {
            if (trace && cpu) {
                const regs = cpu.getRegisters();
                const opcode = memory.read(regs.PC);
                console.error(`${regs.PC.toString(16).toUpperCase().padStart(4, '0')}  ${opcode.toString(16).toUpperCase().padStart(2, '0')}  A:${regs.A.toString(16).toUpperCase().padStart(2, '0')} X:${regs.X.toString(16).toUpperCase().padStart(2, '0')} Y:${regs.Y.toString(16).toUpperCase().padStart(2, '0')} P:${regs.Status.toString(16).toUpperCase().padStart(2, '0')} SP:${regs.SP.toString(16).toUpperCase().padStart(2, '0')}`);
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

main();
