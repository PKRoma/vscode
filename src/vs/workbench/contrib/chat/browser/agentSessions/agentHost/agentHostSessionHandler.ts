/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { Emitter } from '../../../../../../base/common/event.js';
import { MarkdownString } from '../../../../../../base/common/htmlContent.js';
import { Disposable, toDisposable } from '../../../../../../base/common/lifecycle.js';
import { observableValue } from '../../../../../../base/common/observable.js';
import { URI } from '../../../../../../base/common/uri.js';
import { ExtensionIdentifier } from '../../../../../../platform/extensions/common/extensions.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IProductService } from '../../../../../../platform/product/common/productService.js';
import { IAgentHostService, IAgentMessageEvent, IAgentToolCompleteEvent, IAgentToolStartEvent, AgentProvider } from '../../../../../../platform/agent/common/agentService.js';
import { ChatAgentLocation, ChatModeKind } from '../../../common/constants.js';
import { IChatAgentData, IChatAgentImplementation, IChatAgentRequest, IChatAgentResult, IChatAgentService } from '../../../common/participants/chatAgents.js';
import { IChatProgress, IChatTerminalToolInvocationData, IChatToolInvocationSerialized, ToolConfirmKind } from '../../../common/chatService/chatService.js';
import { ChatToolInvocation } from '../../../common/model/chatProgressTypes/chatToolInvocation.js';
import { IToolData, ToolDataSource } from '../../../common/tools/languageModelToolsService.js';
import { IChatSession, IChatSessionContentProvider, IChatSessionHistoryItem } from '../../../common/chatSessionsService.js';
import { getAgentHostIcon } from '../agentSessions.js';
import { AGENT_HOST_AGENT_ID, AGENT_HOST_CLAUDE_AGENT_ID, AGENT_HOST_SESSION_TYPE, AGENT_HOST_CLAUDE_SESSION_TYPE } from './agentHostConstants.js';

// =============================================================================
// History reconstruction
// =============================================================================

/**
 * Converts a flat array of IPC events (messages + tool events) into
 * request/response history items for the chat model.
 */
function buildHistory(
	events: readonly (IAgentMessageEvent | IAgentToolStartEvent | IAgentToolCompleteEvent)[],
	history: IChatSessionHistoryItem[],
): void {
	let currentResponseParts: IChatProgress[] | undefined;

	for (const e of events) {
		if (e.type === 'message') {
			if (e.role === 'user') {
				if (currentResponseParts) {
					history.push({ type: 'response', parts: currentResponseParts, participant: AGENT_HOST_AGENT_ID });
					currentResponseParts = undefined;
				}
				history.push({ type: 'request', prompt: e.content, participant: AGENT_HOST_AGENT_ID });
			} else {
				if (!currentResponseParts) {
					currentResponseParts = [];
				}
				if (e.content) {
					currentResponseParts.push({ kind: 'markdownContent', content: new MarkdownString(e.content) });
				}
			}
		} else if (e.type === 'tool_start') {
			if (!currentResponseParts) {
				currentResponseParts = [];
			}
			const toolSpecificData = (e.toolKind === 'terminal' && e.toolInput)
				? { kind: 'terminal' as const, commandLine: { original: e.toolInput }, language: e.language ?? 'shellscript' }
				: undefined;
			currentResponseParts.push({
				kind: 'toolInvocationSerialized',
				toolCallId: e.toolCallId,
				toolId: e.toolName,
				source: ToolDataSource.Internal,
				invocationMessage: new MarkdownString(e.invocationMessage),
				originMessage: undefined,
				pastTenseMessage: undefined,
				isConfirmed: { type: ToolConfirmKind.ConfirmationNotNeeded },
				isComplete: false,
				presentation: undefined,
				toolSpecificData,
			} satisfies IChatToolInvocationSerialized);
		} else if (e.type === 'tool_complete') {
			if (currentResponseParts) {
				const idx = currentResponseParts.findIndex(
					p => p.kind === 'toolInvocationSerialized' && p.toolCallId === e.toolCallId
				);
				if (idx >= 0) {
					const existing = currentResponseParts[idx] as IChatToolInvocationSerialized;
					const isTerminal = existing.toolSpecificData?.kind === 'terminal';
					currentResponseParts[idx] = {
						...existing,
						isComplete: true,
						pastTenseMessage: isTerminal ? undefined : new MarkdownString(e.pastTenseMessage),
						toolSpecificData: isTerminal
							? {
								...existing.toolSpecificData as IChatTerminalToolInvocationData,
								terminalCommandOutput: e.toolOutput !== undefined ? { text: e.toolOutput } : undefined,
								terminalCommandState: { exitCode: e.success ? 0 : 1 },
							}
							: existing.toolSpecificData,
					};
				}
			}
		}
	}

	// Mark incomplete tool invocations as complete (orphaned tool_start without tool_complete)
	if (currentResponseParts) {
		for (let i = 0; i < currentResponseParts.length; i++) {
			const part = currentResponseParts[i];
			if (part.kind === 'toolInvocationSerialized' && !part.isComplete) {
				currentResponseParts[i] = { ...part, isComplete: true };
			}
		}
		history.push({ type: 'response', parts: currentResponseParts, participant: AGENT_HOST_AGENT_ID });
	}
}

// =============================================================================
// Chat session
// =============================================================================

class AgentHostChatSession extends Disposable implements IChatSession {
	readonly progressObs = observableValue<IChatProgress[]>('agentHostProgress', []);
	readonly isCompleteObs = observableValue<boolean>('agentHostComplete', true);

	private readonly _onWillDispose = this._register(new Emitter<void>());
	readonly onWillDispose = this._onWillDispose.event;

	readonly requestHandler: IChatSession['requestHandler'];
	readonly interruptActiveResponseCallback: IChatSession['interruptActiveResponseCallback'];

	constructor(
		readonly sessionResource: URI,
		readonly history: readonly IChatSessionHistoryItem[],
		private readonly _sendRequest: (message: string, progress: (parts: IChatProgress[]) => void, token: CancellationToken) => Promise<void>,
		onDispose: () => void,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		this._register(toDisposable(() => this._onWillDispose.fire()));
		this._register(toDisposable(onDispose));

		this.requestHandler = async (request, progress, _history, cancellationToken) => {
			this._logService.info('[AgentHost] requestHandler called');
			this.isCompleteObs.set(false, undefined);
			await this._sendRequest(request.message, progress, cancellationToken);
			this.isCompleteObs.set(true, undefined);
		};

		this.interruptActiveResponseCallback = history.length > 0 ? undefined : async () => {
			// TODO: Hook up session.abort()
			return true;
		};
	}
}

// =============================================================================
// Session handler
// =============================================================================

export interface IAgentHostSessionHandlerConfig {
	readonly provider: AgentProvider;
}

export class AgentHostSessionHandler extends Disposable implements IChatSessionContentProvider {

	private readonly _resourceToSessionId = new Map<string, string>();
	private readonly _activeSessions = new Map<string, AgentHostChatSession>();
	private readonly _provider: AgentProvider;
	private readonly _agentId: string;
	private readonly _sessionType: string;

	constructor(
		config: IAgentHostSessionHandlerConfig,
		@IAgentHostService private readonly _agentHostService: IAgentHostService,
		@IChatAgentService private readonly _chatAgentService: IChatAgentService,
		@ILogService private readonly _logService: ILogService,
		@IProductService private readonly _productService: IProductService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();
		this._provider = config.provider;
		this._agentId = config.provider === 'claude' ? AGENT_HOST_CLAUDE_AGENT_ID : AGENT_HOST_AGENT_ID;
		this._sessionType = config.provider === 'claude' ? AGENT_HOST_CLAUDE_SESSION_TYPE : AGENT_HOST_SESSION_TYPE;
		this._registerAgent();
	}

	async provideChatSessionContent(sessionResource: URI, _token: CancellationToken): Promise<IChatSession> {
		const sessionId = sessionResource.path.substring(1);

		const history: IChatSessionHistoryItem[] = [];
		if (!sessionId.startsWith('untitled-')) {
			const events = await this._agentHostService.getSessionMessages(sessionId);
			buildHistory(events, history);
		}

		const resolvedSessionId = await this._resolveSessionId(sessionResource);
		const session = this._instantiationService.createInstance(
			AgentHostChatSession,
			sessionResource,
			history,
			(message: string, progress: (parts: IChatProgress[]) => void, token: CancellationToken) =>
				this._sendAndStreamResponse(resolvedSessionId, message, progress, token),
			() => {
				this._activeSessions.delete(sessionId);
				this._resourceToSessionId.delete(sessionResource.toString());
				this._agentHostService.disposeSession(resolvedSessionId);
			},
		);
		this._activeSessions.set(sessionId, session);
		return session;
	}

	private _registerAgent(): void {
		const isClaude = this._provider === 'claude';
		const agentData: IChatAgentData = {
			id: this._agentId,
			name: this._agentId,
			fullName: isClaude ? 'Agent Host - Claude' : 'Agent Host - Copilot',
			description: isClaude
				? 'Claude SDK agent running in a dedicated process'
				: 'Copilot SDK agent running in a dedicated process',
			extensionId: new ExtensionIdentifier('vscode.agent-host'),
			extensionVersion: undefined,
			extensionPublisherId: 'vscode',
			extensionDisplayName: 'Agent Host',
			isDefault: false,
			isDynamic: true,
			isCore: true,
			metadata: { themeIcon: getAgentHostIcon(this._productService) },
			slashCommands: [],
			locations: [ChatAgentLocation.Chat],
			modes: [ChatModeKind.Agent],
			disambiguation: [],
		};

		const agentImpl: IChatAgentImplementation = {
			invoke: async (request, progress, _history, cancellationToken) => {
				return this._invokeAgent(request, progress, cancellationToken);
			},
		};

		this._register(this._chatAgentService.registerDynamicAgent(agentData, agentImpl));
	}

	private async _invokeAgent(
		request: IChatAgentRequest,
		progress: (parts: IChatProgress[]) => void,
		cancellationToken: CancellationToken,
	): Promise<IChatAgentResult> {
		this._logService.info(`[AgentHost] _invokeAgent called for resource: ${request.sessionResource.toString()}`);
		const sessionId = await this._resolveSessionId(request.sessionResource, request.userSelectedModelId);
		this._logService.info(`[AgentHost] resolved session ID: ${sessionId}`);

		await this._sendAndStreamResponse(sessionId, request.message, progress, cancellationToken);

		const activeSession = this._activeSessions.get(sessionId);
		if (activeSession) {
			activeSession.isCompleteObs.set(true, undefined);
		}

		return {};
	}

	private async _sendAndStreamResponse(
		sessionId: string,
		message: string,
		progress: (parts: IChatProgress[]) => void,
		cancellationToken: CancellationToken,
	): Promise<void> {
		if (cancellationToken.isCancellationRequested) {
			return;
		}

		const activeToolInvocations = new Map<string, ChatToolInvocation>();

		let resolveDone: () => void;
		const done = new Promise<void>(resolve => { resolveDone = resolve; });

		const finish = () => {
			this._finalizeOutstandingTools(activeToolInvocations);
			listener.dispose();
			resolveDone();
		};

		const listener = this._agentHostService.onDidSessionProgress(e => {
			if (e.sessionId !== sessionId || cancellationToken.isCancellationRequested) {
				return;
			}

			switch (e.type) {
				case 'delta':
					progress([{ kind: 'markdownContent', content: new MarkdownString(e.content) }]);
					break;

				case 'tool_start': {
					const invocation = this._createToolInvocation(e);
					activeToolInvocations.set(e.toolCallId, invocation);
					progress([invocation]);
					break;
				}

				case 'tool_complete': {
					const invocation = activeToolInvocations.get(e.toolCallId);
					if (invocation) {
						activeToolInvocations.delete(e.toolCallId);
						this._finalizeToolInvocation(invocation, e);
					}
					break;
				}

				case 'idle':
					finish();
					break;
			}
		});

		const cancelListener = cancellationToken.onCancellationRequested(() => {
			finish();
			cancelListener.dispose();
		});

		try {
			this._logService.info(`[AgentHost] Sending message to session ${sessionId}`);
			await this._agentHostService.sendMessage(sessionId, message);
			this._logService.info(`[AgentHost] sendMessage returned for session ${sessionId}`);
		} catch (err) {
			this._logService.error(`[AgentHost] [${sessionId}] sendMessage failed`, err);
			finish();
		}

		await done;
		cancelListener.dispose();
	}

	private async _resolveSessionId(sessionResource: URI, model?: string): Promise<string> {
		if (sessionResource.scheme === this._sessionType && !sessionResource.path.startsWith('/untitled-')) {
			return sessionResource.path.substring(1);
		}

		const key = sessionResource.toString();
		const existing = this._resourceToSessionId.get(key);
		if (existing) {
			return existing;
		}

		const sessionId = await this._agentHostService.createSession({ model, provider: this._provider });
		this._resourceToSessionId.set(key, sessionId);
		return sessionId;
	}

	private _createToolInvocation(event: IAgentToolStartEvent): ChatToolInvocation {
		const toolData: IToolData = {
			id: event.toolName,
			source: ToolDataSource.Internal,
			displayName: event.displayName,
			modelDescription: event.toolName,
		};
		let parameters: unknown;
		if (event.toolArguments) {
			try {
				parameters = JSON.parse(event.toolArguments);
			} catch {
				// malformed JSON
			}
		}

		const invocation = new ChatToolInvocation(undefined, toolData, event.toolCallId, undefined, parameters);
		invocation.invocationMessage = new MarkdownString(event.invocationMessage);

		if (event.toolKind === 'terminal' && event.toolInput) {
			invocation.toolSpecificData = {
				kind: 'terminal',
				commandLine: { original: event.toolInput },
				language: event.language ?? 'shellscript',
			} satisfies IChatTerminalToolInvocationData;
		}

		return invocation;
	}

	private _finalizeToolInvocation(invocation: ChatToolInvocation, event: IAgentToolCompleteEvent): void {
		if (invocation.toolSpecificData?.kind === 'terminal') {
			const terminalData = invocation.toolSpecificData as IChatTerminalToolInvocationData;
			invocation.toolSpecificData = {
				...terminalData,
				terminalCommandOutput: event.toolOutput !== undefined ? { text: event.toolOutput } : undefined,
				terminalCommandState: { exitCode: event.success ? 0 : 1 },
			};
		} else {
			invocation.pastTenseMessage = new MarkdownString(event.pastTenseMessage);
		}

		invocation.didExecuteTool(!event.success ? { content: [], toolResultError: event.error?.message } : undefined);
	}

	private _finalizeOutstandingTools(activeToolInvocations: Map<string, ChatToolInvocation>): void {
		for (const [id, invocation] of activeToolInvocations) {
			invocation.didExecuteTool(undefined);
			activeToolInvocations.delete(id);
		}
	}

	override dispose(): void {
		for (const [, session] of this._activeSessions) {
			session.dispose();
		}
		this._activeSessions.clear();
		this._resourceToSessionId.clear();
		super.dispose();
	}
}
