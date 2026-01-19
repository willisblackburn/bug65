
import { VariableResolver, CSymbolInfo, TypeInfo } from '../src/debugInfo';
import * as assert from 'assert';

console.log("Running VariableResolver Test...");

const mem = {
    data: new Uint8Array(65536),
    fill(addr: number, val: number) {
        this.data[addr] = val;
    },
    read(addr: number) {
        return this.data[addr];
    },
    readWord(addr: number) {
        return this.data[addr] | (this.data[addr + 1] << 8);
    }
};

const sp = 0x1000;

mem.data.fill(0);

// Char Test
{
    const sym: CSymbolInfo = { id: 1, name: 'c', scopeId: 1, typeId: 1, sc: 'auto', offset: 0 };
    const type: TypeInfo = { id: 1, size: 1, kind: '04' };
    mem.fill(sp, 65); // 'A'
    const res = VariableResolver.resolveValue(mem, sp, sym, type);
    assert.strictEqual(res.type, 'char');
    assert.ok(res.str.includes("'A'"));
    console.log("PASS: Char test");
}

// Int Test
{
    const sym: CSymbolInfo = { id: 2, name: 'i', scopeId: 1, typeId: 2, sc: 'auto', offset: 2 };
    const type: TypeInfo = { id: 2, size: 2, kind: '05' };
    mem.fill(sp + 2, 0x39);
    mem.fill(sp + 3, 0x05); // 0x0539 = 1337
    const res = VariableResolver.resolveValue(mem, sp, sym, type);
    assert.strictEqual(res.type, 'int');
    assert.ok(res.str.includes("1337"));
    console.log("PASS: Int test");
}

// Pointer Test
{
    const sym: CSymbolInfo = { id: 4, name: 'ptr', scopeId: 1, typeId: 3, sc: 'auto', offset: 6 };
    const type: TypeInfo = { id: 3, size: 2, kind: '80' }; // Pointer
    mem.fill(sp + 6, 0x00);
    mem.fill(sp + 7, 0x20); // 0x2000
    const res = VariableResolver.resolveValue(mem, sp, sym, type);
    assert.strictEqual(res.type, 'ptr');
    assert.strictEqual(res.str, '$2000');
    console.log("PASS: Pointer test");
}

// Array Test
{
    const sym: CSymbolInfo = { id: 5, name: 'arr', scopeId: 1, typeId: 4, sc: 'auto', offset: 8 };
    const type: TypeInfo = { id: 4, size: 10, kind: '90' }; // Array
    const res = VariableResolver.resolveValue(mem, sp, sym, type);
    assert.strictEqual(res.type, 'array');
    assert.ok(res.str.startsWith('@ $'));
    console.log("PASS: Array test");
}

console.log("All VariableResolver tests passed.");
