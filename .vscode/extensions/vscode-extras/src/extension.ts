/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { NpmUpToDateFeature } from './npmUpToDateFeature';

export class Extension extends vscode.Disposable {
	private readonly _npmFeature: NpmUpToDateFeature | undefined;

	constructor(context: vscode.ExtensionContext) {
		const disposables: vscode.Disposable[] = [];
		super(() => disposables.forEach(d => d.dispose()));

		const config = vscode.workspace.getConfiguration('vscode-extras');
		if (config.get<boolean>('npmUpToDateFeature.enabled', true)) {
			this._npmFeature = new NpmUpToDateFeature();
			disposables.push(this._npmFeature);
		}

		disposables.push(
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('vscode-extras.npmUpToDateFeature.enabled')) {
					vscode.window.showInformationMessage('Reload the window to apply the npmUpToDateFeature setting change.');
				}
			})
		);
	}
}

let extension: Extension | undefined;

export function activate(context: vscode.ExtensionContext) {
	extension = new Extension(context);
	context.subscriptions.push(extension);
}

export function deactivate() {
	extension = undefined;
}
