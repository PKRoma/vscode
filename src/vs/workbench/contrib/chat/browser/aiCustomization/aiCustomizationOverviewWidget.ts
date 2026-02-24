/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, Dimension, EventType } from '../../../../../base/browser/dom.js';
import { status } from '../../../../../base/browser/ui/aria/aria.js';
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
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { AICustomizationManagementCommands } from './aiCustomizationManagement.js';
import * as AICustomizationIcons from './aiCustomizationIcons.js';

/**
 * When the total count of customizations is at or below this threshold,
 * show the welcome stepper instead of the dashboard.
 */
const WELCOME_MODE_THRESHOLD = 2;

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

/**
 * Journey steps ordered by impact (80/20 Rule):
 * Instructions (50% of value) -> Prompts -> Agents -> Advanced (Skills, MCP, Hooks)
 */
interface IJourneyStep {
	readonly section: AICustomizationManagementSection;
	readonly icon: ThemeIcon;
	readonly title: string;
	readonly description: string;
	readonly ctaLabel: string;
	readonly docUrl: string;
}

/**
 * Advanced sub-items grouped into the collapsible final step.
 */
interface IAdvancedSubItem {
	readonly section: AICustomizationManagementSection;
	readonly icon: ThemeIcon;
	readonly label: string;
	readonly ctaLabel: string;
}

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
	private currentMode: 'welcome' | 'dashboard' | undefined;
	private _advancedExpanded = false;

	private get totalCount(): number {
		let total = 0;
		for (const count of this.counts.values()) {
			total += count ?? 0;
		}
		return total;
	}

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
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
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
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => this.refreshScheduler.schedule()));
	}

	render(parent: HTMLElement): void {
		this.container = parent;
		this.container.role = 'region';
		this.container.tabIndex = -1;
		this.container.ariaLabel = localize('aiCustomizationOverview', "AI Customization Overview");
		// Fetch counts first so we render the correct mode immediately,
		// avoiding a flash from welcome → dashboard.
		this.refresh();
	}

	async refresh(): Promise<void> {
		await this.refreshCounts();
		if (this._store.isDisposed) {
			return;
		}
		const newMode = this.totalCount <= WELCOME_MODE_THRESHOLD ? 'welcome' : 'dashboard';
		if (newMode !== this.currentMode) {
			const oldMode = this.currentMode;
			this.renderContent();
			if (oldMode !== undefined) {
				const announcement = newMode === 'dashboard'
					? localize('switchedToDashboard', "Switched to dashboard view")
					: localize('switchedToWelcome', "Switched to setup guide");
				status(announcement);
			}
		} else {
			for (const [section, count] of this.counts) {
				this.updateCountBadge(section, count);
			}
		}
	}

	private updateCountBadge(section: AICustomizationManagementSection, count: number | undefined): void {
		const badge = this.badges.get(section);
		if (badge) {
			const isZeroOrLoading = count === undefined || count === 0;
			const text = count === undefined ? '--' : (count === 0 ? localize('getStarted', "Get started") : `${count}`);
			if (badge.textContent !== text) {
				badge.textContent = text;
				badge.ariaLive = 'polite';
			}
			badge.classList.toggle('loading', count === undefined);
			badge.classList.toggle('get-started-link', isZeroOrLoading);
			badge.classList.toggle('count-badge', !isZeroOrLoading);

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
			case AICustomizationManagementSection.Instructions: return localize('descInstructions', "Define coding conventions, preferred libraries, and project structure");
			case AICustomizationManagementSection.Prompts: return localize('descPrompts', "Build reusable prompts for tasks you repeat every day");
			case AICustomizationManagementSection.Agents: return localize('descAgents', "Give Copilot personas for code review, architecture, or testing");
			case AICustomizationManagementSection.Skills: return localize('descSkills', "Folders of instructions Copilot loads when relevant");
			case AICustomizationManagementSection.McpServers: return localize('descMCP', "Connect external tools and services to Copilot");
			case AICustomizationManagementSection.Hooks: return localize('descHooks', "Automate prompts at specific lifecycle events");
			default: return '';
		}
	}

	private _getJourneySteps(): IJourneyStep[] {
		return [
			{
				section: AICustomizationManagementSection.Instructions,
				icon: AICustomizationIcons.instructionsIcon,
				title: localize('stepInstructionsTitle', "Set Your Standards"),
				description: localize('stepInstructionsDesc', "Define coding conventions, preferred libraries, and project structure. This single file eliminates most friction with Copilot."),
				ctaLabel: localize('generateInstructionsCta', "Generate Instructions"),
				docUrl: 'https://code.visualstudio.com/docs/copilot/copilot-customization',
			},
			{
				section: AICustomizationManagementSection.Prompts,
				icon: AICustomizationIcons.promptIcon,
				title: localize('stepPromptsTitle', "Automate Your Workflows"),
				description: localize('stepPromptsDesc', "Build reusable prompts for tasks you repeat every day -- code reviews, documentation, test generation."),
				ctaLabel: localize('createPrompt', "Create Prompt"),
				docUrl: 'https://code.visualstudio.com/docs/copilot/prompt-files',
			},
			{
				section: AICustomizationManagementSection.Agents,
				icon: AICustomizationIcons.agentIcon,
				title: localize('stepAgentsTitle', "Create Specialist AI"),
				description: localize('stepAgentsDesc', "Give Copilot specialized personas with their own instructions, tools, and knowledge for specific roles."),
				ctaLabel: localize('createAgent', "Create Agent"),
				docUrl: 'https://code.visualstudio.com/docs/copilot/copilot-extensibility-overview',
			},
		];
	}

	private _getAdvancedSubItems(): IAdvancedSubItem[] {
		return [
			{
				section: AICustomizationManagementSection.Skills,
				icon: AICustomizationIcons.skillIcon,
				label: localize('sectionSkills', "Skills"),
				ctaLabel: localize('createSkill', "Create Skill"),
			},
			{
				section: AICustomizationManagementSection.McpServers,
				icon: Codicon.server,
				label: localize('sectionMCP', "MCP Servers"),
				ctaLabel: localize('addMCPServer', "Add Server"),
			},
			{
				section: AICustomizationManagementSection.Hooks,
				icon: AICustomizationIcons.hookIcon,
				label: localize('sectionHooks', "Hooks"),
				ctaLabel: localize('createHook', "Create Hook"),
			},
		];
	}

	private renderContent(): void {
		if (!this.container) {
			return;
		}

		this.currentMode = this.totalCount <= WELCOME_MODE_THRESHOLD ? 'welcome' : 'dashboard';

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
		welcome.ariaLabel = localize('welcomeRegion', "AI Customization Setup Guide");

		const header = append(welcome, $('.welcome-header'));
		append(header, $('h2.hero-heading')).textContent = localize('welcomeTitle', "Copilot already writes great code. Teach it yours.");
		append(header, $('p.hero-subtitle')).textContent = localize('welcomeSubtitle', "Start with what matters most -- each step builds on the last.");

		// Journey stepper
		const stepper = append(welcome, $('.journey-stepper'));
		stepper.role = 'list';
		stepper.ariaLabel = localize('journeyStepperLabel', "Setup steps");

		const steps = this._getJourneySteps();
		let foundCurrent = false;

		for (let i = 0; i < steps.length; i++) {
			const step = steps[i];
			const count = this.counts.get(step.section) ?? 0;
			const isComplete = count > 0;
			const isCurrent = !isComplete && !foundCurrent;
			if (isCurrent) {
				foundCurrent = true;
			}

			this._renderJourneyStep(stepper, step, i + 1, isComplete, isCurrent);
		}

		// Advanced collapsible section
		this._renderAdvancedSection(welcome);

		// Footer doc link
		const footer = append(welcome, $('.overview-footer'));
		const docLink = append(footer, $('a.overview-explore-link')) as HTMLAnchorElement;
		docLink.textContent = localize('exploreDocsLink', "Explore the customization guide");
		docLink.href = 'https://code.visualstudio.com/docs/copilot/customization/overview';
		this._renderDisposables.add(addDisposableListener(docLink, EventType.CLICK, (e: MouseEvent) => {
			this.openerService.open(URI.parse('https://code.visualstudio.com/docs/copilot/customization/overview'));
			e.preventDefault();
		}));
	}

	private _renderJourneyStep(parent: HTMLElement, step: IJourneyStep, stepNumber: number, isComplete: boolean, isCurrent: boolean): void {
		const stepEl = append(parent, $('.journey-step'));
		stepEl.role = 'listitem';
		stepEl.classList.toggle('complete', isComplete);
		stepEl.classList.toggle('current', isCurrent);

		const statusLabel = isComplete
			? localize('stepComplete', "Completed")
			: (isCurrent ? localize('stepCurrent', "Current step") : localize('stepUpcoming', "Upcoming"));
		stepEl.ariaLabel = localize('journeyStepAriaLabel', "Step {0}: {1}, {2}. {3}", stepNumber, step.title, statusLabel, step.description);

		// Step indicator (number or check)
		const indicator = append(stepEl, $('.step-indicator'));
		indicator.ariaHidden = 'true';
		if (isComplete) {
			indicator.classList.add('complete');
			append(indicator, renderIcon(Codicon.check));
		} else {
			indicator.textContent = `${stepNumber}`;
		}

		// Step content
		const content = append(stepEl, $('.step-content'));
		const stepHeader = append(content, $('.step-header'));

		const iconContainer = append(stepHeader, $('.step-icon'));
		iconContainer.ariaHidden = 'true';
		append(iconContainer, renderIcon(step.icon));
		append(stepHeader, $('span.step-title')).textContent = step.title;

		append(content, $('p.step-description')).textContent = step.description;

		// Actions row
		const actions = append(content, $('.step-actions'));

		const commandId = createCommands[step.section];
		if (commandId) {
			const ctaButton = append(actions, $('button.step-cta'));
			ctaButton.ariaLabel = step.ctaLabel;
			if (step.section === AICustomizationManagementSection.Instructions) {
				ctaButton.classList.add('generate-instructions');
				const sparkleIcon = append(ctaButton, renderIcon(Codicon.sparkle));
				sparkleIcon.classList.add('step-cta-icon');
				sparkleIcon.ariaHidden = 'true';
				append(ctaButton, $('span')).textContent = step.ctaLabel;
			} else {
				ctaButton.textContent = step.ctaLabel;
			}
			this._renderDisposables.add(addDisposableListener(ctaButton, EventType.CLICK, () => {
				this.commandService.executeCommand(commandId);
			}));
		}

		const learnMore = append(actions, $('a.step-learn-more')) as HTMLAnchorElement;
		learnMore.textContent = localize('learnMore', "Learn more");
		learnMore.href = step.docUrl;
		this._renderDisposables.add(addDisposableListener(learnMore, EventType.CLICK, (e: MouseEvent) => {
			this.openerService.open(URI.parse(step.docUrl));
			e.preventDefault();
		}));

		// "View" link for completed steps to navigate
		if (isComplete) {
			const viewButton = append(actions, $('button.step-view-link'));
			viewButton.textContent = localize('viewItems', "View");
			this._renderDisposables.add(addDisposableListener(viewButton, EventType.CLICK, () => {
				this._onDidSelectSection.fire(step.section);
			}));
		}
	}

	private _renderAdvancedSection(parent: HTMLElement): void {
		const advanced = append(parent, $('.journey-advanced'));

		const toggle = append(advanced, $('button.advanced-toggle'));
		const toggleIcon = append(toggle, $('.toggle-icon'));
		append(toggleIcon, renderIcon(this._advancedExpanded ? Codicon.chevronDown : Codicon.chevronRight));
		append(toggle, $('span')).textContent = localize('advancedTitle', "Extend Your Reach");
		toggle.ariaExpanded = `${this._advancedExpanded}`;
		toggle.ariaLabel = localize('advancedToggleLabel', "Extend Your Reach -- connect external tools, add skills, and automate lifecycle events");

		const body = append(advanced, $('.advanced-body'));
		body.style.display = this._advancedExpanded ? '' : 'none';

		this._renderDisposables.add(addDisposableListener(toggle, EventType.CLICK, () => {
			this._advancedExpanded = !this._advancedExpanded;
			body.style.display = this._advancedExpanded ? '' : 'none';
			toggle.ariaExpanded = `${this._advancedExpanded}`;
			clearNode(toggleIcon);
			append(toggleIcon, renderIcon(this._advancedExpanded ? Codicon.chevronDown : Codicon.chevronRight));
		}));

		const subItems = this._getAdvancedSubItems();
		for (const item of subItems) {
			const row = append(body, $('.advanced-item'));

			const iconEl = append(row, $('.advanced-item-icon'));
			iconEl.ariaHidden = 'true';
			append(iconEl, renderIcon(item.icon));

			const label = append(row, $('span.advanced-item-label'));
			label.textContent = item.label;

			const count = this.counts.get(item.section) ?? 0;
			const badge = append(row, $('span.advanced-item-badge'));
			badge.textContent = `${count}`;
			this.badges.set(item.section, badge);

			// Navigate to section
			const viewButton = append(row, $('button.advanced-item-action'));
			const commandId = createCommands[item.section];
			if (count > 0) {
				viewButton.textContent = localize('viewItems', "View");
				this._renderDisposables.add(addDisposableListener(viewButton, EventType.CLICK, () => {
					this._onDidSelectSection.fire(item.section);
				}));
			} else if (commandId) {
				viewButton.textContent = item.ctaLabel;
				this._renderDisposables.add(addDisposableListener(viewButton, EventType.CLICK, () => {
					this.commandService.executeCommand(commandId);
				}));
			}
		}
	}

	private renderDashboard(parent: HTMLElement): void {
		const dashboard = append(parent, $('.ai-customization-overview-dashboard'));
		dashboard.role = 'region';
		dashboard.ariaLabel = localize('dashboardRegion', "AI Customization Dashboard");

		// Progress header
		const progressHeader = append(dashboard, $('.dashboard-progress'));
		const progressText = append(progressHeader, $('span.progress-text'));
		progressText.textContent = localize('progressSummary', "{0} of {1} customization types active", this.activeTypeCount, DASHBOARD_SECTIONS.length);

		// "What's Next" recommendation
		this._renderWhatsNext(dashboard);

		// Section cards grid
		const sectionsGrid = append(dashboard, $('.section-cards'));

		const sectionMeta: Record<string, { icon: ThemeIcon; label: string; description: string }> = {
			[AICustomizationManagementSection.Instructions]: { icon: AICustomizationIcons.instructionsIcon, label: localize('sectionInstructions', "Instructions"), description: this._getSectionDescription(AICustomizationManagementSection.Instructions) },
			[AICustomizationManagementSection.Prompts]: { icon: AICustomizationIcons.promptIcon, label: localize('sectionPrompts', "Prompts"), description: this._getSectionDescription(AICustomizationManagementSection.Prompts) },
			[AICustomizationManagementSection.Agents]: { icon: AICustomizationIcons.agentIcon, label: localize('sectionAgents', "Agents"), description: this._getSectionDescription(AICustomizationManagementSection.Agents) },
			[AICustomizationManagementSection.Skills]: { icon: AICustomizationIcons.skillIcon, label: localize('sectionSkills', "Skills"), description: this._getSectionDescription(AICustomizationManagementSection.Skills) },
			[AICustomizationManagementSection.McpServers]: { icon: Codicon.server, label: localize('sectionMCP', "MCP Servers"), description: this._getSectionDescription(AICustomizationManagementSection.McpServers) },
			[AICustomizationManagementSection.Hooks]: { icon: AICustomizationIcons.hookIcon, label: localize('sectionHooks', "Hooks"), description: this._getSectionDescription(AICustomizationManagementSection.Hooks) },
		};

		for (const sectionId of DASHBOARD_SECTIONS) {
			const meta = sectionMeta[sectionId];
			const count = this.counts.get(sectionId);

			const card = append(sectionsGrid, $('button.card'));
			this._sectionCards.set(sectionId, card);
			const countLabel = count === undefined ? localize('loading', "loading") : (count === 1 ? localize('oneItem', "1 item") : localize('manyItems', "{0} items", count));
			card.ariaLabel = localize('sectionCardAriaLabel', "{0}, {1}", meta.label, countLabel);
			const cardCommandId = createCommands[sectionId];
			this._renderDisposables.add(addDisposableListener(card, EventType.CLICK, () => {
				if (count === 0 && cardCommandId) {
					this.commandService.executeCommand(cardCommandId);
				} else {
					this._onDidSelectSection.fire(sectionId);
				}
			}));

			const iconContainer = append(card, $('.section-icon'));
			iconContainer.ariaHidden = 'true';
			append(iconContainer, renderIcon(meta.icon));

			const textContainer = append(card, $('.card-info'));
			append(textContainer, $('.card-title')).textContent = meta.label;
			append(textContainer, $('.card-description')).textContent = meta.description;

			const badge = append(card, $('span'));
			this.badges.set(sectionId, badge);
			this.updateCountBadge(sectionId, count);
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
			if (count === 0) {
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
			const cta = append(whatsNext, $('button.whats-next-cta'));
			cta.textContent = localize('whatsNextCta', "Create {0}", this._getSectionLabel(nextSection));
			cta.ariaLabel = localize('whatsNextCta', "Create {0}", this._getSectionLabel(nextSection));
			this._renderDisposables.add(addDisposableListener(cta, EventType.CLICK, () => {
				this.commandService.executeCommand(commandId);
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
				if (this._store.isDisposed) { return; }
				const count = agents.length;
				this.counts.set(AICustomizationManagementSection.Agents, count);
				this.updateCountBadge(AICustomizationManagementSection.Agents, count);
			}),
			this.promptsService.findAgentSkills(CancellationToken.None).then(skills => {
				if (this._store.isDisposed) { return; }
				const count = skills?.length ?? 0;
				this.counts.set(AICustomizationManagementSection.Skills, count);
				this.updateCountBadge(AICustomizationManagementSection.Skills, count);
			}),
			this.promptsService.listPromptFiles(PromptsType.instructions, CancellationToken.None).then(files => {
				if (this._store.isDisposed) { return; }
				const count = files.length;
				this.counts.set(AICustomizationManagementSection.Instructions, count);
				this.updateCountBadge(AICustomizationManagementSection.Instructions, count);
			}),
			this.promptsService.getPromptSlashCommands(CancellationToken.None).then(prompts => {
				if (this._store.isDisposed) { return; }
				const count = prompts.length;
				this.counts.set(AICustomizationManagementSection.Prompts, count);
				this.updateCountBadge(AICustomizationManagementSection.Prompts, count);
			}),
			this.promptsService.getHooks(CancellationToken.None).then(hooksInfo => {
				if (this._store.isDisposed) { return; }
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
		if (this.currentMode === 'welcome') {
			content.push(localize('overviewWelcomeAria', "AI Customization Setup Guide. Copilot already writes great code -- teach it your codebase with these steps."));
			const steps = this._getJourneySteps();
			for (let i = 0; i < steps.length; i++) {
				const step = steps[i];
				const count = this.counts.get(step.section) ?? 0;
				const status = count > 0 ? localize('stepDone', "done") : localize('stepPending', "pending");
				content.push(localize('stepStatus', "Step {0}: {1} ({2})", i + 1, step.title, status));
			}
			const subItems = this._getAdvancedSubItems();
			content.push(localize('advancedSectionLabel', "Advanced: {0}", subItems.map(item => {
				const count = this.counts.get(item.section) ?? 0;
				return `${item.label} (${count})`;
			}).join(', ')));
		} else {
			content.push(localize('overviewDashboardAriaV2', "AI Customization Dashboard. {0} of {1} customization types active.", this.activeTypeCount, DASHBOARD_SECTIONS.length));
			for (const section of DASHBOARD_SECTIONS) {
				const label = this._getSectionLabel(section);
				const count = this.counts.get(section);
				const countLabel = count === undefined ? localize('loading', "loading") : (count === 1 ? localize('oneItem', "1 item") : localize('manyItems', "{0} items", count));
				content.push(`${label}: ${countLabel}`);
			}
		}
		return content.join('\n');
	}
}
