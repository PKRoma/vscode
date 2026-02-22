/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { formatChatSessionAsMarkdown } from '../../../browser/actions/chatImportExport.js';
import { IExportableChatData, ISerializableChatRequestData } from '../../../common/model/chatModel.js';
import { IChatToolInvocationSerialized } from '../../../common/chatService/chatService.js';

suite('ChatImportExport', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('formats pretty conversation markdown without tool calls', () => {
		const toolInvocation: IChatToolInvocationSerialized = {
			kind: 'toolInvocationSerialized',
			presentation: undefined,
			toolId: 'run_in_terminal',
			toolCallId: 'tool-call-1',
			source: undefined,
			invocationMessage: { value: 'Running `npm test`' },
			originMessage: undefined,
			pastTenseMessage: { value: 'Executed `npm test` successfully' },
			isConfirmed: true,
			isComplete: true,
		};

		const request: ISerializableChatRequestData = {
			requestId: 'request-1',
			message: 'Please run tests',
			variableData: { variables: [] },
			response: [
				{
					kind: 'markdownVuln',
					content: { value: 'All tests passed.' },
					vulnerabilities: []
				},
				toolInvocation
			]
		};

		const data: IExportableChatData = {
			initialLocation: undefined,
			responderUsername: 'assistant',
			requests: [request]
		};

		const markdown = formatChatSessionAsMarkdown(data, 'Session Title');

		assert.ok(markdown.includes('# Session Title'));
		assert.ok(markdown.includes('*A conversation between you and Copilot*'));
		assert.ok(!markdown.includes('## Turn '));
		assert.ok(markdown.includes('### You'));
		assert.ok(markdown.includes('> Please run tests'));
		assert.ok(markdown.includes('### Copilot'));
		assert.ok(markdown.includes('> All tests passed.'));
		assert.ok(!markdown.includes('### Activity'));
		assert.ok(!markdown.includes('Tool run_in_terminal'));
	});

	test('formats parsed request text', () => {
		const request: ISerializableChatRequestData = {
			requestId: 'request-2',
			message: {
				text: 'Summarize this session',
				parts: []
			},
			variableData: { variables: [] },
			response: [
				{
					kind: 'markdownContent',
					content: { value: 'Here is the summary.' }
				}
			]
		};

		const data: IExportableChatData = {
			initialLocation: undefined,
			responderUsername: 'assistant',
			requests: [request]
		};

		const markdown = formatChatSessionAsMarkdown(data);
		assert.ok(markdown.includes('# Chat Session'));
		assert.ok(markdown.includes('### You'));
		assert.ok(markdown.includes('### Copilot'));
		assert.ok(markdown.includes('Summarize this session'));
		assert.ok(markdown.includes('Here is the summary.'));
	});

	test('includes assistant messages exported as raw markdown strings', () => {
		const request: ISerializableChatRequestData = {
			requestId: 'request-3',
			message: 'Explain the refactor',
			variableData: { variables: [] },
			response: [
				{ value: 'I moved the compile CLI jobs into each platform pipeline.' }
			]
		};

		const data: IExportableChatData = {
			initialLocation: undefined,
			responderUsername: 'assistant',
			requests: [request]
		};

		const markdown = formatChatSessionAsMarkdown(data);
		assert.ok(markdown.includes('### Copilot'));
		assert.ok(markdown.includes('> I moved the compile CLI jobs into each platform pipeline.'));
	});
});
