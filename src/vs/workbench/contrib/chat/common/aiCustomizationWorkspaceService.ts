/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IObservable } from '../../../../base/common/observable.js';
import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { PromptsType } from './promptSyntax/promptTypes.js';
import { PromptsStorage } from './promptSyntax/service/promptsService.js';

export const IAICustomizationWorkspaceService = createDecorator<IAICustomizationWorkspaceService>('aiCustomizationWorkspaceService');

/**
 * Allowed creation targets for customization files.
 */
export type CustomizationCreationTarget = 'workspace' | 'user' | 'generate';

/**
 * Possible section IDs for the AI Customization Management Editor sidebar.
 */
export const AICustomizationManagementSection = {
	Agents: 'agents',
	Skills: 'skills',
	Instructions: 'instructions',
	Prompts: 'prompts',
	Hooks: 'hooks',
	McpServers: 'mcpServers',
	Models: 'models',
} as const;

export type AICustomizationManagementSection = typeof AICustomizationManagementSection[keyof typeof AICustomizationManagementSection];

/**
 * Provides workspace context for AI Customization views.
 */
export interface IAICustomizationWorkspaceService {
	readonly _serviceBrand: undefined;

	/**
	 * Observable that fires when the active project root changes.
	 */
	readonly activeProjectRoot: IObservable<URI | undefined>;

	/**
	 * Returns the current active project root, if any.
	 */
	getActiveProjectRoot(): URI | undefined;

	/**
	 * The sections to show in the AI Customization Management Editor sidebar.
	 */
	readonly managementSections: readonly AICustomizationManagementSection[];

	/**
	 * The storage sources to show as groups in the customization list.
	 */
	readonly visibleStorageSources: readonly PromptsStorage[];

	/**
	 * URI roots to exclude from user-level file listings.
	 * Files under these roots are hidden from the customization list.
	 */
	readonly excludedUserFileRoots: readonly URI[];

	/**
	 * Returns the allowed creation targets for a given customization type.
	 * The first item is the primary button action; remaining items appear in the dropdown.
	 */
	getCreationTargets(type: PromptsType): readonly CustomizationCreationTarget[];

	/**
	 * Returns the item count for a given customization type and storage.
	 * Counts are populated by the list widget after loading items.
	 */
	getItemCount(type: PromptsType, storage?: PromptsStorage): number;

	/**
	 * Updates the cached item counts for a customization type.
	 * Called by the list widget after loading items.
	 */
	setItemCounts(type: PromptsType, items: readonly { storage: PromptsStorage }[]): void;

	/**
	 * Event fired when item counts change.
	 */
	readonly onDidChangeItemCounts: Event<void>;

	/**
	 * Commits files in the active project.
	 */
	commitFiles(projectRoot: URI, fileUris: URI[]): Promise<void>;

	/**
	 * Launches the AI-guided creation flow for the given customization type.
	 */
	generateCustomization(type: PromptsType): Promise<void>;
}
