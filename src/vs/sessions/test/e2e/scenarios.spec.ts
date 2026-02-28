/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { discoverScenarios } from './scenarioParser';
import { executeStep, StepContext } from './actionMap';
import { launchSessionsWindow, SessionApp } from './sessionApp';

// out/ sits next to scenarios/ in the e2e directory
const scenariosDir = path.join(__dirname, '..', 'scenarios');

async function run(): Promise<void> {
	const scenarios = discoverScenarios(scenariosDir);

	if (scenarios.length === 0) {
		console.error('No scenario files found in', scenariosDir);
		process.exit(1);
	}

	let app: SessionApp | undefined;
	let failed = 0;
	let passed = 0;

	try {
		console.log('Launching agent sessions window…');
		app = await launchSessionsWindow();
		console.log('Window launched.\n');

		for (const scenario of scenarios) {
			// Dismiss any open dropdowns/overlays from a previous scenario
			await app.page.keyboard.press('Escape').catch(() => {/* ignore */});
			await app.page.waitForTimeout(200);

			console.log(`▶ Scenario: ${scenario.name}`);

			if (scenario.preconditions.length > 0) {
				console.log('  Preconditions:');
				for (const p of scenario.preconditions) {
					console.log(`    • ${p}`);
				}
			}

			const ctx = new StepContext();

			for (const [i, step] of scenario.steps.entries()) {
				const label = `step ${i + 1}: ${step}`;
				try {
					await executeStep(app.page, step, ctx);
					console.log(`  ✅ ${label}`);
					passed++;
				} catch (err) {
					console.error(`  ❌ ${label}`);
					console.error(`     ${(err as Error).message}`);
					// Capture a screenshot to help diagnose failures
					const screenshotPath = path.join(__dirname, `failure-step${i + 1}.png`);
					await app.page.screenshot({ path: screenshotPath }).catch(() => {/* ignore */});
					console.error(`     Screenshot saved: ${screenshotPath}`);
					failed++;
				}
			}

			console.log();
		}
	} finally {
		await app?.close();
	}

	console.log(`\nResults: ${passed} passed, ${failed} failed`);
	if (failed > 0) {
		process.exit(1);
	}
}

run().catch(err => {
	console.error(err);
	process.exit(1);
});
