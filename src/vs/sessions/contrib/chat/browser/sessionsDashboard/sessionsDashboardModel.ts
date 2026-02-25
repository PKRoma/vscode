/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IObservable, derived, observableValue } from '../../../../../base/common/observable.js';
import { AgentSessionStatus, IAgentSession, IAgentSessionsModel, isSessionInProgressStatus } from '../../../../../workbench/contrib/chat/browser/agentSessions/agentSessionsModel.js';
import { IAgentSessionsService } from '../../../../../workbench/contrib/chat/browser/agentSessions/agentSessionsService.js';

const MAX_RECENTLY_COMPLETED = 20;

export interface ISessionsDashboardModel {
	readonly needsInput: IObservable<readonly IAgentSession[]>;
	readonly inProgress: IObservable<readonly IAgentSession[]>;
	readonly recentlyCompleted: IObservable<readonly IAgentSession[]>;
	readonly isEmpty: IObservable<boolean>;
}

export class SessionsDashboardModel extends Disposable implements ISessionsDashboardModel {

	private readonly _version = observableValue<number>(this, 0);

	readonly needsInput: IObservable<readonly IAgentSession[]>;
	readonly inProgress: IObservable<readonly IAgentSession[]>;
	readonly recentlyCompleted: IObservable<readonly IAgentSession[]>;
	readonly isEmpty: IObservable<boolean>;

	private get _model(): IAgentSessionsModel {
		return this.agentSessionsService.model;
	}

	constructor(
		@IAgentSessionsService private readonly agentSessionsService: IAgentSessionsService,
	) {
		super();

		// Bump version when sessions change to trigger recomputation
		this._register(this._model.onDidChangeSessions(() => {
			this._version.set(this._version.get() + 1, undefined);
		}));
		this._register(this._model.onDidChangeSessionArchivedState(() => {
			this._version.set(this._version.get() + 1, undefined);
		}));

		this.needsInput = derived(reader => {
			this._version.read(reader); // track version for reactivity
			return this._getSessionsByStatus(AgentSessionStatus.NeedsInput);
		});

		this.inProgress = derived(reader => {
			this._version.read(reader);
			return this._getSessionsByStatus(AgentSessionStatus.InProgress);
		});

		this.recentlyCompleted = derived(reader => {
			this._version.read(reader);
			return this._getRecentlyCompletedSessions();
		});

		this.isEmpty = derived(reader => {
			return this.needsInput.read(reader).length === 0
				&& this.inProgress.read(reader).length === 0
				&& this.recentlyCompleted.read(reader).length === 0;
		});
	}

	private _getSessionsByStatus(status: AgentSessionStatus): IAgentSession[] {
		return this._model.sessions
			.filter(s => !s.isArchived() && s.status === status)
			.sort((a, b) => {
				const aTime = a.timing.lastRequestStarted ?? a.timing.created;
				const bTime = b.timing.lastRequestStarted ?? b.timing.created;
				return bTime - aTime; // newest first
			});
	}

	private _getRecentlyCompletedSessions(): IAgentSession[] {
		return this._model.sessions
			.filter(s => {
				if (s.isArchived()) {
					return false;
				}
				if (isSessionInProgressStatus(s.status)) {
					return false;
				}
				return true;
			})
			.sort((a, b) => {
				const aTime = a.timing.lastRequestEnded ?? a.timing.created;
				const bTime = b.timing.lastRequestEnded ?? b.timing.created;
				return bTime - aTime; // newest first
			})
			.slice(0, MAX_RECENTLY_COMPLETED);
	}
}
