"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.launchSessionsWindow = launchSessionsWindow;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const playwright = __importStar(require("playwright-core"));
// out/ → e2e/ → test/ → sessions/ → vs/ → src/ → ROOT
const ROOT = process.env['SESSIONS_E2E_ROOT'] ?? path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
/**
 * Launch the VS Code Electron window and return a handle to it.
 *
 * Set `SESSIONS_E2E_ELECTRON_PATH` to override the Electron binary path
 * (useful when the worktree hasn't downloaded Electron yet).
 */
async function launchSessionsWindow() {
    const electronPath = process.env['SESSIONS_E2E_ELECTRON_PATH'] ?? getDevElectronPath();
    if (!fs.existsSync(electronPath)) {
        throw new Error(`Electron binary not found at ${electronPath}. ` +
            `Run \`./scripts/code.sh\` once to download Electron, or set SESSIONS_E2E_ELECTRON_PATH.`);
    }
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `sessions-e2e-${Date.now()}-`));
    const mockExtPath = path.join(__dirname, '..', 'extensions', 'mock-chat-provider');
    // Pre-seed the application SQLite storage so the welcome overlay is skipped.
    // VS Code stores application-scoped keys in User/globalStorage/state.vscdb.
    await seedWelcomeStorage(tmpDir);
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
        // Disable built-in auth and the real Copilot so our mock handles everything
        '--disable-extension=vscode.github',
        '--disable-extension=vscode.github-authentication',
        '--disable-extension=GitHub.copilot',
        '--disable-extension=GitHub.copilot-chat',
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
    // Collect windows as they open
    const openedWindows = [...electron.windows()];
    electron.on('window', (win) => {
        console.log(`[e2e] New window opened: ${win.url()}`);
        openedWindows.push(win);
    });
    // Wait for the first window to appear
    if (openedWindows.length === 0) {
        console.log('[e2e] Waiting for first window…');
        const w = await electron.waitForEvent('window', { timeout: 0 });
        openedWindows.push(w);
    }
    console.log(`[e2e] First window available`);
    // With --sessions flag, VS Code opens a sessions window (may be 1st or 2nd window).
    // Wait up to 15s for a second window; if one never comes, use the first.
    let page;
    if (openedWindows.length < 2) {
        console.log('[e2e] Waiting up to 15s for sessions window…');
        const maybeSecond = await Promise.race([
            electron.waitForEvent('window', { timeout: 15_000 }).then(w => { openedWindows.push(w); return w; }),
            new Promise(resolve => setTimeout(() => resolve(null), 15_000)),
        ]).catch(() => null);
        if (maybeSecond) {
            console.log(`[e2e] Second window opened`);
        }
        else {
            console.log(`[e2e] No second window appeared, using first window`);
        }
    }
    // Pick the last opened window (the sessions window is always the newest)
    page = openedWindows[openedWindows.length - 1];
    console.log(`[e2e] Using window ${openedWindows.indexOf(page) + 1}/${openedWindows.length}`);
    // Wait for it to be interactive
    await page.waitForLoadState('domcontentloaded');
    console.log('[e2e] DOM content loaded');
    // Intercept Copilot API calls so the token manager sees a valid session
    // without needing real GitHub credentials.
    await mockCopilotApiRoutes(page);
    // Log console errors from the page
    page.on('console', msg => {
        if (msg.type() === 'error') {
            console.log(`[e2e][console.error] ${msg.text()}`);
        }
    });
    // Wait for the sessions workbench to render
    console.log('[e2e] Waiting for .agent-sessions-workbench…');
    await page.waitForSelector('.agent-sessions-workbench', { state: 'attached', timeout: 30_000 });
    console.log('[e2e] Sessions workbench ready');
    return {
        page,
        async close() {
            await electron.close();
            fs.rmSync(tmpDir, { recursive: true, force: true });
        },
    };
}
/**
 * Intercept Copilot/GitHub API calls so the extension sees a valid session
 * without needing real credentials. This prevents the welcome overlay from
 * showing and avoids 401 errors in the console during tests.
 */
async function mockCopilotApiRoutes(page) {
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
function getDevElectronPath() {
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
 * Pre-seed the VS Code application SQLite storage so the sessions welcome
 * overlay sees `welcomeComplete = true` and skips sign-in on first launch.
 */
async function seedWelcomeStorage(userDataDir) {
    const storageDir = path.join(userDataDir, 'User', 'globalStorage');
    fs.mkdirSync(storageDir, { recursive: true });
    const dbPath = path.join(storageDir, 'state.vscdb');
    // Use VS Code's bundled @vscode/sqlite3
    const sqlite3 = require(path.join(ROOT, 'node_modules', '@vscode', 'sqlite3'));
    await new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                return reject(err);
            }
            db.serialize(() => {
                db.run(`CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)`, (e) => { if (e) {
                    return reject(e);
                } });
                db.run(`INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)`, ['workbench.agentsession.welcomeComplete', 'true'], (e) => {
                    if (e) {
                        return reject(e);
                    }
                    db.close((closeErr) => closeErr ? reject(closeErr) : resolve());
                });
            });
        });
    });
}
//# sourceMappingURL=sessionApp.js.map