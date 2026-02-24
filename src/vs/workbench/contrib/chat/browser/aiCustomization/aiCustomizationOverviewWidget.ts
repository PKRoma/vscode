/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, Dimension, EventType } from '../../../../../base/browser/dom.js';
import { renderIcon } from '../../../../../base/browser/ui/iconLabel/iconLabels.js';
import { RunOnceScheduler } from '../../../../../base/common/async.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { URI } from '../../../../../base/common/uri.js';
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
	[AICustomizationManagementSection.Instructions]: 'workbench.action.chat.generateInstructions',
	[AICustomizationManagementSection.Prompts]: AICustomizationManagementCommands.CreateNewPrompt,
	[AICustomizationManagementSection.Hooks]: 'workbench.action.chat.generateHook',
	[AICustomizationManagementSection.McpServers]: 'workbench.mcp.addConfiguration',
	[AICustomizationManagementSection.Models]: undefined,
	[AICustomizationManagementSection.Overview]: undefined
};

/** Sections ordered by 80/20 priority for dashboard cards */
const DASHBOARD_SECTIONS = [
	AICustomizationManagementSection.Instructions,
	AICustomizationManagementSection.Prompts,
	AICustomizationManagementSection.Agents,
	AICustomizationManagementSection.Skills,
	AICustomizationManagementSection.McpServers,
	AICustomizationManagementSection.Hooks,
] as const;

export class AICustomizationOverviewWidget extends Disposable {

	private readonly _onDidSelectSection = this._register(new Emitter<AICustomizationManagementSection>());
	readonly onDidSelectSection: Event<AICustomizationManagementSection> = this._onDidSelectSection.event;

	private readonly refreshScheduler: RunOnceScheduler;
	private readonly _renderDisposables = this._register(new DisposableStore());
	private container: HTMLElement | undefined;
	private readonly counts = new Map<AICustomizationManagementSection, number | undefined>();
	private readonly badges = new Map<AICustomizationManagementSection, HTMLElement>();
	private readonly _sectionCards = new Map<AICustomizationManagementSection, HTMLElement>();

	private get activeTypeCount(): number {
		let active = 0;
		for (const section of DASHBOARD_SECTIONS) {
			const count = this.counts.get(section);
			if (count !== undefined && count > 0) {
				active++;
			}
		}
		return active;
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
		this.refresh();
	}

	async refresh(): Promise<void> {
		await this.refreshCounts();
		this.renderContent();
	}

	private updateCountBadge(section: AICustomizationManagementSection, count: number | undefined): void {
		const badge = this.badges.get(section);
		if (badge) {
			const text = count === undefined ? '--' : `${count}`;
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
			default: return '';
		}
	}

	private _getSectionDescription(section: AICustomizationManagementSection): string {
		switch (section) {
			case AICustomizationManagementSection.Instructions: return localize('descInstructions', "Teach Copilot your coding standards once and keep every session aligned");
			case AICustomizationManagementSection.Prompts: return localize('descPrompts', "Package repeatable workflows into reusable slash-command prompts");
			case AICustomizationManagementSection.Agents: return localize('descAgents', "Create specialist collaborators for review, architecture, and testing");
			case AICustomizationManagementSection.Skills: return localize('descSkills', "Folders of instructions Copilot loads when relevant");
			case AICustomizationManagementSection.McpServers: return localize('descMCP', "Connect external tools and services to Copilot");
			case AICustomizationManagementSection.Hooks: return localize('descHooks', "Automate prompts at specific lifecycle events");
			default: return '';
		}
	}

	private _getSectionPitch(section: AICustomizationManagementSection): string {
		switch (section) {
			case AICustomizationManagementSection.Instructions: return localize('pitchInstructions', "Highest impact: remove most Copilot friction with one shared instruction file.");
			case AICustomizationManagementSection.Prompts: return localize('pitchPrompts', "Turn recurring tasks into one-click, repeatable workflows.");
			case AICustomizationManagementSection.Agents: return localize('pitchAgents', "Assign specialized personas with their own tools and context.");
			case AICustomizationManagementSection.Skills: return localize('pitchSkills', "Bundle domain playbooks Copilot can load automatically.");
			case AICustomizationManagementSection.McpServers: return localize('pitchMcp', "Bring external systems and internal tools directly into chat.");
			case AICustomizationManagementSection.Hooks: return localize('pitchHooks', "Trigger custom behavior at key moments in every session.");
			default: return '';
		}
	}

	private _getSectionDocUrl(section: AICustomizationManagementSection): string {
		switch (section) {
			case AICustomizationManagementSection.Instructions: return 'https://code.visualstudio.com/docs/copilot/copilot-customization';
			case AICustomizationManagementSection.Prompts: return 'https://code.visualstudio.com/docs/copilot/prompt-files';
			case AICustomizationManagementSection.Agents: return 'https://code.visualstudio.com/docs/copilot/copilot-extensibility-overview';
			case AICustomizationManagementSection.Skills: return 'https://code.visualstudio.com/docs/copilot/copilot-customization';
			case AICustomizationManagementSection.McpServers: return 'https://code.visualstudio.com/docs/copilot/chat/mcp-servers';
			case AICustomizationManagementSection.Hooks: return 'https://code.visualstudio.com/docs/copilot/customization/overview';
			default: return 'https://code.visualstudio.com/docs/copilot/customization/overview';
		}
	}

	private _getSectionActionLabel(section: AICustomizationManagementSection): string {
		switch (section) {
			case AICustomizationManagementSection.Instructions: return localize('generateInstructionsCta', "Generate Instructions");
			case AICustomizationManagementSection.Prompts: return localize('createPrompt', "Create Prompt");
			case AICustomizationManagementSection.Agents: return localize('createAgent', "Create Agent");
			case AICustomizationManagementSection.Skills: return localize('createSkill', "Create Skill");
			case AICustomizationManagementSection.McpServers: return localize('addMCPServer', "Add Server");
			case AICustomizationManagementSection.Hooks: return localize('createHook', "Create Hook");
			default: return localize('createLabel', "Create");
		}
	}

	private renderContent(): void {
		if (!this.container) {
			return;
		}

		clearNode(this.container);
		this._renderDisposables.clear();
		this.badges.clear();
		this._sectionCards.clear();
		this.renderDashboard(this.container);
	}

	private renderDashboard(parent: HTMLElement): void {
		const dashboard = append(parent, $('.ai-customization-overview-dashboard'));
		dashboard.role = 'region';
		dashboard.ariaLabel = localize('dashboardRegion', "AI Customization Dashboard");

		const intro = append(dashboard, $('.dashboard-intro'));
		append(intro, $('h2.dashboard-hero-heading')).textContent = localize('dashboardHeroHeading', "Copilot writes better code when it learns yours.");
		append(intro, $('p.dashboard-hero-subtitle')).textContent = localize('dashboardHeroSubtitle', "Start with Instructions, then add Prompts and Agents to scale your best practices across every session.");

		const introLink = append(intro, $('a.overview-explore-link'));
		introLink.textContent = localize('exploreDocsLink', "Explore the customization guide");
		introLink.setAttribute('href', this._getSectionDocUrl(AICustomizationManagementSection.Overview));
		this._renderDisposables.add(addDisposableListener(introLink, EventType.CLICK, (e: MouseEvent) => {
			this.openerService.open(URI.parse(this._getSectionDocUrl(AICustomizationManagementSection.Overview)));
			e.preventDefault();
		}));

		// Progress header
		const progressHeader = append(dashboard, $('.dashboard-progress'));
		const progressText = append(progressHeader, $('span.progress-text'));
		progressText.textContent = localize('progressSummary', "{0} of {1} customization types active", this.activeTypeCount, DASHBOARD_SECTIONS.length);

		// "What's Next" recommendation
		this._renderWhatsNext(dashboard);
		this._renderLearnMoreLinks(dashboard);

		// Section cards grid
		const sectionsGrid = append(dashboard, $('.section-cards'));

		const sectionMeta: Record<string, { icon: ThemeIcon; label: string; description: string; pitch: string }> = {
			[AICustomizationManagementSection.Instructions]: { icon: AICustomizationIcons.instructionsIcon, label: localize('sectionInstructions', "Instructions"), description: this._getSectionDescription(AICustomizationManagementSection.Instructions), pitch: this._getSectionPitch(AICustomizationManagementSection.Instructions) },
			[AICustomizationManagementSection.Prompts]: { icon: AICustomizationIcons.promptIcon, label: localize('sectionPrompts', "Prompts"), description: this._getSectionDescription(AICustomizationManagementSection.Prompts), pitch: this._getSectionPitch(AICustomizationManagementSection.Prompts) },
			[AICustomizationManagementSection.Agents]: { icon: AICustomizationIcons.agentIcon, label: localize('sectionAgents', "Agents"), description: this._getSectionDescription(AICustomizationManagementSection.Agents), pitch: this._getSectionPitch(AICustomizationManagementSection.Agents) },
			[AICustomizationManagementSection.Skills]: { icon: AICustomizationIcons.skillIcon, label: localize('sectionSkills', "Skills"), description: this._getSectionDescription(AICustomizationManagementSection.Skills), pitch: this._getSectionPitch(AICustomizationManagementSection.Skills) },
			[AICustomizationManagementSection.McpServers]: { icon: Codicon.server, label: localize('sectionMCP', "MCP Servers"), description: this._getSectionDescription(AICustomizationManagementSection.McpServers), pitch: this._getSectionPitch(AICustomizationManagementSection.McpServers) },
			[AICustomizationManagementSection.Hooks]: { icon: AICustomizationIcons.hookIcon, label: localize('sectionHooks', "Hooks"), description: this._getSectionDescription(AICustomizationManagementSection.Hooks), pitch: this._getSectionPitch(AICustomizationManagementSection.Hooks) },
		};

		for (const sectionId of DASHBOARD_SECTIONS) {
			const meta = sectionMeta[sectionId];
			const count = this.counts.get(sectionId);

			const card = append(sectionsGrid, $('button.card'));
			this._sectionCards.set(sectionId, card);
			const countLabel = count === undefined ? localize('loading', "loading") : (count === 1 ? localize('oneItem', "1 item") : localize('manyItems', "{0} items", count));
			card.ariaLabel = localize('sectionCardAriaLabel', "{0}, {1}", meta.label, countLabel);
			this._renderDisposables.add(addDisposableListener(card, EventType.CLICK, () => {
				this._onDidSelectSection.fire(sectionId);
			}));

			const iconContainer = append(card, $('.section-icon'));
			iconContainer.ariaHidden = 'true';
			append(iconContainer, renderIcon(meta.icon));

			const textContainer = append(card, $('.card-info'));
			append(textContainer, $('.card-title')).textContent = meta.label;
			append(textContainer, $('.card-description')).textContent = meta.description;
			append(textContainer, $('.card-pitch')).textContent = meta.pitch;

			if (count !== undefined && count > 0) {
				const badge = append(card, $('.count-badge'));
				this.badges.set(sectionId, badge);
				this.updateCountBadge(sectionId, count);
			} else {
				const getStarted = append(card, $('span.get-started-link'));
				getStarted.textContent = localize('getStarted', "Get started");
				this.badges.set(sectionId, getStarted);
			}
		}
	}

	private _renderLearnMoreLinks(parent: HTMLElement): void {
		const linksContainer = append(parent, $('.dashboard-learn-links'));
		append(linksContainer, $('span.learn-links-label')).textContent = localize('learnMoreLabel', "Learn more:");

		const learnSections = [
			AICustomizationManagementSection.Instructions,
			AICustomizationManagementSection.Prompts,
			AICustomizationManagementSection.Agents,
		];

		for (const section of learnSections) {
			const link = append(linksContainer, $('a.dashboard-learn-link'));
			link.textContent = this._getSectionLabel(section);
			link.setAttribute('href', this._getSectionDocUrl(section));
			this._renderDisposables.add(addDisposableListener(link, EventType.CLICK, (e: MouseEvent) => {
				this.openerService.open(URI.parse(this._getSectionDocUrl(section)));
				e.preventDefault();
			}));
		}
	}

	private _renderWhatsNext(parent: HTMLElement): void {
		// Find the highest-priority empty section
		const priorityOrder: AICustomizationManagementSection[] = [
			AICustomizationManagementSection.Instructions,
			AICustomizationManagementSection.Prompts,
			AICustomizationManagementSection.Agents,
		];

		const whatsNextMessages: Record<string, string> = {
			[AICustomizationManagementSection.Instructions]: localize('whatsNextInstructions', "Instructions are the single highest-impact customization. Define your coding standards to eliminate most friction with Copilot."),
			[AICustomizationManagementSection.Prompts]: localize('whatsNextPrompts', "You have instructions set up. Now create reusable prompts for tasks you repeat every day."),
			[AICustomizationManagementSection.Agents]: localize('whatsNextAgents', "Ready for the next level? Create custom agents with specialized instructions and tools."),
		};

		let nextSection: AICustomizationManagementSection | undefined;
		for (const section of priorityOrder) {
			const count = this.counts.get(section);
			if (count === undefined || count === 0) {
				nextSection = section;
				break;
			}
		}

		if (!nextSection) {
			return; // All primary sections have items
		}

		const whatsNext = append(parent, $('.whats-next'));
		whatsNext.role = 'region';
		whatsNext.ariaLabel = localize('whatsNextLabel', "Recommended next step");

		const whatsNextHeader = append(whatsNext, $('span.whats-next-header'));
		whatsNextHeader.textContent = localize('whatsNextTitle', "Recommended");

		const message = append(whatsNext, $('p.whats-next-message'));
		message.textContent = whatsNextMessages[nextSection] ?? '';

		const commandId = createCommands[nextSection];
		if (commandId) {
			const actions = append(whatsNext, $('.whats-next-actions'));

			const cta = append(actions, $('button.whats-next-cta'));
			cta.textContent = this._getSectionActionLabel(nextSection);
			cta.ariaLabel = this._getSectionActionLabel(nextSection);
			this._renderDisposables.add(addDisposableListener(cta, EventType.CLICK, () => {
				this.commandService.executeCommand(commandId);
			}));

			const learnMore = append(actions, $('a.whats-next-learn-more'));
			learnMore.textContent = localize('learnMore', "Learn more");
			learnMore.setAttribute('href', this._getSectionDocUrl(nextSection));
			this._renderDisposables.add(addDisposableListener(learnMore, EventType.CLICK, (e: MouseEvent) => {
				this.openerService.open(URI.parse(this._getSectionDocUrl(nextSection)));
				e.preventDefault();
			}));
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

	layout(_dimension: Dimension): void {
		// Layout is CSS-driven; no imperative adjustments needed.
	}

	focus(): void {
		if (this.container) {
			this.container.focus();
		}
	}

	getAccessibleDetails(): string {
		const content: string[] = [];
		content.push(localize('overviewDashboardAriaV3', "AI Customization Dashboard. {0} of {1} customization types active.", this.activeTypeCount, DASHBOARD_SECTIONS.length));
		for (const section of DASHBOARD_SECTIONS) {
			const label = this._getSectionLabel(section);
			const count = this.counts.get(section);
			const countLabel = count === undefined ? localize('loading', "loading") : (count === 1 ? localize('oneItem', "1 item") : localize('manyItems', "{0} items", count));
			content.push(`${label}: ${countLabel}`);
		}
		return content.join('\n');
	}
}
