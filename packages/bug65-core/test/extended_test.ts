
import { Memory } from './../src/memory';
import { Cpu6502 } from './../src/cpu6502';
import { Flags } from './../src/cpu-interface';
import * as assert from 'assert';

function testADC() {
    const memory = new Memory();
    const cpu = new Cpu6502(memory); // Access protected members with casting if needed? No, use public API

    // Test: 10 + 20 = 30
    memory.write(0xFFFC, 0x00); memory.write(0xFFFD, 0x02); // PC=0200
    memory.write(0x0200, 0xA9); memory.write(0x0201, 0x0A); // LDA #10
    memory.write(0x0202, 0x69); memory.write(0x0203, 0x14); // ADC #20
    memory.write(0x0204, 0x00); // BRK

    cpu.reset();
    for (let i = 0; i < 3; i++) cpu.step(); // LDA, ADC, BRK (trap/stop)

    const regs = cpu.getRegisters();
    assert.strictEqual(regs.A, 30);
    assert.strictEqual(regs.Status & Flags.Carry, 0);
    console.log("testADC Passed");
}

function testADCCarry() {
    const memory = new Memory();
    const cpu = new Cpu6502(memory);

    // Test: 250 + 10 = 260 (4 in A, Carry Set)
    // SEC (Set Carry)
    // LDA #250
    // ADC #10

    memory.write(0xFFFC, 0x00); memory.write(0xFFFD, 0x02);
    memory.write(0x0200, 0x38); // SEC
    memory.write(0x0201, 0xA9); memory.write(0x0202, 0xFA); // LDA #250
    memory.write(0x0203, 0x69); memory.write(0x0204, 0x0A); // ADC #10

    cpu.reset();
    cpu.step(); // SEC
    cpu.step(); // LDA
    cpu.step(); // ADC

    const regs = cpu.getRegisters();
    // 250 + 10 + 1 (carry) = 261 = 0x105 -> A=5, Carry=1
    assert.strictEqual(regs.A, 5);
    assert.strictEqual((regs.Status & Flags.Carry) !== 0, true);
    console.log("testADCCarry Passed");
}

function testBranch() {
    const memory = new Memory();
    const cpu = new Cpu6502(memory);

    // Loop X from 5 down to 0
    // LDX #5
    // Loop: DEX
    // BNE Loop

    // 0200: A2 05 (LDX #5)
    // 0202: CA    (DEX)
    // 0203: D0 FD (BNE -3 -> 0202) (-3 = FD)
    // 0205: 00    (BRK)

    memory.write(0xFFFC, 0x00); memory.write(0xFFFD, 0x02);
    memory.write(0x0200, 0xA2); memory.write(0x0201, 0x05);
    memory.write(0x0202, 0xCA);
    memory.write(0x0203, 0xD0); memory.write(0x0204, 0xFD);
    // memory.write(0x0205, 0x00);

    cpu.reset();
    let steps = 0;
    while (cpu.getRegisters().PC !== 0x0205 && steps < 100) {
        cpu.step();
        steps++;
    }

    assert.strictEqual(cpu.getRegisters().X, 0);
    // Steps: LDX(1) + 5 * (DEX(1) + BNE(1)) -> 1 + 10 = 11 steps. 
    // Wait: DEX (5->4), BNE taken.
    // ...
    // DEX (1->0), BNE not taken.
    // Total steps: 1 (LDX) + 5*(DEX+BNE) + 1 (DEX) + 1 (BNE not taken)? 
    // Actually Loop 5 times: 5,4,3,2,1. 
    // When X=1 -> DEX(X=0) -> BNE(Not Taken).
    console.log(`testBranch Passed (steps: ${steps})`);
}

function testStack() {
    const memory = new Memory();
    const cpu = new Cpu6502(memory);

    // LDA #$AA
    // PHA
    // LDA #$00
    // PLA
    // Expect A=$AA

    memory.write(0xFFFC, 0x00); memory.write(0xFFFD, 0x02);
    memory.write(0x0200, 0xA9); memory.write(0x0201, 0xAA);
    memory.write(0x0202, 0x48);
    memory.write(0x0203, 0xA9); memory.write(0x0204, 0x00);
    memory.write(0x0205, 0x68);

    cpu.reset();
    for (let i = 0; i < 4; i++) cpu.step();

    assert.strictEqual(cpu.getRegisters().A, 0xAA);
    console.log("testStack Passed");
}

testADC();
testADCCarry();
testBranch();
testStack();
