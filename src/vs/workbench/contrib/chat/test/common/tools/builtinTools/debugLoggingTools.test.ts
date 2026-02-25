/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationToken } from '../../../../../../../base/common/cancellation.js';
import { VSBuffer } from '../../../../../../../base/common/buffer.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { DebugLoggingTracker, InsertDebugLoggingTool, debugLoggingTracker } from '../../../../common/tools/builtinTools/insertDebugLoggingTool.js';
import { RemoveDebugLoggingTool } from '../../../../common/tools/builtinTools/removeDebugLoggingTool.js';
import { IToolInvocation, IToolResult, IToolResultTextPart, ToolProgress } from '../../../../common/tools/languageModelToolsService.js';
import { IFileService, IFileStatWithMetadata, IWriteFileOptions } from '../../../../../../../platform/files/common/files.js';

const noopProgress: ToolProgress = { report() { } };

class MockFileService {
	private readonly _files = new Map<string, string>();

	setFileContent(uri: string, content: string): void {
		this._files.set(uri, content);
	}

	async readFile(uri: URI): Promise<{ value: VSBuffer }> {
		const content = this._files.get(uri.toString());
		if (content === undefined) {
			throw new Error(`File not found: ${uri.toString()}`);
		}
		return { value: VSBuffer.fromString(content) };
	}

	async writeFile(uri: URI, content: VSBuffer, _options?: IWriteFileOptions): Promise<IFileStatWithMetadata> {
		this._files.set(uri.toString(), content.toString());
		return {} as IFileStatWithMetadata;
	}

	getFileContent(uri: string): string | undefined {
		return this._files.get(uri);
	}
}

function createInvocation(parameters: object): IToolInvocation {
	return {
		parameters,
		callId: 'test-call-id',
		toolId: 'test-tool-id',
		context: undefined,
		tokenizationCounterpart: undefined,
	} as unknown as IToolInvocation;
}

function noopCountTokens() { return Promise.resolve(0); }

function getResultText(result: IToolResult): string {
	const part = result.content[0] as IToolResultTextPart;
	return part.value;
}

suite('DebugLoggingTracker', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	let tracker: DebugLoggingTracker;

	setup(() => {
		tracker = new DebugLoggingTracker();
	});

	test('starts empty', () => {
		assert.deepStrictEqual(tracker.entries, []);
	});

	test('addEntries and getEntriesForFile', () => {
		tracker.addEntries([
			{ uri: 'file:///a.ts', lineNumber: 1, insertedLineNumber: 2, statement: 'console.log("a")', hypothesis: 'h1' },
			{ uri: 'file:///b.ts', lineNumber: 5, insertedLineNumber: 6, statement: 'console.log("b")', hypothesis: 'h2' },
			{ uri: 'file:///a.ts', lineNumber: 10, insertedLineNumber: 11, statement: 'console.log("c")', hypothesis: 'h3' },
		]);

		assert.strictEqual(tracker.entries.length, 3);
		assert.strictEqual(tracker.getEntriesForFile('file:///a.ts').length, 2);
		assert.strictEqual(tracker.getEntriesForFile('file:///b.ts').length, 1);
		assert.strictEqual(tracker.getEntriesForFile('file:///c.ts').length, 0);
	});

	test('clear returns entries and empties tracker', () => {
		tracker.addEntries([
			{ uri: 'file:///a.ts', lineNumber: 1, insertedLineNumber: 2, statement: 'log', hypothesis: 'h' },
		]);

		const cleared = tracker.clear();
		assert.strictEqual(cleared.length, 1);
		assert.deepStrictEqual(tracker.entries, []);
	});
});

suite('InsertDebugLoggingTool', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	let fileService: MockFileService;
	let tool: InsertDebugLoggingTool;

	setup(() => {
		fileService = new MockFileService();
		tool = new InsertDebugLoggingTool(fileService as unknown as IFileService);
		debugLoggingTracker.clear();
	});

	test('inserts logging statements at correct positions', async () => {
		const fileUri = URI.parse('file:///src/app.ts');
		fileService.setFileContent(fileUri.toString(), [
			'function main() {',
			'  const x = 1;',
			'  return x;',
			'}',
		].join('\n'));

		const result = await tool.invoke(
			createInvocation({
				uri: fileUri.toString(),
				logStatements: [
					{ lineNumber: 2, statement: 'console.log("[DEBUG] x =", x);', hypothesis: 'x might be wrong' },
				],
			}),
			noopCountTokens,
			noopProgress,
			CancellationToken.None,
		);

		const updatedContent = fileService.getFileContent(fileUri.toString())!;
		const lines = updatedContent.split('\n');

		assert.strictEqual(lines.length, 5);
		assert.strictEqual(lines[2].trim(), 'console.log("[DEBUG] x =", x);');
		assert.ok(getResultText(result).includes('Inserted 1'));
		assert.strictEqual(debugLoggingTracker.entries.length, 1);
	});

	test('inserts multiple statements sorted by descending line', async () => {
		const fileUri = URI.parse('file:///src/app.ts');
		fileService.setFileContent(fileUri.toString(), [
			'line1',
			'line2',
			'line3',
			'line4',
		].join('\n'));

		await tool.invoke(
			createInvocation({
				uri: fileUri.toString(),
				logStatements: [
					{ lineNumber: 1, statement: 'log1', hypothesis: 'h1' },
					{ lineNumber: 3, statement: 'log2', hypothesis: 'h2' },
				],
			}),
			noopCountTokens,
			noopProgress,
			CancellationToken.None,
		);

		const lines = fileService.getFileContent(fileUri.toString())!.split('\n');
		assert.strictEqual(lines.length, 6);
		assert.strictEqual(lines[1], 'log1');
		assert.strictEqual(lines[4], 'log2');
		assert.strictEqual(debugLoggingTracker.entries.length, 2);
	});

	test('preserves indentation from target line', async () => {
		const fileUri = URI.parse('file:///src/app.ts');
		fileService.setFileContent(fileUri.toString(), [
			'function main() {',
			'    const x = 1;',
			'}',
		].join('\n'));

		await tool.invoke(
			createInvocation({
				uri: fileUri.toString(),
				logStatements: [
					{ lineNumber: 2, statement: 'console.log("test");', hypothesis: 'h' },
				],
			}),
			noopCountTokens,
			noopProgress,
			CancellationToken.None,
		);

		const lines = fileService.getFileContent(fileUri.toString())!.split('\n');
		assert.ok(lines[2].startsWith('    console.log'));
	});

	test('returns error for missing parameters', async () => {
		const result = await tool.invoke(
			createInvocation({ uri: '', logStatements: [] }),
			noopCountTokens,
			noopProgress,
			CancellationToken.None,
		);

		assert.ok(getResultText(result).includes('Error'));
	});

	test('returns error for non-existent file', async () => {
		const result = await tool.invoke(
			createInvocation({
				uri: 'file:///nonexistent.ts',
				logStatements: [{ lineNumber: 1, statement: 'log', hypothesis: 'h' }],
			}),
			noopCountTokens,
			noopProgress,
			CancellationToken.None,
		);

		assert.ok(getResultText(result).includes('Error'));
	});
});

suite('RemoveDebugLoggingTool', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	let fileService: MockFileService;
	let tool: RemoveDebugLoggingTool;

	setup(() => {
		fileService = new MockFileService();
		tool = new RemoveDebugLoggingTool(fileService as unknown as IFileService);
		debugLoggingTracker.clear();
	});

	test('returns message when no entries tracked', async () => {
		const result = await tool.invoke(
			createInvocation({}),
			noopCountTokens,
			noopProgress,
			CancellationToken.None,
		);

		assert.ok(getResultText(result).includes('No debug logging'));
	});

	test('removes tracked logging statements from file', async () => {
		const fileUri = URI.parse('file:///src/app.ts');
		fileService.setFileContent(fileUri.toString(), [
			'function main() {',
			'  const x = 1;',
			'  console.log("[DEBUG] x =", x);',
			'  return x;',
			'}',
		].join('\n'));

		debugLoggingTracker.addEntries([{
			uri: fileUri.toString(),
			lineNumber: 2,
			insertedLineNumber: 3,
			statement: 'console.log("[DEBUG] x =", x);',
			hypothesis: 'test',
		}]);

		const result = await tool.invoke(
			createInvocation({}),
			noopCountTokens,
			noopProgress,
			CancellationToken.None,
		);

		const lines = fileService.getFileContent(fileUri.toString())!.split('\n');
		assert.strictEqual(lines.length, 4);
		assert.ok(!lines.some(l => l.includes('[DEBUG]')));
		assert.ok(getResultText(result).includes('1 statement(s) removed'));
		assert.deepStrictEqual(debugLoggingTracker.entries, []);
	});

	test('removes from specific file only when uri provided', async () => {
		const fileA = URI.parse('file:///a.ts');
		const fileB = URI.parse('file:///b.ts');
		fileService.setFileContent(fileA.toString(), 'original\nlogA\nend');
		fileService.setFileContent(fileB.toString(), 'original\nlogB\nend');

		debugLoggingTracker.addEntries([
			{ uri: fileA.toString(), lineNumber: 1, insertedLineNumber: 2, statement: 'logA', hypothesis: 'h1' },
			{ uri: fileB.toString(), lineNumber: 1, insertedLineNumber: 2, statement: 'logB', hypothesis: 'h2' },
		]);

		await tool.invoke(
			createInvocation({ uri: fileA.toString() }),
			noopCountTokens,
			noopProgress,
			CancellationToken.None,
		);

		// File A should have logging removed
		assert.ok(!fileService.getFileContent(fileA.toString())!.includes('logA'));
		// File B should still have its logging
		assert.ok(fileService.getFileContent(fileB.toString())!.includes('logB'));
	});

	test('handles indented logging statements', async () => {
		const fileUri = URI.parse('file:///src/app.ts');
		fileService.setFileContent(fileUri.toString(), [
			'function main() {',
			'    console.log("[DEBUG] test");',
			'    return 1;',
			'}',
		].join('\n'));

		debugLoggingTracker.addEntries([{
			uri: fileUri.toString(),
			lineNumber: 1,
			insertedLineNumber: 2,
			statement: 'console.log("[DEBUG] test");',
			hypothesis: 'test',
		}]);

		await tool.invoke(
			createInvocation({}),
			noopCountTokens,
			noopProgress,
			CancellationToken.None,
		);

		const lines = fileService.getFileContent(fileUri.toString())!.split('\n');
		assert.strictEqual(lines.length, 3);
		assert.ok(!lines.some(l => l.includes('[DEBUG]')));
	});
});
