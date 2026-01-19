
import { DebugInfoParser } from '../src/debugInfo';
import * as assert from 'assert';

console.log("Running DebugInfo Parser Test...");

const debugContent = `
file id=1,name="test.c",size=100
seg id=1,name="CODE",start=0x1000,size=256
span id=1,seg=1,start=0,size=10
span id=2,seg=1,start=20,size=10
line file=1,line=10,span=1+2
`;

const info = DebugInfoParser.parse(debugContent);

// Test Span 1 (0x1000 - 0x1009)
const line1 = info.getLineForAddress(0x1000);
if (!line1) {
    console.error("FAILED: Address 0x1000 (Span 1) not mapped to a line.");
    process.exit(1);
}
if (line1.line !== 10) {
    console.error(`FAILED: Address 0x1000 mapped to line ${line1.line}, expected 10.`);
    process.exit(1);
}
console.log("PASS: Span 1 mapped correctly.");

// Test Span 2 (Offset 20 -> 0x1014)
const line2 = info.getLineForAddress(0x1014);
if (!line2) {
    console.error("FAILED: Address 0x1014 (Span 2) not mapped to a line.");
    process.exit(1);
}
if (line2.line !== 10) {
    console.error(`FAILED: Address 0x1014 mapped to line ${line2.line}, expected 10.`);
    process.exit(1);
}
console.log("PASS: Span 2 mapped correctly.");

console.log("PASS: Span 2 mapped correctly.");

const cDebugContent = `
file id=1,name="test.c",size=100
seg id=1,name="CODE",start=0x1000,size=256
span id=1,seg=1,start=0,size=10
scope id=1,name="my_func",mod=0,type=scope,size=24,parent=0,sym=0,span=1
csym id=0,name="local_var",scope=1,type=0,sc=auto,offs=-2
type id=0,val="00"
`;

const cInfo = DebugInfoParser.parse(cDebugContent);
const scope = cInfo.scopes.get(1);
if (!scope || scope.name !== "my_func") {
    console.error("FAILED: Scope 'my_func' not parsed correctly.");
    process.exit(1);
}
console.log("PASS: Scope parsed.");

const vars = cInfo.getVariablesForScope(1);
if (vars.length !== 1 || vars[0].name !== "local_var") {
    console.error("FAILED: Variable 'local_var' not found in scope.");
    process.exit(1);
}
if (vars[0].offset !== -2) {
    console.error("FAILED: Variable offset incorrect.");
    process.exit(1);
}
console.log("PASS: Variables parsed.");

console.log("All tests passed.");
