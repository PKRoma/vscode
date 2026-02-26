/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../base/browser/dom.js';
import { renderLabelWithIcons } from '../../../../../../base/browser/ui/iconLabel/iconLabels.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { IDisposable } from '../../../../../../base/common/lifecycle.js';
import { IObservable } from '../../../../../../base/common/observable.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { localize } from '../../../../../../nls.js';
import { IActionWidgetService } from '../../../../../../platform/actionWidget/browser/actionWidget.js';
import { IActionWidgetDropdownAction, IActionWidgetDropdownActionProvider } from '../../../../../../platform/actionWidget/browser/actionWidgetDropdown.js';
import { IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { IKeybindingService } from '../../../../../../platform/keybinding/common/keybinding.js';
import { ITelemetryService } from '../../../../../../platform/telemetry/common/telemetry.js';
import { ChatPermissionLevel } from '../../../common/constants.js';
import { MenuItemAction } from '../../../../../../platform/actions/common/actions.js';
import { ChatInputPickerActionViewItem, IChatInputPickerOptions } from './chatInputPickerActionItem.js';

export interface IPermissionPickerDelegate {
	readonly currentPermissionLevel: IObservable<ChatPermissionLevel>;
	readonly setPermissionLevel: (level: ChatPermissionLevel) => void;
}

export class PermissionPickerActionItem extends ChatInputPickerActionViewItem {
	constructor(
		action: MenuItemAction,
		private readonly delegate: IPermissionPickerDelegate,
		pickerOptions: IChatInputPickerOptions,
		@IActionWidgetService actionWidgetService: IActionWidgetService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@ITelemetryService telemetryService: ITelemetryService,
	) {
		const actionProvider: IActionWidgetDropdownActionProvider = {
			getActions: () => {
				const currentLevel = delegate.currentPermissionLevel.get();
				return [
					{
						...action,
						id: 'chat.permissions.default',
						label: localize('permissions.default', "Default Approvals"),
						icon: ThemeIcon.fromId(Codicon.shield.id),
						checked: currentLevel === ChatPermissionLevel.Default,
						tooltip: '',
						hover: {
							content: localize('permissions.default.description', "Use configured approval settings"),
							position: pickerOptions.hoverPosition
						},
						run: async () => {
							delegate.setPermissionLevel(ChatPermissionLevel.Default);
							if (this.element) {
								this.renderLabel(this.element);
							}
						},
					} satisfies IActionWidgetDropdownAction,
					{
						...action,
						id: 'chat.permissions.autopilot',
						label: localize('permissions.autoApproveAll', "Auto Approvals"),
						icon: ThemeIcon.fromId(Codicon.warning.id),
						checked: currentLevel === ChatPermissionLevel.Autopilot,
						tooltip: '',
						hover: {
							content: localize('permissions.autoApproveAll.description', "Automatically approve all tool calls"),
							position: pickerOptions.hoverPosition
						},
						run: async () => {
							delegate.setPermissionLevel(ChatPermissionLevel.Autopilot);
							if (this.element) {
								this.renderLabel(this.element);
							}
						},
					} satisfies IActionWidgetDropdownAction,
				];
			}
		};

		super(action, {
			actionProvider,
			reporter: { id: 'ChatPermissionPicker', name: 'ChatPermissionPicker', includeOptions: true },
		}, pickerOptions, actionWidgetService, keybindingService, contextKeyService, telemetryService);
	}

	protected override renderLabel(element: HTMLElement): IDisposable | null {
		this.setAriaLabelAttributes(element);

		const level = this.delegate.currentPermissionLevel.get();
		const isFullAccess = level === ChatPermissionLevel.Autopilot;
		const icon = isFullAccess ? Codicon.warning : Codicon.shield;

		const labelElements = [];
		labelElements.push(...renderLabelWithIcons(`$(${icon.id})`));
		const label = isFullAccess
			? localize('permissions.autoApproveAll.label', "Auto Approvals")
			: localize('permissions.default.label', "Default Approvals");
		labelElements.push(dom.$('span.chat-input-picker-label', undefined, label));
		labelElements.push(...renderLabelWithIcons(`$(chevron-down)`));

		dom.reset(element, ...labelElements);
		element.classList.toggle('warning', isFullAccess);
		return null;
	}
}
