/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, toDisposable } from '../../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IProductService } from '../../../../../../platform/product/common/productService.js';
import { IAgentHostService } from '../../../../../../platform/agent/common/agentService.js';
import { IDefaultAccountService } from '../../../../../../platform/defaultAccount/common/defaultAccount.js';
import { IAuthenticationService } from '../../../../../services/authentication/common/authentication.js';
import { IWorkbenchContribution } from '../../../../../common/contributions.js';
import { IChatAgentService } from '../../../common/participants/chatAgents.js';
import { IChatSessionsService } from '../../../common/chatSessionsService.js';
import { ILanguageModelsService } from '../../../common/languageModels.js';
import { AGENT_HOST_CLAUDE_MODEL_VENDOR, AGENT_HOST_CLAUDE_SESSION_TYPE, AGENT_HOST_MODEL_VENDOR, AGENT_HOST_SESSION_TYPE } from './agentHostConstants.js';
import { AgentHostLanguageModelProvider } from './agentHostLanguageModelProvider.js';
import { AgentHostSessionHandler } from './agentHostSessionHandler.js';
import { AgentHostSessionListController } from './agentHostSessionListController.js';

export { AgentHostSessionListController } from './agentHostSessionListController.js';
export { AgentHostSessionHandler } from './agentHostSessionHandler.js';

export class AgentHostChatContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.agentHostChatContribution';

	constructor(
		@IAgentHostService private readonly _agentHostService: IAgentHostService,
		@IChatSessionsService chatSessionsService: IChatSessionsService,
		@IChatAgentService chatAgentService: IChatAgentService,
		@IDefaultAccountService private readonly _defaultAccountService: IDefaultAccountService,
		@IAuthenticationService private readonly _authenticationService: IAuthenticationService,
		@ILogService logService: ILogService,
		@IProductService productService: IProductService,
		@ILanguageModelsService languageModelsService: ILanguageModelsService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();

		// Session list controller -- Copilot
		const listController = this._register(this._instantiationService.createInstance(AgentHostSessionListController));
		this._register(chatSessionsService.registerChatSessionItemController(AGENT_HOST_SESSION_TYPE, listController));

		// Session handler + agent -- Copilot
		const sessionHandler = this._register(this._instantiationService.createInstance(AgentHostSessionHandler, { provider: 'copilot' as const }));
		this._register(chatSessionsService.registerChatSessionContentProvider(AGENT_HOST_SESSION_TYPE, sessionHandler));

		// Session list controller -- Claude
		const claudeListController = this._register(this._instantiationService.createInstance(AgentHostSessionListController));
		this._register(chatSessionsService.registerChatSessionItemController(AGENT_HOST_CLAUDE_SESSION_TYPE, claudeListController));

		// Session handler + agent -- Claude
		const claudeSessionHandler = this._register(this._instantiationService.createInstance(AgentHostSessionHandler, { provider: 'claude' as const }));
		this._register(chatSessionsService.registerChatSessionContentProvider(AGENT_HOST_CLAUDE_SESSION_TYPE, claudeSessionHandler));

		// Language model provider -- register the vendor descriptors first, then the providers
		const vendorDescriptor = { vendor: AGENT_HOST_MODEL_VENDOR, displayName: 'Agent Host - Copilot', configuration: undefined, managementCommand: undefined, when: undefined };
		const claudeVendorDescriptor = { vendor: AGENT_HOST_CLAUDE_MODEL_VENDOR, displayName: 'Agent Host - Claude', configuration: undefined, managementCommand: undefined, when: undefined };
		languageModelsService.deltaLanguageModelChatProviderDescriptors([vendorDescriptor, claudeVendorDescriptor], []);
		this._register(toDisposable(() =>
			languageModelsService.deltaLanguageModelChatProviderDescriptors([], [vendorDescriptor, claudeVendorDescriptor])));
		const modelProvider = new AgentHostLanguageModelProvider(this._agentHostService, logService);
		this._register(languageModelsService.registerLanguageModelProvider(AGENT_HOST_MODEL_VENDOR, modelProvider));
		const claudeModelProvider = new AgentHostLanguageModelProvider(this._agentHostService, logService);
		this._register(languageModelsService.registerLanguageModelProvider(AGENT_HOST_CLAUDE_MODEL_VENDOR, claudeModelProvider));

		// Auth -- refresh models after token is pushed so the SDK can authenticate
		this._pushAuthToken().then(() => modelProvider.refresh());
		this._register(this._defaultAccountService.onDidChangeDefaultAccount(() =>
			this._pushAuthToken().then(() => modelProvider.refresh())));
		this._register(this._authenticationService.onDidChangeSessions(() =>
			this._pushAuthToken().then(() => modelProvider.refresh())));
	}

	private async _pushAuthToken(): Promise<void> {
		try {
			const account = await this._defaultAccountService.getDefaultAccount();
			if (!account) {
				return;
			}

			const sessions = await this._authenticationService.getSessions(account.authenticationProvider.id);
			const session = sessions.find(s => s.id === account.sessionId);
			if (session) {
				await this._agentHostService.setAuthToken(session.accessToken);
			}
		} catch {
			// best-effort
		}
	}
}
