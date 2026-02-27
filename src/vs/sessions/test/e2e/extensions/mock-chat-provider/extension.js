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
