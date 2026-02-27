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
const path = __importStar(require("path"));
const scenarioParser_1 = require("./scenarioParser");
const actionMap_1 = require("./actionMap");
const sessionApp_1 = require("./sessionApp");
// out/ sits next to scenarios/ in the e2e directory
const scenariosDir = path.join(__dirname, '..', 'scenarios');
async function run() {
    const scenarios = (0, scenarioParser_1.discoverScenarios)(scenariosDir);
    if (scenarios.length === 0) {
        console.error('No scenario files found in', scenariosDir);
        process.exit(1);
    }
    let app;
    let failed = 0;
    let passed = 0;
    try {
        console.log('Launching agent sessions window…');
        app = await (0, sessionApp_1.launchSessionsWindow)();
        console.log('Window launched.\n');
        for (const scenario of scenarios) {
            console.log(`▶ Scenario: ${scenario.name}`);
            if (scenario.preconditions.length > 0) {
                console.log('  Preconditions:');
                for (const p of scenario.preconditions) {
                    console.log(`    • ${p}`);
                }
            }
            const ctx = new actionMap_1.StepContext();
            for (const [i, step] of scenario.steps.entries()) {
                const label = `step ${i + 1}: ${step}`;
                try {
                    await (0, actionMap_1.executeStep)(app.page, step, ctx);
                    console.log(`  ✅ ${label}`);
                    passed++;
                }
                catch (err) {
                    console.error(`  ❌ ${label}`);
                    console.error(`     ${err.message}`);
                    failed++;
                }
            }
            console.log();
        }
    }
    finally {
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
//# sourceMappingURL=scenarios.spec.js.map