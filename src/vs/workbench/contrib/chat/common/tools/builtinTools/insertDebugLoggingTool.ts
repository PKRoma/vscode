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

export const InsertDebugLoggingToolId = 'vscode_insertDebugLogging';

export const InsertDebugLoggingToolData: IToolData = {
	id: InsertDebugLoggingToolId,
	toolReferenceName: 'insertDebugLogging',
	displayName: localize('tool.insertDebugLogging', 'Insert Debug Logging'),
	modelDescription: 'Insert temporary debug logging statements into source files to diagnose a bug. Use this tool to instrument code with logging at specific locations to capture variable values, execution flow, and timing information at runtime. Each logging statement is tracked for clean removal later. Call this tool for each file you want to instrument. The logging statements should be designed to test specific hypotheses about the bug.',
	source: ToolDataSource.Internal,
	tags: ['debug'],
	inputSchema: {
		type: 'object',
		properties: {
			uri: {
				type: 'string',
				description: 'The URI of the file to instrument with logging.'
			},
			logStatements: {
				type: 'array',
				description: 'Array of logging statements to insert.',
				items: {
					type: 'object',
					properties: {
						lineNumber: {
							type: 'number',
							description: 'The 1-based line number AFTER which to insert the logging statement.'
						},
						statement: {
							type: 'string',
							description: 'The full logging statement to insert (e.g. console.log, print, Debug.WriteLine). Use a [DEBUG] prefix in the log message for easy identification.'
						},
						hypothesis: {
							type: 'string',
							description: 'The hypothesis this logging statement is designed to test.'
						}
					},
					required: ['lineNumber', 'statement', 'hypothesis']
				}
			}
		},
		required: ['uri', 'logStatements']
	}
};

interface ILogStatement {
	lineNumber: number;
	statement: string;
	hypothesis: string;
}

interface IInsertDebugLoggingParams {
	uri: string;
	logStatements: ILogStatement[];
}

export interface IDebugLoggingEntry {
	uri: string;
	lineNumber: number;
	insertedLineNumber: number;
	statement: string;
	hypothesis: string;
}

/**
 * Tracks all debug logging instrumentation across files for a session.
 */
export class DebugLoggingTracker {
	private readonly _entries: IDebugLoggingEntry[] = [];

	get entries(): readonly IDebugLoggingEntry[] {
		return this._entries;
	}

	addEntries(entries: IDebugLoggingEntry[]): void {
		this._entries.push(...entries);
	}

	getEntriesForFile(uri: string): IDebugLoggingEntry[] {
		return this._entries.filter(e => e.uri === uri);
	}

	clear(): IDebugLoggingEntry[] {
		return this._entries.splice(0, this._entries.length);
	}
}

// Global tracker shared between insert and remove tools
export const debugLoggingTracker = new DebugLoggingTracker();

export class InsertDebugLoggingTool implements IToolImpl {

	constructor(
		@IFileService private readonly fileService: IFileService,
	) { }

	async prepareToolInvocation(context: IToolInvocationPreparationContext, _token: CancellationToken): Promise<IPreparedToolInvocation | undefined> {
		const params = context.parameters as IInsertDebugLoggingParams;
		const count = params.logStatements?.length ?? 0;
		return {
			invocationMessage: localize('tool.insertDebugLogging.invocation', 'Inserting {0} debug logging statement(s)', count),
		};
	}

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, token: CancellationToken): Promise<IToolResult> {
		const params = invocation.parameters as IInsertDebugLoggingParams;

		if (!params.uri || !params.logStatements?.length) {
			return {
				content: [{ kind: 'text', value: 'Error: uri and logStatements are required.' }]
			};
		}

		const fileUri = URI.revive(params.uri as unknown as UriComponents);

		// Read the file
		let fileContent: string;
		try {
			const rawContent = await this.fileService.readFile(fileUri);
			fileContent = rawContent.value.toString();
		} catch {
			return {
				content: [{ kind: 'text', value: `Error: Could not read file ${params.uri}.` }]
			};
		}

		const lines = fileContent.split('\n');

		// Sort log statements by line number descending so insertions don't shift earlier line numbers
		const sortedStatements = [...params.logStatements].sort((a, b) => b.lineNumber - a.lineNumber);

		const insertedEntries: IDebugLoggingEntry[] = [];

		for (const stmt of sortedStatements) {
			if (token.isCancellationRequested) {
				break;
			}

			const insertIndex = Math.min(stmt.lineNumber, lines.length);

			// Determine indentation from the target line
			const targetLine = lines[Math.min(insertIndex, lines.length) - 1] ?? '';
			const indent = targetLine.match(/^(\s*)/)?.[1] ?? '';

			const loggingLine = `${indent}${stmt.statement}`;
			lines.splice(insertIndex, 0, loggingLine);

			insertedEntries.push({
				uri: params.uri,
				lineNumber: stmt.lineNumber,
				insertedLineNumber: insertIndex + 1,
				statement: stmt.statement,
				hypothesis: stmt.hypothesis,
			});
		}

		// Write the modified file
		const newContent = lines.join('\n');
		await this.fileService.writeFile(fileUri, VSBuffer.fromString(newContent));

		// Track the entries
		debugLoggingTracker.addEntries(insertedEntries);

		// Build response
		const summary = insertedEntries.map(e =>
			`- Line ${e.insertedLineNumber}: ${e.statement} (testing: ${e.hypothesis})`
		).join('\n');

		return {
			content: [{
				kind: 'text',
				value: `Inserted ${insertedEntries.length} debug logging statement(s) in ${params.uri}:\n${summary}\n\nTotal tracked instrumentation: ${debugLoggingTracker.entries.length} statement(s) across all files.\n\nNow ask the user to reproduce the bug so you can analyze the runtime output.`
			}]
		};
	}
}
