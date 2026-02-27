/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';

export interface Scenario {
	readonly name: string;
	readonly description: string;
	readonly preconditions: string[];
	readonly steps: string[];
	readonly filePath: string;
}

/**
 * Parse a `.scenario.md` file into a structured {@link Scenario}.
 *
 * Expected format:
 * ```markdown
 * # Scenario Name
 *
 * Description paragraph(s).
 *
 * ## Preconditions
 *
 * - precondition 1
 * - precondition 2
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
	const preconditions: string[] = [];
	const steps: string[] = [];
	let section: 'header' | 'description' | 'preconditions' | 'steps' = 'header';

	for (const line of lines) {
		const trimmed = line.trim();

		if (section === 'header' && trimmed.startsWith('# ')) {
			name = trimmed.slice(2).trim();
			section = 'description';
			continue;
		}

		if (/^## preconditions?$/i.test(trimmed)) {
			section = 'preconditions';
			continue;
		}

		if (/^## steps?$/i.test(trimmed)) {
			section = 'steps';
			continue;
		}

		// Skip other headings
		if (trimmed.startsWith('#')) {
			continue;
		}

		const listItem = trimmed.match(/^(?:-|\d+\.)\s+(.*)/);

		if (section === 'description' && trimmed.length > 0) {
			descriptionLines.push(trimmed);
		}

		if (section === 'preconditions' && listItem) {
			preconditions.push(listItem[1].trim());
		}

		if (section === 'steps' && listItem) {
			steps.push(listItem[1].trim());
		}
	}

	return {
		name,
		description: descriptionLines.join(' '),
		preconditions,
		steps,
		filePath,
	};
}

/**
 * Discover all `.scenario.md` files under a directory, sorted by filename.
 */
export function discoverScenarios(dir: string): Scenario[] {
	const entries = fs.readdirSync(dir);
	return entries
		.filter(f => f.endsWith('.scenario.md'))
		.sort()
		.map(f => parseScenario(path.join(dir, f)));
}
