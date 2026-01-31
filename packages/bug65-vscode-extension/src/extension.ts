import * as vscode from 'vscode';
import { hello } from 'bug65-core';
import { Bug65DebugSession, Bug65Terminal } from './bug65_debug';

console.log('[bug65] Extension module loading...');

export function activate(context: vscode.ExtensionContext) {
    try {
        console.log('[bug65] Activating extension "bug65-debugger"...');
        console.log(hello());

        let disposable = vscode.commands.registerCommand('bug65-debugger.helloWorld', () => {
            vscode.window.showInformationMessage('Hello World from bug65-debugger!');
        });

        context.subscriptions.push(disposable);

        const factory = new Bug65DebugAdapterDescriptorFactory();
        context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('bug65', factory));
        console.log('[bug65] Debug Adapter Descriptor Factory registered.');

        const provider = new Bug65ConfigurationProvider();
        context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('bug65', provider));
        console.log('[bug65] Debug Configuration Provider registered.');
    } catch (err) {
        console.error('[bug65] Failed to activate extension:', err);
    }
}

class Bug65DebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
    
    // Map session name -> Terminal pair
    private terminalRegistry = new Map<string, { terminal: vscode.Terminal, pty: Bug65Terminal }>();

    createDebugAdapterDescriptor(session: vscode.DebugSession, executable: vscode.DebugAdapterExecutable | undefined): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        console.log(`[bug65] createDebugAdapterDescriptor called for session: ${session.name}`);

        let termEntry = this.terminalRegistry.get(session.name);

        // Check availability and closed status
        if (termEntry) {
             if (termEntry.terminal.exitStatus !== undefined) {
                 // Terminated (exit code set)
                 termEntry = undefined;
             }
        }

        if (!termEntry) {
            const pty = new Bug65Terminal();
            const terminal = vscode.window.createTerminal({
                name: `bug65: ${session.name}`,
                pty: pty,
                iconPath: new vscode.ThemeIcon('debug-console')
            });
            termEntry = { terminal, pty };
            this.terminalRegistry.set(session.name, termEntry);
            
            // Clean up registry when terminal is closed by user
            // This is a backup; exitStatus check above is the primary way for reuse logic.
            // But we don't want the map to grow forever.
            // Note: We can't easily hook onDidCloseTerminal for *specific* terminal here without global listener.
            // The global listener approach can be cleaner, but we'll lazy-clean in create for now.
        }

        termEntry.terminal.show(true);

        // Always use inline debug adapter for development/debugging simplicity
        return new vscode.DebugAdapterInlineImplementation(new Bug65DebugSession(undefined, undefined, session.name, termEntry.pty));
    }
}

class Bug65ConfigurationProvider implements vscode.DebugConfigurationProvider {

    /**
     * Massage a debug configuration just before a debug session is being launched,
     * e.g. add all missing attributes to the debug configuration.
     */
    resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration, token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration> {

        // if launch.json is missing or empty
        if (!config.type && !config.request && !config.name) {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'c') {
                config.type = 'bug65';
                config.name = 'Launch';
                config.request = 'launch';
                config.program = '${file}';
            }
        }

        if (!config.program) {
            return vscode.window.showInformationMessage("Cannot find a program to debug").then(_ => {
                return undefined;	// abort launch
            });
        }

        return config;
    }

    /**
     * Contextual add configuration menu
     */
    provideDebugConfigurations(folder: vscode.WorkspaceFolder | undefined, token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration[]> {
        return [
            {
                name: "Run bug65 Program",
                type: "bug65",
                request: "launch",
                program: "${workspaceFolder}/program.bin",
                cwd: "${workspaceFolder}"
            }
        ];
    }
}

export function deactivate() { }
