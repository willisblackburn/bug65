import * as vscode from 'vscode';
import { hello } from 'bug65-core';
import { Bug65DebugSession } from './bug65_debug';

console.log('[bug65] Extension module loading...');

export function activate(context: vscode.ExtensionContext) {
    try {
        console.log('[bug65] Activating extension "bug65-debugger"...');
        console.log(hello());

        let disposable = vscode.commands.registerCommand('bug65-debugger.helloWorld', () => {
            vscode.window.showInformationMessage('Hello World from bug65-vscode-debugger!');
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
    createDebugAdapterDescriptor(session: vscode.DebugSession, executable: vscode.DebugAdapterExecutable | undefined): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        console.log('[bug65] createDebugAdapterDescriptor called.');
        // Always use inline debug adapter for development/debugging simplicity
        return new vscode.DebugAdapterInlineImplementation(new Bug65DebugSession());
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
