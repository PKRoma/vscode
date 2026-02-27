/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application, Logger } from '../../../../automation';
import { installAllHandlers } from '../../utils';

export function setup(logger: Logger) {
	describe('Agent Sessions', function () {

		// Agent responses are non-deterministic; retry to reduce flakiness
		this.retries(3);

		// Shared before/after handling
		installAllHandlers(logger);

		it('sessions window renders and accepts chat input', async function () {
			const app = this.app as Application;

			// The smoke test launches the standard workbench. The agent
			// sessions window opens as a second Electron window, so we
			// switch the Playwright driver to that window.
			await app.workbench.agentSessions.switchToSessionsWindow();

			// Verify the sessions workbench loaded
			await app.workbench.agentSessions.waitForWorkbench();

			// Verify the chat input is present
			await app.workbench.agentSessions.waitForChatInput();
		});
	});
}
