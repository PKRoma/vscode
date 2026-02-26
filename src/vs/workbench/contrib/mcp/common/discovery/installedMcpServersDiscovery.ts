/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { equals } from '../../../../../base/common/arrays.js';
import { Throttler } from '../../../../../base/common/async.js';
import { Disposable, DisposableMap, DisposableStore, IDisposable } from '../../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../../base/common/map.js';
import { ISettableObservable, observableValue } from '../../../../../base/common/observable.js';
import { URI } from '../../../../../base/common/uri.js';
import { Location } from '../../../../../editor/common/languages.js';
import { ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { ConfigurationTarget } from '../../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IMcpSandboxConfiguration } from '../../../../../platform/mcp/common/mcpPlatformTypes.js';
import { IMcpResourceScannerService, McpResourceTarget } from '../../../../../platform/mcp/common/mcpResourceScannerService.js';
import { StorageScope } from '../../../../../platform/storage/common/storage.js';
import { IWorkbenchLocalMcpServer } from '../../../../services/mcp/common/mcpWorkbenchManagementService.js';
import { getMcpServerMapping } from '../mcpConfigFileUtils.js';
import { mcpConfigurationSection } from '../mcpConfiguration.js';
import { IMcpRegistry } from '../mcpRegistryTypes.js';
import { IMcpConfigPath, IMcpWorkbenchService, McpCollectionDefinition, McpServerDefinition, McpServerLaunch, McpServerTransportType, McpServerTrust } from '../mcpTypes.js';
import { IMcpDiscovery } from './mcpDiscovery.js';

interface CollectionState extends IDisposable {
	definition: McpCollectionDefinition;
	serverDefinitions: ISettableObservable<readonly McpServerDefinition[]>;
}

interface IResolvedMcpConfigInfo {
	mcpConfigPath: IMcpConfigPath | undefined;
	locations: Map<string, Location>;
	sandbox: IMcpSandboxConfiguration | undefined;
}

export class InstalledMcpServersDiscovery extends Disposable implements IMcpDiscovery {

	readonly fromGallery = true;
	private readonly collections = this._register(new DisposableMap<string, CollectionState>());

	constructor(
		@IMcpWorkbenchService private readonly mcpWorkbenchService: IMcpWorkbenchService,
		@IMcpRegistry private readonly mcpRegistry: IMcpRegistry,
		@IMcpResourceScannerService private readonly mcpResourceScannerService: IMcpResourceScannerService,
		@ITextModelService private readonly textModelService: ITextModelService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	public start(): void {
		const throttler = this._register(new Throttler());
		this._register(this.mcpWorkbenchService.onChange(() => throttler.queue(() => this.sync())));
		this.sync();
	}

	private async getServerIdMapping(resource: URI, pathToServers: string[]): Promise<Map<string, Location>> {
		const store = new DisposableStore();
		try {
			const ref = await this.textModelService.createModelReference(resource);
			store.add(ref);
			const serverIdMapping = getMcpServerMapping({ model: ref.object.textEditorModel, pathToServers });
			return serverIdMapping;
		} catch {
			return new Map();
		} finally {
			store.dispose();
		}
	}

	private async sync(): Promise<void> {
		try {
			const collections = new Map<string, { mcpConfigPath: IMcpConfigPath | undefined; sandbox: IMcpSandboxConfiguration | undefined; serverDefinitions: McpServerDefinition[] }>();
			const mcpConfigInfos = new ResourceMap<Promise<IResolvedMcpConfigInfo>>();
			for (const server of this.mcpWorkbenchService.getEnabledLocalMcpServers()) {
				let mcpConfigInfoPromise = mcpConfigInfos.get(server.mcpResource);
				if (!mcpConfigInfoPromise) {
					mcpConfigInfoPromise = (async (local: IWorkbenchLocalMcpServer): Promise<IResolvedMcpConfigInfo> => {
						const mcpConfigPath = this.mcpWorkbenchService.getMcpConfigPath(local);
						const locations = mcpConfigPath?.uri ? await this.getServerIdMapping(mcpConfigPath?.uri, mcpConfigPath.section ? [...mcpConfigPath.section, 'servers'] : ['servers']) : new Map();
						const scanTarget = mcpConfigPath ? this._toMcpResourceTarget(mcpConfigPath.target) : undefined;
						const scanned = scanTarget !== undefined ? await this.mcpResourceScannerService.scanMcpServers(local.mcpResource, scanTarget) : undefined;
						return { mcpConfigPath, locations, sandbox: scanned?.sandbox };
					})(server);
					mcpConfigInfos.set(server.mcpResource, mcpConfigInfoPromise);
				}

				const config = server.config;
				const mcpConfigInfo = await mcpConfigInfoPromise;
				const collectionId = `mcp.config.${mcpConfigInfo.mcpConfigPath ? mcpConfigInfo.mcpConfigPath.id : 'unknown'}`;

				let collectionEntry = collections.get(collectionId);
				if (!collectionEntry) {
					collectionEntry = {
						mcpConfigPath: mcpConfigInfo.mcpConfigPath,
						sandbox: mcpConfigInfo.sandbox,
						serverDefinitions: [],
					};
					collections.set(collectionId, collectionEntry);
				}

				const launch: McpServerLaunch = config.type === 'http' ? {
					type: McpServerTransportType.HTTP,
					uri: URI.parse(config.url),
					headers: Object.entries(config.headers || {}),
				} : {
					type: McpServerTransportType.Stdio,
					command: config.command,
					args: config.args || [],
					env: config.env || {},
					envFile: config.envFile,
					cwd: config.cwd,
				};

				collectionEntry.serverDefinitions.push({
					id: `${collectionId}.${server.name}`,
					label: server.name,
					launch,
					sandboxEnabled: config.type === 'http' ? undefined : config.sandboxEnabled,
					cacheNonce: await McpServerLaunch.hash(launch),
					roots: mcpConfigInfo.mcpConfigPath?.workspaceFolder ? [mcpConfigInfo.mcpConfigPath.workspaceFolder.uri] : undefined,
					variableReplacement: {
						folder: mcpConfigInfo.mcpConfigPath?.workspaceFolder,
						section: mcpConfigurationSection,
						target: mcpConfigInfo.mcpConfigPath?.target ?? ConfigurationTarget.USER,
					},
					devMode: config.dev,
					presentation: {
						order: mcpConfigInfo.mcpConfigPath?.order,
						origin: mcpConfigInfo.locations.get(server.name)
					}
				});
			}

			for (const [id] of this.collections) {
				if (!collections.has(id)) {
					this.collections.deleteAndDispose(id);
				}
			}

			for (const [id, { mcpConfigPath, sandbox, serverDefinitions }] of collections) {
				const newServerDefinitions = observableValue<readonly McpServerDefinition[]>(this, serverDefinitions);
				const newCollection: McpCollectionDefinition = {
					id,
					label: mcpConfigPath?.label ?? '',
					presentation: {
						order: serverDefinitions[0]?.presentation?.order,
						origin: mcpConfigPath?.uri,
					},
					remoteAuthority: mcpConfigPath?.remoteAuthority ?? null,
					serverDefinitions: newServerDefinitions,
					trustBehavior: McpServerTrust.Kind.Trusted,
					configTarget: mcpConfigPath?.target ?? ConfigurationTarget.USER,
					scope: mcpConfigPath?.scope ?? StorageScope.PROFILE,
					sandbox,
				};
				const existingCollection = this.collections.get(id);

				const collectionDefinitionsChanged = existingCollection ? !McpCollectionDefinition.equals(existingCollection.definition, newCollection) : true;
				if (!collectionDefinitionsChanged) {
					const serverDefinitionsChanged = existingCollection ? !equals(existingCollection.definition.serverDefinitions.get(), newCollection.serverDefinitions.get(), McpServerDefinition.equals) : true;
					if (serverDefinitionsChanged) {
						existingCollection?.serverDefinitions.set(serverDefinitions, undefined);
					}
					continue;
				}

				this.collections.deleteAndDispose(id);
				const disposable = this.mcpRegistry.registerCollection(newCollection);
				this.collections.set(id, {
					definition: newCollection,
					serverDefinitions: newServerDefinitions,
					dispose: () => disposable.dispose()
				});
			}

		} catch (error) {
			this.logService.error(error);
		}
	}

	private _toMcpResourceTarget(target: ConfigurationTarget): McpResourceTarget | undefined {
		switch (target) {
			case ConfigurationTarget.USER:
			case ConfigurationTarget.USER_LOCAL:
			case ConfigurationTarget.USER_REMOTE:
				return ConfigurationTarget.USER;
			case ConfigurationTarget.WORKSPACE:
				return ConfigurationTarget.WORKSPACE;
			case ConfigurationTarget.WORKSPACE_FOLDER:
				return ConfigurationTarget.WORKSPACE_FOLDER;
			default:
				return undefined;
		}
	}
}
