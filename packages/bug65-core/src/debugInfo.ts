
import * as fs from 'fs';

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

export class DebugInfo {
    public files: Map<number, SourceFile> = new Map();
    public segments: Map<number, SegmentInfo> = new Map();
    public lines: LineInfo[] = []; // List of all line mappings
    public spans: Map<number, SpanInfo> = new Map();
    public symbols: Map<number, SymbolInfo> = new Map();
    public symbolsByName: Map<string, SymbolInfo> = new Map();
    private addressToLine: Map<number, LineInfo> = new Map();
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

    // Mapping from address to nearest line info
    // Since lines map to spans (ranges), we can lookup address in spans.

    public getLineForAddress(addr: number): LineInfo | undefined {
        // Simple search (can be optimized with interval tree or sorted array)
        // Find span containing addr
        for (const span of this.spans.values()) {
            if (addr >= span.start && addr < (span.start + span.size)) {
                // Find line referencing this span?
                // Actually 'line' entries usually point to 'span' or range?
                // Or 'line' entries have 'file' and 'line' and direct range?
                // The format usually links line -> span or line -> address range?
                // Wait, searches say: "Line information ... Connects specific lines ... to ranges".
                // Typical format: line id=..., file=..., line=..., span=... ??
                // Let's assume line has direct file/line and maybe range or links to a span.
                // If line links to span, we search spans.

                // Reverse lookup: find line that points to this span
                // This is checking ALL lines, slow. 
            }
        }

        // Let's assume we parse "line" entries and build an index.
        // If "line" has "span" or "type=2,val=..."

        return this.addressToLine.get(addr);
    }

    public addLineMapping(spanId: number, lineInfo: LineInfo) {
        const span = this.spans.get(spanId);
        if (span) {
            const segStart = this.segments.get(span.segId)?.start || 0;
            for (let i = 0; i < span.size; i++) {
                const addr = segStart + span.start + i;
                const existing = this.addressToLine.get(addr);

                // Heuristic: Prefer type=1 (C/High-level) over undefined (ASM)
                if (!existing || (existing.type !== 1 && lineInfo.type === 1)) {
                    this.addressToLine.set(addr, lineInfo);
                } else if (!existing && lineInfo.type !== 1) {
                    this.addressToLine.set(addr, lineInfo);
                }
                // If existing is 1 and new is not 1, keep existing.
                // If both are same type, overwrite? (Standard behavior)
                else if (existing && existing.type === lineInfo.type) {
                    this.addressToLine.set(addr, lineInfo);
                }
            }
        }
    }
}

export class DebugInfoParser {
    public static parse(content: string): DebugInfo {
        const info = new DebugInfo();
        const lines = content.split(/\r?\n/);

        // Store items to process after first pass
        const rawLines: { fileId: number, lineNum: number, spanId?: number, type?: number }[] = [];

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
                        const sym: SymbolInfo = { id, name, addr: val, type, segId };
                        if (id !== -1) info.symbols.set(id, sym);
                        info.symbolsByName.set(name, sym);
                        info.addSymbol(sym);
                    }
                    break;
                case 'line':
                    if (props.has('file') && props.has('line')) {
                        const fileId = parseInt(props.get('file')!);
                        const lineNum = parseInt(props.get('line')!);
                        const type = props.has('type') ? parseInt(props.get('type')!) : undefined;
                        const spanIdStr = props.get('span');
                        let spanId: number | undefined;
                        if (spanIdStr) {
                            const plusIdx = spanIdStr.indexOf('+');
                            if (plusIdx !== -1) spanId = parseInt(spanIdStr.substring(0, plusIdx));
                            else spanId = parseInt(spanIdStr);
                        }

                        rawLines.push({ fileId, lineNum, spanId, type });
                    }
                    break;
            }
        }

        // Second pass: Process lines now that spans are loaded
        for (const l of rawLines) {
            const lInfo: LineInfo = { fileId: l.fileId, line: l.lineNum, spanId: l.spanId, type: l.type };
            info.lines.push(lInfo);
            if (l.spanId !== undefined) {
                info.addLineMapping(l.spanId, lInfo);
            }
        }

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
