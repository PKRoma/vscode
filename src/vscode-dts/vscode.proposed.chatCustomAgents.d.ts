/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// version: 1

declare module 'vscode' {

	/**
	 * Represents a custom agent defined via an `.agent.md` file.
	 */
	export interface CustomAgent {
		/**
		 * The name of the custom agent.
		 */
		readonly name: string;

		/**
		 * The display label of the custom agent.
		 */
		readonly label: string;

		/**
		 * A description of the custom agent.
		 */
		readonly description: string;

		/**
		 * The prompt instructions for the custom agent.
		 */
		readonly prompt: string;

		/**
		 * The tools available to the custom agent, or `undefined` if not specified.
		 */
		readonly tools: readonly string[] | undefined;

		/**
		 * The target of the custom agent (e.g. `'vscode'`, `'github-copilot'`, `'claude'`), or `undefined` if not specified.
		 */
		readonly target: string | undefined;

		/**
		 * The model used by the custom agent, or `undefined` if not specified.
		 */
		readonly model: string | undefined;
	}

	export namespace chat {
		/**
		 * An event that fires when the list of {@link customAgents custom agents} changes.
		 */
		export const onDidChangeCustomAgents: Event<void>;

		/**
		 * The list of currently available custom agents. These are agents defined
		 * via `.agent.md` files from all sources (local, user, and extension-provided).
		 */
		export const customAgents: readonly CustomAgent[];
	}
}
