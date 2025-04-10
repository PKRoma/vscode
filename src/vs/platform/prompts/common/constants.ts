/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { basename } from '../../../base/common/resources.js';

/**
 * File extension for the reusable prompt files.
 */
export const PROMPT_FILE_EXTENSION = '.prompt.md';

/**
 * File extension for the reusable instruction files.
 */
export const INSTRUCTION_FILE_EXTENSION = '.instructions.md';

/**
 * Copilot custom instructions file name.
 */
export const COPILOT_CUSTOM_INSTRUCTIONS_FILENAME = 'copilot-instructions.md';

/**
 * Configuration key for the `reusable prompts` feature
 * (also known as `prompt files`, `prompt instructions`, etc.).
 */
export const CONFIG_KEY: string = 'chat.promptFiles';

/**
 * Configuration key for the locations of reusable prompt files.
 */
export const LOCATIONS_CONFIG_KEY: string = 'chat.promptFilesLocations';

/**
 * Default reusable prompt files source folder.
 */
export const DEFAULT_SOURCE_FOLDER = '.github/prompts';


/**
 * Gets the prompt file type from the provided path.
 */
export function getPromptFileType(fileUri: URI): 'instructions' | 'prompt' | undefined {
	const filename = basename(fileUri);
	if (filename.endsWith(PROMPT_FILE_EXTENSION)) {
		return 'prompt';
	} else if (filename.endsWith(INSTRUCTION_FILE_EXTENSION) || filename === COPILOT_CUSTOM_INSTRUCTIONS_FILENAME) {
		return 'instructions';
	}
	return undefined;
}

/**
 * Check if provided path is a reusable prompt file.
 */
export function isPromptFile(fileUri: URI): boolean {
	return getPromptFileType(fileUri) !== undefined;
}


export function getFileExtension(type: 'instructions' | 'prompt'): string {
	return type === 'instructions' ? INSTRUCTION_FILE_EXTENSION : PROMPT_FILE_EXTENSION;
}

/**
 * Gets clean prompt name without file extension.
 *
 * @throws If provided path is not a prompt file
 * 		   (does not end with {@link PROMPT_FILE_EXTENSION}).
 */
export const getCleanPromptName = (
	fileUri: URI,
): string => {
	const filename = basename(fileUri);
	if (filename.endsWith(PROMPT_FILE_EXTENSION)) {
		return filename.slice(0, -PROMPT_FILE_EXTENSION.length);
	} else if (filename.endsWith(INSTRUCTION_FILE_EXTENSION)) {
		return filename.slice(0, -INSTRUCTION_FILE_EXTENSION.length);
	} else if (filename === COPILOT_CUSTOM_INSTRUCTIONS_FILENAME) {
		return filename.slice(0, -3);
	}
	throw new Error(`File ${fileUri} is not a prompt file`);
};
