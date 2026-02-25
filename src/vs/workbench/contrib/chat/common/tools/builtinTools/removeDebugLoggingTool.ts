/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { VSBuffer } from '../../../../../../base/common/buffer.js';
import { URI, UriComponents } from '../../../../../../base/common/uri.js';
import { localize } from '../../../../../../nls.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { CountTokensCallback, IPreparedToolInvocation, IToolData, IToolImpl, IToolInvocation, IToolInvocationPreparationContext, IToolResult, ToolDataSource, ToolProgress } from '../languageModelToolsService.js';
import { debugLoggingTracker, IDebugLoggingEntry } from './insertDebugLoggingTool.js';

export const RemoveDebugLoggingToolId = 'vscode_removeDebugLogging';

export const RemoveDebugLoggingToolData: IToolData = {
	id: RemoveDebugLoggingToolId,
	toolReferenceName: 'removeDebugLogging',
	displayName: localize('tool.removeDebugLogging', 'Remove Debug Logging'),
	modelDescription: 'Remove all debug logging statements that were previously inserted by the insertDebugLogging tool. This cleans up instrumentation from all files, restoring them to their original state. Call this tool after the bug has been fixed and verified, or when you want to start a fresh round of instrumentation.',
	source: ToolDataSource.Internal,
	tags: ['debug'],
	inputSchema: {
		type: 'object',
		properties: {
			uri: {
				type: 'string',
				description: 'Optional: URI of a specific file to remove logging from. If not provided, removes logging from all instrumented files.'
			}
		}
	}
};

interface IRemoveDebugLoggingParams {
	uri?: string;
}

export class RemoveDebugLoggingTool implements IToolImpl {

	constructor(
		@IFileService private readonly fileService: IFileService,
	) { }

	async prepareToolInvocation(_context: IToolInvocationPreparationContext, _token: CancellationToken): Promise<IPreparedToolInvocation | undefined> {
		const count = debugLoggingTracker.entries.length;
		return {
			invocationMessage: localize('tool.removeDebugLogging.invocation', 'Removing {0} debug logging statement(s)', count),
		};
	}

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, token: CancellationToken): Promise<IToolResult> {
		const params = invocation.parameters as IRemoveDebugLoggingParams;

		const entries = debugLoggingTracker.entries;
		if (entries.length === 0) {
			return {
				content: [{ kind: 'text', value: 'No debug logging statements to remove. No instrumentation is currently tracked.' }]
			};
		}

		// Group entries by file URI
		const entriesByFile = new Map<string, IDebugLoggingEntry[]>();
		for (const entry of entries) {
			if (params.uri && entry.uri !== params.uri) {
				continue;
			}
			const existing = entriesByFile.get(entry.uri) ?? [];
			existing.push(entry);
			entriesByFile.set(entry.uri, existing);
		}

		if (entriesByFile.size === 0) {
			return {
				content: [{ kind: 'text', value: `No debug logging found for file ${params.uri}.` }]
			};
		}

		let totalRemoved = 0;
		const results: string[] = [];

		for (const [fileUri, fileEntries] of entriesByFile) {
			if (token.isCancellationRequested) {
				break;
			}

			const uri = URI.revive(fileUri as unknown as UriComponents);
			let fileContent: string;
			try {
				const rawContent = await this.fileService.readFile(uri);
				fileContent = rawContent.value.toString();
			} catch {
				results.push(`Warning: Could not read ${fileUri}, skipping.`);
				continue;
			}

			const lines = fileContent.split('\n');
			const statementsToRemove = new Set(fileEntries.map(e => e.statement.trim()));

			// Remove lines that match the tracked statements (search by trimmed content)
			const filteredLines = lines.filter(line => !statementsToRemove.has(line.trim()));

			const removedCount = lines.length - filteredLines.length;
			totalRemoved += removedCount;

			if (removedCount > 0) {
				const newContent = filteredLines.join('\n');
				await this.fileService.writeFile(uri, VSBuffer.fromString(newContent));
				results.push(`Removed ${removedCount} statement(s) from ${fileUri}`);
			} else {
				results.push(`No matching statements found in ${fileUri} (may have been manually edited)`);
			}
		}

		// Clear tracked entries
		debugLoggingTracker.clear();

		return {
			content: [{
				kind: 'text',
				value: `Debug logging cleanup complete. ${totalRemoved} statement(s) removed.\n${results.join('\n')}`
			}]
		};
	}
}
