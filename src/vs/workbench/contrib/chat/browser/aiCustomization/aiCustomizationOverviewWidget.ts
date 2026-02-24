/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dimension } from '../../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IMcpWorkbenchService } from '../../../../contrib/mcp/common/mcpTypes.js';
import { AICustomizationManagementSection } from '../../common/aiCustomizationWorkspaceService.js';
import { PromptsType } from '../../common/promptSyntax/promptTypes.js';
import { IPromptsService } from '../../common/promptSyntax/service/promptsService.js';

interface ISectionCount {
	readonly section: AICustomizationManagementSection;
	readonly count: number | undefined; // undefined = loading
}

export class AICustomizationOverviewWidget extends Disposable {

	private readonly _onDidSelectSection = this._register(new Emitter<AICustomizationManagementSection>());
	readonly onDidSelectSection: Event<AICustomizationManagementSection> = this._onDidSelectSection.event;

	private container: HTMLElement | undefined;
	private counts = new Map<AICustomizationManagementSection, number | undefined>();

	constructor(
		@IPromptsService private readonly promptsService: IPromptsService,
		@IMcpWorkbenchService private readonly mcpWorkbenchService: IMcpWorkbenchService,
		@ICommandService private readonly commandService: ICommandService,
		@IOpenerService private readonly openerService: IOpenerService,
	) {
		super();
	}

	render(parent: HTMLElement): void {
		// TODO: implement two-mode rendering (2.3)
		this.container = parent;
	}

	async refresh(): Promise<void> {
		await this.refreshCounts();
	}

	private updateCountBadge(section: AICustomizationManagementSection, count: number | undefined): void {
		// stub for now (2.3)
	}

	private async refreshCounts(): Promise<void> {
		const sections = [
			AICustomizationManagementSection.Agents,
			AICustomizationManagementSection.Skills,
			AICustomizationManagementSection.Instructions,
			AICustomizationManagementSection.Prompts,
			AICustomizationManagementSection.Hooks,
			AICustomizationManagementSection.McpServers
		];

		// Set to skeleton state
		for (const section of sections) {
			this.counts.set(section, undefined);
			this.updateCountBadge(section, undefined);
		}

		// MCP is sync
		const mcpCount = this.mcpWorkbenchService.local.length;
		this.counts.set(AICustomizationManagementSection.McpServers, mcpCount);
		this.updateCountBadge(AICustomizationManagementSection.McpServers, mcpCount);

		// Other sections are async
		await Promise.allSettled([
			this.promptsService.getCustomAgents(CancellationToken.None).then(agents => {
				const count = agents.length;
				this.counts.set(AICustomizationManagementSection.Agents, count);
				this.updateCountBadge(AICustomizationManagementSection.Agents, count);
			}),
			this.promptsService.findAgentSkills(CancellationToken.None).then(skills => {
				const count = skills?.length ?? 0;
				this.counts.set(AICustomizationManagementSection.Skills, count);
				this.updateCountBadge(AICustomizationManagementSection.Skills, count);
			}),
			this.promptsService.listPromptFiles(PromptsType.instructions, CancellationToken.None).then(files => {
				const count = files.length;
				this.counts.set(AICustomizationManagementSection.Instructions, count);
				this.updateCountBadge(AICustomizationManagementSection.Instructions, count);
			}),
			this.promptsService.getPromptSlashCommands(CancellationToken.None).then(prompts => {
				const count = prompts.length;
				this.counts.set(AICustomizationManagementSection.Prompts, count);
				this.updateCountBadge(AICustomizationManagementSection.Prompts, count);
			}),
			this.promptsService.getHooks(CancellationToken.None).then(hooksInfo => {
				const count = hooksInfo ? Object.values(hooksInfo.hooks).reduce((acc: number, current) => acc + (current?.length ?? 0), 0) : 0;
				this.counts.set(AICustomizationManagementSection.Hooks, count);
				this.updateCountBadge(AICustomizationManagementSection.Hooks, count);
			})
		]);
	}

	layout(dimension: Dimension): void {
		// TODO: implement responsive layout
	}
}
