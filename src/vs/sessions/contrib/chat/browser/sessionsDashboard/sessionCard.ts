/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { URI } from '../../../../../base/common/uri.js';
import { renderIcon } from '../../../../../base/browser/ui/iconLabel/iconLabels.js';
import { localize } from '../../../../../nls.js';
import { AgentSessionStatus, getAgentChangesSummary, hasValidDiff, IAgentSession } from '../../../../../workbench/contrib/chat/browser/agentSessions/agentSessionsModel.js';
import { AgentSessionProviders, getAgentSessionProviderIcon } from '../../../../../workbench/contrib/chat/browser/agentSessions/agentSessions.js';
import { IChatService, IChatSendRequestOptions, IChatToolInvocation, ToolConfirmKind } from '../../../../../workbench/contrib/chat/common/chatService/chatService.js';
import { ChatAgentLocation, ChatModeKind } from '../../../../../workbench/contrib/chat/common/constants.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { CHANGES_VIEW_ID } from '../../../changesView/browser/changesView.js';
import { IViewsService } from '../../../../../workbench/services/views/common/viewsService.js';
import { ISessionsManagementService } from '../../../sessions/browser/sessionsManagementService.js';

export type SessionCardMode = 'row' | 'action-pill';

/**
 * Renders a session as a full-width horizontal row (active sessions)
 * or a compact pill (action items that need input).
 */
export class SessionCard extends Disposable {

	private readonly _element: HTMLElement;
	private readonly _disposables = this._register(new DisposableStore());
	private _expandedArea: HTMLElement | undefined;
	private _inlineInput: HTMLInputElement | undefined;
	private _expanded = false;

	private readonly _onDidSelect = this._register(new Emitter<URI>());
	readonly onDidSelect: Event<URI> = this._onDidSelect.event;

	get element(): HTMLElement { return this._element; }
	get sessionResource(): URI { return this.session.resource; }

	markRead(): void {
		this._element.classList.add('read');
	}

	constructor(
		private readonly session: IAgentSession,
		mode: SessionCardMode,
		@IChatService private readonly chatService: IChatService,
		@IViewsService private readonly viewsService: IViewsService,
		@ISessionsManagementService private readonly sessionsManagementService: ISessionsManagementService,
	) {
		super();

		this._element = dom.$('.session-row');
		this._element.dataset.status = this._statusKey();
		this._element.dataset.mode = mode;
		this._element.tabIndex = 0;

		if (mode === 'row') {
			this._renderRow();
		} else {
			this._renderActionPill();
		}
	}

	setSelected(selected: boolean): void {
		const wasSelected = this._element.classList.contains('selected');
		this._element.classList.toggle('selected', selected);

		if (selected) {
			this.markRead();
		}

		if (selected && !wasSelected) {
			this._showExpandedArea();
		} else if (!selected && wasSelected) {
			this._hideExpandedArea();
		}
	}

	private _statusKey(): string {
		switch (this.session.status) {
			case AgentSessionStatus.NeedsInput: return 'needsInput';
			case AgentSessionStatus.InProgress: return 'inProgress';
			case AgentSessionStatus.Failed: return 'failed';
			default: return 'completed';
		}
	}

	// Row mode //
	// Layout: [dot] Title / subtitle | duration | progress | +X -Y | archive | chevron
	// For NeedsInput: also shows confirmation message + Approve/Skip inline
	private _renderRow(): void {
		const s = this.session;

		// Status dot
		const dot = dom.append(this._element, dom.$('.session-row-dot'));
		dot.classList.add(this._statusKey());

		// Left: title + subtitle
		const left = dom.append(this._element, dom.$('.session-row-left'));
		const title = dom.append(left, dom.$('.session-row-title'));
		title.textContent = s.label;
		title.title = s.label;

		const subtitle = this._getSubtitle(s);
		if (subtitle) {
			const sub = dom.append(left, dom.$('.session-row-subtitle'));
			sub.textContent = subtitle;
		}

		// For NeedsInput sessions: show confirmation message + Approve/Skip in one row
		if (s.status === AgentSessionStatus.NeedsInput) {
			const confirmRow = dom.append(left, dom.$('.session-row-confirm-row'));

			const confirmInfo = this._getPendingConfirmationInfo();
			const msgEl = dom.append(confirmRow, dom.$('.session-row-confirm-message'));
			msgEl.textContent = confirmInfo ?? localize('confirm.pending', "Waiting for approval...");
			msgEl.title = confirmInfo ?? '';

			const inlineActions = dom.append(confirmRow, dom.$('.session-row-inline-actions'));
			this._addBtn(inlineActions, localize('action.approve', "Approve"), Codicon.check, 'primary', () => {
				this._confirmPendingTools({ type: ToolConfirmKind.UserAction });
			});
			this._addBtn(inlineActions, localize('action.skip', "Skip"), Codicon.close, 'secondary', () => {
				this._confirmPendingTools({ type: ToolConfirmKind.Skipped });
			});
		}

		// Right: diff stats + archive + chevron
		const right = dom.append(this._element, dom.$('.session-row-right'));

		// Diff stats (+X -Y) — always visible when there are changes
		if (hasValidDiff(s.changes)) {
			const diff = getAgentChangesSummary(s.changes);
			if (diff) {
				const statsEl = dom.append(right, dom.$('.session-row-diff-stats'));
				const addedSpan = dom.append(statsEl, dom.$('span.diff-added'));
				addedSpan.textContent = `+${diff.insertions}`;
				const removedSpan = dom.append(statsEl, dom.$('span.diff-removed'));
				removedSpan.textContent = `-${diff.deletions}`;
			}
		}

		// Archive button
		this._addBtn(right, '', Codicon.archive, 'ghost', () => {
			s.setArchived(true);
		});

		// Open session button (eye icon)
		this._addBtn(right, '', Codicon.eye, 'ghost', () => {
			this.sessionsManagementService.openSession(s.resource);
		});

		// Chevron (expand/collapse)
		const chevron = dom.append(right, dom.$('.session-row-chevron'));
		dom.append(chevron, renderIcon(Codicon.chevronDown));

		// select (not open)
		this._disposables.add(dom.addDisposableListener(this._element, dom.EventType.CLICK, (e) => {
			if ((e.target as HTMLElement).closest('.session-card-action-button') ||
				(e.target as HTMLElement).closest('.session-row-inline-input')) {
				return;
			}
			this._onDidSelect.fire(s.resource);
		}));
	}

	// Action pill mode //
	// Layout: [icon] action-label
	private _renderActionPill(): void {
		const s = this.session;

		const iconEl = dom.append(this._element, dom.$('.session-row-pill-icon'));
		const providerIcon = getAgentSessionProviderIcon(s.providerType as AgentSessionProviders);
		dom.append(iconEl, renderIcon(providerIcon));

		const label = dom.append(this._element, dom.$('.session-row-pill-label'));
		label.textContent = s.label;
		label.title = s.label;

		// select
		this._disposables.add(dom.addDisposableListener(this._element, dom.EventType.CLICK, () => {
			this._onDidSelect.fire(s.resource);
		}));
	}

	// Expanded area (shown when selected) //
	private _showExpandedArea(): void {
		if (this._expanded) {
			return;
		}
		this._expanded = true;

		// Reveal the changes sidebar (don't steal focus)
		this.viewsService.openView(CHANGES_VIEW_ID, false);

		this._expandedArea = dom.append(this._element, dom.$('.session-row-expanded'));
		const area = this._expandedArea;

		// Inline chat input
		const inputWrapper = dom.append(area, dom.$('.session-row-inline-input'));
		const inlineInput = dom.append(inputWrapper, dom.$('input.session-row-input-field')) as HTMLInputElement;
		this._inlineInput = inlineInput;
		inlineInput.type = 'text';
		inlineInput.placeholder = localize('inlineInput.placeholder', "Send a message...");

		const sendBtn = dom.append(inputWrapper, dom.$('.session-row-inline-send'));
		dom.append(sendBtn, renderIcon(Codicon.send));

		this._disposables.add(dom.addDisposableListener(inlineInput, dom.EventType.KEY_DOWN, (e) => {
			if (e.keyCode === KeyCode.Enter && !e.shiftKey) {
				e.preventDefault();
				e.stopPropagation();
				this._sendMessage();
			}
		}));

		this._disposables.add(dom.addDisposableListener(sendBtn, dom.EventType.CLICK, (e) => {
			e.stopPropagation();
			this._sendMessage();
		}));

		setTimeout(() => inlineInput.focus(), 50);
	}

	private _hideExpandedArea(): void {
		this._expanded = false;
		this._inlineInput = undefined;
		this._expandedArea?.remove();
		this._expandedArea = undefined;
	}

	private async _sendMessage(): Promise<void> {
		if (!this._inlineInput) {
			return;
		}
		const msg = this._inlineInput.value.trim();
		if (!msg) {
			return;
		}
		this._inlineInput.value = '';
		this._inlineInput.disabled = true;
		try {
			await this.chatService.acquireOrLoadSession(this.session.resource, ChatAgentLocation.Chat, CancellationToken.None);
			const opts: IChatSendRequestOptions = {
				location: ChatAgentLocation.Chat,
				modeInfo: { kind: ChatModeKind.Agent, isBuiltin: true, modeInstructions: undefined, modeId: 'agent', applyCodeBlockSuggestionId: undefined },
			};
			await this.chatService.sendRequest(this.session.resource, msg, opts);
		} finally {
			if (this._inlineInput) {
				this._inlineInput.disabled = false;
				this._inlineInput.focus();
			}
		}
	}

	/**
	 * Directly confirm or skip all pending tool invocations on the session's chat model.
	 * This works without a chat widget being open.
	 */
	private _confirmPendingTools(reason: { type: ToolConfirmKind.UserAction } | { type: ToolConfirmKind.Skipped }): void {
		const modelRef = this.chatService.acquireExistingSession(this.session.resource);
		if (!modelRef) {
			return;
		}
		try {
			const requests = modelRef.object.getRequests();
			const lastRequest = requests[requests.length - 1];
			if (!lastRequest?.response) {
				return;
			}
			for (const item of lastRequest.response.response.value) {
				if (item.kind === 'toolInvocation') {
					const state = item.state.get();
					if (state.type === IChatToolInvocation.StateKind.WaitingForConfirmation || state.type === IChatToolInvocation.StateKind.WaitingForPostApproval) {
						state.confirm(reason);
					}
				}
			}
		} finally {
			modelRef.dispose();
		}
	}

	/**
	 * Gets a human-readable description of what the pending tool confirmation is about.
	 */
	private _getPendingConfirmationInfo(): string | undefined {
		const modelRef = this.chatService.acquireExistingSession(this.session.resource);
		if (!modelRef) {
			return undefined;
		}
		try {
			const requests = modelRef.object.getRequests();
			const lastRequest = requests[requests.length - 1];
			if (!lastRequest?.response) {
				return undefined;
			}
			for (const item of lastRequest.response.response.value) {
				if (item.kind === 'toolInvocation') {
					const state = item.state.get();
					if (state.type === IChatToolInvocation.StateKind.WaitingForConfirmation) {
						// Use the confirmation title/message if available
						const title = state.confirmationMessages?.title;
						if (title) {
							return typeof title === 'string' ? title : title.value;
						}
						// Fall back to the invocation message
						const msg = item.invocationMessage;
						if (msg) {
							return typeof msg === 'string' ? msg : msg.value;
						}
					}
					if (state.type === IChatToolInvocation.StateKind.WaitingForPostApproval) {
						return localize('confirm.postApproval', "Review tool results");
					}
				}
			}
			return undefined;
		} finally {
			modelRef.dispose();
		}
	}

	// Helpers //
	private _getSubtitle(s: IAgentSession): string | undefined {
		const repo = s.metadata?.repositoryPath as string | undefined;
		if (repo) {
			const parts = repo.split('/');
			return parts[parts.length - 1];
		}
		return s.providerType !== AgentSessionProviders.Local
			? `${s.providerLabel}`
			: undefined;
	}

	private _addBtn(container: HTMLElement, label: string, icon: ThemeIcon, variant: string, handler: () => void): void {
		const btn = dom.append(container, dom.$(`.session-card-action-button.${variant}`));
		btn.tabIndex = 0;
		btn.role = 'button';
		btn.title = label || ThemeIcon.asClassName(icon);
		dom.append(btn, renderIcon(icon));
		if (label) {
			dom.append(btn, dom.$('span', undefined, label));
		}
		this._disposables.add(dom.addDisposableListener(btn, dom.EventType.CLICK, (e) => {
			e.stopPropagation();
			handler();
		}));
	}
}
