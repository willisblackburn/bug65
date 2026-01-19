
import { SimpleMemory } from './../src/memory';
import { Cpu6502 } from './../src/cpu_6502';
import * as assert from 'assert';

function testLDAImmediate() {
    const memory = new SimpleMemory();
    const cpu = new Cpu6502(memory);

    // LDA #$55
    memory.write(0xFFFC, 0x00);
    memory.write(0xFFFD, 0x80); // Reset vector -> $8000
    memory.write(0x8000, 0xA9); // LDA #
    memory.write(0x8001, 0x55); // $55

    cpu.reset();
    cpu.step();

    const regs = cpu.getRegisters();
    assert.strictEqual(regs.A, 0x55);
    console.log("testLDAImmediate Passed");
}

function testParavirtualizationTraps() {
    const memory = new SimpleMemory();
    const cpu = new Cpu6502(memory);

    // Setup reset vector
    memory.write(0xFFFC, 0x00);
    memory.write(0xFFFD, 0x80); // Reset vector -> $8000

    // JMP $FFF9 (Exit)
    memory.write(0x8000, 0x4C); // JMP
    memory.write(0x8001, 0xF9);
    memory.write(0x8002, 0xFF);

    // Set exit code
    // LDA #$01
    memory.write(0x7FFE, 0xA9);
    memory.write(0x7FFF, 0x01);
    memory.writeWord(0xFFFC, 0x7FFE); // Start at 7FFE

    cpu.reset();

    // Hook
    let capturedExitCode = -1;
    cpu.onTrap = (pc) => {
        if (pc === 0xFFF9) {
            capturedExitCode = cpu.getRegisters().A;
            return true;
        }
        return false;
    };

    while (true) {
        const result = cpu.step();
        if (result === 0 && capturedExitCode !== -1) break;
        if (cpu.getRegisters().PC > 0xFFFF) break; // runaway
    }

    assert.strictEqual(capturedExitCode, 1);
    console.log("testParavirtualizationTraps Passed");
}

testLDAImmediate();
testParavirtualizationTraps();
