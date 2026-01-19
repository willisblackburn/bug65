
import * as fs from 'fs';

import IntervalTree from 'node-interval-tree';

export interface SourceFile {
    id: number;
    name: string;
    size?: number;
    mtime?: string;
}

export interface LineInfo {
    id?: number;
    fileId: number;
    line: number;
    spanId?: number; // referenced span?
    type?: number;
}

export interface SpanInfo {
    id: number;
    segId: number;
    start: number;
    size: number;
    type?: number;
    absStart?: number; // Calculated absolute start address
}

export interface SymbolInfo {
    id: number;
    name: string;
    addr: number;
    size?: number;
    type?: string;
    parentId?: number;
    symType?: string; // e.g. "func", "lab"
    segId?: number;
}

export interface SegmentInfo {
    id: number;
    name: string;
    start: number;
    size: number;
}

export interface ModuleInfo {
    id: number;
    name: string;
    fileId: number; // Primary source file
    libId?: number; // References a library?
    lib?: boolean; // Is library?
}

export interface LibraryInfo {
    id: number;
    name: string;
}

export interface ScopeInfo {
    id: number;
    name: string;
    symId?: number; // Symbol ID of the function or block name
    parentId?: number;
    type?: number; // scope type
    size?: number; // size of locals?
    spans: number[]; // Span IDs belonging to this scope
}

export interface CSymbolInfo {
    id: number;
    name: string;
    scopeId: number;
    typeId: number;
    sc: string; // Storage class (auto, static, register, extern)
    offset: number; // Offset from stack pointer (for auto)
    symId?: number; // Related symbol ID (for static/extern address)
}

export interface TypeInfo {
    id: number;
    size: number;
    baseId?: number; // Type ID of base type (e.g. pointer to...)
    name?: string; // struct/union tag or typedef name
    kind?: string; // e.g. "ptr", "struct", "func", "array"
    memberIds?: number[]; // For structs/unions
    count?: number; // Array element count
}

export class DebugInfo {
    public files: Map<number, SourceFile> = new Map();
    public segments: Map<number, SegmentInfo> = new Map();
    public lines: LineInfo[] = []; // List of all line mappings
    public spans: Map<number, SpanInfo> = new Map();
    public symbols: Map<number, SymbolInfo> = new Map();
    public symbolsByName: Map<string, SymbolInfo> = new Map();
    public modules: Map<number, ModuleInfo> = new Map();
    public libraries: Map<number, LibraryInfo> = new Map();

    // New C Debug Info
    public scopes: Map<number, ScopeInfo> = new Map();
    public csymbols: Map<number, CSymbolInfo> = new Map();
    public types: Map<number, TypeInfo> = new Map();

    // Derived: Scope hierarchy and Span->Scope map
    public spanToScopes: Map<number, number[]> = new Map(); // Span ID -> List of Scope IDs (leaf first)

    // Derived map: fileId -> isLibrary
    public fileIsLibrary: Map<number, boolean> = new Map();

    // Optimized lookups
    public spanTree = new IntervalTree<SpanInfo>();
    private spanToLines: Map<number, LineInfo[]> = new Map();

    private addressToSymbol: Map<number, SymbolInfo> = new Map();

    public addSymbol(sym: SymbolInfo) {
        if (sym.addr !== undefined) {
            const existing = this.addressToSymbol.get(sym.addr);
            if (!existing) {
                this.addressToSymbol.set(sym.addr, sym);
            } else {
                // Heuristic: Prefer 'lab' over 'equ'
                if (existing.type === 'equ' && sym.type === 'lab') {
                    this.addressToSymbol.set(sym.addr, sym);
                }
                // Heuristic: Prefer symbol with segment ID (implies memory location)
                else if (existing.segId === undefined && sym.segId !== undefined) {
                    this.addressToSymbol.set(sym.addr, sym);
                }
            }
        }
    }

    public getSymbolForAddress(addr: number): SymbolInfo | undefined {
        return this.addressToSymbol.get(addr);
    }

    // Return the "best" line for an address (backward compatibility)
    public getLineForAddress(addr: number): LineInfo | undefined {
        const lines = this.getAllLinesForAddress(addr);
        if (!lines || lines.length === 0) return undefined;

        // Heuristic: Prefer type=1 (C/High-level)
        const best = lines.find(l => l.type === 1);
        return best || lines[0];
    }

    public getAllLinesForAddress(addr: number): LineInfo[] {
        // Find spans containing addr
        const candidateSpans = this.spanTree.search(addr, addr);

        // Heuristic: Sort candidates by size (ascending) to prefer smaller (more specific) spans.
        candidateSpans.sort((a, b) => a.size - b.size);

        const results: LineInfo[] = [];
        for (const span of candidateSpans) {
            const lines = this.spanToLines.get(span.id);
            if (lines) {
                results.push(...lines);
            }
        }
        return results;
    }

    public addLineMapping(spanId: number, lineInfo: LineInfo) {
        let list = this.spanToLines.get(spanId);
        if (!list) {
            list = [];
            this.spanToLines.set(spanId, list);
        }
        // Avoid duplicates
        if (!list.some(existing => existing.fileId === lineInfo.fileId && existing.line === lineInfo.line)) {
            list.push(lineInfo);
        }
    }

    public getScopesForAddress(addr: number): ScopeInfo[] {
        const candidateSpans = this.spanTree.search(addr, addr);
        // Find specific span (smallest)
        if (candidateSpans.length === 0) return [];

        // Sort by size ascending (smallest first) - assume smallest span is most specific
        candidateSpans.sort((a, b) => a.size - b.size);

        // Try to find scopes attached to spans, starting from most specific
        for (const span of candidateSpans) {
            const scopeIds = this.spanToScopes.get(span.id);
            if (scopeIds && scopeIds.length > 0) {
                // Resolve scope objects
                const scopes: ScopeInfo[] = [];
                for (const sid of scopeIds) {
                    const scope = this.scopes.get(sid);
                    if (scope) scopes.push(scope);
                }
                return scopes;
            }
        }

        return [];
    }

    public getVariablesForScope(scopeId: number): CSymbolInfo[] {
        const vars: CSymbolInfo[] = [];
        for (const sym of this.csymbols.values()) {
            if (sym.scopeId === scopeId) {
                vars.push(sym);
            }
        }
        return vars;
    }

    public finalize() {
        // Build fileIsLibrary map
        for (const mod of this.modules.values()) {
            if (mod.libId !== undefined || mod.lib) {
                this.fileIsLibrary.set(mod.fileId, true);
            }
        }

        // Build interval tree
        for (const span of this.spans.values()) {
            const seg = this.segments.get(span.segId);
            if (seg) {
                span.absStart = seg.start + span.start;
                this.spanTree.insert(span.absStart, span.absStart + span.size - 1, span);
            }
        }

        // Map spans to scopes
        for (const scope of this.scopes.values()) {
            for (const sid of scope.spans) {
                let list = this.spanToScopes.get(sid);
                if (!list) {
                    list = [];
                    this.spanToScopes.set(sid, list);
                }
                list.push(scope.id);
            }
        }
    }
}

export class DebugInfoParser {
    public static parse(content: string): DebugInfo {
        const info = new DebugInfo();
        const lines = content.split(/\r?\n/);

        // Store items to process after first pass
        const rawLines: { fileId: number, lineNum: number, spanIds?: number[], type?: number }[] = [];

        for (const lineStr of lines) {
            if (!lineStr.trim()) continue;

            const match = lineStr.match(/^(\S+)\s+(.*)$/);
            if (!match) continue;

            const type = match[1];
            const remainder = match[2];
            const props = this.parseProps(remainder);

            switch (type) {
                case 'file':
                    if (props.has('id') && props.has('name')) {
                        const id = parseInt(props.get('id')!);
                        info.files.set(id, {
                            id,
                            name: props.get('name')!.replace(/"/g, ''),
                            size: props.has('size') ? parseInt(props.get('size')!) : undefined
                        });
                    }
                    break;
                case 'seg':
                    if (props.has('id') && props.has('start')) {
                        const id = parseInt(props.get('id')!);
                        info.segments.set(id, {
                            id,
                            name: props.get('name')!.replace(/"/g, ''),
                            start: this.parseNumber(props.get('start')!),
                            size: this.parseNumber(props.get('size')!)
                        });
                    }
                    break;
                case 'span':
                    if (props.has('id') && props.has('start') && props.has('size')) {
                        const id = parseInt(props.get('id')!);
                        info.spans.set(id, {
                            id,
                            segId: parseInt(props.get('seg') || '0'),
                            start: this.parseNumber(props.get('start')!),
                            size: this.parseNumber(props.get('size')!)
                        });
                    }
                    break;
                case 'sym':
                    if (props.has('name')) {
                        const name = props.get('name')!.replace(/"/g, '');
                        // val is decimal or hex
                        let val = 0;
                        if (props.has('val')) val = this.parseNumber(props.get('val')!);
                        else if (props.has('addr')) val = this.parseNumber(props.get('addr')!);

                        const id = props.has('id') ? parseInt(props.get('id')!) : -1;
                        const type = props.get('type');
                        const segId = props.has('seg') ? parseInt(props.get('seg')!) : undefined;
                        const size = props.has('size') ? this.parseNumber(props.get('size')!) : undefined;
                        const sym: SymbolInfo = { id, name, addr: val, type, segId, size };
                        if (id !== -1) info.symbols.set(id, sym);
                        info.symbolsByName.set(name, sym);
                        info.addSymbol(sym);
                    }
                    break;
                case 'mod':
                    if (props.has('id') && props.has('name') && props.has('file')) {
                        const id = parseInt(props.get('id')!);
                        const name = props.get('name')!.replace(/"/g, '');
                        const fileId = parseInt(props.get('file')!);
                        const libId = props.has('lib') ? parseInt(props.get('lib')!) : undefined;
                        // Sometimes lib=... means it is in a lib? Or checks for existence?
                        info.modules.set(id, { id, name, fileId, libId });
                    }
                    break;
                case 'lib':
                    if (props.has('id')) {
                        const id = parseInt(props.get('id')!);
                        const name = props.has('name') ? props.get('name')!.replace(/"/g, '') : '';
                        info.libraries.set(id, { id, name });
                    }
                    break;
                case 'line':
                    if (props.has('file') && props.has('line')) {
                        const fileId = parseInt(props.get('file')!);
                        const lineNum = parseInt(props.get('line')!);
                        const type = props.has('type') ? parseInt(props.get('type')!) : undefined;
                        const spanIdStr = props.get('span');
                        let spanIds: number[] | undefined;
                        if (spanIdStr) {
                            spanIds = spanIdStr.split('+').map(s => parseInt(s));
                        }

                        rawLines.push({ fileId, lineNum, spanIds, type });
                    }
                    break;
                case 'scope':
                    if (props.has('id') && props.has('name')) {
                        const id = parseInt(props.get('id')!);
                        const name = props.get('name')!.replace(/"/g, '');
                        const symId = props.has('sym') ? parseInt(props.get('sym')!) : undefined;
                        const parentId = props.has('parent') ? parseInt(props.get('parent')!) : undefined;
                        const type = props.has('type') ? parseInt(props.get('type')!) : undefined;
                        const size = props.has('size') ? parseInt(props.get('size')!) : undefined;

                        const spanStr = props.get('span');
                        const spans = spanStr ? spanStr.split('+').map(s => parseInt(s)) : [];

                        info.scopes.set(id, { id, name, symId, parentId, type, size, spans });
                    }
                    break;
                case 'csym':
                    if (props.has('id') && props.has('name')) {
                        const id = parseInt(props.get('id')!);
                        const name = props.get('name')!.replace(/"/g, '');
                        const scopeId = parseInt(props.get('scope')!);
                        const typeId = parseInt(props.get('type')!);
                        const sc = props.get('sc')!;
                        const offset = props.has('offs') ? this.parseNumber(props.get('offs')!) : 0;
                        const symId = props.has('sym') ? parseInt(props.get('sym')!) : undefined;

                        info.csymbols.set(id, { id, name, scopeId, typeId, sc, offset, symId });
                    }
                    break;
                case 'type':
                    if (props.has('id') && props.has('val')) {
                        const id = parseInt(props.get('id')!);
                        const val = props.get('val')!.replace(/"/g, '');
                        // Store raw val for now
                        info.types.set(id, { id, size: 0, kind: val });
                    } else if (props.has('id') && props.has('size')) {
                        const id = parseInt(props.get('id')!);
                        const size = this.parseNumber(props.get('size')!);
                        const baseId = props.has('base') ? parseInt(props.get('base')!) : undefined;
                        info.types.set(id, { id, size, baseId });
                    }
                    break;
            }
        }

        // Second pass: Process lines now that spans are loaded
        for (const l of rawLines) {
            if (l.spanIds && l.spanIds.length > 0) {
                for (const sid of l.spanIds) {
                    const lInfo: LineInfo = { fileId: l.fileId, line: l.lineNum, spanId: sid, type: l.type };
                    info.lines.push(lInfo);
                    info.addLineMapping(sid, lInfo);
                }
            } else {
                // Line without span? Just record it.
                info.lines.push({ fileId: l.fileId, line: l.lineNum, type: l.type, spanId: undefined });
            }
        }

        info.finalize();
        return info;
    }

    private static parseProps(str: string): Map<string, string> {
        const props = new Map<string, string>();
        let keyStart = 0;
        let inValue = false;
        let valStart = 0;
        let inQuote = false;

        for (let i = 0; i <= str.length; i++) {
            const char = str[i];

            if (!inValue) {
                if (char === '=') {
                    inValue = true;
                    valStart = i + 1;
                }
            } else {
                if (char === '"') {
                    inQuote = !inQuote;
                } else if ((char === ',' && !inQuote) || i === str.length) {
                    const key = str.substring(keyStart, valStart - 1).trim();
                    const val = str.substring(valStart, i);
                    props.set(key, val);
                    inValue = false;
                    keyStart = i + 1;
                }
            }
        }
        return props;
    }

    private static parseNumber(str: string): number {
        if (str.startsWith('0x')) return parseInt(str, 16);
        return parseInt(str);
    }

    public static resolveDebugFile(programPath: string): string | undefined {
        // (a) try the executable name plus '.dbg'
        // (b) try removing any extension (but only if present) and replacing with '.dbg'

        const path = require('path');
        const fs = require('fs');

        const candidates: string[] = [];
        candidates.push(programPath + '.dbg');

        const ext = path.extname(programPath);
        if (ext) {
            candidates.push(programPath.slice(0, -ext.length) + '.dbg');
        }

        for (const c of candidates) {
            if (fs.existsSync(c)) {
                return c;
            }
        }

        return undefined;
    }
}

export class VariableResolver {
    public static resolveValue(mem: { read(addr: number): number, readWord(addr: number): number }, sp: number, sym: CSymbolInfo, typeInfo?: TypeInfo): { value: number, str: string, type: string } {
        const addr = (sp + sym.offset) & 0xFFFF;
        let size = 2; // Default to int/ptr
        let typeName = "int";

        if (typeInfo) {
            // Very basic heuristic until we have full type parsing
            if (typeInfo.kind) {
                // val="00" -> void/int?
                // val starting with 80...
                typeName = `type_${typeInfo.kind}`;
            }
            if (typeInfo.size > 0) {
                size = typeInfo.size;
            }
        }

        // TODO: Map 'val' code to size if size is 0
        // e.g. check known patterns. 
        // For now, default to 2.

        let val = 0;
        let valStr = "";

        if (size === 1) {
            val = mem.read(addr);
            valStr = `$${val.toString(16).toUpperCase().padStart(2, '0')} (${val})`;
            typeName = "char"; // Guess
        } else if (size === 2) {
            val = mem.readWord(addr);
            valStr = `$${val.toString(16).toUpperCase().padStart(4, '0')} (${val})`;
        } else {
            // larger types
            valStr = `[${size} bytes] @ $${addr.toString(16)}`;
        }

        return { value: val, str: valStr, type: typeName };
    }
}
