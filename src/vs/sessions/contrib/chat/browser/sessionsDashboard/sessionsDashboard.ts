/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './sessionsDashboard.css';
import * as dom from '../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { autorun } from '../../../../../base/common/observable.js';
import { isEqual } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { renderIcon } from '../../../../../base/browser/ui/iconLabel/iconLabels.js';
import { localize } from '../../../../../nls.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IAgentSession } from '../../../../../workbench/contrib/chat/browser/agentSessions/agentSessionsModel.js';
import { ISessionsDashboardModel, SessionsDashboardModel } from './sessionsDashboardModel.js';
import { SessionCard, SessionCardMode } from './sessionCard.js';
import { IAgentSessionsService } from '../../../../../workbench/contrib/chat/browser/agentSessions/agentSessionsService.js';
import { ISessionsManagementService } from '../../../sessions/browser/sessionsManagementService.js';

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
private readonly _sections: IDashboardSection[] = [];
private readonly _cards: SessionCard[] = [];
private _selectedResource: URI | undefined;
private _isDisposed = false;

get element(): HTMLElement { return this._element; }
get isEmpty(): ISessionsDashboardModel['isEmpty'] { return this._model.isEmpty; }

constructor(
@IInstantiationService private readonly instantiationService: IInstantiationService,
@IAgentSessionsService agentSessionsService: IAgentSessionsService,
@ISessionsManagementService private readonly sessionsManagementService: ISessionsManagementService,
) {
super();

this._model = this._register(this.instantiationService.createInstance(SessionsDashboardModel));
this._element = dom.$('.sessions-dashboard');

// "Active" section: running + needs-input sessions as rows
this._createSection('active', localize('section.active', "Active"), 'row');
// "Action" section: needs-input sessions as action pills
this._createSection('action', localize('section.action', "Action"), 'action-pill');
// "Recent" section: completed sessions as rows
this._createSection('recent', localize('section.recent', "Recent"), 'row');

this._register(autorun(reader => {
if (this._isDisposed) { return; }
const needsInput = this._model.needsInput.read(reader);
const inProgress = this._model.inProgress.read(reader);
const completed = this._model.recentlyCompleted.read(reader);

// Active = all in-progress + needs-input sessions
const activeSessions = [...needsInput, ...inProgress];
this._renderSection('active', activeSessions);

// Action = only needs-input as pills
this._renderSection('action', needsInput);

// Recent = completed
this._renderSection('recent', completed);

this._element.classList.toggle('empty',
activeSessions.length === 0 && needsInput.length === 0 && completed.length === 0);
}));
}

private _createSection(key: string, label: string, cardMode: SessionCardMode): void {
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

const section: IDashboardSection = { key, label, cardMode, container, headerEl, cardsContainer, countBadge, disposables, collapsed: false };
this._sections.push(section);

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

section.disposables.add(card.onDidSelect(resource => {
this._selectCard(resource);
}));

section.cardsContainer.appendChild(card.element);
this._cards.push(card);
}
}

private _selectCard(resource: URI): void {
if (this._selectedResource && isEqual(this._selectedResource, resource)) {
this._selectedResource = undefined;
this.sessionsManagementService.selectSession(undefined);
} else {
this._selectedResource = resource;
this.sessionsManagementService.selectSession(resource);
}

for (const card of this._cards) {
card.setSelected(isEqual(card.sessionResource, this._selectedResource));
}
}

layout(_height: number, _width: number): void { /* auto-reflow via CSS */ }

override dispose(): void {
this._isDisposed = true;
super.dispose();
}
}
