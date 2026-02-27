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
exports.parseScenario = parseScenario;
exports.discoverScenarios = discoverScenarios;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
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
function parseScenario(filePath) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split('\n');
    let name = path.basename(filePath, '.scenario.md');
    const descriptionLines = [];
    const preconditions = [];
    const steps = [];
    let section = 'header';
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
function discoverScenarios(dir) {
    const entries = fs.readdirSync(dir);
    return entries
        .filter(f => f.endsWith('.scenario.md'))
        .sort()
        .map(f => parseScenario(path.join(dir, f)));
}
//# sourceMappingURL=scenarioParser.js.map