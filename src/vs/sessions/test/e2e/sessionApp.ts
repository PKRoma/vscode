/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as cp from 'child_process';
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

	// Pre-seed the application SQLite storage so the welcome overlay is skipped.
	// VS Code stores application-scoped keys in User/globalStorage/state.vscdb.
	await seedWelcomeStorage(tmpDir);

	// Pick a random port for CDP so parallel runs don't collide.
	const cdpPort = 9200 + Math.floor(Math.random() * 800);

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
		'--skip-sessions-welcome',
		`--remote-debugging-port=${cdpPort}`,
		// Disable built-in auth and the real Copilot so our mock handles everything
		'--disable-extension=vscode.github',
		'--disable-extension=vscode.github-authentication',
		'--disable-extension=GitHub.copilot',
		'--disable-extension=GitHub.copilot-chat',
	];

	const ts = () => new Date().toISOString().slice(11, 23);

	// Spawn VS Code as a child process (not via playwright._electron.launch which
	// hangs because VS Code's main process doesn't respond to Playwright's CDP handshake).
	// Build a clean env: spread the parent env but explicitly unset
	// ELECTRON_RUN_AS_NODE (set by the Copilot CLI which itself runs on Electron).
	// When ELECTRON_RUN_AS_NODE=1 the binary starts in Node mode rather than as
	// a full Electron application, which breaks the 'electron' built-in imports.
	const spawnEnv = { ...process.env };
	delete spawnEnv['ELECTRON_RUN_AS_NODE'];
	spawnEnv['VSCODE_DEV'] = '1';
	spawnEnv['VSCODE_CLI'] = '1';
	spawnEnv['VSCODE_REPOSITORY'] = ROOT;

	const proc = cp.spawn(electronPath, args, {
		env: spawnEnv,
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	proc.stdout?.on('data', (d: Buffer) => process.stdout.write(`[vscode] ${d}`));
	proc.stderr?.on('data', (d: Buffer) => process.stderr.write(`[vscode] ${d}`));
	console.log(`[e2e ${ts()}] VS Code spawned (pid=${proc.pid}, cdpPort=${cdpPort})`);

	// Poll until the CDP endpoint is ready.
	const cdpEndpoint = `http://127.0.0.1:${cdpPort}`;
	await waitForCDP(cdpEndpoint, 30_000);
	console.log(`[e2e ${ts()}] CDP endpoint ready`);

	// Connect Playwright to the running VS Code renderer process.
	const browser = await playwright.chromium.connectOverCDP(cdpEndpoint);
	console.log(`[e2e ${ts()}] Playwright connected via CDP`);

	// VS Code opens multiple BrowserWindow contexts. Find the sessions window.
	const page = await findSessionsPage(browser, ts, 20_000);
	console.log(`[e2e ${ts()}] Sessions page found`);

	// Intercept Copilot API calls so the token manager sees a valid session
	// without needing real GitHub credentials.
	await mockCopilotApiRoutes(page);
	console.log(`[e2e ${ts()}] Copilot API routes mocked`);

	// Log console errors from the page
	page.on('console', msg => {
		if (msg.type() === 'error') {
			console.log(`[e2e][console.error] ${msg.text()}`);
		}
	});

	// Wait for the sessions workbench to render
	console.log(`[e2e ${ts()}] Waiting for .agent-sessions-workbench to be visible…`);
	await page.waitForSelector('.agent-sessions-workbench', { state: 'visible', timeout: 30_000 });
	console.log(`[e2e ${ts()}] Sessions workbench ready`);

	return {
		page,
		async close() {
			await browser.close();
			proc.kill();
			fs.rmSync(tmpDir, { recursive: true, force: true });
		},
	};
}

/**
 * Intercept Copilot/GitHub API calls so the extension sees a valid session
 * without needing real credentials. This prevents the welcome overlay from
 * showing and avoids 401 errors in the console during tests.
 */
async function mockCopilotApiRoutes(page: playwright.Page): Promise<void> {
	const futureExpiry = Math.floor(Date.now() / 1000) + 7200;

	// Copilot token endpoint — Copilot uses this to get a short-lived token
	await page.route('**/copilot_internal/v2/token**', route => {
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				token: 'mock-copilot-token',
				expires_at: futureExpiry,
				refresh_in: 1800,
				sku: 'copilot_enterprise',
				tracking_id: 'mock-tracking-id',
			}),
		});
	});

	// Copilot user entitlement endpoint
	await page.route('**/copilot_internal/user**', route => {
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				login: 'e2e-test-user',
				id: 1,
				copilot_plan: 'enterprise',
				public_repos: 0,
				public_gists: 0,
				followers: 0,
			}),
		});
	});

	// VS Code marketplace extension query (prevents 404 noise)
	await page.route('**/extensionquery**', route => {
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ results: [] }),
		});
	});
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

/**
 * Poll the CDP HTTP endpoint until it responds (VS Code is ready to accept connections).
 */
async function waitForCDP(endpoint: string, timeoutMs: number): Promise<void> {
	const http = require('http') as typeof import('http');
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const ok = await new Promise<boolean>(resolve => {
			const req = http.get(`${endpoint}/json/version`, res => {
				res.resume();
				resolve(res.statusCode === 200);
			});
			req.on('error', () => resolve(false));
			req.setTimeout(1000, () => { req.destroy(); resolve(false); });
		});
		if (ok) { return; }
		await new Promise(r => setTimeout(r, 500));
	}
	throw new Error(`CDP endpoint ${endpoint} did not become ready within ${timeoutMs}ms`);
}

/**
 * Iterate CDP browser contexts/pages to find the one rendering the sessions workbench.
 */
async function findSessionsPage(browser: playwright.Browser, ts: () => string, timeoutMs: number): Promise<playwright.Page> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		for (const ctx of browser.contexts()) {
			for (const pg of ctx.pages()) {
				try {
					const found = await pg.evaluate(() =>
						!!document.querySelector('.monaco-workbench.agent-sessions-workbench')
					).catch(() => false);
					if (found) { return pg; }

					// Also check if it has the workbench class at all (even before sessions class is added)
					const cls = await pg.evaluate(() =>
						document.querySelector('.monaco-workbench')?.className ?? ''
					).catch(() => '');
					if (cls) {
						console.log(`[e2e ${ts()}] Page has workbench classes: "${String(cls).slice(0, 100)}"`);
					}
				} catch {
					// page navigating or closed — skip
				}
			}
		}
		await new Promise(r => setTimeout(r, 500));
	}
	// Timeout: return the first non-closed page with any workbench
	for (const ctx of browser.contexts()) {
		for (const pg of ctx.pages()) {
			if (!pg.isClosed()) { return pg; }
		}
	}
	throw new Error('Could not find sessions workbench page within timeout');
}

/**
 * Pre-seed the VS Code application SQLite storage so the sessions welcome
 * overlay sees `welcomeComplete = true` and skips sign-in on first launch.
 */
async function seedWelcomeStorage(userDataDir: string): Promise<void> {
	const storageDir = path.join(userDataDir, 'User', 'globalStorage');
	fs.mkdirSync(storageDir, { recursive: true });
	const dbPath = path.join(storageDir, 'state.vscdb');

	// Use VS Code's bundled @vscode/sqlite3
	const sqlite3 = require(path.join(ROOT, 'node_modules', '@vscode', 'sqlite3')) as typeof import('@vscode/sqlite3');
	await new Promise<void>((resolve, reject) => {
		const db = new sqlite3.Database(dbPath, (err: Error | null) => {
			if (err) { return reject(err); }
			db.serialize(() => {
				db.run(
					`CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)`,
					(e: Error | null) => { if (e) { return reject(e); } }
				);
				db.run(
					`INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)`,
					['workbench.agentsession.welcomeComplete', 'true'],
					(e: Error | null) => {
						if (e) { return reject(e); }
						db.close((closeErr: Error | null) => closeErr ? reject(closeErr) : resolve());
					}
				);
			});
		});
	});
}
