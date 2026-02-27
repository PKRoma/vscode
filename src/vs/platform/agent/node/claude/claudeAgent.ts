/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableMap } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ILogService } from '../../../log/common/log.js';
import { IAgentCreateSessionConfig, IAgentModelInfo, IAgentProgressEvent, IAgentMessageEvent, IAgent, IAgentSessionMetadata, IAgentToolStartEvent, IAgentToolCompleteEvent } from '../../common/agentService.js';
import { ClaudeSession } from './claudeSession.js';

/**
 * Agent provider backed by the Claude Agent SDK.
 */
export class ClaudeAgent extends Disposable implements IAgent {
	readonly id = 'claude' as const;

	private readonly _onDidSessionProgress = this._register(new Emitter<IAgentProgressEvent>());
	readonly onDidSessionProgress = this._onDidSessionProgress.event;

	private readonly _sessions = this._register(new DisposableMap<string, ClaudeSession>());

	constructor(
		private readonly _logService: ILogService,
	) {
		super();
	}

	// ---- auth ---------------------------------------------------------------

	async setAuthToken(_token: string): Promise<void> {
		// Claude SDK uses its own API key; no-op for GitHub tokens.
	}

	// ---- session management -------------------------------------------------

	async listSessions(): Promise<IAgentSessionMetadata[]> {
		// Claude SDK doesn't persist sessions.
		return [];
	}

	async listModels(): Promise<IAgentModelInfo[]> {
		// Model selection is handled by the SDK's Options.model field.
		return [];
	}

	async createSession(config?: IAgentCreateSessionConfig): Promise<string> {
		const sessionId = config?.sessionId ?? generateUuid();
		this._logService.info(`[Claude] Creating session ${sessionId}${config?.model ? ` model=${config.model}` : ''}`);
		const session = new ClaudeSession(sessionId, config?.model, process.cwd(), this._logService);
		session.onProgress(e => this._onDidSessionProgress.fire(e));
		await session.start();
		this._sessions.set(sessionId, session);
		this._logService.info(`[Claude] Session created: ${sessionId}`);
		return sessionId;
	}

	async sendMessage(sessionId: string, prompt: string): Promise<void> {
		const session = this._sessions.get(sessionId);
		if (!session) {
			throw new Error(`[Claude] Unknown session: ${sessionId}`);
		}
		this._logService.info(`[Claude:${sessionId}] sendMessage called: "${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}"`);
		await session.send(prompt);
		this._logService.info(`[Claude:${sessionId}] send() returned`);
	}

	async getSessionMessages(_sessionId: string): Promise<(IAgentMessageEvent | IAgentToolStartEvent | IAgentToolCompleteEvent)[]> {
		// Claude SDK doesn't support message history retrieval.
		return [];
	}

	async disposeSession(sessionId: string): Promise<void> {
		this._sessions.deleteAndDispose(sessionId);
	}

	async shutdown(): Promise<void> {
		this._logService.info('[Claude] Shutting down...');
		this._sessions.clearAndDisposeAll();
	}

	/**
	 * Returns true if this provider owns the given session ID.
	 */
	hasSession(sessionId: string): boolean {
		return this._sessions.has(sessionId);
	}
}
