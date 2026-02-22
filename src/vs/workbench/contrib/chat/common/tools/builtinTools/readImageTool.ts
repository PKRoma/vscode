/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { MarkdownString } from '../../../../../../base/common/htmlContent.js';
import { extname } from '../../../../../../base/common/path.js';
import { URI } from '../../../../../../base/common/uri.js';
import { localize } from '../../../../../../nls.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { ChatImageMimeType } from '../../languageModels.js';
import { CountTokensCallback, IPreparedToolInvocation, IToolData, IToolImpl, IToolInvocation, IToolInvocationPreparationContext, IToolResult, IToolResultDataPart, IToolResultTextPart, ToolDataSource, ToolProgress } from '../languageModelToolsService.js';

export const InternalReadImageToolId = 'vscode_readImage_internal';

export const ReadImageToolData: IToolData = {
	id: InternalReadImageToolId,
	displayName: localize('readImage.displayName', 'Read Image'),
	canBeReferencedInPrompt: false,
	modelDescription: 'Reads an image file from disk and returns its contents. Use this tool when you need to see or analyze an image file. Supports PNG, JPEG, GIF, WEBP, and BMP formats.',
	source: ToolDataSource.Internal,
	inputSchema: {
		type: 'object',
		properties: {
			filePaths: {
				type: 'array',
				items: {
					type: 'string',
				},
				description: localize('readImage.filePathsDescription', 'An array of file URIs for the images to read.')
			}
		},
		required: ['filePaths']
	}
};

export interface IReadImageToolParams {
	filePaths?: string[];
}

export class ReadImageTool implements IToolImpl {

	constructor(
		@IFileService private readonly _fileService: IFileService,
	) { }

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, token: CancellationToken): Promise<IToolResult> {
		const filePaths = (invocation.parameters as IReadImageToolParams).filePaths || [];

		if (filePaths.length === 0) {
			return {
				content: [{ kind: 'text', value: localize('readImage.noFilePaths', 'No file paths provided.') }]
			};
		}

		const content: (IToolResultTextPart | IToolResultDataPart)[] = [];
		const validUris: URI[] = [];

		for (const filePath of filePaths) {
			let uri: URI;
			try {
				uri = URI.parse(filePath);
			} catch {
				content.push({ kind: 'text', value: localize('readImage.invalidUri', 'Invalid file path: {0}', filePath) });
				continue;
			}

			const imageMimeType = getSupportedImageMimeType(uri);
			if (!imageMimeType) {
				content.push({ kind: 'text', value: localize('readImage.unsupportedFormat', 'Unsupported image format: {0}. Supported formats are PNG, JPEG, GIF, WEBP, and BMP.', filePath) });
				continue;
			}

			try {
				const fileContent = await this._fileService.readFile(uri, undefined, token);
				content.push({
					kind: 'data',
					value: {
						mimeType: imageMimeType,
						data: fileContent.value
					}
				});
				validUris.push(uri);
			} catch {
				content.push({ kind: 'text', value: localize('readImage.readError', 'Failed to read image file: {0}', filePath) });
			}
		}

		return {
			content,
			toolResultDetails: validUris.length > 0 ? validUris : undefined,
		};
	}

	async prepareToolInvocation(context: IToolInvocationPreparationContext, _token: CancellationToken): Promise<IPreparedToolInvocation | undefined> {
		const filePaths = (context.parameters as IReadImageToolParams).filePaths || [];

		const invocationMessage = new MarkdownString();
		const pastTenseMessage = new MarkdownString();

		if (filePaths.length > 1) {
			invocationMessage.appendMarkdown(localize('readImage.invocationMessage.plural', 'Reading {0} images', filePaths.length));
			pastTenseMessage.appendMarkdown(localize('readImage.pastTenseMessage.plural', 'Read {0} images', filePaths.length));
		} else if (filePaths.length === 1) {
			invocationMessage.appendMarkdown(localize('readImage.invocationMessage.singular', 'Reading image'));
			pastTenseMessage.appendMarkdown(localize('readImage.pastTenseMessage.singular', 'Read image'));
		}

		return { invocationMessage, pastTenseMessage };
	}
}

export function getSupportedImageMimeType(uri: URI): ChatImageMimeType | undefined {
	const ext = extname(uri.path).toLowerCase();
	switch (ext) {
		case '.png':
			return ChatImageMimeType.PNG;
		case '.jpg':
		case '.jpeg':
			return ChatImageMimeType.JPEG;
		case '.gif':
			return ChatImageMimeType.GIF;
		case '.webp':
			return ChatImageMimeType.WEBP;
		case '.bmp':
			return ChatImageMimeType.BMP;
		default:
			return undefined;
	}
}
