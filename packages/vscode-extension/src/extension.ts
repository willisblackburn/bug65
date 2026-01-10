import * as vscode from 'vscode';
import { hello } from 'bug65-core';
import { Bug65DebugSession } from './bug65Debug';

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "vscode-bug65-debugger" is now active!');
    console.log(hello());

    let disposable = vscode.commands.registerCommand('vscode-bug65-debugger.helloWorld', () => {
        vscode.window.showInformationMessage('Hello World from bug65-vscode-debugger!');
    });

    context.subscriptions.push(disposable);

    const factory = new Bug65DebugAdapterDescriptorFactory();
    context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('bug65', factory));
}

class Bug65DebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
    createDebugAdapterDescriptor(session: vscode.DebugSession, executable: vscode.DebugAdapterExecutable | undefined): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        if (!executable) {
            // use packaged debug adapter
            return new vscode.DebugAdapterInlineImplementation(new Bug65DebugSession());
        }
        return executable;
    }
}

export function deactivate() { }
