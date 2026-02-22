/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { getErrorMessage } from '../../../../../base/common/errors.js';
import { isMarkdownString } from '../../../../../base/common/htmlContent.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { hasKey } from '../../../../../base/common/types.js';
import { ServicesAccessor } from '../../../../../editor/browser/editorExtensions.js';
import { localize, localize2 } from '../../../../../nls.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { Action2, MenuId, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { asJson, IRequestService } from '../../../../../platform/request/common/request.js';
import { IAuthenticationService } from '../../../../services/authentication/common/authentication.js';
import { CHAT_CATEGORY } from './chatActions.js';
import { ChatViewPaneTarget, IChatWidgetService } from '../chat.js';
import { IChatEditorOptions } from '../widgetHosts/editor/chatEditor.js';
import { ChatEditorInput } from '../widgetHosts/editor/chatEditorInput.js';
import { ChatContextKeys } from '../../common/actions/chatContextKeys.js';
import { IExportableChatData, ISerializableChatRequestData, isExportableSessionData } from '../../common/model/chatModel.js';
import { IChatService } from '../../common/chatService/chatService.js';
import { IChatViewTitleActionContext, isChatViewTitleActionContext } from '../../common/actions/chatActions.js';
import { URI } from '../../../../../base/common/uri.js';
import { revive } from '../../../../../base/common/marshalling.js';
import { ACTIVE_GROUP, PreferredGroup } from '../../../../services/editor/common/editorService.js';

const defaultFileName = 'chat.json';
const filters = [{ name: localize('chat.file.label', "Chat Session"), extensions: ['json'] }];
const githubAuthProviderId = 'github';
const githubAuthScopes = ['gist', 'user:email'];
const githubGistApiUrl = 'https://api.github.com/gists';

interface IGithubGistResponse {
	html_url?: string;
}

/**
 * Target location for importing a chat session.
 * - 'chatViewPane': Opens in the chat view pane (sidebar/panel)
 * - 'default': Opens in the active editor group
 */
export type ChatImportTarget = 'chatViewPane' | 'default';

export interface ChatImportOptions {
	inputPath?: URI;
	target?: ChatImportTarget;
}

export function formatChatSessionAsMarkdown(data: IExportableChatData, sessionTitle?: string): string {
	const lines: string[] = [];
	lines.push(`# ${sessionTitle || localize('chat.publishGist.defaultTitle', "Chat Session")}`);
	lines.push('');
	lines.push(`*${localize('chat.publishGist.pretty.subtitle', "A conversation between you and Copilot")}*`);
	lines.push('');
	for (const request of data.requests) {
		const requestText = getRequestText(request);
		if (requestText) {
			lines.push('### You');
			lines.push('');
			lines.push(asBlockQuote(requestText));
			lines.push('');
		}

		const assistantMessages = getAssistantMessages(request);
		if (assistantMessages.length > 0) {
			lines.push('### Copilot');
			lines.push('');
			lines.push(asBlockQuote(assistantMessages.join('\n\n')));
			lines.push('');
		}
	}

	return lines.join('\n').trim();
}

function getRequestText(request: ISerializableChatRequestData): string {
	if (typeof request.message === 'string') {
		return request.message.trim();
	}

	return request.message.text.trim();
}

function getAssistantMessages(request: ISerializableChatRequestData): string[] {
	const messages: string[] = [];
	for (const part of request.response ?? []) {
		if (isMarkdownString(part)) {
			const value = part.value.trim();
			if (value) {
				messages.push(value);
			}
			continue;
		}

		if (!part || typeof part !== 'object' || !hasKey(part, { kind: true })) {
			continue;
		}

		if ((part.kind === 'markdownContent' || part.kind === 'markdownVuln' || part.kind === 'warning')
			&& hasKey(part, { content: true })
			&& isMarkdownString(part.content)) {
			const value = part.content.value.trim();
			if (value) {
				messages.push(value);
			}
		}
	}

	return messages;
}

function asBlockQuote(content: string): string {
	return content
		.split('\n')
		.map(line => `> ${line}`)
		.join('\n');
}

function getGistMarkdownFileName(sessionTitle: string | undefined): string {
	const safeName = (sessionTitle ?? 'chat-session')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	const suffix = new Date().toISOString().replace(/[:.]/g, '-');
	return `${safeName || 'chat-session'}-${suffix}.md`;
}

async function createPrivateGist(requestService: IRequestService, accessToken: string, fileName: string, markdown: string): Promise<string> {
	const response = await requestService.request({
		type: 'POST',
		url: githubGistApiUrl,
		headers: {
			'Accept': 'application/vnd.github+json',
			'Authorization': `Bearer ${accessToken}`,
			'Content-Type': 'application/json',
			'X-GitHub-Api-Version': '2022-11-28'
		},
		data: JSON.stringify({
			public: false,
			files: {
				[fileName]: { content: markdown }
			}
		})
	}, CancellationToken.None);

	const body = await asJson<IGithubGistResponse>(response);
	if (!body?.html_url) {
		throw new Error(localize('chat.publishGist.invalidResponse', "GitHub did not return a gist URL."));
	}

	return body.html_url;
}

export function registerChatExportActions() {
	registerAction2(class ExportChatAction extends Action2 {
		constructor() {
			super({
				id: 'workbench.action.chat.export',
				category: CHAT_CATEGORY,
				title: localize2('chat.export.label', "Export Chat..."),
				precondition: ChatContextKeys.enabled,
				f1: true,
			});
		}
		async run(accessor: ServicesAccessor, outputPath?: URI) {
			const widgetService = accessor.get(IChatWidgetService);
			const fileDialogService = accessor.get(IFileDialogService);
			const fileService = accessor.get(IFileService);
			const chatService = accessor.get(IChatService);

			const widget = widgetService.lastFocusedWidget;
			if (!widget || !widget.viewModel) {
				return;
			}

			if (!outputPath) {
				const defaultUri = joinPath(await fileDialogService.defaultFilePath(), defaultFileName);
				const result = await fileDialogService.showSaveDialog({
					defaultUri,
					filters
				});
				if (!result) {
					return;
				}
				outputPath = result;
			}

			const model = chatService.getSession(widget.viewModel.sessionResource);
			if (!model) {
				return;
			}

			// Using toJSON on the model
			const content = VSBuffer.fromString(JSON.stringify(model.toExport(), undefined, 2));
			await fileService.writeFile(outputPath, content);
		}
	});

	registerAction2(class ImportChatAction extends Action2 {
		constructor() {
			super({
				id: 'workbench.action.chat.import',
				title: localize2('chat.import.label', "Import Chat..."),
				category: CHAT_CATEGORY,
				precondition: ChatContextKeys.enabled,
				f1: true,
			});
		}
		async run(accessor: ServicesAccessor, opts?: ChatImportOptions) {
			const fileService = accessor.get(IFileService);
			const widgetService = accessor.get(IChatWidgetService);
			const chatService = accessor.get(IChatService);
			const fileDialogService = accessor.get(IFileDialogService);

			let inputPath = opts?.inputPath;
			if (!inputPath) {
				const defaultUri = joinPath(await fileDialogService.defaultFilePath(), defaultFileName);
				const result = await fileDialogService.showOpenDialog({
					defaultUri,
					canSelectFiles: true,
					filters
				});
				if (!result) {
					return;
				}
				inputPath = result[0];
			}

			const content = await fileService.readFile(inputPath);
			try {
				const data = revive(JSON.parse(content.value.toString()));
				if (!isExportableSessionData(data)) {
					throw new Error('Invalid chat session data');
				}

				let sessionResource: URI;
				let resolvedTarget: typeof ChatViewPaneTarget | PreferredGroup;
				let options: IChatEditorOptions;

				if (opts?.target === 'chatViewPane') {
					const modelRef = chatService.loadSessionFromData(data);
					sessionResource = modelRef.object.sessionResource;
					resolvedTarget = ChatViewPaneTarget;
					options = { pinned: true };
				} else {
					sessionResource = ChatEditorInput.getNewEditorUri();
					resolvedTarget = ACTIVE_GROUP;
					options = { target: { data }, pinned: true };
				}

				await widgetService.openSession(sessionResource, resolvedTarget, options);
			} catch (err) {
				throw err;
			}
		}
	});

	registerAction2(class PublishChatSessionToPrivateGistAction extends Action2 {
		constructor() {
			super({
				id: 'workbench.action.chat.publishToPrivateGist',
				title: localize2('chat.publishGist.label', "Publish Session to Private Gist..."),
				category: CHAT_CATEGORY,
				icon: Codicon.cloudUpload,
				precondition: ChatContextKeys.enabled,
				f1: true,
				menu: [{
					id: MenuId.ChatViewSessionTitleToolbar,
					group: 'navigation',
					order: 10,
					when: ChatContextKeys.enabled
				}]
			});
		}

		async run(accessor: ServicesAccessor, context?: IChatViewTitleActionContext) {
			const chatService = accessor.get(IChatService);
			const chatWidgetService = accessor.get(IChatWidgetService);
			const authenticationService = accessor.get(IAuthenticationService);
			const requestService = accessor.get(IRequestService);
			const notificationService = accessor.get(INotificationService);
			const clipboardService = accessor.get(IClipboardService);
			const openerService = accessor.get(IOpenerService);

			const sessionResource = isChatViewTitleActionContext(context)
				? context.sessionResource
				: chatWidgetService.lastFocusedWidget?.viewModel?.sessionResource;

			if (!sessionResource) {
				notificationService.warn(localize('chat.publishGist.noSession', "No active chat session to publish."));
				return;
			}

			const model = chatService.getSession(sessionResource);
			if (!model || !model.hasRequests) {
				notificationService.warn(localize('chat.publishGist.emptySession', "The active chat session is empty."));
				return;
			}

			try {
				const sessions = await authenticationService.getSessions(githubAuthProviderId, githubAuthScopes, undefined, true);
				const session = sessions[0] ?? await authenticationService.createSession(githubAuthProviderId, githubAuthScopes);
				const markdown = formatChatSessionAsMarkdown(model.toExport(), model.title);
				const fileName = getGistMarkdownFileName(model.title);
				const gistUrl = await createPrivateGist(requestService, session.accessToken, fileName, markdown);

				await clipboardService.writeText(gistUrl);
				await openerService.open(URI.parse(gistUrl), { openExternal: true });

				notificationService.info(localize('chat.publishGist.success', "Published chat session to a private gist. The URL has been copied to your clipboard."));
			} catch (error) {
				notificationService.error(localize('chat.publishGist.failed', "Failed to publish chat session to a private gist: {0}", getErrorMessage(error)));
			}
		}
	});
}
