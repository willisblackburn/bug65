
import { Memory } from './memory';
import { CpuType } from './cpu_interface';

export interface ProgramLoadResult {
    loadAddr: number;
    resetAddr: number;
    spAddr: number;
    entryPoint: number; // usually resetAddr
    cpuType: CpuType;
}

export namespace ProgramLoader {
    export function load(memory: Memory, data: Buffer | Uint8Array, options?: { loadAddr?: number }): ProgramLoadResult {
        // Check for sim65 header
        // Header: "sim65" (5 bytes)
        // Version: 1 byte (offset 5)
        // CPU: 1 byte (offset 6)
        // SP Addr: 1 byte (offset 7)
        // Load Addr: 2 bytes (offset 8)
        // Reset Addr: 2 bytes (offset 10)

        const headerStr = data.subarray(0, 5).toString();
        let loadAddr = options?.loadAddr ?? 0x0200;
        let resetAddr = 0x0200;
        let spAddr = 0x00;
        let offset = 0;
        let cpuType: CpuType = '6502';

        // Use Buffer vs Uint8Array handling
        // slice works on both, toString might vary.
        // Let's rely on string comparison of first 5 bytes.
        let isSim65 = true;
        const magic = [0x73, 0x69, 0x6D, 0x36, 0x35]; // "sim65"
        for (let i = 0; i < 5; i++) {
            if (data[i] !== magic[i]) {
                isSim65 = false;
                break;
            }
        }

        if (isSim65) {
            offset = 12;
            spAddr = data[7];
            const loadLow = data[8];
            const loadHigh = data[9];
            const fileLoadAddr = (loadHigh << 8) | loadLow;

            const resetLow = data[10];
            const resetHigh = data[11];
            const fileResetAddr = (resetHigh << 8) | resetLow;

            if (options?.loadAddr === undefined) {
                loadAddr = fileLoadAddr;
                resetAddr = fileResetAddr;
            } else {
                resetAddr = loadAddr;
            }

            cpuType = data[6] === 1 ? '65C02' : '6502';
        } else {
            // Raw binary
            // Default resetAddr to loadAddr if not specified? 
            // Original logic: resetAddr = 0x0200 default.
            // But if user provides loadAddr, maybe resetAddr should be loadAddr?
            // Existing CLI logic: if user specified loadAddr, resetAddr = loadAddr.
            if (options?.loadAddr !== undefined) {
                resetAddr = options.loadAddr;
            }
        }

        const programData = data.subarray(offset);

        // Load into memory
        if (memory) {
            // Need to convert Uint8Array/Buffer to Uint8Array safely
            const bytes = new Uint8Array(programData);
            memory.load(loadAddr, bytes);

            // Set Reset Vector
            memory.writeWord(0xFFFC, resetAddr);
        }

        return {
            loadAddr,
            resetAddr,
            spAddr,
            entryPoint: resetAddr,
            cpuType
        };
    }
}
