/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Page } from 'playwright-core';

// ---------------------------------------------------------------------------
// Shared run‑time state that persists across steps within a scenario.
// Steps can store values (e.g. a generated name) for later steps to read.
// ---------------------------------------------------------------------------

export class StepContext {
	private readonly vars = new Map<string, string>();

	set(key: string, value: string): void { this.vars.set(key, value); }
	get(key: string): string {
		const v = this.vars.get(key);
		if (v === undefined) {
			throw new Error(`Variable "${key}" is not set. Available: ${[...this.vars.keys()].join(', ') || '(none)'}`);
		}
		return v;
	}

	/** Replace `<varName>` placeholders in a string with stored values. */
	interpolate(text: string): string {
		return text.replace(/<(\w+)>/g, (_, key) => this.get(key));
	}

	clear(): void { this.vars.clear(); }
}

// ---------------------------------------------------------------------------
// Element vocabulary — maps natural-language names to CSS selectors scoped
// to the agent-sessions workbench.
// ---------------------------------------------------------------------------

const WB = '[data-testid="sessions-workbench"]';

const ELEMENT_MAP: Record<string, string> = {
	// Top-level workbench
	'the sessions workbench': WB,
	'the workbench': WB,

	// Workbench parts
	'the sidebar': `${WB} .part.sidebar`,
	'the chat bar': `${WB} .part.chatbar`,
	'the titlebar': `${WB} .part.titlebar`,
	'the auxiliary bar': `${WB} .part.auxiliarybar`,
	'the panel': `${WB} .part.panel`,

	// Chat input — stable testid on the editor container, Monaco editor inside
	'the chat input': `[data-testid="sessions-chat-input"] .monaco-editor`,
	'a chat response': `${WB} .interactive-item-container.interactive-response`,

	// Session target radio (Local / Cloud)
	'the target picker': `[data-testid="sessions-target-picker"]`,
	'the local button': `[data-testid="sessions-target-picker"] .monaco-button:first-child`,
	'the cloud button': `[data-testid="sessions-target-picker"] .monaco-button:last-child`,

	// Repository picker trigger & dropdown
	'the repo picker': `[data-testid="sessions-repo-picker"]`,
	'the repository picker dropdown': `.action-widget`,
	'the repository picker': `[data-testid="sessions-repo-picker"]`,

	// AI Customization overview sidebar view
	'the customizations sidebar': `${WB} .part.sidebar [id="workbench.view.aiCustomizationOverview"]`,
	'the customizations overview': `${WB} .overview-sections`,

	// Overview section items — each section is an .overview-section with aria-label
	'the agents section': `${WB} .overview-section[aria-label*="Agents"]`,
	'the skills section': `${WB} .overview-section[aria-label*="Skills"]`,
	'the instructions section': `${WB} .overview-section[aria-label*="Instructions"]`,
	'the prompts section': `${WB} .overview-section[aria-label*="Prompts"]`,
	'the hooks section': `${WB} .overview-section[aria-label*="Hooks"]`,

	// Section counts (the .section-count span inside each section)
	'the agents count': `${WB} .overview-section[aria-label*="Agents"] .section-count`,
	'the skills count': `${WB} .overview-section[aria-label*="Skills"] .section-count`,
	'the instructions count': `${WB} .overview-section[aria-label*="Instructions"] .section-count`,
	'the prompts count': `${WB} .overview-section[aria-label*="Prompts"] .section-count`,
	'the hooks count': `${WB} .overview-section[aria-label*="Hooks"] .section-count`,

	// Sidebar badge counts (the badge-content number next to each composite bar item)
	'sidebar badges': `${WB} .part.sidebar .badge .badge-content`,

	// Management editor (opens when clicking a section)
	'the management editor': `${WB} .part.auxiliarybar .pane-body`,
	'the editor header': `${WB} .part.auxiliarybar .composite.title`,

	// Management editor item list
	'workspace items': `${WB} .ai-customization-group-header:has-text("Workspace")`,
	'user items': `${WB} .ai-customization-group-header:has-text("User")`,
	'extension items': `${WB} .ai-customization-group-header:has-text("Extensions")`,

	// Tree items
	'customization items': `${WB} .ai-customization-tree-item`,

	// Buttons
	'the create button': `${WB} .part.auxiliarybar .action-item a[aria-label*="New"]`,
	'the back button': `${WB} .part.auxiliarybar .action-item a[aria-label*="Back"]`,
	'the add dropdown': `${WB} .part.auxiliarybar .action-item a[aria-label*="Add"]`,

	// Quick input (command palette / name input)
	'the quick input': `.quick-input-widget`,
	'the quick input box': `.quick-input-widget .input`,

	// Monaco embedded editor (inside management editor for file editing)
	'the embedded editor': `${WB} .part.auxiliarybar .monaco-editor[role="code"]`,

	// Empty state
	'the empty state': `${WB} .part.auxiliarybar .pane-body .empty-message`,
};

function resolveSelector(elementName: string): string {
	const key = elementName.toLowerCase();
	const selector = ELEMENT_MAP[key];
	if (!selector) {
		throw new Error(`Unknown element "${elementName}". Known elements:\n  ${Object.keys(ELEMENT_MAP).join('\n  ')}`);
	}
	return selector;
}

// ---------------------------------------------------------------------------
// Step handlers — each regex is tried in order; the first match wins.
// ---------------------------------------------------------------------------

interface StepHandler {
	readonly pattern: RegExp;
	execute(page: Page, match: RegExpMatchArray, ctx: StepContext): Promise<void>;
}

const STEP_HANDLERS: StepHandler[] = [
	// ------ Waits ------

	// wait for <element> to load
	{
		pattern: /^wait for (.+?) to load$/i,
		async execute(page, match) {
			await page.waitForSelector(resolveSelector(match[1]), { state: 'visible', timeout: 30_000 });
		},
	},
	// wait <N> seconds
	{
		pattern: /^wait (\d+) seconds?$/i,
		async execute(page, match) {
			await page.waitForTimeout(parseInt(match[1], 10) * 1000);
		},
	},

	// ------ Visibility ------

	// verify <element> is visible
	{
		pattern: /^verify (.+?) is visible$/i,
		async execute(page, match) {
			await page.waitForSelector(resolveSelector(match[1]), { state: 'visible', timeout: 10_000 });
		},
	},
	// verify <element> is not visible / is hidden
	{
		pattern: /^verify (.+?) is (?:not visible|hidden)$/i,
		async execute(page, match) {
			await page.waitForSelector(resolveSelector(match[1]), { state: 'hidden', timeout: 10_000 });
		},
	},

	// ------ Text & content assertions ------

	// verify <element> has text "<text>"
	{
		pattern: /^verify (.+?) has text "(.+?)"$/i,
		async execute(page, match) {
			const selector = resolveSelector(match[1]);
			const expected = match[2];
			await page.waitForFunction(
				({ sel, txt }) => {
					const el = document.querySelector(sel);
					return el?.textContent?.includes(txt) ?? false;
				},
				{ sel: selector, txt: expected },
				{ timeout: 10_000 }
			);
		},
	},
	// verify <element> text contains "<text>"
	{
		pattern: /^verify (.+?) text contains "(.+?)"$/i,
		async execute(page, match) {
			const selector = resolveSelector(match[1]);
			const expected = match[2];
			await page.waitForFunction(
				({ sel, txt }) => {
					const el = document.querySelector(sel);
					return el?.textContent?.includes(txt) ?? false;
				},
				{ sel: selector, txt: expected },
				{ timeout: 10_000 }
			);
		},
	},
	// verify text "<text>" appears on the page
	{
		pattern: /^verify text "(.+?)" appears(?: on the page)?$/i,
		async execute(page, match) {
			await page.getByText(match[1]).first().waitFor({ state: 'visible', timeout: 10_000 });
		},
	},

	// ------ Counts ------

	// verify <element> count is <N>
	{
		pattern: /^verify (.+?) count is (\d+)$/i,
		async execute(page, match) {
			const selector = resolveSelector(match[1]);
			const expected = parseInt(match[2], 10);
			await page.waitForFunction(
				({ sel, n }) => document.querySelectorAll(sel).length === n,
				{ sel: selector, n: expected },
				{ timeout: 10_000 }
			);
		},
	},
	// verify <element> count is greater than <N>
	{
		pattern: /^verify (.+?) count is greater than (\d+)$/i,
		async execute(page, match) {
			const selector = resolveSelector(match[1]);
			const min = parseInt(match[2], 10);
			await page.waitForFunction(
				({ sel, n }) => document.querySelectorAll(sel).length > n,
				{ sel: selector, n: min },
				{ timeout: 10_000 }
			);
		},
	},
	// store <element> text as <varName>
	{
		pattern: /^store (.+?) text as (\w+)$/i,
		async execute(page, match, ctx) {
			const selector = resolveSelector(match[1]);
			const text = await page.$eval(selector, el => el.textContent ?? '');
			ctx.set(match[2], text.trim());
		},
	},

	// ------ Sidebar badge assertions ------

	// verify all sidebar badges are hidden
	{
		pattern: /^verify all sidebar badges are hidden$/i,
		async execute(page) {
			const selector = resolveSelector('sidebar badges');
			await page.waitForFunction(
				(sel) => {
					const badges = document.querySelectorAll(sel);
					return Array.from(badges).every(b => {
						const text = b.textContent?.trim();
						return !text || text === '0';
					});
				},
				selector,
				{ timeout: 10_000 }
			);
		},
	},

	// ------ Input ------

	// type "<text>" in <element>
	{
		pattern: /^type "(.+?)" in (.+)$/i,
		async execute(page, match, ctx) {
			const text = ctx.interpolate(match[1]);
			const selector = resolveSelector(match[2]);
			await page.waitForSelector(selector, { state: 'visible', timeout: 10_000 });
			await page.click(selector);
			await page.locator(selector).pressSequentially(text);
		},
	},
	// press Enter to submit (presses Enter in the chat input)
	{
		pattern: /^press Enter to submit$/i,
		async execute(page) {
			const chatInput = `[data-testid="sessions-chat-input"] .monaco-editor`;
			await page.waitForSelector(chatInput, { state: 'visible', timeout: 10_000 });
			await page.click(chatInput);
			await page.keyboard.press('Enter');
		},
	},
	// press <key>
	{
		pattern: /^press (.+)$/i,
		async execute(page, match) {
			await page.keyboard.press(match[1]);
		},
	},

	// ------ Click by text (must come before generic click to avoid mismatches) ------

	// click button "<text>"
	{
		pattern: /^click button "(.+?)"$/i,
		async execute(page, match, ctx) {
			const text = ctx.interpolate(match[1]);
			// Use force:true to click through any overlay (e.g. context-view-pointerBlock left over from a previous scenario)
			await page.getByRole('button', { name: text }).first().click({ timeout: 10_000, force: true });
		},
	},
	// click menu item "<text>"
	{
		pattern: /^click menu item "(.+?)"$/i,
		async execute(page, match, ctx) {
			const text = ctx.interpolate(match[1]);
			await page.getByRole('menuitem', { name: text }).first().click({ timeout: 10_000 });
		},
	},
	// click link "<text>"
	{
		pattern: /^click link "(.+?)"$/i,
		async execute(page, match, ctx) {
			const text = ctx.interpolate(match[1]);
			await page.getByRole('link', { name: text }).first().click({ timeout: 10_000 });
		},
	},

	// ------ Click by element name ------

	// click <element>
	{
		pattern: /^click (.+)$/i,
		async execute(page, match) {
			const selector = resolveSelector(match[1]);
			await page.waitForSelector(selector, { state: 'visible', timeout: 10_000 });
			await page.click(selector);
		},
	},
	// select "<text>" in the quick input
	{
		pattern: /^select "(.+?)" in the quick input$/i,
		async execute(page, match, ctx) {
			const text = ctx.interpolate(match[1]);
			await page.waitForSelector('.quick-input-widget', { state: 'visible', timeout: 10_000 });
			await page.locator('.quick-input-widget .input').fill(text);
			await page.keyboard.press('Enter');
		},
	},

	// ------ Commands (VS Code command palette) ------

	// run command "<command>"
	{
		pattern: /^run command "(.+?)"$/i,
		async execute(page, match) {
			const command = match[1];
			// Open command palette
			const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
			await page.keyboard.press(`${mod}+Shift+KeyP`);
			await page.waitForSelector('.quick-input-widget', { state: 'visible', timeout: 10_000 });
			await page.locator('.quick-input-widget .input').fill(command);
			// Wait for the matching item and select it
			await page.waitForTimeout(500);
			await page.keyboard.press('Enter');
		},
	},

	// ------ Variables ------

	// set <varName> to "<value>"
	{
		pattern: /^set (\w+) to "(.+?)"$/i,
		async execute(_page, match, ctx) {
			ctx.set(match[1], match[2]);
		},
	},

	// ------ Button enabled / disabled state ------

	// verify the "<label>" button is enabled
	{
		pattern: /^verify the? "(.+?)" button is enabled$/i,
		async execute(page, match, ctx) {
			const label = ctx.interpolate(match[1]);
			const btn = page.getByRole('button', { name: label }).first();
			await btn.waitFor({ state: 'visible', timeout: 10_000 });
			const ariaDisabled = await btn.getAttribute('aria-disabled');
			const disabled = await btn.isDisabled();
			if (ariaDisabled === 'true' || disabled) {
				throw new Error(`Expected button "${label}" to be enabled but it is disabled`);
			}
		},
	},
	// verify the "<label>" button is disabled
	{
		pattern: /^verify the? "(.+?)" button is disabled$/i,
		async execute(page, match, ctx) {
			const label = ctx.interpolate(match[1]);
			const btn = page.getByRole('button', { name: label }).first();
			await btn.waitFor({ state: 'visible', timeout: 10_000 });
			const ariaDisabled = await btn.getAttribute('aria-disabled');
			const disabled = await btn.isDisabled();
			if (ariaDisabled !== 'true' && !disabled) {
				throw new Error(`Expected button "${label}" to be disabled but it is enabled`);
			}
		},
	},

	// ------ Chat ------

	// verify a chat response appears
	{
		pattern: /^verify a chat response appears$/i,
		async execute(page) {
			await page.waitForSelector(resolveSelector('a chat response'), { state: 'visible', timeout: 30_000 });
		},
	},

	// ------ File path assertions ------

	// verify the editor header contains "<text>"
	{
		pattern: /^verify the editor header contains "(.+?)"$/i,
		async execute(page, match, ctx) {
			const expected = ctx.interpolate(match[1]);
			const selector = resolveSelector('the editor header');
			await page.waitForFunction(
				({ sel, txt }) => {
					const el = document.querySelector(sel);
					return el?.textContent?.includes(txt) ?? false;
				},
				{ sel: selector, txt: expected },
				{ timeout: 10_000 }
			);
		},
	},

	// ------ Folder / workspace selection (sessions-specific) ------

	// select workspace folder "<path>"
	{
		pattern: /^select workspace folder "(.+?)"$/i,
		async execute(page, match, ctx) {
			const folder = ctx.interpolate(match[1]);
			// Use the "Open Folder" command or project bar picker
			await page.getByText(folder).first().click({ timeout: 10_000 });
		},
	},
];

/**
 * Execute a single natural-language step against a Playwright {@link Page}.
 */
export async function executeStep(page: Page, rawStep: string, ctx: StepContext): Promise<void> {
	const step = ctx.interpolate(rawStep);

	for (const handler of STEP_HANDLERS) {
		const match = step.match(handler.pattern);
		if (match) {
			await handler.execute(page, match, ctx);
			return;
		}
	}
	throw new Error(`No handler matches step: "${step}"`);
}
