/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { IGitExtensionDelegate, IGitService, GitRef, GitRefQuery, GitRefType } from '../../contrib/git/common/gitService.js';
import { extHostNamedCustomer, IExtHostContext } from '../../services/extensions/common/extHostCustomers.js';
import { ExtHostContext, ExtHostGitExtensionShape, GitRefTypeDto, MainContext, MainThreadGitExtensionShape } from '../common/extHost.protocol.js';

function toGitRefType(type: GitRefTypeDto): GitRefType {
	switch (type) {
		case GitRefTypeDto.Head: return GitRefType.Head;
		case GitRefTypeDto.RemoteHead: return GitRefType.RemoteHead;
		case GitRefTypeDto.Tag: return GitRefType.Tag;
		default: throw new Error(`Unknown GitRefType: ${type}`);
	}
}

@extHostNamedCustomer(MainContext.MainThreadGitExtension)
export class MainThreadGitExtensionService extends Disposable implements MainThreadGitExtensionShape, IGitExtensionDelegate {
	private readonly _proxy: ExtHostGitExtensionShape;

	constructor(
		extHostContext: IExtHostContext,
		@IGitService private readonly gitService: IGitService,
	) {
		super();

		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostGitExtension);
		this._initializeDelegate();
	}

	private async _initializeDelegate(): Promise<void> {
		// Check whether the vscode.git extension is available in the extension host
		// process before setting the delegate. The delegate should only be set once,
		// for the extension host process that runs the vscode.git extension
		const isExtensionAvailable = await this._proxy.$isGitExtensionAvailable();

		if (isExtensionAvailable && !this._store.isDisposed) {
			this._register(this.gitService.setDelegate(this));
		}
	}

	async openRepository(uri: URI): Promise<URI | undefined> {
		const result = await this._proxy.$openRepository(uri);
		return result ? URI.revive(result) : undefined;
	}

	async getRefs(root: URI, query: GitRefQuery, token?: CancellationToken): Promise<GitRef[]> {
		const result = await this._proxy.$getRefs(root, query, token);

		if (token?.isCancellationRequested) {
			return [];
		}

		return result.map(ref => ({
			...ref,
			type: toGitRefType(ref.type)
		} satisfies GitRef));
	}
}
