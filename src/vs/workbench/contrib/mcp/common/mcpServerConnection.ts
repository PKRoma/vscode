/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../base/common/errors.js';
import { Disposable, DisposableStore, IReference, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { autorun, IObservable, observableValue } from '../../../../base/common/observable.js';
import { localize } from '../../../../nls.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogger, log, LogLevel } from '../../../../platform/log/common/log.js';
import { IMcpHostDelegate, IMcpMessageTransport } from './mcpRegistryTypes.js';
import { McpServerRequestHandler } from './mcpServerRequestHandler.js';
import { McpTaskManager } from './mcpTaskManager.js';
import { IMcpClientMethods, IMcpServerConnection, McpCollectionDefinition, McpConnectionState, McpServerDefinition, McpServerLaunch } from './mcpTypes.js';

export class McpServerConnection extends Disposable implements IMcpServerConnection {
	private static readonly _maxRecentLogLines = 100;

	private readonly _launch = this._register(new MutableDisposable<IReference<IMcpMessageTransport>>());
	private readonly _state = observableValue<McpConnectionState>('mcpServerState', { state: McpConnectionState.Kind.Stopped });
	private readonly _requestHandler = observableValue<McpServerRequestHandler | undefined>('mcpServerRequestHandler', undefined);

	public readonly state: IObservable<McpConnectionState> = this._state;
	public readonly handler: IObservable<McpServerRequestHandler | undefined> = this._requestHandler;

	constructor(
		private readonly _collection: McpCollectionDefinition,
		public readonly definition: McpServerDefinition,
		private readonly _delegate: IMcpHostDelegate,
		public readonly launchDefinition: McpServerLaunch,
		private readonly _logger: ILogger,
		private readonly _errorOnUserInteraction: boolean | undefined,
		private readonly _taskManager: McpTaskManager,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();
	}

	/** @inheritdoc */
	public async start(methods: IMcpClientMethods): Promise<McpConnectionState> {
		const currentState = this._state.get();
		if (!McpConnectionState.canBeStarted(currentState.state)) {
			return this._waitForState(McpConnectionState.Kind.Running, McpConnectionState.Kind.Error);
		}

		this._launch.value = undefined;
		this._state.set({ state: McpConnectionState.Kind.Starting }, undefined);
		this._logger.info(localize('mcpServer.starting', 'Starting server {0}', this.definition.label));

		try {
			const launch = this._delegate.start(this._collection, this.definition, this.launchDefinition, { errorOnUserInteraction: this._errorOnUserInteraction });
			this._launch.value = this.adoptLaunch(launch, methods);
			return this._waitForState(McpConnectionState.Kind.Running, McpConnectionState.Kind.Error);
		} catch (e) {
			const errorState: McpConnectionState = {
				state: McpConnectionState.Kind.Error,
				message: e instanceof Error ? e.message : String(e)
			};
			this._state.set(errorState, undefined);
			return errorState;
		}
	}

	private adoptLaunch(launch: IMcpMessageTransport, methods: IMcpClientMethods): IReference<IMcpMessageTransport> {
		const store = new DisposableStore();
		const cts = new CancellationTokenSource();
		const recentLogLines: string[] = [];

		store.add(toDisposable(() => cts.dispose(true)));
		store.add(launch);
		store.add(launch.onDidLog(({ level, message }) => {
			log(this._logger, level, message);
			recentLogLines.push(message);
			if (recentLogLines.length > McpServerConnection._maxRecentLogLines) {
				recentLogLines.splice(0, recentLogLines.length - McpServerConnection._maxRecentLogLines);
			}
		}));

		let didStart = false;
		store.add(autorun(reader => {
			const state = this._withLogTailOnError(launch.state.read(reader), recentLogLines);
			this._state.set(state, undefined);
			this._logger.info(localize('mcpServer.state', 'Connection state: {0}', McpConnectionState.toString(state)));

			if (state.state === McpConnectionState.Kind.Running && !didStart) {
				didStart = true;
				McpServerRequestHandler.create(this._instantiationService, {
					...methods,
					launch,
					logger: this._logger,
					requestLogLevel: this.definition.devMode ? LogLevel.Info : LogLevel.Debug,
					taskManager: this._taskManager,
				}, cts.token).then(
					handler => {
						if (!store.isDisposed) {
							this._requestHandler.set(handler, undefined);
						} else {
							handler.dispose();
						}
					},
					err => {
						if (!store.isDisposed && McpConnectionState.isRunning(this._state.read(undefined))) {
							let message = err.message;
							if (err instanceof CancellationError) {
								message = 'Server exited before responding to `initialize` request.';
								this._logger.error(message);
							} else {
								this._logger.error(err);
							}
							this._state.set(this._withLogTailOnError({ state: McpConnectionState.Kind.Error, message }, recentLogLines), undefined);
						}
						store.dispose();
					},
				);
			}
		}));

		return { dispose: () => store.dispose(), object: launch };
	}

	public async stop(): Promise<void> {
		this._logger.info(localize('mcpServer.stopping', 'Stopping server {0}', this.definition.label));
		this._launch.value?.object.stop();
		await this._waitForState(McpConnectionState.Kind.Stopped, McpConnectionState.Kind.Error);
	}

	public override dispose(): void {
		this._requestHandler.get()?.dispose();
		super.dispose();
		this._state.set({ state: McpConnectionState.Kind.Stopped }, undefined);
	}

	private _waitForState(...kinds: McpConnectionState.Kind[]): Promise<McpConnectionState> {
		const current = this._state.get();
		if (kinds.includes(current.state)) {
			return Promise.resolve(current);
		}

		return new Promise(resolve => {
			const disposable = autorun(reader => {
				const state = this._state.read(reader);
				if (kinds.includes(state.state)) {
					disposable.dispose();
					resolve(state);
				}
			});
		});
	}

	private _withLogTailOnError(state: McpConnectionState, recentLogLines: readonly string[]): McpConnectionState {
		if (state.state !== McpConnectionState.Kind.Error) {
			return state;
		}

		const logTail = this._toSandboxDiagnosticLogTail(recentLogLines);
		if (!logTail) {
			return state;
		}

		if (state.sandboxDiagnosticLog?.includes(logTail)) {
			return state;
		}

		return {
			...state,
			sandboxDiagnosticLog: state.sandboxDiagnosticLog ? `${state.sandboxDiagnosticLog}\n${logTail}` : logTail,
		};
	}

	private _toSandboxDiagnosticLogTail(logLines: readonly string[]): string | undefined {
		const sandboxLinePatterns = [
			/\b(?:fail(?:ed|ure)?)\b/i,
			/not accessible/i,
			/No matching config rule, denying:/i,
			/EAI_AGAIN/i,
			/ENOTFOUND/i,
			/\bENOENT\b/i,
			/\b(?:EACCES|EPERM)\b/i,
		];

		const relevant = logLines.filter(line => sandboxLinePatterns.some(pattern => pattern.test(line))).slice(-80);
		if (!relevant.length) {
			return undefined;
		}

		return relevant.join('\n');
	}
}
