import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    console.log('[TestExtension] Activated!');

    let disposable = vscode.commands.registerCommand('test-extension.helloWorld', () => {
        vscode.window.showInformationMessage('Hello from Test Extension!');
    });

    context.subscriptions.push(disposable);
}

export function deactivate() { }
