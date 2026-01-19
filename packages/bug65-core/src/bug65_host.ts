import { Cpu6502 } from './cpu_6502';
import { Cpu } from './cpu_interface';
import { Memory } from './memory';
import * as fs from 'fs';
import { constants } from 'fs';

export interface IOStrategy {
    read(count: number): Uint8Array;
    write(data: Uint8Array): number;
    lseek(offset: number, whence: number): number;
    close(): number;
}

class ConsoleStrategy implements IOStrategy {
    public inputBuffer: number[] = [];

    constructor(private onWrite?: (val: number) => void) { }

    read(count: number): Uint8Array {
        if (this.inputBuffer.length === 0) {
            return new Uint8Array(0);
        }
        const len = Math.min(count, this.inputBuffer.length);
        const res = new Uint8Array(this.inputBuffer.slice(0, len));
        this.inputBuffer = this.inputBuffer.slice(len);
        return res;
    }

    addInput(data: Uint8Array) {
        for (let i = 0; i < data.length; i++) {
            this.inputBuffer.push(data[i]);
        }
    }

    write(data: Uint8Array): number {
        if (this.onWrite) {
            data.forEach(c => this.onWrite!(c));
        }
        return data.length;
    }

    lseek(offset: number, whence: number): number {
        return -1; // Not seekable
    }

    close(): number {
        return 0;
    }
}

class FileStrategy implements IOStrategy {
    constructor(private fd: number) { }

    read(count: number): Uint8Array {
        const buf = new Uint8Array(count);
        const bytesRead = fs.readSync(this.fd, buf, 0, count, null);
        return buf.subarray(0, bytesRead);
    }

    write(data: Uint8Array): number {
        return fs.writeSync(this.fd, data);
    }

    lseek(offset: number, whence: number): number {
        // sim65 maps SEEK_CUR(0), SEEK_END(1), SEEK_SET(2)
        // fs.constants? No, fs.read/writeSync uses position.
        // fs.writeSync(fd, buffer, offset, length, position)
        // But we need explicit seek to active position?
        // Node fs doesn't expose lseek directly except via position in read/write
        // BUT we can use separate postion tracking? Or 'fs.readSync' with null position updates current position?
        // Yes, null position updates current file position.
        // Wait, lseek(fd, offset, whence) is strictly for setting position.
        // Node.js doesn't have lseek.
        // We might only support this for opened files?
        // Actually, typically we don't need lseek for basic I/O.
        // But cc65 might use it.
        // Hack: use fs.readSync/writeSync with null to use kernel pointer.
        // BUT explicit seek?
        // We can't do explicit lseek easily in pure Node 'fs' without wrapping native?
        // Wait, strictly speaking, Node 'fs' treats FDs as stateful if position is null.
        // But how to *change* that state without RW?
        // We can try to use a dummy read? No.
        // Actually, most sim65 use cases are just sequential read/write.
        // If lseek is needed, we might have a problem.
        // Let's stub lseek for now or throw error?
        // User asked to implement it.
        // Actually, maybe we track position manually in FileStrategy?
        // But we don't know initial position if we opened existing file?
        // We opened it ourself.
        // So we can track position.
        return -1;
    }

    close(): number {
        fs.closeSync(this.fd);
        return 0;
    }
}

export class Bug65Host {
    private cpu: Cpu6502;

    private memory: Memory;
    public onExit: ((code: number) => void) | undefined;
    public onWrite: ((val: number) => void) | undefined;

    // New: Event for when the host is waiting for input
    public onWaitForInput: (() => void) | undefined;
    public waitingForInput: boolean = false;

    public commandLineArgs: string[] = ["bug65"];
    private spAddress: number = 0x00; // Default to $00 (cc65 default)

    private fds: Map<number, IOStrategy> = new Map();
    private nextFd: number = 3;

    // sim65 addresses
    private readonly ADDR_LSEEK = 0xFFF1;
    private readonly ADDR_REMOVE = 0xFFF2;
    private readonly ADDR_MAPERRNO = 0xFFF3;
    private readonly ADDR_OPEN = 0xFFF4;
    private readonly ADDR_CLOSE = 0xFFF5;
    private readonly ADDR_READ = 0xFFF6;
    private readonly ADDR_WRITE = 0xFFF7;
    private readonly ADDR_ARGS = 0xFFF8;
    private readonly ADDR_EXIT = 0xFFF9;

    constructor(cpu: Cpu6502, memory: Memory) {
        if (cpu.onTrap) {
            throw new Error("CPU onTrap handler is already set.");
        }
        this.cpu = cpu;
        this.memory = memory;
        this.cpu.onTrap = (pc: number) => this.handleTrap(pc);

        // Standard FDs
        const consoleStrategy = new ConsoleStrategy((val) => {
            if (this.onWrite) this.onWrite(val);
        });
        this.fds.set(0, consoleStrategy); // Stdin
        this.fds.set(1, consoleStrategy); // Stdout
        this.fds.set(2, consoleStrategy); // Stderr
    }

    public writeInput(data: Uint8Array) {
        const stdin = this.fds.get(0);
        if (stdin instanceof ConsoleStrategy) {
            stdin.addInput(data);
        }
    }

    public setSpAddress(addr: number): void {
        this.spAddress = addr;
        console.error(`[Bug65Host] SP ZP Address set to $${addr.toString(16).padStart(2, '0')}`);
    }

    public getSpAddress(): number {
        return this.spAddress;
    }

    private getAX(): number {
        const regs = this.cpu.getRegisters();
        return (regs.X << 8) | regs.A;
    }

    private setAX(val: number): void {
        const regs = this.cpu.getRegisters();
        regs.A = val & 0xFF;
        regs.X = (val >> 8) & 0xFF;
        this.cpu.setRegisters(regs);
    }


    // Push buffer to software stack (sim65 convention, descending stack)
    // Returns the address where data was written (new SP)
    private pushBuffer(data: Uint8Array): number {
        const spZp = this.spAddress;
        let sp = (this.memory.read(spZp + 1) << 8) | this.memory.read(spZp);

        sp = (sp - data.length) & 0xFFFF;

        for (let i = 0; i < data.length; i++) {
            this.memory.write(sp + i, data[i]);
        }

        this.memory.write(spZp, sp & 0xFF);
        this.memory.write(spZp + 1, (sp >> 8) & 0xFF);
        return sp;
    }

    // Pop param from software stack (sim65 convention)
    private popParam(bytes: number): number {
        const spZp = this.spAddress;
        const sp = (this.memory.read(spZp + 1) << 8) | this.memory.read(spZp);

        // Read value
        let val = 0;
        for (let i = 0; i < bytes; i++) {
            val |= (this.memory.read(sp + i) << (i * 8));
        }

        // Increment SP
        const newSp = (sp + bytes) & 0xFFFF;
        this.memory.write(spZp, newSp & 0xFF);
        this.memory.write(spZp + 1, (newSp >> 8) & 0xFF);

        return val;
    }

    private peekParam(bytes: number, offsetBytes: number = 0): number {
        const spZp = this.spAddress;
        let sp = (this.memory.read(spZp + 1) << 8) | this.memory.read(spZp);

        // Sim65 parameters are pushed in order, so latest is at SP.
        // Wait, typical calling convention: push arg1, push arg2.
        // ArgN is at top.
        // popParam pops from top.
        // If we want to peek params in the order popParam receives them...
        // We need to account for previous pops.

        sp = (sp + offsetBytes) & 0xFFFF;

        let val = 0;
        for (let i = 0; i < bytes; i++) {
            val |= (this.memory.read(sp + i) << (i * 8));
        }
        return val;
    }

    private handleTrap(pc: number): boolean {
        if (pc === this.ADDR_EXIT) {
            const exitCode = this.cpu.getRegisters().A;
            if (this.onExit) {
                this.onExit(exitCode);
            }
            return true;
        }

        try {
            switch (pc) {
                case this.ADDR_OPEN: this.pvOpen(); break;
                case this.ADDR_CLOSE: this.pvClose(); break;
                case this.ADDR_READ: return this.pvRead(); // Returns true if blocking
                case this.ADDR_WRITE: this.pvWrite(); break;
                case this.ADDR_LSEEK: this.pvLseek(); break;
                case this.ADDR_REMOVE: this.pvRemove(); break;
                case this.ADDR_MAPERRNO: this.pvMapErrno(); break;
                case this.ADDR_ARGS: this.pvArgs(); break;
                default:
                    // Not handled, return false? Or throw?
                    return false;
            }

        } catch (e) {
            console.error(`[Bug65Host] Trap error at $${pc.toString(16)}:`, e);
            this.setAX(0xFFFF); // Return -1 on error
        }

        return false;
    }

    private pvOpen() {
        // Mode (2), Flags (2), Name (2) -> AX ret
        const mode = this.popParam(2); // Unused for now?
        const flags = this.popParam(2);
        const nameAddr = this.popParam(2);

        // Read filename
        let path = "";
        let ptr = nameAddr;
        while (true) {
            const char = this.memory.read(ptr++);
            if (char === 0) break;
            path += String.fromCharCode(char);
        }

        // Map Flags
        // sim65 maps:
        // 0x01: RDONLY, 0x02: WRONLY, 0x03: RDWR
        // 0x10: CREAT, 0x20: TRUNC, 0x40: APPEND, 0x80: EXCL
        let fsFlags = "";
        const access = flags & 0x03;
        if (access === 0x01) fsFlags = "r"; // O_RDONLY
        else if (access === 0x02) fsFlags = "w"; // O_WRONLY
        else if (access === 0x03) fsFlags = "r+"; // O_RDWR (r+ implies exists?)

        // Fix up node flags logic
        if (flags & 0x10) { // O_CREAT
            if (access === 0x02) fsFlags = "w"; // w creates
            else if (access === 0x03) fsFlags = "w+"; // w+ reads/writes/creates
        }
        if (flags & 0x40) { // O_APPEND
            if (access === 0x02) fsFlags = "a";
            else if (access === 0x03) fsFlags = "a+";
        }

        // Fallback
        if (!fsFlags) fsFlags = "r";

        try {
            const fd = fs.openSync(path, fsFlags);
            const hostFd = this.nextFd++;
            this.fds.set(hostFd, new FileStrategy(fd));
            this.setAX(hostFd);
        } catch (e) {
            this.setAX(0xFFFF); // -1
        }
    }

    private pvClose() {
        const fd = this.getAX();
        const strat = this.fds.get(fd);
        if (strat) {
            const res = strat.close();
            this.fds.delete(fd);
            this.setAX(res);
        } else {
            this.setAX(0xFFFF);
        }
    }

    private pvRead() {
        const count = this.getAX();

        // Peek params instead of popping immediately
        // Layout: [FD (2)] [BufAddr (2)] (Top of stack) -> popped in reverse order in pvRead originally?
        // Original: popParam(2) (bufAddr) -> popParam(2) (fd) ?
        // Wait, original:
        // const bufAddr = this.popParam(2);
        // const fd = this.popParam(2);
        // So bufAddr is at SP, fd is at SP+2.

        const bufAddr = this.peekParam(2, 0);
        const fd = this.peekParam(2, 2);

        // Check if we need to block
        if (fd === 0) { // Stdin
            const strat = this.fds.get(0);
            if (strat instanceof ConsoleStrategy) {
                // If asking for >0 bytes and buffer is empty
                if (count > 0 && strat.read(0).length === 0) {
                    // We check length 0 read? No, read(0) returns empty.
                    // We need to check if buffer is empty.
                    // I need to expose 'hasInput' or use read(0) behavior?
                    // ConsoleStrategy.read doesn't support "peek".
                    // But I modified read() to buffer.
                    // I will trust that if I read 1 byte and get 0, it's empty.
                    // Actually, I can check specific property or method.
                    // Let's rely on simulated read.
                    // Hack: strat.read is consuming. I can't check without consuming.
                    // I should expose `hasInput` on Strategy?
                    // Or casting to ConsoleStrategy.
                }
            }
        }

        // Actually, let's just make ConsoleStrategy expose a way to check.
        // Or simpler: Try to read. If result is 0 length (and we wanted >0), treat as BLOCK?
        // But what if it's EOF?
        // Standard behavior: 
        //  - If blocking mode: wait.
        //  - If non-blocking: return 0 (or -1 with EAGAIN).
        // User wants blocking.
        // So if count > 0 and we get 0 bytes, we BLOCK.

        const strat = this.fds.get(fd);
        if (strat) {

            // Special handling for Console/Blocking strategies
            // We need to know if it's blocking. For now only stdin(0).
            if (fd === 0 && count > 0) {
                // Check available input
                // Cast to ConsoleStrategy to peek buffer length?
                if (strat instanceof ConsoleStrategy) {
                    // @ts-ignore
                    if (strat.inputBuffer.length === 0) {
                        this.waitingForInput = true;
                        if (this.onWaitForInput) this.onWaitForInput();
                        // Return TRUE to stop execution (trap handled, but halt step)
                        // We do NOT pop params. We do NOT advance PC.
                        // Ideally checking this.onTrap return value.
                        // Bug65Host.handleTrap returns boolean.
                        // pvRead doesn't return value in current signature, need to modify flow.
                        return true;
                    }
                }
            }

            // Proceed with read
            // NOW we pop params
            this.popParam(2); // bufAddr
            this.popParam(2); // fd

            try {
                const data = strat.read(count);
                // Write back to memory
                for (let i = 0; i < data.length; i++) {
                    this.memory.write(bufAddr + i, data[i]);
                }
                this.setAX(data.length);
            } catch (e) {
                this.setAX(0xFFFF);
            }
        } else {
            // Bad FD
            this.popParam(2);
            this.popParam(2);
            this.setAX(0xFFFF);
        }
        this.waitingForInput = false;
        return false; // Done, continue execution
    }

    private pvWrite() {
        const count = this.getAX();
        const bufAddr = this.popParam(2);
        const fd = this.popParam(2);

        const strat = this.fds.get(fd);
        if (strat) {
            const buffer = new Uint8Array(count);
            for (let i = 0; i < count; i++) {
                buffer[i] = this.memory.read(bufAddr + i);
            }
            const res = strat.write(buffer);
            this.setAX(res);
        } else {
            this.setAX(0xFFFF);
        }
    }

    private pvLseek() {
        const whence = this.getAX();
        const offset = this.popParam(4); // 32-bit offset
        const fd = this.popParam(2);

        const strat = this.fds.get(fd);
        if (strat) {
            const res = strat.lseek(offset, whence);
            this.setAX(res); // Return result (position?)
        } else {
            this.setAX(0xFFFF);
        }
    }

    private pvRemove() {
        const nameAddr = this.getAX();
        let path = "";
        let ptr = nameAddr;
        while (true) {
            const char = this.memory.read(ptr++);
            if (char === 0) break;
            path += String.fromCharCode(char);
        }

        try {
            fs.unlinkSync(path);
            this.setAX(0);
        } catch (e) {
            this.setAX(0xFFFF);
        }
    }

    private pvMapErrno() {
        // Trivial implementation: always return 0 (no error) for now
        this.setAX(0);
    }

    private pvArgs() {
        const argvPtrAddr = this.getAX(); // Address of __argv variable
        const args = this.commandLineArgs;
        const argc = args.length;

        // 1. Push strings
        const stringAddrs: number[] = [];
        for (const arg of args) {
            const bytes = new Uint8Array(arg.length + 1);
            for (let i = 0; i < arg.length; i++) {
                bytes[i] = arg.charCodeAt(i);
            }
            bytes[arg.length] = 0; // Null terminator
            stringAddrs.push(this.pushBuffer(bytes));
        }

        // 2. Push pointers (argv array)
        // Push NULL first (argv[argc])
        this.pushBuffer(new Uint8Array([0, 0]));

        // Push in reverse order so argv[0] is at lowest address (top of stack)
        for (let i = argc - 1; i >= 0; i--) {
            const addr = stringAddrs[i];
            this.pushBuffer(new Uint8Array([addr & 0xFF, (addr >> 8) & 0xFF]));
        }

        // Current SP is argv
        const spZp = this.spAddress;
        const argvAddr = (this.memory.read(spZp + 1) << 8) | this.memory.read(spZp);

        // 3. Write argv to __argv
        this.memory.write(argvPtrAddr, argvAddr & 0xFF);
        this.memory.write(argvPtrAddr + 1, (argvAddr >> 8) & 0xFF);

        // 4. Return argc
        this.setAX(argc);
    }
}
