
import { Cpu6502, Memory, Flags } from 'bug65-core';
import * as fs from 'fs';
import * as path from 'path';

function printHelp() {
    console.log("Usage: bug65 <program.bin> [start_address_hex]");
    console.log("Example: bug65 program.bin 0200");
}

function main() {
    const args = process.argv.slice(2);
    if (args.length < 1) {
        printHelp();
        process.exit(1);
    }

    const programPath = args[0];
    let specifiedLoadAddr = args.length > 1 ? parseInt(args[1], 16) : null;

    if (!fs.existsSync(programPath)) {
        console.error(`Error: File not found: ${programPath}`);
        process.exit(1);
    }

    try {
        const data = fs.readFileSync(programPath);
        const memory = new Memory();
        const cpu = new Cpu6502(memory);

        // Header check for 'sim65'
        const header = data.slice(0, 5).toString('ascii');
        let loadAddr = specifiedLoadAddr !== null ? specifiedLoadAddr : 0x0200;
        let offset = 0;

        if (header === 'sim65') {
            offset = 12;
            if (specifiedLoadAddr === null) {
                // sim65 binary likely assumes 0x0200 or is relocatable?
                // Standard sim65 usually has simple header. 
                // We stick to 0x0200 default if not specified.
            }
        }

        const programData = new Uint8Array(data.slice(offset));
        memory.load(loadAddr, programData);

        // Set Reset Vector to load address
        memory.writeWord(0xFFFC, loadAddr);

        // Reset and Run
        cpu.reset();

        // Set up trap
        cpu.onTrap = (pc: number) => {
            if (pc === 0xFFF9) {
                const exitCode = cpu.getRegisters().A;
                // console.log(`Exited with code: ${exitCode}`);
                process.exit(exitCode);
                return true;
            }
            return false;
        };

        // Run loop
        // We use a simple loop here. For very long running programs this might block,
        // but for a CLI simulator it's usually fine to run fast-as-possible.

        while (true) {
            cpu.step();
        }

    } catch (e: any) {
        console.error(`Error executing program: ${e.message}`);
        process.exit(1);
    }
}

main();
