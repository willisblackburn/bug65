
import { DebugInfo, DebugInfoParser } from '../src/debugInfo';
import * as assert from 'assert';

console.log("Running DebugInfo Overlap Test...");

const debugContent = `
file id=1,name="test.c",size=100
seg id=1,name="CODE",start=0x1000,size=256
span id=1,seg=1,start=0,size=100
span id=2,seg=1,start=50,size=10
line file=1,line=10,span=1
line file=1,line=20,span=2
`;

// Span 1: 0x1000 - 0x1064 (Line 10)
// Span 2: 0x1032 - 0x103C (Line 20) (Start 50 = 0x32)

const info = DebugInfoParser.parse(debugContent);

// Test Nested Span (Span 2 inside Span 1)
// Addr 0x1032 (Start of Span 2)
// Should find both, but prefer Line 20 (Span 2) as it appears first in search (closest start)?
// Wait, sorted by start. Span 1 (0) comes before Span 2 (50).
// UpperBound search for 0x1032.
// Span 1 (0) <= 0x1032.
// Span 2 (50) <= 0x1032.
// Returns index AFTER Span 2.
// Backward walk:
// Check Span 2. Starts 0x1032. Matches. Returns Line 20.
// Check Span 1. Starts 0x1000. Matches. Returns Line 10.
// getLineForAddress uses first found?
// getAllLinesForAddress returns [Line 20, Line 10].

const lines = info.getAllLinesForAddress(0x1032);
console.log(`Found ${lines.length} lines for 0x1032.`);
lines.forEach(l => console.log(` - Line ${l.line}`));

if (lines.length !== 2) {
    console.error("FAILED: Expected 2 lines for nested address.");
}

const best = info.getLineForAddress(0x1032);
if (best?.line !== 20) {
    console.error(`FAILED: Best line for 0x1032 is ${best?.line}, expected 20.`);
} else {
    console.log("PASS: 0x1032 -> Line 20 (Nested/Specific)");
}

// Test Outer Span (Only Span 1)
// Addr 0x1010 (Inside Span 1, before Span 2)
const best2 = info.getLineForAddress(0x1010);
if (best2?.line !== 10) {
    console.error(`FAILED: Best line for 0x1010 is ${best2?.line}, expected 10.`);
} else {
    console.log("PASS: 0x1010 -> Line 10 (Outer)");
}

// Test Outer Span (After Span 2)
// Addr 0x1050 (Inside Span 1, after Span 2)
const best3 = info.getLineForAddress(0x1050);
if (best3?.line !== 10) {
    console.error(`FAILED: Best line for 0x1050 is ${best3?.line}, expected 10.`);
} else {
    console.log("PASS: 0x1050 -> Line 10 (Outer/After)");
}

console.log("Test Complete.");
