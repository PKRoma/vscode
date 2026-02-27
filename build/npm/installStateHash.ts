/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';
import * as fs from 'fs';
import path from 'path';
import { dirs } from './dirs.ts';

export const root = path.dirname(path.dirname(import.meta.dirname));
export const stateFile = path.join(root, 'node_modules', '.postinstall-state');
export const forceInstallMessage = 'Run \x1b[36mnode build/npm/fast-install.ts --force\x1b[0m to force a full install.';

export function collectInputFiles(): string[] {
	const files: string[] = [];

	for (const dir of dirs) {
		const base = dir === '' ? root : path.join(root, dir);
		for (const file of ['package.json', '.npmrc']) {
			const filePath = path.join(base, file);
			if (fs.existsSync(filePath)) {
				files.push(filePath);
			}
		}
	}

	files.push(path.join(root, '.nvmrc'));

	return files;
}

export function computeInputHash(): string {
	const hash = crypto.createHash('sha256');

	for (const filePath of collectInputFiles()) {
		hash.update(filePath + '\0');
		hash.update(fs.readFileSync(filePath));
	}

	return hash.digest('hex');
}

export function isUpToDate(): boolean {
	if (!fs.existsSync(stateFile)) {
		return false;
	}
	return fs.readFileSync(stateFile, 'utf8').trim() === computeInputHash();
}

// When run directly, output state as JSON for tooling (e.g. the vscode-extras extension).
if (import.meta.filename === process.argv[1]) {
	console.log(JSON.stringify({
		root,
		stateFile,
		isUpToDate: isUpToDate(),
		files: collectInputFiles(),
	}));
}
