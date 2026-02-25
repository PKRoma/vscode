/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ChatModeKind, isChatMode, isAgentLikeChatMode, validateChatMode } from '../../common/constants.js';
import { ChatMode, IChatMode, isBuiltinChatMode } from '../../common/chatModes.js';

suite('ChatModeKind', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	suite('validateChatMode', () => {
		test('validates all known mode kinds', () => {
			assert.strictEqual(validateChatMode('ask'), ChatModeKind.Ask);
			assert.strictEqual(validateChatMode('edit'), ChatModeKind.Edit);
			assert.strictEqual(validateChatMode('agent'), ChatModeKind.Agent);
			assert.strictEqual(validateChatMode('debug'), ChatModeKind.Debug);
		});

		test('returns undefined for unknown values', () => {
			assert.strictEqual(validateChatMode('unknown'), undefined);
			assert.strictEqual(validateChatMode(''), undefined);
			assert.strictEqual(validateChatMode(null), undefined);
			assert.strictEqual(validateChatMode(undefined), undefined);
			assert.strictEqual(validateChatMode(42), undefined);
		});
	});

	suite('isChatMode', () => {
		test('returns true for valid mode kinds', () => {
			assert.strictEqual(isChatMode('ask'), true);
			assert.strictEqual(isChatMode('edit'), true);
			assert.strictEqual(isChatMode('agent'), true);
			assert.strictEqual(isChatMode('debug'), true);
		});

		test('returns false for invalid values', () => {
			assert.strictEqual(isChatMode('unknown'), false);
			assert.strictEqual(isChatMode(null), false);
		});
	});

	suite('isAgentLikeChatMode', () => {
		test('returns true for Agent and Debug modes', () => {
			assert.strictEqual(isAgentLikeChatMode(ChatModeKind.Agent), true);
			assert.strictEqual(isAgentLikeChatMode(ChatModeKind.Debug), true);
		});

		test('returns false for Ask and Edit modes', () => {
			assert.strictEqual(isAgentLikeChatMode(ChatModeKind.Ask), false);
			assert.strictEqual(isAgentLikeChatMode(ChatModeKind.Edit), false);
		});
	});

	suite('isBuiltinChatMode', () => {
		test('recognizes all builtin modes including Debug', () => {
			assert.strictEqual(isBuiltinChatMode(ChatMode.Ask), true);
			assert.strictEqual(isBuiltinChatMode(ChatMode.Edit), true);
			assert.strictEqual(isBuiltinChatMode(ChatMode.Agent), true);
			assert.strictEqual(isBuiltinChatMode(ChatMode.Debug), true);
		});

		test('returns false for non-builtin mode', () => {
			assert.strictEqual(isBuiltinChatMode({ id: 'custom-mode' } as IChatMode), false);
		});
	});

	suite('ChatMode.Debug', () => {
		test('has correct properties', () => {
			assert.strictEqual(ChatMode.Debug.kind, ChatModeKind.Debug);
			assert.strictEqual(ChatMode.Debug.id, 'debug');
			assert.strictEqual(ChatMode.Debug.label.get(), 'Debug');
			assert.strictEqual(ChatMode.Debug.name.get(), 'debug');
			assert.strictEqual(ChatMode.Debug.isBuiltin, true);
		});

		test('has modeInstructions with debug workflow', () => {
			const instructions = ChatMode.Debug.modeInstructions?.get();
			assert.ok(instructions, 'Debug mode should have modeInstructions');
			assert.ok(instructions.content.includes('Phase 1: Understand'));
			assert.ok(instructions.content.includes('Phase 2: Instrument'));
			assert.ok(instructions.content.includes('Phase 3: Reproduce'));
			assert.ok(instructions.content.includes('Phase 4: Analyze'));
			assert.ok(instructions.content.includes('Phase 5: Fix'));
			assert.ok(instructions.content.includes('Phase 6: Verify'));
			assert.ok(instructions.content.includes('Phase 7: Cleanup'));
		});

		test('other builtin modes do not have modeInstructions', () => {
			assert.strictEqual(ChatMode.Ask.modeInstructions, undefined);
			assert.strictEqual(ChatMode.Edit.modeInstructions, undefined);
			assert.strictEqual(ChatMode.Agent.modeInstructions, undefined);
		});
	});
});
