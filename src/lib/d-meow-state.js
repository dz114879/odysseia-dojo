export const D_MEOW_STORAGE = 'dojo:theme:v1';
export const D_MEOW_THEME = 'd-meow';
export const D_MEOW_PENDING = 'dojo:d-meow-logout-pending:v1';
export const D_MEOW_SECRET = 'durvis';
export const D_MEOW_BRAND = '旅程 ΟΡΙΖΟΝΤΑΣ';
export const D_MEOW_LOGOUT = '/api/auth/logout';
export const D_MEOW_SEQUENCE_GAP = 2000;

/** The reading shell (including its header and navigation) is not a login page.
 * @param {string} pathname
 */
export function isDMeowReadingPage(pathname) {
	return /^\/docs(?:\/|$)/.test(pathname);
}

/** A bounded shortcut recognizer; never stores typed text or handles form input.
 * @param {{now?: () => number}} options
 */
export function createDMeowSequence({ now = Date.now } = {}) {
	let buffer = '';
	let lastAt = 0;
	return {
		reset() {
			buffer = '';
			lastAt = 0;
		},
		/** @param {{key: string, editable?: boolean, modifier?: boolean, repeat?: boolean, composing?: boolean}} input */
		feed({ key, editable = false, modifier = false, repeat = false, composing = false }) {
			if (editable || modifier || repeat || composing || !/^[a-z]$/i.test(key)) {
				buffer = '';
				return false;
			}
			const time = now();
			if (time - lastAt > D_MEOW_SEQUENCE_GAP) buffer = '';
			lastAt = time;
			const candidate = buffer + key.toLowerCase();
			buffer = D_MEOW_SECRET.startsWith(candidate) ? candidate : key.toLowerCase() === 'd' ? 'd' : '';
			if (buffer !== D_MEOW_SECRET) return false;
			buffer = '';
			return true;
		},
	};
}

/** Match offsets refer to original text, including names split across inline DOM nodes.
 * @param {string} text
 */
export function findDMeowNames(text) {
	const expression = /类脑\s*(?:Odysseia|ΟΔΥΣΣΕΙΑ)|类脑|Odysseia|ΟΔΥΣΣΕΙΑ/giu;
	return [...text.matchAll(expression)].map((match) => ({
		text: match[0],
		start: match.index,
		end: match.index + match[0].length,
	}));
}

/** Presentation tokens only; URLs, source Markdown, code and identifiers are never rewritten.
 * @param {string} text
 * @param {{reading?: boolean}} options
 * @returns {{text: string, kind: 'text' | 'name' | 'greek'}[]}
 */
export function dMeowTextParts(text, { reading = false } = {}) {
	const parts = [];
	let cursor = 0;
	for (const match of findDMeowNames(text)) {
		if (match.start > cursor) parts.push({ text: text.slice(cursor, match.start), kind: 'text' });
		if (reading || match.text.startsWith('类脑')) {
			parts.push({ text: '旅程', kind: 'name' });
			if (!reading && match.text !== '类脑') {
				parts.push({ text: ' ', kind: 'text' }, { text: 'ΟΡΙΖΟΝΤΑΣ', kind: 'greek' });
			}
		} else parts.push({ text: 'ΟΡΙΖΟΝΤΑΣ', kind: 'greek' });
		cursor = match.end;
	}
	if (cursor < text.length) parts.push({ text: text.slice(cursor), kind: 'text' });
	return parts;
}

/** Plain attributes and browser titles use the corrected name, without visual markup.
 * @param {string} text
 * @param {{reading?: boolean}} options
 */
export function dMeowPlainText(text, { reading = false } = {}) {
	return dMeowTextParts(text, { reading })
		.map((part) => (reading && part.kind === 'name' ? '类脑' : part.text))
		.join('');
}
