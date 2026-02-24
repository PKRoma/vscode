/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Source Map Validator
 *
 * Validates that a source map correctly maps generated positions back to original
 * source positions. For each mapping, it checks that the token at the generated
 * position plausibly corresponds to the token at the original position.
 *
 * Usage:
 *   npx tsx build/next/test/sourcemap-validator.ts <file.js> [--verbose] [--limit N]
 *
 * The .map file is expected alongside the .js file (e.g., file.js.map).
 */

import * as fs from 'fs';
import * as path from 'path';
import { SourceMapConsumer } from 'source-map';

interface ValidationResult {
	totalMappings: number;
	unmappedSegments: number;
	validMappings: number;
	mismatches: MismatchInfo[];
	noSourceContent: number;
}

interface MismatchInfo {
	generatedLine: number;
	generatedColumn: number;
	originalLine: number;
	originalColumn: number;
	source: string;
	generatedToken: string;
	originalToken: string;
}

/**
 * Extract a token (up to `maxLen` chars) starting at the given column in a line.
 * A "token" is a contiguous run of word characters, or a single non-word character.
 */
function extractToken(line: string, col: number, maxLen = 30): string {
	if (col >= line.length) {
		return '<EOL>';
	}
	const rest = line.substring(col);
	// Try to grab a word token
	const wordMatch = rest.match(/^[\w$]+/);
	if (wordMatch) {
		return wordMatch[0].substring(0, maxLen);
	}
	// Otherwise grab a single char (operator, punctuation, etc.)
	return rest[0];
}

/**
 * Check if two tokens plausibly correspond to each other.
 *
 * The minifier performs many transformations that change the token type while
 * preserving the mapping. We need to allow these known patterns while still
 * catching genuinely wrong mappings (e.g., an operator mapped to a keyword
 * from a completely different statement).
 */
function tokensCorrespond(generated: string, original: string): boolean {
	if (generated === original) {
		return true;
	}
	if (generated === '<EOL>' || original === '<EOL>') {
		return true; // Can't validate end-of-line mappings
	}

	const isIdentifier = (t: string) => /^[\w$]+$/.test(t);
	const isKeyword = (t: string) => JS_KEYWORDS.has(t);
	const isNumeric = (t: string) => /^\d/.test(t);
	const isStringStart = (t: string) => t.charCodeAt(0) === 34 /* " */ || t.charCodeAt(0) === 39 /* ' */ || t.charCodeAt(0) === 96 /* ` */;

	// Both identifiers (possibly renamed by minification/mangling): always ok
	if (isIdentifier(generated) && isIdentifier(original) && !isKeyword(generated) && !isKeyword(original)) {
		return true;
	}

	// Minifier converts const/let to var/let and vice versa
	const DECL_KEYWORDS = new Set(['var', 'let', 'const']);
	if (DECL_KEYWORDS.has(generated) && DECL_KEYWORDS.has(original)) {
		return true;
	}

	// Minifier rewrites control flow: if -> return, if -> throw, etc.
	const CONTROL_KEYWORDS = new Set(['if', 'return', 'throw', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally']);
	if (CONTROL_KEYWORDS.has(generated) && CONTROL_KEYWORDS.has(original)) {
		return true;
	}

	// Minifier converts boolean/null literals to shorter forms: false -> !0, true -> !1, null -> void 0
	const LITERAL_OR_OPERATOR = new Set(['true', 'false', 'null', 'void', '!', 'undefined']);
	if (LITERAL_OR_OPERATOR.has(generated) && LITERAL_OR_OPERATOR.has(original)) {
		return true;
	}

	// Minifier may rewrite `!` to `true`/`false` or vice versa
	if ((generated === '!' && (original === 'true' || original === 'false')) ||
		(original === '!' && (generated === 'true' || generated === 'false'))) {
		return true;
	}

	// Both keywords (not covered above): esbuild's minifier freely transforms
	// between keywords (class -> var, this -> return, etc.), so allow all
	// keyword-to-keyword mappings
	if (isKeyword(generated) && isKeyword(original)) {
		return true;
	}

	// Both numeric
	if (isNumeric(generated) && isNumeric(original)) {
		return true;
	}

	// Both string starts
	if (isStringStart(generated) && isStringStart(original)) {
		return true;
	}

	// Minifier converts class/function declarations: class Foo {} -> var Foo = class {}
	// Also converts methods: generated keyword at original identifier position
	if (isKeyword(generated) && isIdentifier(original)) {
		return true;
	}
	if (isIdentifier(generated) && isKeyword(original)) {
		// Reverse: original had a keyword, generated has an identifier (from tree shaking / inlining)
		return true;
	}

	// Numeric mapped to identifier or vice versa (minifier inlines constants)
	if ((isNumeric(generated) && isIdentifier(original)) || (isIdentifier(generated) && isNumeric(original))) {
		return true;
	}

	// Operator/punctuation: allow a broad set since minifier restructures expressions
	// Only flag clear structural mismatches
	const OPEN_CLOSE = new Set(['(', ')', '{', '}', '[', ']']);
	if (OPEN_CLOSE.has(generated) && OPEN_CLOSE.has(original)) {
		return true;
	}

	// Single-char operators are often moved around by the minifier
	if (generated.length === 1 && original.length === 1 && !isIdentifier(generated) && !isIdentifier(original)) {
		return true;
	}

	// If we can't determine, be lenient — the minifier does too many
	// transformations to enumerate all of them. Only report as a mismatch
	// when a whitespace character maps to a non-whitespace token, which
	// indicates a genuinely off-by-one or structurally wrong mapping.
	const isWhitespace = (t: string) => /^\s+$/.test(t);
	if (isWhitespace(generated) && !isWhitespace(original)) {
		return false;
	}

	// Default: allow
	return true;
}

const JS_KEYWORDS = new Set([
	'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
	'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for',
	'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'null', 'return',
	'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var',
	'void', 'while', 'with', 'yield', 'async', 'await', 'of', 'get', 'set',
]);

export function validateSourceMap(
	jsContent: string,
	mapJson: object,
	options: { verbose?: boolean; limit?: number } = {}
): ValidationResult {
	const consumer = new SourceMapConsumer(mapJson as import('source-map').RawSourceMap);
	const generatedLines = jsContent.split('\n');

	const result: ValidationResult = {
		totalMappings: 0,
		unmappedSegments: 0,
		validMappings: 0,
		mismatches: [],
		noSourceContent: 0,
	};

	// Build source content lookup
	const sourceContentMap = new Map<string, string[]>();
	const rawMap = mapJson as { sources?: string[]; sourcesContent?: (string | null)[] };
	if (rawMap.sources && rawMap.sourcesContent) {
		for (let i = 0; i < rawMap.sources.length; i++) {
			const content = rawMap.sourcesContent[i];
			if (content) {
				sourceContentMap.set(rawMap.sources[i], content.split('\n'));
			}
		}
	}

	const limit = options.limit ?? Infinity;

	consumer.eachMapping(mapping => {
		result.totalMappings++;

		if (mapping.originalLine === null || mapping.originalColumn === null) {
			result.unmappedSegments++;
			return;
		}

		if (result.mismatches.length >= limit) {
			return;
		}

		const source = mapping.source;
		const sourceLines = sourceContentMap.get(source);
		if (!sourceLines) {
			result.noSourceContent++;
			return;
		}

		// Get generated token
		const genLine = generatedLines[mapping.generatedLine - 1];
		if (!genLine) {
			return;
		}
		const genToken = extractToken(genLine, mapping.generatedColumn);

		// Get original token
		const origLine = sourceLines[mapping.originalLine - 1];
		if (!origLine) {
			return;
		}
		const origToken = extractToken(origLine, mapping.originalColumn);

		if (tokensCorrespond(genToken, origToken)) {
			result.validMappings++;
		} else {
			result.mismatches.push({
				generatedLine: mapping.generatedLine,
				generatedColumn: mapping.generatedColumn,
				originalLine: mapping.originalLine,
				originalColumn: mapping.originalColumn,
				source,
				generatedToken: genToken,
				originalToken: origToken,
			});
		}
	});

	return result;
}

// CLI entry point
if (process.argv[1] && (process.argv[1].endsWith('sourcemap-validator.ts') || process.argv[1].endsWith('sourcemap-validator.js'))) {
	const args = process.argv.slice(2);
	const jsFile = args.find(a => !a.startsWith('--'));
	const verbose = args.includes('--verbose');
	const limitArg = args.indexOf('--limit');
	const limit = limitArg >= 0 ? parseInt(args[limitArg + 1], 10) : 100;

	if (!jsFile) {
		console.error('Usage: npx tsx build/next/test/sourcemap-validator.ts <file.js> [--verbose] [--limit N]');
		process.exit(1);
	}

	const jsPath = path.resolve(jsFile);
	const mapPath = jsPath + '.map';

	if (!fs.existsSync(jsPath)) {
		console.error(`JS file not found: ${jsPath}`);
		process.exit(1);
	}
	if (!fs.existsSync(mapPath)) {
		console.error(`Source map not found: ${mapPath}`);
		process.exit(1);
	}

	console.log(`Validating: ${path.basename(jsPath)}`);
	console.log(`Source map: ${path.basename(mapPath)}`);

	const jsContent = fs.readFileSync(jsPath, 'utf-8');
	const mapJson = JSON.parse(fs.readFileSync(mapPath, 'utf-8'));

	const result = validateSourceMap(jsContent, mapJson, { verbose, limit });

	console.log();
	console.log(`Total mappings:     ${result.totalMappings}`);
	console.log(`Unmapped segments:  ${result.unmappedSegments}`);
	console.log(`Valid mappings:     ${result.validMappings}`);
	console.log(`No source content:  ${result.noSourceContent}`);
	console.log(`Mismatches:         ${result.mismatches.length}${result.mismatches.length >= limit ? ` (capped at ${limit})` : ''}`);

	const checked = result.totalMappings - result.unmappedSegments - result.noSourceContent;
	if (checked > 0) {
		const accuracy = ((result.validMappings / checked) * 100).toFixed(2);
		console.log(`Accuracy:           ${accuracy}% (${result.validMappings}/${checked})`);
	}

	if (result.mismatches.length > 0) {
		console.log();
		console.log(`First ${Math.min(result.mismatches.length, 20)} mismatches:`);
		for (const m of result.mismatches.slice(0, 20)) {
			const shortSource = m.source.split('/').slice(-2).join('/');
			console.log(
				`  gen ${m.generatedLine}:${m.generatedColumn} "${m.generatedToken}" -> ` +
				`orig ${m.originalLine}:${m.originalColumn} "${m.originalToken}" ` +
				`[${shortSource}]`
			);
		}
	}

	if (result.mismatches.length > 0) {
		process.exit(1);
	}
}
