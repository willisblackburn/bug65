import * as vscode from 'vscode';
import { hello } from 'bug65-core';
import { Bug65DebugSession } from './bug65Debug';

console.log('[Bug65] Extension module loading...');

export function activate(context: vscode.ExtensionContext) {
    try { 
        console.log('[Bug65] Activating extension "vscode-bug65-debugger"...');
        console.log(hello());

        let disposable = vscode.commands.registerCommand('vscode-bug65-debugger.helloWorld', () => {
            vscode.window.showInformationMessage('Hello World from bug65-vscode-debugger!');
        });

        context.subscriptions.push(disposable);

        const factory = new Bug65DebugAdapterDescriptorFactory();
        context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('bug65', factory));
        console.log('[Bug65] Debug Adapter Descriptor Factory registered.');
    } catch (err) {
        console.error('[Bug65] Failed to activate extension:', err);
    }
}

class Bug65DebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
    createDebugAdapterDescriptor(session: vscode.DebugSession, executable: vscode.DebugAdapterExecutable | undefined): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        console.log('[Bug65] createDebugAdapterDescriptor called.');
        // Always use inline debug adapter for development/debugging simplicity
        return new vscode.DebugAdapterInlineImplementation(new Bug65DebugSession());
    }
}

export function deactivate() { }
