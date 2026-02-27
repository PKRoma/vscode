/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';

// =============================================================================
// Claude Code SDK built-in tool interfaces
//
// The Claude Agent SDK (@anthropic-ai/claude-agent-sdk) exposes these built-in
// tools. Tool names come from the SDK as content blocks in assistant messages.
// =============================================================================

/**
 * Known Claude Code tool names. These are the tool_use block names that
 * appear in assistant messages from the Claude Agent SDK.
 */
const enum ClaudeToolName {
	Bash = 'Bash',
	Read = 'Read',
	Edit = 'Edit',
	Write = 'Write',
	MultiEdit = 'MultiEdit',
	Grep = 'Grep',
	Glob = 'Glob',
	LS = 'LS',
	Task = 'Task',
	WebSearch = 'WebSearch',
	WebFetch = 'WebFetch',
	TodoRead = 'TodoRead',
	TodoWrite = 'TodoWrite',
	Patch = 'Patch',
}

/** Parameters for the `Bash` tool. */
interface IClaudeBashToolArgs {
	command: string;
	timeout?: number;
}

/** Parameters for file tools (`Read`, `Edit`, `Write`). */
interface IClaudeFileToolArgs {
	file_path: string;
}

/** Parameters for the `Grep` tool. */
interface IClaudeGrepToolArgs {
	pattern: string;
	path?: string;
	include?: string;
}

/** Parameters for the `Glob` tool. */
interface IClaudeGlobToolArgs {
	pattern: string;
	path?: string;
}

/** Set of tool names that execute shell commands. */
const SHELL_TOOL_NAMES: ReadonlySet<string> = new Set([
	ClaudeToolName.Bash,
]);

/**
 * Tools that should not be shown to the user.
 */
const HIDDEN_TOOL_NAMES: ReadonlySet<string> = new Set([
	ClaudeToolName.TodoRead,
	ClaudeToolName.TodoWrite,
]);

/**
 * Returns true if the tool should be hidden from the UI.
 */
export function isHiddenClaudeTool(toolName: string): boolean {
	return HIDDEN_TOOL_NAMES.has(toolName);
}

// =============================================================================
// Display helpers
// =============================================================================

function truncate(text: string, maxLength: number): string {
	return text.length > maxLength ? text.substring(0, maxLength - 3) + '...' : text;
}

export function getClaudeToolDisplayName(toolName: string): string {
	switch (toolName) {
		case ClaudeToolName.Bash: return localize('claudeTool.bash', "Bash");
		case ClaudeToolName.Read: return localize('claudeTool.read', "Read File");
		case ClaudeToolName.Edit: return localize('claudeTool.edit', "Edit File");
		case ClaudeToolName.Write: return localize('claudeTool.write', "Write File");
		case ClaudeToolName.MultiEdit: return localize('claudeTool.multiEdit', "Multi Edit");
		case ClaudeToolName.Grep: return localize('claudeTool.grep', "Search");
		case ClaudeToolName.Glob: return localize('claudeTool.glob', "Find Files");
		case ClaudeToolName.LS: return localize('claudeTool.ls', "List Directory");
		case ClaudeToolName.Task: return localize('claudeTool.task', "Task");
		case ClaudeToolName.WebSearch: return localize('claudeTool.webSearch', "Web Search");
		case ClaudeToolName.WebFetch: return localize('claudeTool.webFetch', "Web Fetch");
		case ClaudeToolName.Patch: return localize('claudeTool.patch', "Patch");
		default: return toolName;
	}
}

export function getClaudeInvocationMessage(toolName: string, displayName: string, parameters: Record<string, unknown> | undefined): string {
	if (SHELL_TOOL_NAMES.has(toolName)) {
		const args = parameters as IClaudeBashToolArgs | undefined;
		if (args?.command) {
			const firstLine = args.command.split('\n')[0];
			return localize('claudeInvoke.bashCmd', "Running `{0}`", truncate(firstLine, 80));
		}
		return localize('claudeInvoke.bash', "Running command");
	}

	switch (toolName) {
		case ClaudeToolName.Read: {
			const args = parameters as IClaudeFileToolArgs | undefined;
			if (args?.file_path) {
				return localize('claudeInvoke.readFile', "Reading {0}", args.file_path);
			}
			return localize('claudeInvoke.read', "Reading file");
		}
		case ClaudeToolName.Edit: {
			const args = parameters as IClaudeFileToolArgs | undefined;
			if (args?.file_path) {
				return localize('claudeInvoke.editFile', "Editing {0}", args.file_path);
			}
			return localize('claudeInvoke.edit', "Editing file");
		}
		case ClaudeToolName.Write: {
			const args = parameters as IClaudeFileToolArgs | undefined;
			if (args?.file_path) {
				return localize('claudeInvoke.writeFile', "Writing to {0}", args.file_path);
			}
			return localize('claudeInvoke.write', "Writing file");
		}
		case ClaudeToolName.Grep: {
			const args = parameters as IClaudeGrepToolArgs | undefined;
			if (args?.pattern) {
				return localize('claudeInvoke.grepPattern', "Searching for `{0}`", truncate(args.pattern, 80));
			}
			return localize('claudeInvoke.grep', "Searching files");
		}
		case ClaudeToolName.Glob: {
			const args = parameters as IClaudeGlobToolArgs | undefined;
			if (args?.pattern) {
				return localize('claudeInvoke.globPattern', "Finding files matching `{0}`", truncate(args.pattern, 80));
			}
			return localize('claudeInvoke.glob', "Finding files");
		}
		default:
			return localize('claudeInvoke.generic', "Using \"{0}\"", displayName);
	}
}

export function getClaudePastTenseMessage(toolName: string, displayName: string, parameters: Record<string, unknown> | undefined, success: boolean): string {
	if (!success) {
		return localize('claudeComplete.failed', "\"{0}\" failed", displayName);
	}

	if (SHELL_TOOL_NAMES.has(toolName)) {
		const args = parameters as IClaudeBashToolArgs | undefined;
		if (args?.command) {
			const firstLine = args.command.split('\n')[0];
			return localize('claudeComplete.bashCmd', "Ran `{0}`", truncate(firstLine, 80));
		}
		return localize('claudeComplete.bash', "Ran command");
	}

	switch (toolName) {
		case ClaudeToolName.Read: {
			const args = parameters as IClaudeFileToolArgs | undefined;
			if (args?.file_path) {
				return localize('claudeComplete.readFile', "Read {0}", args.file_path);
			}
			return localize('claudeComplete.read', "Read file");
		}
		case ClaudeToolName.Edit: {
			const args = parameters as IClaudeFileToolArgs | undefined;
			if (args?.file_path) {
				return localize('claudeComplete.editFile', "Edited {0}", args.file_path);
			}
			return localize('claudeComplete.edit', "Edited file");
		}
		case ClaudeToolName.Write: {
			const args = parameters as IClaudeFileToolArgs | undefined;
			if (args?.file_path) {
				return localize('claudeComplete.writeFile', "Wrote to {0}", args.file_path);
			}
			return localize('claudeComplete.write', "Wrote file");
		}
		case ClaudeToolName.Grep: {
			const args = parameters as IClaudeGrepToolArgs | undefined;
			if (args?.pattern) {
				return localize('claudeComplete.grepPattern', "Searched for `{0}`", truncate(args.pattern, 80));
			}
			return localize('claudeComplete.grep', "Searched files");
		}
		case ClaudeToolName.Glob: {
			const args = parameters as IClaudeGlobToolArgs | undefined;
			if (args?.pattern) {
				return localize('claudeComplete.globPattern', "Found files matching `{0}`", truncate(args.pattern, 80));
			}
			return localize('claudeComplete.glob', "Found files");
		}
		default:
			return localize('claudeComplete.generic', "Used \"{0}\"", displayName);
	}
}

export function getClaudeToolInputString(toolName: string, parameters: Record<string, unknown> | undefined, rawArguments: string | undefined): string | undefined {
	if (!parameters && !rawArguments) {
		return undefined;
	}

	if (SHELL_TOOL_NAMES.has(toolName)) {
		const args = parameters as IClaudeBashToolArgs | undefined;
		return args?.command ?? rawArguments;
	}

	switch (toolName) {
		case ClaudeToolName.Grep: {
			const args = parameters as IClaudeGrepToolArgs | undefined;
			return args?.pattern ?? rawArguments;
		}
		default:
			if (parameters) {
				try {
					return JSON.stringify(parameters, null, 2);
				} catch {
					return rawArguments;
				}
			}
			return rawArguments;
	}
}

export function getClaudeToolKind(toolName: string): 'terminal' | undefined {
	if (SHELL_TOOL_NAMES.has(toolName)) {
		return 'terminal';
	}
	return undefined;
}

export function getClaudeShellLanguage(_toolName: string): string {
	return 'shellscript';
}
