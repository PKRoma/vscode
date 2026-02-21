/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Sequencer } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { BugIndicatingError } from '../../../../base/common/errors.js';
import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { URI } from '../../../../base/common/uri.js';
import { IGitService, IGitExtensionDelegate, GitRef, GitRefQuery, IGitRepository } from '../common/gitService.js';

export class GitService extends Disposable implements IGitService {
	declare readonly _serviceBrand: undefined;

	private _delegate: IGitExtensionDelegate | undefined;
	private readonly _openRepositorySequencer = new Sequencer();

	private readonly _repositories = new ResourceMap<IGitRepository>();
	get repositories(): Iterable<IGitRepository> {
		return this._repositories.values();
	}

	setDelegate(delegate: IGitExtensionDelegate): IDisposable {
		// The delegate can only be set once, since the vscode.git
		// extension can only run in one extension host process per
		// window.
		if (this._delegate) {
			throw new BugIndicatingError('GitService delegate is already set.');
		}

		this._delegate = delegate;

		return toDisposable(() => {
			this._repositories.clear();
			this._delegate = undefined;
		});
	}

	async openRepository(uri: URI): Promise<IGitRepository | undefined> {
		return this._openRepositorySequencer.queue(async () => {
			if (!this._delegate) {
				return undefined;
			}

			// Check whether we have an opened repository for the uri
			let repository = this._repositories.get(uri);
			if (repository) {
				return repository;
			}

			// Open the repository to get the repository root
			const root = await this._delegate.openRepository(uri);
			if (!root) {
				return undefined;
			}

			const rootUri = URI.revive(root);

			// Check whether we have an opened repository for the root
			repository = this._repositories.get(rootUri);
			if (repository) {
				return repository;
			}

			// Create a new repository
			repository = new GitRepository(this._delegate, rootUri);
			this._repositories.set(rootUri, repository);

			return repository;
		});
	}
}

export class GitRepository implements IGitRepository {
	constructor(private readonly delegate: IGitExtensionDelegate, readonly rootUri: URI) { }

	async getRefs(query: GitRefQuery, token?: CancellationToken): Promise<GitRef[]> {
		return this.delegate.getRefs(this.rootUri, query, token);
	}
}
