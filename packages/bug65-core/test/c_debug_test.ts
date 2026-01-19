
import { DebugInfoParser, VariableResolver, Memory } from '../src';
import * as fs from 'fs';
import * as path from 'path';
import * as assert from 'assert';

console.log("Running C Debug Integration Test...");

const dbgPath = path.join(__dirname, 'debug_sample.dbg');
if (!fs.existsSync(dbgPath)) {
    console.error("Debug sample 'debug_sample.dbg' not found. Please compile debug_sample.c first.");
    process.exit(1);
}

const debugContent = fs.readFileSync(dbgPath, 'utf8');
const info = DebugInfoParser.parse(debugContent);

console.log(`Parsed info: ${info.files.size} files, ${info.scopes.size} scopes, ${info.csymbols.size} symbols.`);

// Test Scope Resolution: 'my_func' (id=1, name="my_func")
// We need to find the address of my_func scope.
// It has span=14.
// Find span 14.
const span14 = info.spans.get(14);
if (!span14) {
    console.error("FAIL: Span 14 not found.");
    process.exit(1);
}
// Calculate absolute start address
// Segment 0 start: 0x0840
const seg0 = info.segments.get(0);
if (!seg0) {
    console.error("FAIL: Seg 0 not found.");
    process.exit(1);
}
const absStart = seg0.start + span14.start;
console.log(`Span 14 starts at $${absStart.toString(16)}`);

// Debug
console.log(`IntervalTree count: ${info.spanTree.count}`);
console.log(`spanToScopes size: ${info.spanToScopes.size}`);
const spansAtAddr = info.spanTree.search(absStart, absStart);
console.log(`Spans at address: ${spansAtAddr.length}`, spansAtAddr.map(s => s.id));
if (spansAtAddr.length > 0) {
    console.log(`Scopes for span ${spansAtAddr[0].id}:`, info.spanToScopes.get(spansAtAddr[0].id));
}

// Lookup scopes at absStart
const scopes = info.getScopesForAddress(absStart);
const myFuncScope = scopes.find(s => s.name === "_my_func" || s.name === "my_func");
if (!myFuncScope) {
    console.error("FAIL: Scope 'my_func' not found at address.");
    console.log("Found scopes:", scopes.map(s => s.name));
    process.exit(1);
}
console.log("PASS: Found scope 'my_func'.");

// Lookup Variables
const vars = info.getVariablesForScope(myFuncScope.id);
const locVar = vars.find(v => v.name === "local_var");
if (!locVar) {
    console.error("FAIL: Variable 'local_var' not found in scope.");
    process.exit(1);
}
console.log(`PASS: Found variable 'local_var' offset=${locVar.offset}.`);

// Test Value Resolution
// Simulate Memory and Stack
// Stack Pointer (SP) points to top of stack.
// 'local_var' has offset -2.
// If SP is $1000, variable is at $0FFE.
const mem = new Memory();
const sp = 0x1000;
const varAddr = (sp + locVar.offset) & 0xFFFF; // 0x0FFE

// Write known value to memory
mem.writeWord(varAddr, 1234);

// Resolve
const typeInfo = info.types.get(locVar.typeId);
const res = VariableResolver.resolveValue(mem, sp, locVar, typeInfo);

console.log(`Resolved Value: ${res.str}, Type: ${res.type}`);

// Check value
// Expected: $04D2 (1234)
if (!res.str.includes("04D2") && !res.str.includes("4D2")) {
    console.error(`FAIL: Value mismatch. Expected 1234, got ${res.str}`);
    process.exit(1);
}
console.log("PASS: Variable value resolved correctly.");
