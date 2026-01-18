import { Bug65Host } from '../src/bug65-host';
import { Cpu6502 } from '../src/cpu6502';
import { Memory } from '../src/memory';

const memory = new Memory();
const cpu = new Cpu6502(memory);
const host = new Bug65Host(cpu, memory);

// Setup
host.setSpAddress(0x02); // Set ZP SP address to $02
host.commandLineArgs = ["test_prog", "arg1", "arg2"];

// Initialize Software Stack
const spStart = 0xC000;
memory.writeWord(0x02, spStart);

// Set AX to point to where __argv is stored (e.g. $2000)
// This location will receive the address of the argv array.
const argvPtrAddr = 0x2000;
const regs = cpu.getRegisters();
regs.A = argvPtrAddr & 0xFF;
regs.X = (argvPtrAddr >> 8) & 0xFF;
cpu.setRegisters(regs);

// Call pvArgs via Trap
// ADDR_ARGS is 0xFFF8
if (cpu.onTrap) {
    console.log("Calling pvArgs trap...");
    cpu.onTrap(0xFFF8);
} else {
    console.error("Trap handler not set!");
    process.exit(1);
}

// Check results
// 1. Check argc in AX
const newRegs = cpu.getRegisters();
const argc = (newRegs.X << 8) | newRegs.A;
console.log(`Returned argc: ${argc}`);
if (argc !== 3) {
    console.error("FAILED: Incorrect argc");
    process.exit(1);
}

// 2. Check __argv content
const argvAddr = memory.readWord(argvPtrAddr);
console.log(`argv address stored at $${argvPtrAddr.toString(16)}: $${argvAddr.toString(16)}`);

// 3. Check argv array on stack
// argv[0] -> "test_prog"
// argv[1] -> "arg1"
// argv[2] -> "arg2"
// argv[3] -> NULL

const ptr0 = memory.readWord(argvAddr);
const ptr1 = memory.readWord(argvAddr + 2);
const ptr2 = memory.readWord(argvAddr + 4);
const ptr3 = memory.readWord(argvAddr + 6);

console.log(`argv[0] ptr: $${ptr0.toString(16)}`);
console.log(`argv[1] ptr: $${ptr1.toString(16)}`);
console.log(`argv[2] ptr: $${ptr2.toString(16)}`);
console.log(`argv[3] ptr: $${ptr3.toString(16)}`);

if (ptr3 !== 0) {
    console.error("FAILED: argv[3] is not NULL");
    process.exit(1);
}

// Helper to read string from memory
function readString(addr: number): string {
    let s = "";
    let ptr = addr;
    while (true) {
        const c = memory.read(ptr++);
        if (c === 0) break;
        s += String.fromCharCode(c);
    }
    return s;
}

const str0 = readString(ptr0);
console.log(`argv[0] string: "${str0}"`);
if (str0 !== "test_prog") {
    console.error("FAILED: argv[0] mismatch");
    process.exit(1);
}

const str1 = readString(ptr1);
console.log(`argv[1] string: "${str1}"`);
if (str1 !== "arg1") {
    console.error("FAILED: argv[1] mismatch");
    process.exit(1);
}

const str2 = readString(ptr2);
console.log(`argv[2] string: "${str2}"`);
if (str2 !== "arg2") {
    console.error("FAILED: argv[2] mismatch");
    process.exit(1);
}

console.log("SUCCESS: PVArgs test passed.");
