/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { Disposable, DisposableStore } from '../../../base/common/lifecycle.js';
import { URI, UriComponents } from '../../../base/common/uri.js';
import { ExtensionIdentifier } from '../../../platform/extensions/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { IExtHostExtensionService } from './extHostExtensionService.js';
import { IExtHostRpcService } from './extHostRpcService.js';
import { ExtHostGitExtensionShape, GitRefDto, GitRefQueryDto, GitRefTypeDto } from './extHost.protocol.js';

const GIT_EXTENSION_ID = 'vscode.git';

function toGitRefTypeDto(type: GitRefType): GitRefTypeDto {
	switch (type) {
		case GitRefType.Head: return GitRefTypeDto.Head;
		case GitRefType.RemoteHead: return GitRefTypeDto.RemoteHead;
		case GitRefType.Tag: return GitRefTypeDto.Tag;
		default: throw new Error(`Unknown GitRefType: ${type}`);
	}
}

interface Repository {
	readonly rootUri: vscode.Uri;
	getRefs(query: GitRefQuery, token?: vscode.CancellationToken): Promise<GitRef[]>;
}

interface GitRef {
	type: GitRefType;
	name?: string;
	commit?: string;
	remote?: string;
}

const enum GitRefType {
	Head,
	RemoteHead,
	Tag
}

interface GitRefQuery {
	readonly contains?: string;
	readonly count?: number;
	readonly pattern?: string | string[];
	readonly sort?: 'alphabetically' | 'committerdate' | 'creatordate';
}

interface GitExtensionAPI {
	openRepository(root: vscode.Uri): Promise<Repository | null>;
}

interface GitExtension {
	getAPI(version: 1): GitExtensionAPI;
}

export interface IExtHostGitExtensionService extends ExtHostGitExtensionShape {
	readonly _serviceBrand: undefined;
}

export const IExtHostGitExtensionService = createDecorator<IExtHostGitExtensionService>('IExtHostGitExtensionService');

export class ExtHostGitExtensionService extends Disposable implements IExtHostGitExtensionService {
	declare readonly _serviceBrand: undefined;

	private _gitApi: GitExtensionAPI | undefined;
	private readonly _disposables = this._register(new DisposableStore());

	constructor(
		@IExtHostRpcService _extHostRpc: IExtHostRpcService,
		@IExtHostExtensionService private readonly _extHostExtensionService: IExtHostExtensionService,
	) {
		super();
	}

	async $isGitExtensionAvailable(): Promise<boolean> {
		const registry = await this._extHostExtensionService.getExtensionRegistry();
		return !!registry.getExtensionDescription(GIT_EXTENSION_ID);
	}

	async $openRepository(uri: UriComponents): Promise<UriComponents | undefined> {
		const api = await this._ensureGitApi();
		if (!api) {
			return undefined;
		}

		const repository = await api.openRepository(URI.revive(uri));
		return repository?.rootUri;
	}

	async $getRefs(uri: UriComponents, query: GitRefQueryDto, token?: vscode.CancellationToken): Promise<GitRefDto[]> {
		const api = await this._ensureGitApi();
		if (!api) {
			return [];
		}

		const repository = await api.openRepository(URI.revive(uri));
		if (!repository) {
			return [];
		}

		try {
			const refs = await repository.getRefs(query, token);
			const result: (GitRefDto | undefined)[] = refs.map(ref => {
				if (!ref.name || !ref.commit) {
					return undefined;
				}

				const id = ref.type === GitRefType.Head
					? `refs/heads/${ref.name}`
					: ref.type === GitRefType.RemoteHead
						? `refs/remotes/${ref.remote}/${ref.name}`
						: `refs/tags/${ref.name}`;

				return {
					id,
					name: ref.name,
					type: toGitRefTypeDto(ref.type),
					revision: ref.commit
				} satisfies GitRefDto;
			});

			return result.filter(ref => !!ref);
		} catch {
			return [];
		}
	}

	private async _ensureGitApi(): Promise<GitExtensionAPI | undefined> {
		if (this._gitApi) {
			return this._gitApi;
		}

		try {
			await this._extHostExtensionService.activateByIdWithErrors(
				new ExtensionIdentifier(GIT_EXTENSION_ID),
				{ startup: false, extensionId: new ExtensionIdentifier(GIT_EXTENSION_ID), activationEvent: 'api' }
			);

			const exports = this._extHostExtensionService.getExtensionExports(new ExtensionIdentifier(GIT_EXTENSION_ID));
			if (!!exports && typeof (exports as GitExtension).getAPI === 'function') {
				this._gitApi = (exports as GitExtension).getAPI(1);
			}
		} catch {
			// Git extension not available
		}

		return this._gitApi;
	}

	override dispose(): void {
		this._disposables.dispose();
		super.dispose();
	}
}
