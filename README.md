# bug65 (6502 Simulator & Debugger)

**bug65** is a Visual Studio Code extension and core library that acts as a simulator and debugger for the 6502/65C02 microprocessor. It is designed to integrate seamlessly with the [cc65](https://cc65.github.io/) tool suite, providing a modern alternative to `sim65` for debugging unit tests and programs directly within VS Code.

## Features

*   **Core Simulator (`bug65-core`)**:
    *   Full 6502/65C02 instruction set emulation.
    *   Paravirtualization hooks compatible with `sim65` (e.g., exit trap at `$FFF9`).
    *   Cycle-accurate simulation (approximate).
    *   Support for parsing `cc65` debug information (`.dbg` files).

*   **VS Code Extension (`vscode-bug65-debugger`)**:
    *   Implementation of the Debug Adapter Protocol (DAP).
    *   Launch configuration support for binary programs.
    *   View CPU registers (A, X, Y, PC, SP, Status).
    *   Stepping, continue, and break functionality.

## Prerequisites

*   [Node.js](https://nodejs.org/) (version 16 or higher)
*   [Visual Studio Code](https://code.visualstudio.com/)

## Building the Project

This project is structured as a monorepo using npm workspaces.

1.  **Clone the repository**:
    ```bash
    git clone <repository_url>
    cd bug65
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

3.  **Compile the project**:
    ```bash
    npm run compile
    ```

## Usage

1.  Open the `bug65` folder in VS Code.
2.  Press **F5** to run the extension in the Extension Development Host.
3.  In the new window, open a folder containing your `cc65` compiled program (raw binary).
4.  Create a `.vscode/launch.json` configuration:
    ```json
    {
        "version": "0.2.0",
        "configurations": [
            {
                "type": "bug65",
                "request": "launch",
                "name": "Debug 6502 Binary",
                "program": "${workspaceFolder}/files/program.bin",
                "stopOnEntry": true
            }
        ]
    }
    ```
5.  Start debugging!

## Testing

Run unit tests for the simulator core:

```bash
npm test
```
