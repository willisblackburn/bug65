export interface IMemory {
    read(address: number): number;
    write(address: number, value: number): void;
    load(address: number, data: Uint8Array): void;
    readWord(address: number): number;
    writeWord(address: number, value: number): void;
}

export class Memory implements IMemory {
    private data: Uint8Array;

    constructor(size: number = 65536) {
        this.data = new Uint8Array(size);
    }

    read(address: number): number {
        return this.data[address & 0xFFFF];
    }

    write(address: number, value: number): void {
        this.data[address & 0xFFFF] = value & 0xFF;
    }

    load(address: number, data: Uint8Array): void {
        for (let i = 0; i < data.length; i++) {
            this.data[(address + i) & 0xFFFF] = data[i];
        }
    }

    readWord(address: number): number {
        const low = this.read(address);
        const high = this.read(address + 1);
        return (high << 8) | low;
    }

    writeWord(address: number, value: number): void {
        this.write(address, value & 0xFF);
        this.write(address + 1, (value >> 8) & 0xFF);
    }
}
