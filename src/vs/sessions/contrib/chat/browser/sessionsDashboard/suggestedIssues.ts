/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Disposable, MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IRequestService, asJson } from '../../../../../platform/request/common/request.js';
import { IAuthenticationService } from '../../../../../workbench/services/authentication/common/authentication.js';
import { Emitter } from '../../../../../base/common/event.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { ChatMessageRole, getTextResponseFromStream, ILanguageModelsService } from '../../../../../workbench/contrib/chat/common/languageModels.js';

const STORAGE_KEY_FILTER = 'sessions.suggestedIssues.filter';

export interface ISuggestedIssue {
	readonly number: number;
	readonly title: string;
	readonly labels: readonly string[];
	readonly htmlUrl: string;
	readonly repositoryNwo: string;
}

interface IGitHubSearchResponse {
	readonly items: readonly IGitHubSearchItem[];
}

interface IGitHubSearchItem {
	readonly number: number;
	readonly title: string;
	readonly html_url: string;
	readonly labels: readonly { readonly name: string }[];
	readonly pull_request?: unknown;
	readonly repository?: { readonly full_name: string };
	readonly repository_url?: string;
}

/**
 * Fetches GitHub issues using the Search API with a user-customizable filter.
 * The filter is a natural language string that gets translated into GitHub
 * search qualifiers (e.g. "assigned to me" → `assignee:@me`).
 */
export class SuggestedIssuesProvider extends Disposable {

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	private _issues: ISuggestedIssue[] = [];
	private _loading = false;
	private _filter: string;
	private _lastQuery: string = '';
	private _githubUsername: string | undefined;
	private readonly _cts = this._register(new MutableDisposable<CancellationTokenSource>());

	get issues(): readonly ISuggestedIssue[] { return this._issues; }
	get loading(): boolean { return this._loading; }
	get filter(): string { return this._filter; }
	get lastQuery(): string { return this._lastQuery; }

	constructor(
		@IRequestService private readonly requestService: IRequestService,
		@IAuthenticationService private readonly authenticationService: IAuthenticationService,
		@IStorageService private readonly storageService: IStorageService,
		@ILanguageModelsService private readonly languageModelsService: ILanguageModelsService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this._filter = this.storageService.get(STORAGE_KEY_FILTER, StorageScope.PROFILE) ?? '';
		this._resolveUsername().then(() => this.fetchIssues(2));
	}

	private async _resolveUsername(): Promise<void> {
		try {
			const token = await this._getAuthToken();
			const response = await this.requestService.request(
				{
					type: 'GET',
					url: 'https://api.github.com/user',
					headers: {
						'Authorization': `token ${token}`,
						'Accept': 'application/vnd.github.v3+json',
						'User-Agent': 'VS-Code-Sessions',
					},
				},
				CancellationToken.None,
			);
			const user = await asJson<{ login: string }>(response);
			if (user?.login) {
				this._githubUsername = user.login;
				this.logService.info(`[SuggestedIssues] GitHub user: ${this._githubUsername}`);
			}
		} catch (e) {
			this.logService.debug('[SuggestedIssues] Could not resolve GitHub username:', e);
		}
	}

	setFilter(filter: string): void {
		this._filter = filter.trim();
		this.storageService.store(STORAGE_KEY_FILTER, this._filter, StorageScope.PROFILE, StorageTarget.USER);
		this.fetchIssues(this._issues.length > 2 ? 8 : 2);
	}

	async fetchIssues(count: number): Promise<void> {
		this._cts.value?.cancel();
		const cts = this._cts.value = new CancellationTokenSource();

		this._loading = true;
		this._onDidChange.fire();

		try {
			const token = await this._getAuthToken();
			if (cts.token.isCancellationRequested) { return; }

			const query = await this._buildSearchQuery();
			if (cts.token.isCancellationRequested) { return; }

			this._lastQuery = query;
			const url = `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=${count}&sort=updated&order=desc`;

			const response = await this.requestService.request(
				{
					type: 'GET',
					url,
					headers: {
						'Authorization': `token ${token}`,
						'Accept': 'application/vnd.github.v3+json',
						'User-Agent': 'VS-Code-Sessions',
					},
				},
				cts.token,
			);

			if (cts.token.isCancellationRequested) { return; }

			const raw = await asJson<IGitHubSearchResponse>(response);
			if (!raw?.items || cts.token.isCancellationRequested) { return; }

			this._issues = raw.items
				.filter(issue => !issue.pull_request)
				.map(issue => ({
					number: issue.number,
					title: issue.title,
					labels: issue.labels.map(l => l.name),
					htmlUrl: issue.html_url,
					repositoryNwo: issue.repository?.full_name ?? this._extractNwoFromUrl(issue.repository_url) ?? '',
				}));
		} catch (e) {
			if (!cts.token.isCancellationRequested) {
				this.logService.warn('[SuggestedIssues] Failed to fetch issues:', e);
			}
		} finally {
			if (!cts.token.isCancellationRequested) {
				this._loading = false;
				this._onDidChange.fire();
			}
		}
	}

	/**
	 * Builds a GitHub search query. If the user has a custom filter, uses the LLM
	 * to translate natural language into GitHub search qualifiers. Falls back to
	 * a default query if the LLM is unavailable.
	 */
	private async _buildSearchQuery(): Promise<string> {
		const base = 'is:issue is:open';

		if (!this._filter) {
			return `${base} assignee:@me`;
		}

		try {
			const query = await this._translateFilterWithLLM(this._filter);
			if (query) {
				return `${base} ${query}`;
			}
		} catch (e) {
			this.logService.debug('[SuggestedIssues] LLM translation failed, using fallback:', e);
		}

		// Fallback: pass the filter as free-text
		return `${base} ${this._filter}`;
	}

	/**
	 * Uses the LLM to translate a natural-language filter into GitHub search qualifiers.
	 */
	private async _translateFilterWithLLM(input: string): Promise<string | undefined> {
		const models = await this.languageModelsService.selectLanguageModels({ vendor: 'copilot', id: 'copilot-fast' });
		if (models.length === 0) {
			return undefined;
		}

		const cts = new CancellationTokenSource();
		try {
			const usernameContext = this._githubUsername
				? `\nThe authenticated GitHub user is: ${this._githubUsername}\nWhen the user mentions a repo by name only (without owner), assume it belongs to ${this._githubUsername} and use repo:${this._githubUsername}/REPONAME.\n`
				: '';

			const systemPrompt = [
				'You are a GitHub search query translator.',
				'Convert the user\'s natural language description into GitHub issue search qualifiers.',
				'Output ONLY the search qualifiers on a single line, nothing else. No explanation, no markdown, no backticks, no quotes around the entire output.',
				usernameContext,
				'IMPORTANT RULES:',
				'- repo: qualifier MUST use owner/repo format (e.g. repo:microsoft/vscode).',
				this._githubUsername
					? `- If only a repo name is given (e.g. "dashboard"), use repo:${this._githubUsername}/REPONAME.`
					: '- If only a repo name is given without an owner, use it as a keyword search instead.',
				'- Do NOT include "is:issue" or "is:open" — those are already added.',
				'- Use @me for the current user when they say "me", "my", "assigned to me", etc.',
				'',
				'Available qualifiers:',
				'- assignee:USERNAME or assignee:@me',
				'- label:"LABEL NAME"',
				'- repo:OWNER/REPO (MUST include owner)',
				'- author:USERNAME or author:@me',
				'- mentions:USERNAME or mentions:@me',
				'- user:USERNAME (search all repos of a user)',
				'- milestone:"MILESTONE"',
				'- in:title, in:body, in:comments',
				'- "SEARCH TERM" for text/title matching',
				'- created:>YYYY-MM-DD or updated:>YYYY-MM-DD',
				'- comments:>N',
				'- no:assignee, no:label, no:milestone',
				'',
				'Examples:',
				'User: "issues assigned to me with bug label"',
				'Output: assignee:@me label:"bug"',
				'',
				'User: "issues that start with Test:"',
				'Output: in:title "Test:"',
				'',
				...(this._githubUsername ? [
					`User: "issues in dashboard repo"`,
					`Output: repo:${this._githubUsername}/dashboard`,
					'',
					`User: "issues from simple-server"`,
					`Output: repo:${this._githubUsername}/simple-server`,
					'',
				] : [
					'User: "issues from simple-server"',
					'Output: "simple-server"',
					'',
				]),
				'User: "high priority bugs in microsoft/vscode"',
				'Output: repo:microsoft/vscode label:"bug" label:"high priority"',
				'',
				'User: "unassigned issues created this month"',
				'Output: no:assignee created:>2026-02-01',
			].join('\n');

			const response = await this.languageModelsService.sendChatRequest(
				models[0],
				new ExtensionIdentifier('core'),
				[
					{ role: ChatMessageRole.System, content: [{ type: 'text', value: systemPrompt }] },
					{ role: ChatMessageRole.User, content: [{ type: 'text', value: input }] },
				],
				{},
				cts.token,
			);

			const text = await getTextResponseFromStream(response);
			let trimmed = text.trim();

			// Sanity check: the LLM should return qualifiers, not prose
			if (trimmed && !trimmed.includes('\n') && trimmed.length < 500) {
				// Fix malformed repo: qualifiers that are missing owner
				if (this._githubUsername) {
					trimmed = trimmed.replace(/\brepo:([^/\s]+)(?=\s|$)/g, `repo:${this._githubUsername}/$1`);
				}
				this.logService.info(`[SuggestedIssues] LLM translated "${input}" → "${trimmed}"`);
				return trimmed;
			}

			return undefined;
		} finally {
			cts.dispose();
		}
	}

	private _extractNwoFromUrl(repoUrl: string | undefined): string | undefined {
		if (!repoUrl) {
			return undefined;
		}
		// https://api.github.com/repos/owner/repo
		const match = /\/repos\/([^/]+\/[^/]+)$/.exec(repoUrl);
		return match?.[1];
	}

	private async _getAuthToken(): Promise<string> {
		const sessions = await this.authenticationService.getSessions('github', ['repo']);
		if (sessions.length > 0) {
			return sessions[0].accessToken;
		}
		const session = await this.authenticationService.createSession('github', ['repo']);
		return session.accessToken;
	}
}
