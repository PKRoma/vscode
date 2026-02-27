/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';

interface InstallState {
	readonly root: string;
	readonly stateFile: string;
	readonly isUpToDate: boolean;
	readonly files: string[];
}

export class NpmUpToDateFeature extends vscode.Disposable {
	private readonly _statusBarItem: vscode.StatusBarItem;
	private readonly _disposables: vscode.Disposable[] = [];
	private _watcher: vscode.FileSystemWatcher | undefined;

	constructor() {
		const disposables: vscode.Disposable[] = [];
		super(() => disposables.forEach(d => d.dispose()));
		this._disposables = disposables;

		this._statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
		this._statusBarItem.name = 'npm Install State';
		this._statusBarItem.text = '$(warning) npm i';
		this._statusBarItem.tooltip = 'Dependencies are out of date. Click to run npm install.';
		this._statusBarItem.command = 'vscode-extras.runNpmInstall';
		this._statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
		this._disposables.push(this._statusBarItem);

		this._disposables.push(
			vscode.commands.registerCommand('vscode-extras.runNpmInstall', () => this._runNpmInstall())
		);

		this._check();
	}

	private _runNpmInstall(): void {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
		if (!workspaceRoot) {
			return;
		}
		const terminal = vscode.window.createTerminal({ name: 'npm install', cwd: workspaceRoot });
		terminal.sendText('node build/npm/fast-install.ts --force');
		terminal.show();
	}

	private _queryState(): InstallState | undefined {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!workspaceRoot) {
			return undefined;
		}
		try {
			const script = path.join(workspaceRoot, 'build', 'npm', 'installStateHash.ts');
			const output = cp.execFileSync(process.execPath, [script], {
				cwd: workspaceRoot,
				timeout: 10_000,
				encoding: 'utf8',
			});
			return JSON.parse(output.trim());
		} catch {
			return undefined;
		}
	}

	private _check(): void {
		const state = this._queryState();
		if (!state) {
			this._statusBarItem.hide();
			return;
		}

		this._setupWatcher(state);

		if (state.isUpToDate) {
			this._statusBarItem.hide();
		} else {
			this._statusBarItem.show();
		}
	}

	private _setupWatcher(state: InstallState): void {
		this._watcher?.dispose();

		// Watch all input files plus the state file
		const allFiles = [...state.files, state.stateFile];
		const pattern = new vscode.RelativePattern(
			state.root,
			`{${allFiles.map(f => path.relative(state.root, f).replace(/\\/g, '/')).join(',')}}`
		);

		this._watcher = vscode.workspace.createFileSystemWatcher(pattern);
		this._disposables.push(this._watcher);

		let debounceTimer: ReturnType<typeof setTimeout> | undefined;
		const scheduleCheck = () => {
			if (debounceTimer) {
				clearTimeout(debounceTimer);
			}
			debounceTimer = setTimeout(() => this._check(), 500);
		};

		this._disposables.push(this._watcher.onDidChange(scheduleCheck));
		this._disposables.push(this._watcher.onDidCreate(scheduleCheck));
		this._disposables.push(this._watcher.onDidDelete(scheduleCheck));
	}
}
