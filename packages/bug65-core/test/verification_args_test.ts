
import * as fs from 'fs';
import * as path from 'path';
import { DebugInfoParser } from '../src/debug_info';

const dbgPath = path.join(__dirname, 'data', 'args.dbg');
if (!fs.existsSync(dbgPath)) {
    console.error(`Debug file not found: ${dbgPath}`);
    process.exit(1);
}

const content = fs.readFileSync(dbgPath, 'utf8');
const info = DebugInfoParser.parse(content);

// Find file ID for "args.c"
let fileId = -1;
for (const [id, f] of info.files) {
    // The debug file might reference the original path, but we just check the basename for this test
    if (f.name.endsWith('args.c')) {
        fileId = id;
        break;
    }
}

if (fileId === -1) {
    console.error("args.c not found in debug info");
    process.exit(1);
}

// Check lines
const checks = [
    {
        line: 10,
        func: 'main',
        vars: ['argc', 'argv', 'i', 'message'],
        missing: ['length']
    },
    {
        line: 13,
        func: 'main',
        vars: ['argc', 'argv', 'i', 'message'],
        missing: ['length']
    },
    {
        line: 4,
        func: 'print_message',
        vars: ['message'], // argument
        missing: []
    }
];

for (const check of checks) {
    const lInfo = info.lines.find(l => l.fileId === fileId && l.line === check.line && l.type === 1); // type 1 = c source
    if (!lInfo || !lInfo.spanId) {
        console.log(`Skipping line ${check.line} (not found or no span)`);
        continue;
    }

    const span = info.spans.get(lInfo.spanId);
    if (!span || span.absStart === undefined) continue;

    console.log(`Checking Line ${check.line} in ${check.func}...`);
    const scopes = info.getScopesForAddress(span.absStart);
    if (scopes.length === 0) {
        console.error(`  FAILED: No scope found.`);
        continue;
    }

    const leaf = scopes[0];
    const chain = info.getScopeChain(leaf.id);
    // Find function scope
    const funcScope = chain.find(s => s.type === 'scope') || chain[chain.length - 1]; // Main/func usually type='scope'

    // Check function name (stripped of underscore)
    let funcName = funcScope.name;
    if (funcName.startsWith('_')) funcName = funcName.substring(1);

    if (funcName !== check.func) {
        console.error(`  FAILED: Expected function '${check.func}', got '${funcName}'`);
    } else {
        const calculatedSize = info.getFrameSize(funcScope.id);
        console.log(`  PASS: Function scope is '${funcName}', DbgSize: ${funcScope.size}, CalcSize: ${calculatedSize}`);
    }

    // Check vars
    const visibleVars = new Set<string>();
    for (const s of chain) {
        const vars = info.getVariablesForScope(s.id);
        vars.forEach(v => visibleVars.add(v.name));
    }

    for (const v of check.vars) {
        if (visibleVars.has(v)) {
            console.log(`  PASS: Variable '${v}' is visible.`);
        } else {
            console.error(`  FAILED: Variable '${v}' is missing.`);
        }
    }

    for (const v of check.missing) {
        if (!visibleVars.has(v)) {
            console.log(`  PASS: Variable '${v}' is correctly missing (not in debug info).`);
        } else {
            console.error(`  FAILED: Variable '${v}' appeared unexpected.`);
        }
    }
}
