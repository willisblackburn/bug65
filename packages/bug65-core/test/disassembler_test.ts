
import * as assert from 'assert';
import { Disassembler6502 } from '../src/disassembler6502';
import { Memory } from '../src/memory';

async function runTest() {
    const mem = new Memory();
    const disasm = new Disassembler6502();

    // Test 1: LDA #$12 (A9 12)
    mem.load(0x100, new Uint8Array([0xA9, 0x12]));
    let result = disasm.disassemble(mem, 0x100);
    assert.strictEqual(result.asm.trim(), 'LDA #$12');
    assert.strictEqual(result.count, 2);

    // Test 2: JMP $1234 (4C 34 12)
    mem.load(0x200, new Uint8Array([0x4C, 0x34, 0x12]));
    result = disasm.disassemble(mem, 0x200);
    assert.strictEqual(result.asm.trim(), 'JMP $1234');
    assert.strictEqual(result.count, 3);

    // Test 3: Unknown opcode (FF) -> DB
    mem.load(0x300, new Uint8Array([0xFF]));
    result = disasm.disassemble(mem, 0x300);
    assert.match(result.asm, /DB \$FF/);

    // Test 4: 65C02 Instruction (TSB $10 - 04 10) on 6502 mode -> DB
    mem.load(0x400, new Uint8Array([0x04, 0x10]));
    disasm.setCpuType('6502'); // Ensure mode
    result = disasm.disassemble(mem, 0x400);
    assert.match(result.asm, /DB \$04/);

    // Test 5: 65C02 Instruction on 65C02 mode -> TSB $10
    disasm.setCpuType('65C02');
    result = disasm.disassemble(mem, 0x400); // Re-disassemble same bytes
    assert.strictEqual(result.asm.trim(), 'TSB $10');

    console.log('Disassembler tests passed.');
}

runTest().catch(err => {
    console.error(err);
    process.exit(1);
});
