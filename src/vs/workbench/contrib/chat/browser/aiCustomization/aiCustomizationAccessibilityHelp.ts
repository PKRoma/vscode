/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ServicesAccessor } from '../../../../../editor/browser/editorExtensions.js';
import { AccessibleContentProvider, AccessibleViewProviderId, AccessibleViewType } from '../../../../../platform/accessibility/browser/accessibleView.js';
import { IAccessibleViewImplementation } from '../../../../../platform/accessibility/browser/accessibleViewRegistry.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { AccessibilityVerbositySettingId } from '../../../accessibility/browser/accessibilityConfiguration.js';
import { CONTEXT_AI_CUSTOMIZATION_MANAGEMENT_EDITOR, CONTEXT_AI_CUSTOMIZATION_MANAGEMENT_SECTION, AICustomizationManagementSection } from './aiCustomizationManagement.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { AICustomizationManagementEditor } from './aiCustomizationManagementEditor.js';

export class AICustomizationAccessibilityHelp implements IAccessibleViewImplementation {
	readonly priority = 110;
	readonly name = 'aiCustomization';
	readonly type = AccessibleViewType.Help;
	readonly when = ContextKeyExpr.and(CONTEXT_AI_CUSTOMIZATION_MANAGEMENT_EDITOR, CONTEXT_AI_CUSTOMIZATION_MANAGEMENT_SECTION.isEqualTo(AICustomizationManagementSection.Overview));
	getProvider(accessor: ServicesAccessor) {
		const editorService = accessor.get(IEditorService);
		const activeEditorPane = editorService.activeEditorPane;
		if (!(activeEditorPane instanceof AICustomizationManagementEditor)) {
			return;
		}

		const widget = activeEditorPane.getOverviewWidget();
		if (!widget) {
			return;
		}

		return new AccessibleContentProvider(
			AccessibleViewProviderId.AICustomizationHelp,
			{ type: AccessibleViewType.Help },
			() => widget.getAccessibleDetails(),
			() => {
				widget.focus();
			},
			AccessibilityVerbositySettingId.AICustomizationHelp,
		);
	}
}
