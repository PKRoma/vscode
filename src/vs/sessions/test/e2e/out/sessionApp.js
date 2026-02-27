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
        timeout: 120_000,
    });
    // VS Code may open multiple windows (main workbench + sessions).
    // Wait for at least one window, then look for the sessions window.
    let page = electron.windows()[0];
    if (!page) {
        page = await electron.waitForEvent('window', { timeout: 90_000 });
    }
    // Wait for DOM and give the workbench time to render
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(5_000);
    // If the sessions window opened as a second window, find it
    const allWindows = electron.windows();
    for (const win of allWindows) {
        const url = win.url();
        if (url.includes('sessions')) {
            page = win;
            await page.waitForLoadState('domcontentloaded');
            break;
        }
    }
    return {
        page,
        async close() {
            await electron.close();
            fs.rmSync(tmpDir, { recursive: true, force: true });
        },
    };
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
//# sourceMappingURL=sessionApp.js.map