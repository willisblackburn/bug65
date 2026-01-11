
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
}

export class DebugInfo {
    public files: Map<number, SourceFile> = new Map();
    public lines: LineInfo[] = []; // List of all line mappings
    public spans: Map<number, SpanInfo> = new Map();
    public symbols: Map<number, SymbolInfo> = new Map();
    public symbolsByName: Map<string, SymbolInfo> = new Map();
    private addressToLine: Map<number, LineInfo> = new Map();
    private addressToSymbol: Map<number, SymbolInfo> = new Map();

    public addSymbol(sym: SymbolInfo) {
        if (sym.addr !== undefined) {
            // Prefer exact matches. If multiple, maybe keep the one that is not 'export' or has a better name?
            // For now just last one wins or first one?
            // Often multiple labels for same address.
            if (!this.addressToSymbol.has(sym.addr)) {
                this.addressToSymbol.set(sym.addr, sym);
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
            for (let i = 0; i < span.size; i++) {
                this.addressToLine.set(span.start + i, lineInfo);
            }
        }
    }
}

export class DebugInfoParser {
    public static parse(content: string): DebugInfo {
        const info = new DebugInfo();
        const lines = content.split(/\r?\n/);

        // Store items to process after first pass
        const rawLines: { fileId: number, lineNum: number, spanId?: number }[] = [];

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
                        const sym: SymbolInfo = { id, name, addr: val, type };
                        if (id !== -1) info.symbols.set(id, sym);
                        info.symbolsByName.set(name, sym);
                        info.addSymbol(sym);
                    }
                    break;
                case 'line':
                    if (props.has('file') && props.has('line')) {
                        const fileId = parseInt(props.get('file')!);
                        const lineNum = parseInt(props.get('line')!);
                        const spanIdStr = props.get('span');
                        let spanId: number | undefined;
                        if (spanIdStr) {
                            const plusIdx = spanIdStr.indexOf('+');
                            if (plusIdx !== -1) spanId = parseInt(spanIdStr.substring(0, plusIdx));
                            else spanId = parseInt(spanIdStr);
                        }

                        rawLines.push({ fileId, lineNum, spanId });
                    }
                    break;
            }
        }

        // Second pass: Process lines now that spans are loaded
        for (const l of rawLines) {
            const lInfo: LineInfo = { fileId: l.fileId, line: l.lineNum, spanId: l.spanId };
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
}
