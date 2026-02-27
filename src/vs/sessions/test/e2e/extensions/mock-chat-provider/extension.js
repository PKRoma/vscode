/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check

const vscode = require('vscode');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	// Register a fake GitHub auth provider so the sessions welcome overlay
	// sees a signed-in user and dismisses itself.
	const fakeSession = {
		id: 'fake-session-id',
		accessToken: 'fake-token',
		account: { id: 'test-user', label: 'Test User' },
		scopes: ['read:user'],
	};

	context.subscriptions.push(
		vscode.authentication.registerAuthenticationProvider(
			'github',
			'GitHub (Mock)',
			{
				onDidChangeSessions: new vscode.EventEmitter().event,
				getSessions: async () => [fakeSession],
				createSession: async () => fakeSession,
				removeSession: async () => { },
			},
			{ supportsMultipleAccounts: false }
		)
	);

	// Register a mock chat participant so chat input works without a real LLM.
	const participant = vscode.chat.createChatParticipant(
		'mock-chat-provider.mock',
		async (_request, _context, stream, _token) => {
			stream.markdown('This is a **mock response** for agent sessions testing.');
			return {};
		}
	);
	participant.isDefault = true;
	context.subscriptions.push(participant);
}

module.exports = { activate };
