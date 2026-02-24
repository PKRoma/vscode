/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, EventType, StandardKeyboardEvent } from '../../../../../base/browser/dom.js';
import { Dimension } from '../../../../../base/browser/dom.js';
import { renderIcon } from '../../../../../base/browser/ui/iconLabel/iconLabels.js';
import { RunOnceScheduler } from '../../../../../base/common/async.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IMcpWorkbenchService } from '../../../../contrib/mcp/common/mcpTypes.js';
import { AICustomizationManagementSection } from '../../common/aiCustomizationWorkspaceService.js';
import { PromptsType } from '../../common/promptSyntax/promptTypes.js';
import { IPromptsService } from '../../common/promptSyntax/service/promptsService.js';
import { AICustomizationManagementCommands } from './aiCustomizationManagement.js';
import * as AICustomizationIcons from './aiCustomizationIcons.js';

const createCommands: Record<AICustomizationManagementSection, string | undefined> = {
	[AICustomizationManagementSection.Agents]: AICustomizationManagementCommands.CreateNewAgent,
	[AICustomizationManagementSection.Skills]: AICustomizationManagementCommands.CreateNewSkill,
	[AICustomizationManagementSection.Instructions]: AICustomizationManagementCommands.CreateNewInstructions,
	[AICustomizationManagementSection.Prompts]: AICustomizationManagementCommands.CreateNewPrompt,
	[AICustomizationManagementSection.Hooks]: 'workbench.action.chat.generateHook',
	[AICustomizationManagementSection.McpServers]: 'workbench.mcp.addConfiguration',
	[AICustomizationManagementSection.Overview]: undefined
};

interface ISectionCount {
	readonly section: AICustomizationManagementSection;
	readonly count: number | undefined; // undefined = loading
}

export class AICustomizationOverviewWidget extends Disposable {

	private readonly _onDidSelectSection = this._register(new Emitter<AICustomizationManagementSection>());
	readonly onDidSelectSection: Event<AICustomizationManagementSection> = this._onDidSelectSection.event;

	private readonly refreshScheduler: RunOnceScheduler;
	private readonly _renderDisposables = this._register(new DisposableStore());
	private container: HTMLElement | undefined;
	private readonly counts = new Map<AICustomizationManagementSection, number | undefined>();
	private readonly badges = new Map<AICustomizationManagementSection, HTMLElement>();
	private readonly _sectionCards = new Map<AICustomizationManagementSection, HTMLElement>();
	private currentMode: 'welcome' | 'dashboard' | undefined;

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
		this.container = parent;
		this.container.role = 'region';
		this.container.tabIndex = -1;
		this.container.ariaLabel = localize('aiCustomizationOverview', "AI Customization Overview");
		this.renderContent();
	}

	async refresh(): Promise<void> {
		await this.refreshCounts();
		const newMode = this.totalCount <= 1 ? 'welcome' : 'dashboard';
		if (newMode !== this.currentMode) {
			this.renderContent();
		} else {
			for (const [section, count] of this.counts) {
				this.updateCountBadge(section, count);
			}
		}
	}

	private updateCountBadge(section: AICustomizationManagementSection, count: number | undefined): void {
		const badge = this.badges.get(section);
		if (badge) {
			const text = count === undefined ? "--" : `${count}`;
			if (badge.textContent !== text) {
				badge.textContent = text;
				badge.ariaLive = 'polite';
			}
			badge.classList.toggle('loading', count === undefined);

			const card = this._sectionCards.get(section);
			if (card) {
				const sectionLabel = this._getSectionLabel(section);
				const countLabel = count === 1 ? localize('oneItem', "1 item") : localize('manyItems', "{0} items", count ?? 0);
				card.ariaLabel = localize('sectionCardAriaLabel', "{0}, {1}", sectionLabel, countLabel);
			}
		}
	}

	private _getSectionLabel(section: AICustomizationManagementSection): string {
		switch (section) {
			case AICustomizationManagementSection.Agents: return localize('sectionAgents', "Agents");
			case AICustomizationManagementSection.Skills: return localize('sectionSkills', "Skills");
			case AICustomizationManagementSection.Instructions: return localize('sectionInstructions', "Instructions");
			case AICustomizationManagementSection.Prompts: return localize('sectionPrompts', "Prompts");
			case AICustomizationManagementSection.Hooks: return localize('sectionHooks', "Hooks");
			case AICustomizationManagementSection.McpServers: return localize('sectionMCP', "MCP Servers");
			default: return "";
		}
	}

	private renderContent(): void {
		if (!this.container) {
			return;
		}

		this.currentMode = this.totalCount <= 1 ? 'welcome' : 'dashboard';

		clearNode(this.container);
		this._renderDisposables.clear();
		this.badges.clear();
		this._sectionCards.clear();

		if (this.currentMode === 'welcome') {
			this.renderWelcome(this.container);
		} else {
			this.renderDashboard(this.container);
		}
	}

	private renderWelcome(parent: HTMLElement): void {
		const welcome = append(parent, $('.ai-customization-overview-welcome'));
		welcome.role = 'region';
		welcome.ariaLabel = localize('welcomeRegion', "AI Customization Welcome");

		const header = append(welcome, $('.welcome-header')); // Using welcome-header if dashboard uses dashboard-header
		append(header, $('h2.hero-heading')).textContent = localize('welcomeTitle', "Personalize Your AI Assistant");
		append(header, $('p.hero-subtitle')).textContent = localize('welcomeSubtitle', "Shape how Copilot works with custom instructions, agents, prompts, and more.");

		const suggestions = append(welcome, $('.suggestion-cards'));
		this.renderSuggestionCard(suggestions, AICustomizationManagementSection.Instructions, AICustomizationIcons.instructionsIcon, localize('instructionsTitle', "Instructions"), localize('instructionsDescription', "Guidelines that influence AI code generation"), localize('createInstructions', "Create Instructions"));
		this.renderSuggestionCard(suggestions, AICustomizationManagementSection.Agents, AICustomizationIcons.agentIcon, localize('agentsTitle', "Agents"), localize('agentsDescription', "Custom AI personas with specific tools and instructions"), localize('createAgent', "Create Agent"));
		this.renderSuggestionCard(suggestions, AICustomizationManagementSection.Prompts, AICustomizationIcons.promptIcon, localize('promptsTitle', "Prompts"), localize('promptsDescription', "Reusable prompts for common development tasks"), localize('createPrompt', "Create Prompt"));

		const footer = append(welcome, $('.overview-footer'));
		const exploreLink = append(footer, $('a.overview-explore-link'));
		exploreLink.textContent = localize('exploreLink', "Explore all customization types →");
		exploreLink.role = 'button';
		exploreLink.tabIndex = 0;
		exploreLink.onclick = () => this._onDidSelectSection.fire(AICustomizationManagementSection.Agents);
		this._renderDisposables.add(addDisposableListener(exploreLink, EventType.KEY_DOWN, (e: KeyboardEvent) => {
			const keyboardEvent = new StandardKeyboardEvent(e);
			if (keyboardEvent.equals(KeyCode.Enter) || keyboardEvent.equals(KeyCode.Space)) {
				this._onDidSelectSection.fire(AICustomizationManagementSection.Agents);
				e.preventDefault();
				e.stopPropagation();
			}
		}));
	}

	private renderSuggestionCard(parent: HTMLElement, section: AICustomizationManagementSection, icon: ThemeIcon, title: string, description: string, buttonLabel: string): void {
		// Rule: NO nested interactive controls.
		// Card is a non-interactive layout container.
		const card = append(parent, $('.card'));

		// 1. Primary interaction: Navigate to section (wrapped icon + text)
		const navButton = append(card, $('button.card-content-button'));
		navButton.ariaLabel = localize('suggestionCardAriaLabel', "{0}, {1}", title, description);
		navButton.onclick = () => this._onDidSelectSection.fire(section);

		const iconContainer = append(navButton, $('.suggestion-icon'));
		iconContainer.ariaHidden = 'true';
		append(iconContainer, renderIcon(icon));

		const content = append(navButton, $('.card-content'));
		append(content, $('.card-title')).textContent = title;
		append(content, $('.card-description')).textContent = description;

		// 2. Secondary interaction: Inline create action
		const createButton = append(card, $('button.create-button'));
		createButton.textContent = buttonLabel;
		createButton.ariaLabel = buttonLabel;

		const commandId = createCommands[section];
		if (commandId) {
			createButton.onclick = (e) => {
				this.commandService.executeCommand(commandId);
				e.stopPropagation();
			};
		}
	}

	private renderDashboard(parent: HTMLElement): void {
		const dashboard = append(parent, $('.ai-customization-overview-dashboard'));
		dashboard.role = 'region';
		dashboard.ariaLabel = localize('dashboardRegion', "AI Customization Dashboard");

		const sectionsGrid = append(dashboard, $('.section-cards'));

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

			// For dashboard cards, we only have one action (navigation), so making the card itself a button is correct and non-nested.
			const card = append(sectionsGrid, $('button.card'));
			this._sectionCards.set(section.id, card);
			card.onclick = () => this._onDidSelectSection.fire(section.id);

			const iconContainer = append(card, $('.section-icon'));
			iconContainer.ariaHidden = 'true';
			append(iconContainer, renderIcon(section.icon));

			const textContainer = append(card, $('.card-info'));
			append(textContainer, $('.card-title')).textContent = section.label;
			append(textContainer, $('.card-description')).textContent = section.description;

			const badge = append(card, $('.count-badge'));
			this.badges.set(section.id, badge);
			this.updateCountBadge(section.id, count);
		}

		if (emptySections.length > 0) {
			const inlineSuggestions = append(dashboard, $('.overview-inline-suggestions'));
			for (const section of emptySections) {
				const suggestion = append(inlineSuggestions, $('.overview-inline-suggestion'));
				const icon = append(suggestion, $('.codicon'));
				icon.ariaHidden = 'true';
				icon.classList.add(...ThemeIcon.asClassNameArray(section.icon));

				append(suggestion, $('span')).textContent = localize('noItems', "No {0} yet", section.label.toLowerCase());
				const link = append(suggestion, $('a'));
				link.textContent = localize('createOne', "Create one →");
				link.role = 'button';
				link.tabIndex = 0;
				link.ariaLabel = localize('createOneAriaLabel', "Create {0}", section.label);

				const commandId = createCommands[section.id];
				if (commandId) {
					link.onclick = () => this.commandService.executeCommand(commandId);
					this._renderDisposables.add(addDisposableListener(link, EventType.KEY_DOWN, (e: KeyboardEvent) => {
						const keyboardEvent = new StandardKeyboardEvent(e);
						if (keyboardEvent.equals(KeyCode.Enter) || keyboardEvent.equals(KeyCode.Space)) {
							this.commandService.executeCommand(commandId);
							e.preventDefault();
							e.stopPropagation();
						}
					}));
				}
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

	focus(): void {
		if (this.container) {
			this.container.focus();
		}
	}

	getAccessibleDetails(): string {
		const content: string[] = [];
		if (this.currentMode === 'welcome') {
			content.push(localize('overviewWelcomeAria', "AI Customization Overview: Welcome mode. Shape how Copilot works with custom instructions, agents, and prompts."));
			content.push(localize('overviewWelcomeInstructions', "Available actions: Create Instructions, Create Agent, or Create Prompt."));
		} else {
			content.push(localize('overviewDashboardAria', "AI Customization Overview: Dashboard mode."));
			for (const [section, count] of this.counts) {
				const label = this._getSectionLabel(section);
				const countLabel = count === undefined ? localize('loading', "loading") : (count === 1 ? localize('oneItem', "1 item") : localize('manyItems', "{0} items", count));
				content.push(`${label}: ${countLabel}`);
			}
		}
		return content.join('\n');
	}
}
