/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as playwright from 'playwright-core';

// out/ → e2e/ → test/ → sessions/ → vs/ → src/ → ROOT
const ROOT = process.env['SESSIONS_E2E_ROOT'] ?? path.resolve(__dirname, '..', '..', '..', '..', '..', '..');

export interface SessionApp {
	readonly page: playwright.Page;
	close(): Promise<void>;
}

/**
 * Launch the VS Code Electron window and return a handle to it.
 *
 * Set `SESSIONS_E2E_ELECTRON_PATH` to override the Electron binary path
 * (useful when the worktree hasn't downloaded Electron yet).
 */
export async function launchSessionsWindow(): Promise<SessionApp> {
	const electronPath = process.env['SESSIONS_E2E_ELECTRON_PATH'] ?? getDevElectronPath();
	if (!fs.existsSync(electronPath)) {
		throw new Error(
			`Electron binary not found at ${electronPath}. ` +
			`Run \`./scripts/code.sh\` once to download Electron, or set SESSIONS_E2E_ELECTRON_PATH.`
		);
	}

	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `sessions-e2e-${Date.now()}-`));
	const mockExtPath = path.join(__dirname, '..', 'extensions', 'mock-chat-provider');

	// Pre-seed application storage so the welcome/sign-in overlay is skipped
	const storageDir = path.join(tmpDir, 'User', 'globalStorage');
	fs.mkdirSync(storageDir, { recursive: true });
	const storageDb = path.join(storageDir, 'storage.json');
	fs.writeFileSync(storageDb, JSON.stringify({
		'workbench.agentsession.welcomeComplete': true,
	}));

	const args = [
		...(ROOT.includes('/Resources/app') ? [] : [ROOT]),
		'--skip-release-notes',
		'--skip-welcome',
		'--disable-telemetry',
		'--disable-updates',
		'--disable-workspace-trust',
		'--use-inmemory-secretstorage',
		`--user-data-dir=${tmpDir}`,
		`--extensionDevelopmentPath=${mockExtPath}`,
		'--enable-smoke-test-driver',
		'--sessions',
		'--disable-extension=vscode.github',
		'--disable-extension=vscode.github-authentication',
	];

	const electron = await playwright._electron.launch({
		executablePath: electronPath,
		args,
		env: {
			...process.env,
			VSCODE_DEV: '1',
			VSCODE_CLI: '1',
			VSCODE_REPOSITORY: ROOT,
		},
		timeout: 0,
	});

	console.log('[e2e] Electron process launched');

	// Log all windows as they appear
	electron.on('window', (win: playwright.Page) => {
		console.log(`[e2e] New window detected: ${win.url()}`);
	});

	// Wait for the first window
	let page = electron.windows()[0];
	if (!page) {
		console.log('[e2e] No windows yet, waiting for first window…');
		page = await electron.waitForEvent('window', { timeout: 0 });
	}
	console.log(`[e2e] First window URL: ${page.url()}`);

	await page.waitForLoadState('domcontentloaded');
	console.log('[e2e] DOM content loaded');

	// Log console output from the page
	page.on('console', msg => {
		if (msg.type() === 'error') {
			console.log(`[e2e][console.error] ${msg.text()}`);
		}
	});

	// Wait a moment for additional windows (sessions may open as 2nd window)
	await page.waitForTimeout(3_000);

	// If multiple windows, find the sessions one
	const allWindows = electron.windows();
	console.log(`[e2e] Total windows: ${allWindows.length}`);
	for (const [i, win] of allWindows.entries()) {
		console.log(`[e2e]   window[${i}]: ${win.url()}`);
	}

	for (const win of allWindows) {
		if (win.url().includes('sessions')) {
			page = win;
			await page.waitForLoadState('domcontentloaded');
			console.log(`[e2e] Switched to sessions window: ${page.url()}`);
			break;
		}
	}

	// Check what's on the page
	const title = await page.title();
	console.log(`[e2e] Page title: "${title}"`);
	const hasSessionsWB = await page.locator('.agent-sessions-workbench').count();
	const hasMonacoWB = await page.locator('.monaco-workbench').count();
	const hasWelcome = await page.locator('.sessions-welcome-overlay').count();
	console.log(`[e2e] .agent-sessions-workbench: ${hasSessionsWB}, .monaco-workbench: ${hasMonacoWB}, .sessions-welcome-overlay: ${hasWelcome}`);

	return {
		page,
		async close() {
			await electron.close();
			fs.rmSync(tmpDir, { recursive: true, force: true });
		},
	};
}

function getDevElectronPath(): string {
	const product = require(path.join(ROOT, 'product.json'));
	const buildPath = path.join(ROOT, '.build');
	switch (process.platform) {
		case 'darwin':
			return path.join(buildPath, 'electron', `${product.nameLong}.app`, 'Contents', 'MacOS', product.nameShort);
		case 'linux':
			return path.join(buildPath, 'electron', product.applicationName);
		case 'win32':
			return path.join(buildPath, 'electron', `${product.nameShort}.exe`);
		default:
			throw new Error(`Unsupported platform: ${process.platform}`);
	}
}
