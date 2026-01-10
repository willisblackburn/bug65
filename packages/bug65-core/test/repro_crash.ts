
import { Memory } from './../src/memory';
import { Cpu6502 } from './../src/cpu6502';
import * as assert from 'assert';

function testJsrRtsJmp() {
    console.log("Testing JSR / RTS / JMP flow...");
    const memory = new Memory();
    const cpu = new Cpu6502(memory);

    // Setup Scenario
    // 0200: 20 05 02  JSR $0205
    // 0203: 4C 10 02  JMP $0210
    // 0205: 60        RTS
    // 0206: 00        BRK (padding)
    // 0210: A9 42     LDA #$42

    // Memory layout:
    // $0200: 20
    // $0201: 05
    // $0202: 02
    // $0203: 4C
    // $0204: 10
    // $0205: 02  <- High byte of JMP target (if misaligned?) No, Wait.
    // 0203: 4C
    // 0204: 10
    // 0205: 02
    // Ah, JSR target is $0205. Byte at $0205 is 02?
    // Wait.
    // JSR $0205.
    // At $0205 should be RTS.
    // So 0205: 60.

    memory.write(0xFFFC, 0x00); memory.write(0xFFFD, 0x02);

    // 0200: JSR $0206
    memory.write(0x0200, 0x20); memory.write(0x0201, 0x06); memory.write(0x0202, 0x02);

    // 0203: JMP $0210
    memory.write(0x0203, 0x4C); memory.write(0x0204, 0x10); memory.write(0x0205, 0x02);

    // 0206: RTS
    memory.write(0x0206, 0x60);

    // 0210: LDA #$42
    memory.write(0x0210, 0xA9); memory.write(0x0211, 0x42);

    cpu.reset();

    // Step 1: JSR
    console.log(`PC before JSR: ${cpu.getRegisters().PC.toString(16)}`);
    cpu.step();
    console.log(`PC inside JSR: ${cpu.getRegisters().PC.toString(16)}`);
    assert.strictEqual(cpu.getRegisters().PC, 0x0206, "PC should be at RTS ($0206)");

    // Step 2: RTS
    cpu.step();
    console.log(`PC after RTS: ${cpu.getRegisters().PC.toString(16)}`);
    // Should be at 0203 (JMP)
    assert.strictEqual(cpu.getRegisters().PC, 0x0203, "PC should be at JMP ($0203)");

    // Step 3: JMP
    cpu.step();
    console.log(`PC after JMP: ${cpu.getRegisters().PC.toString(16)}`);
    assert.strictEqual(cpu.getRegisters().PC, 0x0210, "PC should be at LDA ($0210)");

    console.log("testJsrRtsJmp Passed");
}

function testCrashScenario() {
    // Recreate the user's dump sequence
    // $3D51: D0 06       BNE +6
    // $3D53: 20 60 40    JSR $4060
    // $3D56: 4C FF 43    JMP $43FF
    // $3D59: 20 ...      

    // We assume BNE is NOT taken for the crash path.
    // We mock JSR target $4060 to just RTS.

    console.log("Testing Crash Scenario...");
    const memory = new Memory();
    const cpu = new Cpu6502(memory);

    const base = 0x3D51;
    memory.write(0xFFFC, 0x51); memory.write(0xFFFD, 0x3D);

    // Code
    memory.write(0x3D51, 0xD0); memory.write(0x3D52, 0x06); // BNE
    memory.write(0x3D53, 0x20); memory.write(0x3D54, 0x60); memory.write(0x3D55, 0x40); // JSR
    memory.write(0x3D56, 0x4C); memory.write(0x3D57, 0xFF); memory.write(0x3D58, 0x43); // JMP
    memory.write(0x3D59, 0x20); // Next instr

    // Target $4060: RTS
    memory.write(0x4060, 0x60);

    // Force Z flag to 1 so BNE is NOT taken
    // We need to set flags manually or via code.
    // LDA #0 -> Z=1.
    // But we start reset at 3D51.
    // Manual hack:
    // cpu.setFlag? No public API.
    // Run LDA #0 at reset vector instead.

    // Using Public API to set Z flag?  Can't easily.
    // Use BNE logic: Loop if Z=0.
    // We want BNE NOT taken. Z must be 1.
    // Reset state: Status = Unused | Interrupt. Z is 0?
    // So BNE will be taken by default.

    // Let's modify code to ensure Z=1. 
    // Or just start PC at 3D53 to skip BNE and simulate fallthrough.

    memory.write(0xFFFC, 0x53); memory.write(0xFFFD, 0x3D); // Start at JSR

    cpu.reset();
    console.log(`Start PC: ${cpu.getRegisters().PC.toString(16)}`);

    // Step 1: JSR
    cpu.step();
    console.log(`PC after JSR: ${cpu.getRegisters().PC.toString(16)}`); // Should be 4060
    assert.strictEqual(cpu.getRegisters().PC, 0x4060);

    // Step 2: RTS
    cpu.step();
    console.log(`PC after RTS: ${cpu.getRegisters().PC.toString(16)}`); // Should be 3D56
    assert.strictEqual(cpu.getRegisters().PC, 0x3D56);

    // Step 3: JMP
    cpu.step();
    console.log(`PC after JMP: ${cpu.getRegisters().PC.toString(16)}`); // Should be 43FF
    assert.strictEqual(cpu.getRegisters().PC, 0x43FF);

    console.log("Crash Scenario Passed (Behavior Correct)");
}

testJsrRtsJmp();
testCrashScenario();
