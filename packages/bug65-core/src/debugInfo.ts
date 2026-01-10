
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

        // Map line definitions to process after spans are loaded
        const pendingLines: { id: number, file: number, line: number, type?: number, spans?: number[] }[] = [];

        // cc65 dbg lines look like: "type key=val,key=val..."

        for (const lineStr of lines) {
            if (!lineStr.trim()) continue;

            // Split type and keypairs
            const firstSpace = lineStr.indexOf(' ');
            if (firstSpace === -1) continue;

            const type = lineStr.substring(0, firstSpace);
            const remainder = lineStr.substring(firstSpace + 1);

            const props = this.parseProps(remainder);

            switch (type) {
                case 'file':
                    if (props.has('id') && props.has('name')) {
                        const id = parseInt(props.get('id')!);
                        info.files.set(id, {
                            id,
                            name: props.get('name')!.replace(/"/g, ''), // strip quotes
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
                    if (props.has('name') && props.has('val')) { // simple label
                        // or 'addr' in dbg?
                        const name = props.get('name')!.replace(/"/g, '');
                        const val = this.parseNumber(props.get('val')!);
                        // Add to symbols?
                        // Full dbg sym format: sym id=...,name=...,addr=...,size=...
                        const addr = props.has('addr') ? this.parseNumber(props.get('addr')!) : val;
                        const id = props.has('id') ? parseInt(props.get('id')!) : -1;

                        const sym: SymbolInfo = { id, name, addr };
                        if (id !== -1) info.symbols.set(id, sym);
                        info.symbolsByName.set(name, sym);
                    }
                    break;
                case 'line':
                    // format: line id=..,file=..,line=..,type=..,span=.. (repeating spans?)
                    // or: line id=0,file=0,line=10,span=5
                    if (props.has('file') && props.has('line')) {
                        const fileId = parseInt(props.get('file')!);
                        const lineNum = parseInt(props.get('line')!);
                        const spanIdStr = props.get('span');

                        // Wait, 'line' usually lists spans associated with it.
                        // Or 'span' lists lines?
                        // Let's assume simple 1:1 for now if 'span' attribute exists.

                        if (spanIdStr) {
                            const spanId = parseInt(spanIdStr);
                            const lInfo: LineInfo = { fileId, line: lineNum, spanId };
                            info.lines.push(lInfo);
                            info.addLineMapping(spanId, lInfo);
                        }
                    }
                    break;
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

        // "key=val,key=val"
        // Need to handle commas inside quotes

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
