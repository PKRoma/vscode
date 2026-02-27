/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';

export interface Scenario {
	readonly name: string;
	readonly description: string;
	readonly steps: string[];
	readonly filePath: string;
}

/**
 * Parse a `.scenario.md` file into a structured {@link Scenario}.
 *
 * Expected format:
 * ```
 * # Scenario Name
 *
 * Optional description paragraph(s).
 *
 * ## Steps
 *
 * - step one
 * - step two
 * ```
 */
export function parseScenario(filePath: string): Scenario {
	const raw = fs.readFileSync(filePath, 'utf-8');
	const lines = raw.split('\n');

	let name = path.basename(filePath, '.scenario.md');
	const descriptionLines: string[] = [];
	const steps: string[] = [];
	let section: 'header' | 'description' | 'steps' = 'header';

	for (const line of lines) {
		const trimmed = line.trim();

		if (section === 'header' && trimmed.startsWith('# ')) {
			name = trimmed.slice(2).trim();
			section = 'description';
			continue;
		}

		if (trimmed.toLowerCase() === '## steps') {
			section = 'steps';
			continue;
		}

		if (section === 'description' && trimmed.length > 0 && !trimmed.startsWith('#')) {
			descriptionLines.push(trimmed);
		}

		if (section === 'steps' && /^-\s+/.test(trimmed)) {
			steps.push(trimmed.replace(/^-\s+/, '').trim());
		}
	}

	return {
		name,
		description: descriptionLines.join(' '),
		steps,
		filePath,
	};
}

/**
 * Discover all `.scenario.md` files under a directory.
 */
export function discoverScenarios(dir: string): Scenario[] {
	const entries = fs.readdirSync(dir);
	return entries
		.filter(f => f.endsWith('.scenario.md'))
		.map(f => parseScenario(path.join(dir, f)));
}
