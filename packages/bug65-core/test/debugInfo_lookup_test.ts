
import { DebugInfo, DebugInfoParser } from '../src/debugInfo';
import * as assert from 'assert';

console.log("Running DebugInfo Lookup Test...");

const debugContent = `
file id=1,name="test.c",size=100
seg id=1,name="CODE",start=0x1000,size=256
span id=1,seg=1,start=0,size=10
span id=2,seg=1,start=20,size=10
line file=1,line=10,span=1
line file=1,line=20,span=2
`;

const info = DebugInfoParser.parse(debugContent);

// Dump sorted spans for debugging


// Test Lookup for Span 1
// Start + 0 (0x1000)
const line1 = info.getLineForAddress(0x1000);
if (!line1) {
    console.error("FAILED: Address 0x1000 (Span 1 Start) not mapped.");
} else {
    console.log(`PASS: 0x1000 -> Line ${line1.line}`);
}

// Start + 5 (0x1005)
const line1b = info.getLineForAddress(0x1005);
if (!line1b) {
    console.error("FAILED: Address 0x1005 (Span 1 Middle) not mapped.");
} else {
    console.log(`PASS: 0x1005 -> Line ${line1b.line}`);
}

// Start + 9 (0x1009)
const line1c = info.getLineForAddress(0x1009);
if (!line1c) {
    console.error("FAILED: Address 0x1009 (Span 1 End) not mapped.");
} else {
    console.log(`PASS: 0x1009 -> Line ${line1c.line}`);
}

// Start + 10 (0x100A) - Should FAIL (Exclusive)
const line1d = info.getLineForAddress(0x100A);
if (line1d) {
    console.error(`FAILED: Address 0x100A (Span 1 After) mapped to line ${line1d.line}, expected undefined.`);
} else {
    console.log(`PASS: 0x100A -> Undefined (Correct)`);
}

// Test Lookup for Span 2
// Start + 0 (0x1000 + 0x14 = 0x1014)
const line2 = info.getLineForAddress(0x1014); // 0x1000 + 20
if (!line2) {
    console.error("FAILED: Address 0x1014 (Span 2 Start) not mapped.");
} else {
    console.log(`PASS: 0x1014 -> Line ${line2.line}`);
}

console.log("Test Complete.");
