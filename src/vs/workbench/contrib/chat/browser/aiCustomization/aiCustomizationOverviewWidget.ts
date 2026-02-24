/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../../base/browser/dom.js';
import { Dimension } from '../../../../../base/browser/dom.js';
import { renderIcon } from '../../../../../base/browser/ui/iconLabel/iconLabels.js';
import { RunOnceScheduler } from '../../../../../base/common/async.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IMcpWorkbenchService } from '../../../../contrib/mcp/common/mcpTypes.js';
import { AICustomizationManagementSection } from '../../common/aiCustomizationWorkspaceService.js';
import { PromptsType } from '../../common/promptSyntax/promptTypes.js';
import { IPromptsService } from '../../common/promptSyntax/service/promptsService.js';
import * as AICustomizationIcons from './aiCustomizationIcons.js';

interface ISectionCount {
	readonly section: AICustomizationManagementSection;
	readonly count: number | undefined; // undefined = loading
}

export class AICustomizationOverviewWidget extends Disposable {

	private readonly _onDidSelectSection = this._register(new Emitter<AICustomizationManagementSection>());
	readonly onDidSelectSection: Event<AICustomizationManagementSection> = this._onDidSelectSection.event;

	private readonly refreshScheduler: RunOnceScheduler;
	private container: HTMLElement | undefined;
	private readonly counts = new Map<AICustomizationManagementSection, number | undefined>();
	private readonly badges = new Map<AICustomizationManagementSection, HTMLElement>();

	private get totalCount(): number {
		let total = 0;
		for (const count of this.counts.values()) {
			total += count ?? 0;
		}
		return total;
	}

	constructor(
		@IPromptsService private readonly promptsService: IPromptsService,
		@IMcpWorkbenchService private readonly mcpWorkbenchService: IMcpWorkbenchService,
		@ICommandService private readonly commandService: ICommandService,
		@IOpenerService private readonly openerService: IOpenerService,
	) {
		super();

		this.refreshScheduler = this._register(new RunOnceScheduler(() => {
			if (this.container) {
				this.refresh();
			}
		}, 300));

		this._register(this.promptsService.onDidChangeCustomAgents(() => this.refreshScheduler.schedule()));
		this._register(this.promptsService.onDidChangeSlashCommands(() => this.refreshScheduler.schedule()));
		this._register(this.mcpWorkbenchService.onChange(() => this.refreshScheduler.schedule()));
	}

	render(parent: HTMLElement): void {
		// TODO: implement two-mode rendering (2.3)
		this.container = parent;
		this.renderContent();
	}

	async refresh(): Promise<void> {
		await this.refreshCounts();
		this.renderContent();
	}

	private updateCountBadge(section: AICustomizationManagementSection, count: number | undefined): void {
		const badge = this.badges.get(section);
		if (badge) {
			badge.textContent = count === undefined ? "--" : `${count}`;
		}
	}

	private renderContent(): void {
		if (!this.container) {
			return;
		}

		clearNode(this.container);
		this.badges.clear();

		if (this.totalCount <= 1) {
			this.renderWelcome(this.container);
		} else {
			this.renderDashboard(this.container);
		}
	}

	private renderWelcome(parent: HTMLElement): void {
		const welcome = append(parent, $('.ai-customization-overview.overview-welcome'));

		const header = append(welcome, $('.overview-header'));
		append(header, $('h2')).textContent = localize('welcomeTitle', "Personalize Your AI Assistant");
		append(header, $('p.overview-subtitle')).textContent = localize('welcomeSubtitle', "Shape how Copilot works with custom instructions, agents, prompts, and more.");

		const suggestions = append(welcome, $('.overview-suggestions'));
		this.renderSuggestionCard(suggestions, AICustomizationManagementSection.Instructions, AICustomizationIcons.instructionsIcon, localize('instructionsTitle', "Instructions"), localize('instructionsDescription', "Guidelines that influence AI code generation"), localize('createInstructions', "Create Instructions"));
		this.renderSuggestionCard(suggestions, AICustomizationManagementSection.Agents, AICustomizationIcons.agentIcon, localize('agentsTitle', "Agents"), localize('agentsDescription', "Custom AI personas with specific tools and instructions"), localize('createAgent', "Create Agent"));
		this.renderSuggestionCard(suggestions, AICustomizationManagementSection.Prompts, AICustomizationIcons.promptIcon, localize('promptsTitle', "Prompts"), localize('promptsDescription', "Reusable prompts for common development tasks"), localize('createPrompt', "Create Prompt"));

		const footer = append(welcome, $('.overview-footer'));
		const exploreLink = append(footer, $('a.overview-explore-link'));
		exploreLink.textContent = localize('exploreLink', "Explore all customization types →");
		exploreLink.role = 'button';
		exploreLink.onclick = () => this._onDidSelectSection.fire(AICustomizationManagementSection.Agents); // Default to agents or keep on overview? Plan says explore all.
	}

	private renderSuggestionCard(parent: HTMLElement, section: AICustomizationManagementSection, icon: ThemeIcon, title: string, description: string, buttonLabel: string): void {
		const card = append(parent, $('.overview-suggestion-card'));
		
		const iconContainer = append(card, $('.suggestion-icon'));
		append(iconContainer, renderIcon(icon));

		const content = append(card, $('.suggestion-content'));
		append(content, $('.suggestion-title')).textContent = title;
		append(content, $('.suggestion-description')).textContent = description;

		const button = append(card, $('button.monaco-button'));
		button.textContent = buttonLabel;
		button.setAttribute('data-section', section);
	}

	private renderDashboard(parent: HTMLElement): void {
		const dashboard = append(parent, $('.ai-customization-overview.overview-dashboard'));
		const sectionsGrid = append(dashboard, $('.overview-sections'));

		const sections = [
			{ id: AICustomizationManagementSection.Agents, icon: AICustomizationIcons.agentIcon, label: localize('sectionAgents', "Agents"), description: localize('descAgents', "Custom AI personas with specific tools and instructions") },
			{ id: AICustomizationManagementSection.Skills, icon: AICustomizationIcons.skillIcon, label: localize('sectionSkills', "Skills"), description: localize('descSkills', "Folders of instructions Copilot loads when relevant") },
			{ id: AICustomizationManagementSection.Instructions, icon: AICustomizationIcons.instructionsIcon, label: localize('sectionInstructions', "Instructions"), description: localize('descInstructions', "Guidelines that influence AI code generation") },
			{ id: AICustomizationManagementSection.Prompts, icon: AICustomizationIcons.promptIcon, label: localize('sectionPrompts', "Prompts"), description: localize('descPrompts', "Reusable prompts for common development tasks") },
			{ id: AICustomizationManagementSection.Hooks, icon: AICustomizationIcons.hookIcon, label: localize('sectionHooks', "Hooks"), description: localize('descHooks', "Prompts executed at specific lifecycle points") },
			{ id: AICustomizationManagementSection.McpServers, icon: Codicon.server, label: localize('sectionMCP', "MCP Servers"), description: localize('descMCP', "External tools and services for AI") }
		];

		const emptySections: typeof sections = [];

		for (const section of sections) {
			const count = this.counts.get(section.id);
			if (count === 0) {
				emptySections.push(section);
			}

			const card = append(sectionsGrid, $('button.overview-section'));
			card.onclick = () => this._onDidSelectSection.fire(section.id);

			const iconContainer = append(card, $('.section-icon'));
			append(iconContainer, renderIcon(section.icon));

			const textContainer = append(card, $('.section-text'));
			append(textContainer, $('.section-label')).textContent = section.label;
			append(textContainer, $('.section-description')).textContent = section.description;

			const badge = append(card, $('.section-count'));
			this.badges.set(section.id, badge);
			this.updateCountBadge(section.id, count);
		}

		if (emptySections.length > 0) {
			const inlineSuggestions = append(dashboard, $('.overview-inline-suggestions'));
			for (const section of emptySections) {
				const suggestion = append(inlineSuggestions, $('.overview-inline-suggestion'));
				const icon = append(suggestion, $('.codicon'));
				icon.classList.add(...ThemeIcon.asClassNameArray(section.icon));
				
				append(suggestion, $('span')).textContent = localize('noItems', "No {0} yet", section.label.toLowerCase());
				const link = append(suggestion, $('a'));
				link.textContent = localize('createOne', "Create one →");
				link.role = 'button';
				link.setAttribute('data-section', section.id);
			}
		}
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
		// TODO: implement responsive layout (4.1)
	}
}
