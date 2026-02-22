/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CancellationToken } from '../../../../../../../base/common/cancellation.js';
import { VSBuffer } from '../../../../../../../base/common/buffer.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { ResourceMap } from '../../../../../../../base/common/map.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { IFileContent, IReadFileOptions } from '../../../../../../../platform/files/common/files.js';
import { ReadImageTool, getSupportedImageMimeType } from '../../../../common/tools/builtinTools/readImageTool.js';
import { TestFileService } from '../../../../../../test/common/workbenchTestServices.js';

class ImageTestFileService extends TestFileService {
	constructor(private uriToContentMap: ResourceMap<VSBuffer>) {
		super();
	}

	override async readFile(resource: URI, _options?: IReadFileOptions | undefined): Promise<IFileContent> {
		const content = this.uriToContentMap.get(resource);
		if (content === undefined) {
			throw new Error(`File not found: ${resource.toString()}`);
		}

		return {
			resource,
			value: content,
			name: '',
			size: content.byteLength,
			etag: '',
			mtime: 0,
			ctime: 0,
			readonly: false,
			locked: false,
			executable: false
		};
	}
}

suite('ReadImageTool', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('should read a single PNG image', async () => {
		const pngData = VSBuffer.wrap(new Uint8Array([0x89, 0x50, 0x4E, 0x47]));
		const fileContentMap = new ResourceMap<VSBuffer>([
			[URI.parse('file:///path/to/image.png'), pngData]
		]);

		const tool = new ReadImageTool(new ImageTestFileService(fileContentMap));

		const result = await tool.invoke(
			{ callId: 'test-1', toolId: 'read-image', parameters: { filePaths: ['file:///path/to/image.png'] }, context: undefined },
			() => Promise.resolve(0),
			{ report: () => { } },
			CancellationToken.None
		);

		assert.strictEqual(result.content.length, 1);
		assert.strictEqual(result.content[0].kind, 'data');
		if (result.content[0].kind === 'data') {
			assert.strictEqual(result.content[0].value.mimeType, 'image/png');
			assert.strictEqual(result.content[0].value.data, pngData);
		}
	});

	test('should read multiple images of different formats', async () => {
		const pngData = VSBuffer.wrap(new Uint8Array([0x89, 0x50]));
		const jpgData = VSBuffer.wrap(new Uint8Array([0xFF, 0xD8]));
		const gifData = VSBuffer.wrap(new Uint8Array([0x47, 0x49]));

		const fileContentMap = new ResourceMap<VSBuffer>([
			[URI.parse('file:///image.png'), pngData],
			[URI.parse('file:///photo.jpg'), jpgData],
			[URI.parse('file:///anim.gif'), gifData],
		]);

		const tool = new ReadImageTool(new ImageTestFileService(fileContentMap));

		const result = await tool.invoke(
			{ callId: 'test-2', toolId: 'read-image', parameters: { filePaths: ['file:///image.png', 'file:///photo.jpg', 'file:///anim.gif'] }, context: undefined },
			() => Promise.resolve(0),
			{ report: () => { } },
			CancellationToken.None
		);

		assert.strictEqual(result.content.length, 3);
		assert.strictEqual(result.content[0].kind, 'data');
		assert.strictEqual(result.content[1].kind, 'data');
		assert.strictEqual(result.content[2].kind, 'data');
		if (result.content[0].kind === 'data') {
			assert.strictEqual(result.content[0].value.mimeType, 'image/png');
		}
		if (result.content[1].kind === 'data') {
			assert.strictEqual(result.content[1].value.mimeType, 'image/jpeg');
		}
		if (result.content[2].kind === 'data') {
			assert.strictEqual(result.content[2].value.mimeType, 'image/gif');
		}
	});

	test('should return error for unsupported image formats', async () => {
		const tool = new ReadImageTool(new ImageTestFileService(new ResourceMap<VSBuffer>()));

		const result = await tool.invoke(
			{ callId: 'test-3', toolId: 'read-image', parameters: { filePaths: ['file:///path/to/document.pdf'] }, context: undefined },
			() => Promise.resolve(0),
			{ report: () => { } },
			CancellationToken.None
		);

		assert.strictEqual(result.content.length, 1);
		assert.strictEqual(result.content[0].kind, 'text');
		if (result.content[0].kind === 'text') {
			assert.ok(result.content[0].value.includes('Unsupported image format'));
		}
	});

	test('should return error for missing files', async () => {
		const tool = new ReadImageTool(new ImageTestFileService(new ResourceMap<VSBuffer>()));

		const result = await tool.invoke(
			{ callId: 'test-4', toolId: 'read-image', parameters: { filePaths: ['file:///nonexistent/image.png'] }, context: undefined },
			() => Promise.resolve(0),
			{ report: () => { } },
			CancellationToken.None
		);

		assert.strictEqual(result.content.length, 1);
		assert.strictEqual(result.content[0].kind, 'text');
		if (result.content[0].kind === 'text') {
			assert.ok(result.content[0].value.includes('Failed to read'));
		}
	});

	test('should handle empty filePaths array', async () => {
		const tool = new ReadImageTool(new ImageTestFileService(new ResourceMap<VSBuffer>()));

		const result = await tool.invoke(
			{ callId: 'test-5', toolId: 'read-image', parameters: { filePaths: [] }, context: undefined },
			() => Promise.resolve(0),
			{ report: () => { } },
			CancellationToken.None
		);

		assert.strictEqual(result.content.length, 1);
		assert.strictEqual(result.content[0].kind, 'text');
		if (result.content[0].kind === 'text') {
			assert.ok(result.content[0].value.includes('No file paths'));
		}
	});

	test('should handle undefined filePaths', async () => {
		const tool = new ReadImageTool(new ImageTestFileService(new ResourceMap<VSBuffer>()));

		const result = await tool.invoke(
			{ callId: 'test-6', toolId: 'read-image', parameters: {}, context: undefined },
			() => Promise.resolve(0),
			{ report: () => { } },
			CancellationToken.None
		);

		assert.strictEqual(result.content.length, 1);
		assert.strictEqual(result.content[0].kind, 'text');
		if (result.content[0].kind === 'text') {
			assert.ok(result.content[0].value.includes('No file paths'));
		}
	});

	test('should handle mix of valid and invalid files', async () => {
		const pngData = VSBuffer.wrap(new Uint8Array([0x89, 0x50]));
		const fileContentMap = new ResourceMap<VSBuffer>([
			[URI.parse('file:///valid.png'), pngData],
		]);

		const tool = new ReadImageTool(new ImageTestFileService(fileContentMap));

		const result = await tool.invoke(
			{ callId: 'test-7', toolId: 'read-image', parameters: { filePaths: ['file:///valid.png', 'file:///missing.jpg', 'file:///doc.pdf'] }, context: undefined },
			() => Promise.resolve(0),
			{ report: () => { } },
			CancellationToken.None
		);

		assert.strictEqual(result.content.length, 3);
		assert.strictEqual(result.content[0].kind, 'data');
		assert.strictEqual(result.content[1].kind, 'text'); // missing file
		assert.strictEqual(result.content[2].kind, 'text'); // unsupported format
	});

	test('should provide correct invocation messages', async () => {
		const tool = new ReadImageTool(new ImageTestFileService(new ResourceMap<VSBuffer>()));

		const singlePrep = await tool.prepareToolInvocation(
			{ parameters: { filePaths: ['file:///image.png'] }, toolCallId: 'test-8', chatSessionResource: undefined },
			CancellationToken.None
		);
		assert.ok(singlePrep);
		assert.ok(singlePrep.invocationMessage);
		const singleMsg = typeof singlePrep.invocationMessage === 'string' ? singlePrep.invocationMessage : singlePrep.invocationMessage!.value;
		assert.ok(singleMsg.includes('Reading image'));

		const pluralPrep = await tool.prepareToolInvocation(
			{ parameters: { filePaths: ['file:///a.png', 'file:///b.jpg'] }, toolCallId: 'test-9', chatSessionResource: undefined },
			CancellationToken.None
		);
		assert.ok(pluralPrep);
		assert.ok(pluralPrep.invocationMessage);
		const pluralMsg = typeof pluralPrep.invocationMessage === 'string' ? pluralPrep.invocationMessage : pluralPrep.invocationMessage!.value;
		assert.ok(pluralMsg.includes('2'));
	});
});

suite('getSupportedImageMimeType', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('should return correct MIME types for supported extensions', () => {
		assert.strictEqual(getSupportedImageMimeType(URI.parse('file:///test.png')), 'image/png');
		assert.strictEqual(getSupportedImageMimeType(URI.parse('file:///test.jpg')), 'image/jpeg');
		assert.strictEqual(getSupportedImageMimeType(URI.parse('file:///test.jpeg')), 'image/jpeg');
		assert.strictEqual(getSupportedImageMimeType(URI.parse('file:///test.gif')), 'image/gif');
		assert.strictEqual(getSupportedImageMimeType(URI.parse('file:///test.webp')), 'image/webp');
		assert.strictEqual(getSupportedImageMimeType(URI.parse('file:///test.bmp')), 'image/bmp');
	});

	test('should be case-insensitive', () => {
		assert.strictEqual(getSupportedImageMimeType(URI.parse('file:///test.PNG')), 'image/png');
		assert.strictEqual(getSupportedImageMimeType(URI.parse('file:///test.JPG')), 'image/jpeg');
	});

	test('should return undefined for unsupported extensions', () => {
		assert.strictEqual(getSupportedImageMimeType(URI.parse('file:///test.pdf')), undefined);
		assert.strictEqual(getSupportedImageMimeType(URI.parse('file:///test.txt')), undefined);
		assert.strictEqual(getSupportedImageMimeType(URI.parse('file:///test.svg')), undefined);
	});
});
