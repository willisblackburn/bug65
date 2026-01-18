
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

export class DebugInfo {
    public files: Map<number, SourceFile> = new Map();
    public segments: Map<number, SegmentInfo> = new Map();
    public lines: LineInfo[] = []; // List of all line mappings
    public spans: Map<number, SpanInfo> = new Map();
    public symbols: Map<number, SymbolInfo> = new Map();
    public symbolsByName: Map<string, SymbolInfo> = new Map();
    public modules: Map<number, ModuleInfo> = new Map();
    public libraries: Map<number, LibraryInfo> = new Map();



    // Derived map: fileId -> isLibrary

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
