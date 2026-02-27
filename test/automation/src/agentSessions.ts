/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from './code';

// Selectors scoped to the agent sessions window (`.agent-sessions-workbench`)
const SESSIONS_WORKBENCH = '.agent-sessions-workbench';
const CHAT_INPUT_EDITOR = `${SESSIONS_WORKBENCH} .interactive-input-part .monaco-editor[role="code"]`;
const CHAT_INPUT_EDITOR_FOCUSED = `${SESSIONS_WORKBENCH} .interactive-input-part .monaco-editor.focused[role="code"]`;
const CHAT_RESPONSE = `${SESSIONS_WORKBENCH} .interactive-item-container.interactive-response`;
const CHAT_RESPONSE_COMPLETE = `${CHAT_RESPONSE}:not(.chat-response-loading)`;

export class AgentSessions {

	constructor(private code: Code) { }

	private get chatInputSelector(): string {
		return `${CHAT_INPUT_EDITOR} ${!this.code.editContextEnabled ? 'textarea' : '.native-edit-context'}`;
	}

	/**
	 * Switch the Playwright driver to target the agent sessions window.
	 * Matches on the `sessions.html` URL fragment.
	 */
	async switchToSessionsWindow(): Promise<void> {
		const switched = this.code.driver.switchToWindow('sessions.html');
		if (!switched) {
			throw new Error('Agent Sessions window not found. Ensure it is open before switching.');
		}
	}

	/**
	 * Wait for the agent sessions workbench container to be rendered.
	 */
	async waitForWorkbench(): Promise<void> {
		await this.code.waitForElement(SESSIONS_WORKBENCH);
	}

	/**
	 * Wait for the chat input editor to appear.
	 */
	async waitForChatInput(): Promise<void> {
		await this.code.waitForElement(CHAT_INPUT_EDITOR);
	}

	/**
	 * Wait for the chat input editor to be focused.
	 */
	async waitForInputFocus(): Promise<void> {
		await this.code.waitForElement(CHAT_INPUT_EDITOR_FOCUSED);
	}

	/**
	 * Type a natural-language message into the chat input and submit it.
	 */
	async sendMessage(message: string): Promise<void> {
		// Click on the chat input to focus it
		await this.code.waitAndClick(CHAT_INPUT_EDITOR);
		await this.waitForInputFocus();

		// Type the message (replace newlines — Enter submits)
		const sanitizedMessage = message.replace(/\n/g, ' ');
		await this.code.driver.currentPage.locator(this.chatInputSelector).pressSequentially(sanitizedMessage);

		// Submit with Enter
		await this.code.dispatchKeybinding('enter', () => Promise.resolve());
	}

	/**
	 * Wait for at least one agent response to appear and finish loading.
	 */
	async waitForResponse(retryCount?: number): Promise<void> {
		await this.code.waitForElement(CHAT_RESPONSE, undefined, retryCount);
		await this.code.waitForElement(CHAT_RESPONSE_COMPLETE, undefined, retryCount);
	}

	/**
	 * Get the text content of the last completed chat response.
	 */
	async getLastResponseText(): Promise<string> {
		const elements = await this.code.waitForElements(CHAT_RESPONSE_COMPLETE, false, els => els.length > 0);
		const last = elements[elements.length - 1];
		return last?.textContent ?? '';
	}
}
