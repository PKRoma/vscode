/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { autorun, derived, IObservable } from '../../../../base/common/observable.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IAICustomizationWorkspaceService, AICustomizationManagementSection, CustomizationCreationTarget } from '../../../../workbench/contrib/chat/common/aiCustomizationWorkspaceService.js';
import { IPromptsService, PromptsStorage } from '../../../../workbench/contrib/chat/common/promptSyntax/service/promptsService.js';
import { ISessionsManagementService } from '../../sessions/browser/sessionsManagementService.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IUserDataProfilesService } from '../../../../platform/userDataProfile/common/userDataProfile.js';
import { CustomizationCreatorService } from '../../../../workbench/contrib/chat/browser/aiCustomization/customizationCreatorService.js';
import { PromptsType } from '../../../../workbench/contrib/chat/common/promptSyntax/promptTypes.js';
import { preloadAllCounts } from '../../sessions/browser/customizationCounts.js';

/**
 * Agent Sessions override of IAICustomizationWorkspaceService.
 * Delegates to ISessionsManagementService to provide the active session's
 * worktree/repository as the project root, and supports worktree commit.
 */
export class SessionsAICustomizationWorkspaceService extends Disposable implements IAICustomizationWorkspaceService {
	declare readonly _serviceBrand: undefined;

	readonly activeProjectRoot: IObservable<URI | undefined>;

	readonly excludedUserFileRoots: readonly URI[];

	private readonly _itemCounts = new Map<string, number>();
	private readonly _onDidChangeItemCounts = new Emitter<void>();
	readonly onDidChangeItemCounts: Event<void> = this._onDidChangeItemCounts.event;

	private _pendingRefresh: Promise<void> | undefined;
	private _refreshScheduled = false;

	getItemCount(type: PromptsType, storage?: PromptsStorage): number {
		const key = storage ? `${type}:${storage}` : type;
		return this._itemCounts.get(key) ?? 0;
	}

	setItemCounts(type: PromptsType, items: readonly { storage: PromptsStorage }[]): void {
		const byStorage = new Map<PromptsStorage, number>();
		for (const item of items) {
			byStorage.set(item.storage, (byStorage.get(item.storage) ?? 0) + 1);
		}
		this._itemCounts.set(type, items.length);
		for (const s of Object.values(PromptsStorage)) {
			this._itemCounts.set(`${type}:${s}`, byStorage.get(s) ?? 0);
		}
		this._onDidChangeItemCounts.fire();
	}

	refreshCounts(): void {
		// If there's already a refresh in flight, schedule another after it finishes
		if (this._pendingRefresh) {
			this._refreshScheduled = true;
			return;
		}
		this._doRefresh();
	}

	private _doRefresh(): void {
		this._refreshScheduled = false;
		this._pendingRefresh = preloadAllCounts(this.promptsService, this).then(() => {
			this._pendingRefresh = undefined;
			if (this._refreshScheduled) {
				this._doRefresh();
			}
		}, () => {
			this._pendingRefresh = undefined;
		});
	}

	constructor(
		@ISessionsManagementService private readonly sessionsService: ISessionsManagementService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IUserDataProfilesService userDataProfilesService: IUserDataProfilesService,
		@IPromptsService private readonly promptsService: IPromptsService,
	) {
		super();
		this.excludedUserFileRoots = [userDataProfilesService.defaultProfile.promptsHome];
		this.activeProjectRoot = derived(reader => {
			const session = this.sessionsService.activeSession.read(reader);
			return session?.worktree ?? session?.repository;
		});

		// Auto-refresh counts when prompts change or the active session changes
		this._register(this.promptsService.onDidChangeCustomAgents(() => this.refreshCounts()));
		this._register(this.promptsService.onDidChangeSlashCommands(() => this.refreshCounts()));
		this._register(autorun(reader => {
			this.activeProjectRoot.read(reader);
			this.refreshCounts();
		}));
	}

	getActiveProjectRoot(): URI | undefined {
		const session = this.sessionsService.getActiveSession();
		return session?.worktree ?? session?.repository;
	}

	readonly managementSections: readonly AICustomizationManagementSection[] = [
		AICustomizationManagementSection.Agents,
		AICustomizationManagementSection.Skills,
		AICustomizationManagementSection.Instructions,
		AICustomizationManagementSection.Prompts,
		AICustomizationManagementSection.Hooks,
		// TODO: Re-enable MCP Servers once CLI MCP configuration is unified with VS Code
		// AICustomizationManagementSection.McpServers,
	];

	readonly visibleStorageSources: readonly PromptsStorage[] = [
		PromptsStorage.local,
		PromptsStorage.user,
	];

	getCreationTargets(type: PromptsType): readonly CustomizationCreationTarget[] {
		switch (type) {
			case PromptsType.instructions:
			case PromptsType.skill:
				return ['workspace', 'user'];
			case PromptsType.prompt:
			case PromptsType.agent:
			case PromptsType.hook:
			default:
				return ['workspace'];
		}
	}

	async commitFiles(projectRoot: URI, fileUris: URI[]): Promise<void> {
		const session = this.sessionsService.getActiveSession();
		if (session) {
			await this.sessionsService.commitWorktreeFiles(session, fileUris);
		}
	}

	async generateCustomization(type: PromptsType): Promise<void> {
		const creator = this.instantiationService.createInstance(CustomizationCreatorService);
		await creator.createWithAI(type);
	}
}
