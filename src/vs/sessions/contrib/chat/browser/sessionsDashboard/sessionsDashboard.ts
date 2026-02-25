/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './sessionsDashboard.css';
import * as dom from '../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { Disposable, DisposableStore, IDisposable } from '../../../../../base/common/lifecycle.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { autorun } from '../../../../../base/common/observable.js';
import { isEqual } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { renderIcon } from '../../../../../base/browser/ui/iconLabel/iconLabels.js';
import { localize } from '../../../../../nls.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IAgentSession } from '../../../../../workbench/contrib/chat/browser/agentSessions/agentSessionsModel.js';
import { AgentSessionProviders } from '../../../../../workbench/contrib/chat/browser/agentSessions/agentSessions.js';
import { ISessionsDashboardModel, SessionsDashboardModel } from './sessionsDashboardModel.js';
import { SessionCard, SessionCardMode } from './sessionCard.js';
import { ISuggestedIssue, SuggestedIssuesProvider } from './suggestedIssues.js';
import { IAgentSessionsService } from '../../../../../workbench/contrib/chat/browser/agentSessions/agentSessionsService.js';
import { ISessionsManagementService } from '../../../sessions/browser/sessionsManagementService.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { ChatSessionPosition, getResourceForNewChatSession } from '../../../../../workbench/contrib/chat/browser/chatSessions/chatSessions.contribution.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IChatService, IChatSendRequestOptions } from '../../../../../workbench/contrib/chat/common/chatService/chatService.js';
import { IChatSessionsService } from '../../../../../workbench/contrib/chat/common/chatSessionsService.js';
import { ChatAgentLocation, ChatModeKind } from '../../../../../workbench/contrib/chat/common/constants.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';

interface IDashboardSection {
	readonly key: string;
	readonly label: string;
	readonly cardMode: SessionCardMode;
	readonly container: HTMLElement;
	readonly headerEl: HTMLElement;
	readonly cardsContainer: HTMLElement;
	readonly countBadge: HTMLElement;
	readonly disposables: DisposableStore;
	collapsed: boolean;
}

export class SessionsDashboard extends Disposable {

	private readonly _element: HTMLElement;
	private readonly _model: ISessionsDashboardModel;
	private readonly _suggestedIssues: SuggestedIssuesProvider;
	private readonly _sections: IDashboardSection[] = [];
	private readonly _cards: SessionCard[] = [];
	private _suggestedContainer: HTMLElement | undefined;
	private _suggestedShowMore: HTMLElement | undefined;
	private _suggestedExpanded = false;
	private _expandedSuggestedCard: { card: HTMLElement; options: HTMLElement } | undefined;
	private _selectedResource: URI | undefined;
	private _isDisposed = false;
	private static readonly SUGGESTED_INITIAL_COUNT = 2;
	private static readonly SUGGESTED_EXPANDED_COUNT = 8;

	get element(): HTMLElement { return this._element; }
	get isEmpty(): ISessionsDashboardModel['isEmpty'] { return this._model.isEmpty; }

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IAgentSessionsService private readonly agentSessionsService: IAgentSessionsService,
		@ISessionsManagementService private readonly sessionsManagementService: ISessionsManagementService,
		@IChatService private readonly chatService: IChatService,
		@IChatSessionsService private readonly chatSessionsService: IChatSessionsService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ILogService private readonly logService: ILogService,
	) {
		super();

		this._model = this._register(this.instantiationService.createInstance(SessionsDashboardModel));
		this._suggestedIssues = this._register(this.instantiationService.createInstance(SuggestedIssuesProvider));
		this._element = dom.$('.sessions-dashboard');

		// "Suggested" section: GitHub issues that can be tackled by the agent
		this._createSuggestedSection();

		// "Active" section: running + needs-input sessions as rows
		this._createSection('running', localize('section.running', "Running"), 'row');
		// "Unread" section: completed sessions the user hasn't clicked yet
		this._createSection('unread', localize('section.unread', "Unread"), 'row');
		// "Recent" section: all completed sessions, collapsed by default
		this._createSection('recent', localize('section.recent', "Recent"), 'row', true);

		// Re-render suggested when issues arrive
		this._register(this._suggestedIssues.onDidChange(() => {
			this._renderSuggestedIssues();
		}));

		this._register(autorun(reader => {
			if (this._isDisposed) { return; }
			const needsInput = this._model.needsInput.read(reader);
			const inProgress = this._model.inProgress.read(reader);
			const completed = this._model.recentlyCompleted.read(reader);

			// Running = all in-progress + needs-input sessions
			const runningSessions = [...needsInput, ...inProgress];
			const runningSet = new Set(runningSessions.map(s => s.resource.toString()));
			this._renderSection('running', runningSessions);

			// Exclude sessions already shown in Running
			const completedOnly = completed.filter(s => !runningSet.has(s.resource.toString()));

			// Unread = completed sessions not yet read (keep selected one visible)
			const unread = completedOnly.filter(s =>
				!s.isRead()
				|| (this._selectedResource && isEqual(s.resource, this._selectedResource))
			);
			const unreadSet = new Set(unread.map(s => s.resource.toString()));
			this._renderSection('unread', unread);

			// Recent = completed sessions NOT in unread (already read)
			const recent = completedOnly.filter(s => !unreadSet.has(s.resource.toString()));
			this._renderSection('recent', recent);

			this._element.classList.toggle('empty',
				runningSessions.length === 0 && unread.length === 0 && recent.length === 0);
		}));
	}

	private _createSection(key: string, label: string, cardMode: SessionCardMode, initialCollapsed?: boolean): void {
		const container = dom.append(this._element, dom.$(`.sessions-dashboard-section[data-section="${key}"]`));
		const headerEl = dom.append(container, dom.$('.sessions-dashboard-section-header'));

		// Collapse toggle
		const chevron = dom.append(headerEl, dom.$('.sessions-dashboard-section-chevron'));
		dom.append(chevron, renderIcon(Codicon.chevronDown));

		const titleEl = dom.append(headerEl, dom.$('.sessions-dashboard-section-title'));
		titleEl.textContent = label;

		const countBadge = dom.append(headerEl, dom.$('.sessions-dashboard-section-count'));

		const cardsContainer = dom.append(container, dom.$('.sessions-dashboard-section-cards'));
		const disposables = this._register(new DisposableStore());

		const collapsed = initialCollapsed ?? false;
		const section: IDashboardSection = { key, label, cardMode, container, headerEl, cardsContainer, countBadge, disposables, collapsed };
		this._sections.push(section);

		// Apply initial collapsed state
		if (collapsed) {
			container.classList.add('collapsed');
			chevron.classList.add('collapsed');
		}

		// Toggle collapse on header click
		this._register(dom.addDisposableListener(headerEl, dom.EventType.CLICK, () => {
			section.collapsed = !section.collapsed;
			container.classList.toggle('collapsed', section.collapsed);
			chevron.classList.toggle('collapsed', section.collapsed);
		}));
	}

	private _renderSection(key: string, sessions: readonly IAgentSession[]): void {
		const section = this._sections.find(s => s.key === key);
		if (!section) { return; }

		section.disposables.clear();
		dom.clearNode(section.cardsContainer);

		section.container.classList.toggle('hidden', sessions.length === 0);
		section.countBadge.textContent = sessions.length > 0 ? `${sessions.length}` : '';

		// Remove old cards for this section from tracker
		const otherCards = this._cards.filter(c =>
			!sessions.some(s => isEqual(s.resource, c.sessionResource))
		);
		this._cards.length = 0;
		this._cards.push(...otherCards);

		for (const session of sessions) {
			const card = section.disposables.add(
				this.instantiationService.createInstance(SessionCard, session, section.cardMode)
			);

			if (this._selectedResource && isEqual(session.resource, this._selectedResource)) {
				card.setSelected(true);
			}

			// Apply read styling from the persisted model
			if (session.isRead()) {
				card.markRead();
			}

			section.disposables.add(card.onDidSelect(resource => {
				this._selectCard(resource);
			}));

			section.cardsContainer.appendChild(card.element);
			this._cards.push(card);
		}
	}

	private _selectCard(resource: URI): void {
		// Mark as read in the persisted model
		const session = this.agentSessionsService.getSession(resource);
		if (session && !session.isRead()) {
			session.setRead(true);
		}

		// Toggle selection
		if (this._selectedResource && isEqual(this._selectedResource, resource)) {
			this._selectedResource = undefined;
			this.sessionsManagementService.selectSession(undefined);
		} else {
			this._selectedResource = resource;
			this.sessionsManagementService.selectSession(resource);
		}

		// Re-render all session sections so the selected card gets expanded
		// and read/unread states are applied correctly.
		const needsInput = this._model.needsInput.get();
		const inProgress = this._model.inProgress.get();
		const completed = this._model.recentlyCompleted.get();

		const runningSessions = [...needsInput, ...inProgress];
		const runningSet = new Set(runningSessions.map(s => s.resource.toString()));
		this._renderSection('running', runningSessions);

		const completedOnly = completed.filter(s => !runningSet.has(s.resource.toString()));

		const unread = completedOnly.filter(s =>
			!s.isRead()
			|| (this._selectedResource && isEqual(s.resource, this._selectedResource))
		);
		const unreadSet = new Set(unread.map(s => s.resource.toString()));
		this._renderSection('unread', unread);

		const recent = completedOnly.filter(s => !unreadSet.has(s.resource.toString()));
		this._renderSection('recent', recent);

		this._element.classList.toggle('empty',
			runningSessions.length === 0 && unread.length === 0 && recent.length === 0);
	}

	layout(_height: number, _width: number): void { /* auto-reflow via CSS */ }

	// --- Suggested issues section ---

	private _suggestedFilterInput: HTMLInputElement | undefined;
	private _suggestedFilterSubtitle: HTMLElement | undefined;
	private _suggestedFilterVisible = false;

	private _createSuggestedSection(): void {
		const section = dom.append(this._element, dom.$('.sessions-dashboard-section.suggested-section'));
		const headerEl = dom.append(section, dom.$('.sessions-dashboard-section-header'));
		const titleEl = dom.append(headerEl, dom.$('.sessions-dashboard-section-title'));
		titleEl.textContent = localize('section.suggested', "Suggested");

		// Gear icon to customize filter
		const gearBtn = dom.append(headerEl, dom.$('.suggested-gear-button'));
		gearBtn.tabIndex = 0;
		gearBtn.role = 'button';
		gearBtn.title = localize('suggested.customize', "Customize filter...");
		dom.append(gearBtn, renderIcon(Codicon.gear));

		this._register(dom.addDisposableListener(gearBtn, dom.EventType.CLICK, (e) => {
			e.stopPropagation();
			this._toggleFilterInput();
		}));

		// Filter subtitle (shows the active filter)
		this._suggestedFilterSubtitle = dom.append(section, dom.$('.suggested-filter-subtitle'));
		this._updateFilterSubtitle();

		// Inline filter input (hidden by default)
		const filterRow = dom.append(section, dom.$('.suggested-filter-row.hidden'));
		this._suggestedFilterInput = dom.append(filterRow, dom.$('input.suggested-filter-input')) as HTMLInputElement;
		this._suggestedFilterInput.type = 'text';
		this._suggestedFilterInput.placeholder = localize('suggested.filterPlaceholder', "e.g. \"label: bug\" or \"assigned to me\" or \"repo: owner/name\"");
		this._suggestedFilterInput.value = this._suggestedIssues.filter;

		this._register(dom.addDisposableListener(this._suggestedFilterInput, dom.EventType.KEY_DOWN, (e) => {
			if (e.keyCode === KeyCode.Enter) {
				e.preventDefault();
				this._applyFilter();
			}
			if (e.keyCode === KeyCode.Escape) {
				e.preventDefault();
				this._toggleFilterInput();
			}
		}));

		const applyBtn = dom.append(filterRow, dom.$('.suggested-filter-apply'));
		applyBtn.tabIndex = 0;
		applyBtn.role = 'button';
		applyBtn.title = localize('suggested.apply', "Apply");
		dom.append(applyBtn, renderIcon(Codicon.check));
		this._register(dom.addDisposableListener(applyBtn, dom.EventType.CLICK, (e) => {
			e.stopPropagation();
			this._applyFilter();
		}));

		const clearBtn = dom.append(filterRow, dom.$('.suggested-filter-clear'));
		clearBtn.tabIndex = 0;
		clearBtn.role = 'button';
		clearBtn.title = localize('suggested.clear', "Clear filter");
		dom.append(clearBtn, renderIcon(Codicon.close));
		this._register(dom.addDisposableListener(clearBtn, dom.EventType.CLICK, (e) => {
			e.stopPropagation();
			if (this._suggestedFilterInput) {
				this._suggestedFilterInput.value = '';
			}
			this._applyFilter();
		}));

		this._suggestedContainer = dom.append(section, dom.$('.sessions-dashboard-suggested-cards'));

		this._suggestedShowMore = dom.append(section, dom.$('.sessions-dashboard-show-more'));
		this._suggestedShowMore.textContent = localize('showMore', "Show More");
		this._suggestedShowMore.tabIndex = 0;
		this._suggestedShowMore.role = 'button';

		this._register(dom.addDisposableListener(this._suggestedShowMore, dom.EventType.CLICK, () => {
			this._suggestedExpanded = true;
			this._suggestedIssues.fetchIssues(SessionsDashboard.SUGGESTED_EXPANDED_COUNT);
		}));

		// Initially hidden until issues arrive
		section.classList.add('hidden');
	}

	private _toggleFilterInput(): void {
		this._suggestedFilterVisible = !this._suggestedFilterVisible;
		const filterRow = this._suggestedFilterInput?.parentElement;
		filterRow?.classList.toggle('hidden', !this._suggestedFilterVisible);
		if (this._suggestedFilterVisible) {
			this._suggestedFilterInput?.focus();
		}
	}

	private _applyFilter(): void {
		const value = this._suggestedFilterInput?.value ?? '';
		this._suggestedIssues.setFilter(value);
		this._suggestedFilterVisible = false;
		this._suggestedFilterInput?.parentElement?.classList.add('hidden');
		this._updateFilterSubtitle();
	}

	private _updateFilterSubtitle(): void {
		if (!this._suggestedFilterSubtitle) {
			return;
		}
		const filter = this._suggestedIssues.filter;
		const query = this._suggestedIssues.lastQuery;
		if (filter && query) {
			// Show the user's filter and the translated GitHub query
			this._suggestedFilterSubtitle.textContent = `"${filter}" → ${query}`;
			this._suggestedFilterSubtitle.classList.remove('hidden');
		} else if (filter) {
			this._suggestedFilterSubtitle.textContent = filter;
			this._suggestedFilterSubtitle.classList.remove('hidden');
		} else {
			this._suggestedFilterSubtitle.textContent = localize('suggested.defaultFilter', "Issues assigned to you");
			this._suggestedFilterSubtitle.classList.remove('hidden');
		}
	}

	private _renderSuggestedIssues(): void {
		if (!this._suggestedContainer) {
			return;
		}

		dom.clearNode(this._suggestedContainer);
		this._updateFilterSubtitle();

		const issues = this._suggestedIssues.issues;
		const sectionEl = this._suggestedContainer.parentElement!;

		// Always show the section when a filter is active (so user sees "no results")
		// or when there are issues, or while loading
		const hasFilter = !!this._suggestedIssues.filter;
		if (issues.length === 0 && !this._suggestedIssues.loading && !hasFilter) {
			sectionEl.classList.add('hidden');
			return;
		}

		sectionEl.classList.remove('hidden');

		if (issues.length === 0 && !this._suggestedIssues.loading) {
			const emptyMsg = dom.append(this._suggestedContainer, dom.$('.suggested-empty-message'));
			emptyMsg.textContent = localize('suggested.noResults', "No issues found. Try adjusting your filter.");
			return;
		}

		const visibleIssues = this._suggestedExpanded ? issues : issues.slice(0, SessionsDashboard.SUGGESTED_INITIAL_COUNT);

		for (const issue of visibleIssues) {
			const card = dom.append(this._suggestedContainer, dom.$('.suggested-issue-card'));
			card.tabIndex = 0;
			card.role = 'button';

			const titleRow = dom.append(card, dom.$('.suggested-issue-title'));
			const numberSpan = dom.append(titleRow, dom.$('span.suggested-issue-number'));
			numberSpan.textContent = `#${issue.number}`;
			const titleSpan = dom.append(titleRow, dom.$('span'));
			titleSpan.textContent = issue.title;

			if (issue.labels.length > 0) {
				const labelsRow = dom.append(card, dom.$('.suggested-issue-labels'));
				for (const label of issue.labels.slice(0, 3)) {
					const pill = dom.append(labelsRow, dom.$('span.suggested-issue-label'));
					pill.textContent = label;
				}
			}

			// Expandable options area (hidden until clicked)
			const optionsArea = dom.append(card, dom.$('.suggested-issue-options.hidden'));

			// Target picker: Local / Cloud
			const targetRow = dom.append(optionsArea, dom.$('.suggested-issue-target-row'));
			const targetLabel = dom.append(targetRow, dom.$('span.suggested-issue-option-label'));
			targetLabel.textContent = localize('suggested.target', "Target:");
			let selectedTarget = AgentSessionProviders.Background;

			const localBtn = dom.append(targetRow, dom.$('.suggested-target-btn.selected'));
			localBtn.textContent = localize('suggested.local', "Local");
			localBtn.tabIndex = 0;
			localBtn.role = 'radio';

			const cloudBtn = dom.append(targetRow, dom.$('.suggested-target-btn'));
			cloudBtn.textContent = localize('suggested.cloud', "Cloud");
			cloudBtn.tabIndex = 0;
			cloudBtn.role = 'radio';

			this._register(dom.addDisposableListener(localBtn, dom.EventType.CLICK, (e) => {
				e.stopPropagation();
				selectedTarget = AgentSessionProviders.Background;
				localBtn.classList.add('selected');
				cloudBtn.classList.remove('selected');
			}));

			this._register(dom.addDisposableListener(cloudBtn, dom.EventType.CLICK, (e) => {
				e.stopPropagation();
				selectedTarget = AgentSessionProviders.Cloud;
				cloudBtn.classList.add('selected');
				localBtn.classList.remove('selected');
			}));

			// Start button
			const startBtn = dom.append(optionsArea, dom.$('.suggested-start-btn'));
			dom.append(startBtn, renderIcon(Codicon.play));
			dom.append(startBtn, dom.$('span', undefined, localize('suggested.start', "Start Session")));
			startBtn.tabIndex = 0;
			startBtn.role = 'button';

			this._register(dom.addDisposableListener(startBtn, dom.EventType.CLICK, (e) => {
				e.stopPropagation();
				card.remove();
				this._startSessionFromIssue(issue, selectedTarget);
			}));

			// Click card to expand/collapse options
			this._register(dom.addDisposableListener(card, dom.EventType.CLICK, (e) => {
				if ((e.target as HTMLElement).closest('.suggested-issue-options')) {
					return; // Don't toggle when clicking inside options
				}
				const isExpanded = !optionsArea.classList.contains('hidden');
				// Collapse previously expanded card
				if (this._expandedSuggestedCard) {
					this._expandedSuggestedCard.options.classList.add('hidden');
					this._expandedSuggestedCard.card.classList.remove('expanded');
					this._expandedSuggestedCard = undefined;
				}
				if (!isExpanded) {
					optionsArea.classList.remove('hidden');
					card.classList.add('expanded');
					this._expandedSuggestedCard = { card, options: optionsArea };
				}
			}));
		}

		// Toggle "Show More" visibility
		if (this._suggestedShowMore) {
			const showMore = !this._suggestedExpanded && issues.length >= SessionsDashboard.SUGGESTED_INITIAL_COUNT;
			this._suggestedShowMore.classList.toggle('hidden', !showMore);
		}
	}

	private async _startSessionFromIssue(issue: ISuggestedIssue, target: AgentSessionProviders): Promise<void> {
		try {
			const defaultRepoUri = this.workspaceContextService.getWorkspace().folders[0]?.uri;
			const resource = getResourceForNewChatSession({
				type: target,
				position: ChatSessionPosition.Sidebar,
				displayName: '',
			});

			const session = await this.sessionsManagementService.createNewSessionForTarget(
				target,
				resource,
				defaultRepoUri,
			);

			const query = localize(
				'suggested.prompt',
				"Fix GitHub issue #{0}: {1}\n\nRepository: {2}\nIssue URL: {3}",
				issue.number,
				issue.title,
				issue.repositoryNwo,
				issue.htmlUrl,
			);

			session.setQuery(query);

			// Create the chat session and load the model WITHOUT opening the UI
			const contribution = this.chatSessionsService.getChatSessionContribution(target);
			await this.chatSessionsService.getOrCreateChatSession(session.resource, CancellationToken.None);
			await this.chatService.acquireOrLoadSession(session.resource, ChatAgentLocation.Chat, CancellationToken.None);

			// Send the request
			const opts: IChatSendRequestOptions = {
				location: ChatAgentLocation.Chat,
				userSelectedModelId: session.modelId,
				modeInfo: { kind: ChatModeKind.Agent, isBuiltin: true, modeInstructions: undefined, modeId: 'agent', applyCodeBlockSuggestionId: undefined },
				agentIdSilent: contribution?.type,
			};

			const existingResources = new Set(
				this.agentSessionsService.model.sessions.map(s => s.resource.toString())
			);

			const result = await this.chatService.sendRequest(session.resource, query, opts);
			if (result.kind === 'rejected') {
				this.logService.error(`[SuggestedIssues] sendRequest rejected: ${result.reason}`);
				return;
			}

			// Wait for the extension to create the agent session (up to 30s)
			let newAgentSession = this.agentSessionsService.model.sessions.find(
				s => !existingResources.has(s.resource.toString())
			);

			if (!newAgentSession) {
				let listener: IDisposable | undefined;
				newAgentSession = await Promise.race([
					new Promise<IAgentSession>(resolve => {
						listener = this.agentSessionsService.model.onDidChangeSessions(() => {
							const found = this.agentSessionsService.model.sessions.find(
								s => !existingResources.has(s.resource.toString())
							);
							if (found) {
								resolve(found);
							}
						});
					}),
					new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), 30_000)),
				]);
				listener?.dispose();
			}

			if (newAgentSession) {
				this.logService.info(`[SuggestedIssues] Agent session created: ${newAgentSession.resource.toString()}`);
			}
		} catch (e) {
			this.logService.error('[SuggestedIssues] Failed to start session from issue:', e);
		}
	}

	override dispose(): void {
		this._isDisposed = true;
		super.dispose();
	}
}
