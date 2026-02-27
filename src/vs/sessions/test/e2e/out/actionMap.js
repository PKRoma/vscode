"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeStep = executeStep;
// ---------------------------------------------------------------------------
// Element vocabulary — maps natural-language names to CSS selectors scoped
// to the agent-sessions workbench.
// ---------------------------------------------------------------------------
const WB = '.agent-sessions-workbench';
const ELEMENT_MAP = {
    'the sessions workbench': WB,
    'the workbench': WB,
    'the sidebar': `${WB} .part.sidebar`,
    'the chat bar': `${WB} .part.chatbar`,
    'the titlebar': `${WB} .part.titlebar`,
    'the auxiliary bar': `${WB} .part.auxiliarybar`,
    'the panel': `${WB} .part.panel`,
    'the chat input': `${WB} .interactive-input-part .monaco-editor[role="code"]`,
    'a chat response': `${WB} .interactive-item-container.interactive-response`,
};
function resolveSelector(elementName) {
    const selector = ELEMENT_MAP[elementName.toLowerCase()];
    if (!selector) {
        throw new Error(`Unknown element "${elementName}". Known elements: ${Object.keys(ELEMENT_MAP).join(', ')}`);
    }
    return selector;
}
const STEP_HANDLERS = [
    // wait for <element> to load
    {
        pattern: /^wait for (.+?) to load$/i,
        async execute(page, match) {
            const selector = resolveSelector(match[1]);
            await page.waitForSelector(selector, { state: 'visible', timeout: 30_000 });
        },
    },
    // verify <element> is visible
    {
        pattern: /^verify (.+?) is visible$/i,
        async execute(page, match) {
            const selector = resolveSelector(match[1]);
            await page.waitForSelector(selector, { state: 'visible', timeout: 10_000 });
        },
    },
    // verify <element> is not visible
    {
        pattern: /^verify (.+?) is not visible$/i,
        async execute(page, match) {
            const selector = resolveSelector(match[1]);
            await page.waitForSelector(selector, { state: 'hidden', timeout: 10_000 });
        },
    },
    // type "<text>" in <element>
    {
        pattern: /^type "(.+?)" in (.+)$/i,
        async execute(page, match) {
            const [, text, elementName] = match;
            const selector = resolveSelector(elementName);
            await page.waitForSelector(selector, { state: 'visible', timeout: 10_000 });
            await page.click(selector);
            // Monaco editors need pressSequentially rather than fill
            await page.locator(selector).pressSequentially(text);
        },
    },
    // click <element>
    {
        pattern: /^click (.+)$/i,
        async execute(page, match) {
            const selector = resolveSelector(match[1]);
            await page.click(selector);
        },
    },
    // press <key>
    {
        pattern: /^press (.+)$/i,
        async execute(page, match) {
            await page.keyboard.press(match[1]);
        },
    },
    // verify a chat response appears
    {
        pattern: /^verify a chat response appears$/i,
        async execute(page) {
            const selector = resolveSelector('a chat response');
            await page.waitForSelector(selector, { state: 'visible', timeout: 30_000 });
        },
    },
    // wait <N> seconds
    {
        pattern: /^wait (\d+) seconds?$/i,
        async execute(page, match) {
            await page.waitForTimeout(parseInt(match[1], 10) * 1000);
        },
    },
];
/**
 * Execute a single natural-language step against a Playwright {@link Page}.
 */
async function executeStep(page, step) {
    for (const handler of STEP_HANDLERS) {
        const match = step.match(handler.pattern);
        if (match) {
            await handler.execute(page, match);
            return;
        }
    }
    throw new Error(`No handler matches step: "${step}"`);
}
//# sourceMappingURL=actionMap.js.map