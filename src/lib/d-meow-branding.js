import { dMeowPlainText, dMeowTextParts, findDMeowNames } from './d-meow-state.js';

// Formatting may split a name; controls, links and block boundaries remain independent.
const inlineTags = new Set([
	'SPAN',
	'STRONG',
	'EM',
	'B',
	'I',
	'U',
	'S',
	'DEL',
	'SMALL',
	'MARK',
	'ABBR',
	'Q',
	'TIME',
	'SUB',
	'SUP',
	'BDI',
	'BDO',
]);
const excluded =
	'script, style, noscript, code, pre, kbd, samp, textarea, input, select, svg, math, cite, [rel~="author"], [contenteditable], [data-d-meow-ui], [data-d-meow-rewrite], [data-mascot], [data-d-meow-preserve], .public-footer';

/** @param {Element} root @returns {Text[][]} */
function textRuns(root) {
	/** @type {Text[][]} */
	const runs = [];
	/** @type {Text[]} */
	let pending = [];
	function flush() {
		if (pending.length) runs.push(pending);
		pending = [];
	}
	/** @param {Element} parent */
	function visit(parent) {
		for (const child of parent.childNodes) {
			if (child.nodeType === 3) {
				pending.push(/** @type {Text} */ (child));
			} else if (child.nodeType === 1) {
				const element = /** @type {Element} */ (child);
				if (element.matches(excluded) || element.hasAttribute('data-dojo-brand')) flush();
				else if (inlineTags.has(element.tagName) && !element.hasAttribute('role')) visit(element);
				else {
					flush();
					visit(element);
					flush();
				}
			}
		}
	}
	visit(root);
	flush();
	return runs;
}

/** Reversible presentation only: retain original nodes, attributes and event listeners.
 * @param {Document} document
 */
export function createDMeowBranding(document) {
	/** @type {Map<HTMLElement, Text>} */
	const originals = new Map();
	/** @type {Map<HTMLElement, DocumentFragment>} */
	const brands = new Map();
	/** @type {Map<Element, Map<string, string>>} */
	const attributes = new Map();
	/** @type {string | undefined} */
	let title;
	/** @param {string} tag @param {string} className @param {string} text */
	function node(tag, className, text = '') {
		const element = document.createElement(tag);
		element.className = className;
		element.textContent = text;
		return element;
	}
	/** @param {Node} parent @param {Node[]} children */
	function append(parent, ...children) {
		for (const child of children) parent.appendChild(child);
	}
	function greekName() {
		const strong = node('strong', 'd-meow-greek');
		append(strong, node('em', '', 'ΟΡΙΖΟΝΤΑΣ'));
		return strong;
	}
	function correctedName() {
		const correction = node('span', 'd-meow-correction');
		append(correction, node('s', '', '旅程'), node('span', 'd-meow-original', '类脑'));
		return correction;
	}
	function restore() {
		for (const [wrapper, text] of originals) if (wrapper.isConnected) wrapper.replaceWith(text);
		for (const [brand, children] of brands) if (brand.isConnected) brand.replaceChildren(children);
		for (const [element, values] of attributes) {
			if (element.isConnected) for (const [name, value] of values) element.setAttribute(name, value);
		}
		originals.clear();
		brands.clear();
		attributes.clear();
		if (title !== undefined) document.title = title;
		title = undefined;
	}
	/** @param {{reading?: boolean}} options */
	function apply({ reading = false } = {}) {
		// Re-group from originals when an app adds search highlights or inline content.
		// The caller disconnects its observer around this transaction.
		restore();
		if (!document.body) return;
		for (const brand of document.querySelectorAll('[data-dojo-brand]')) {
			if (brand.closest(excluded)) continue;
			const fragment = document.createDocumentFragment();
			for (const child of [...brand.childNodes]) fragment.appendChild(child);
			brands.set(/** @type {HTMLElement} */ (brand), fragment);
			if (reading) append(brand, correctedName());
			else append(brand, document.createTextNode('旅程 '), greekName());
		}
		for (const run of textRuns(document.body)) {
			const matches = findDMeowNames(run.map((text) => text.data).join(''));
			if (!matches.length) continue;
			let offset = 0;
			for (const text of run) {
				const start = offset;
				offset += text.length;
				const overlaps = matches.filter((match) => match.start < offset && match.end > start);
				if (!overlaps.length) continue;
				const wrapper = node('span', 'd-meow-rewrite');
				wrapper.dataset.dMeowRewrite = '';
				let cursor = 0;
				for (const match of overlaps) {
					const localStart = Math.max(0, match.start - start);
					append(wrapper, document.createTextNode(text.data.slice(cursor, localStart)));
					if (match.start >= start) {
						for (const part of dMeowTextParts(match.text, { reading })) {
							if (part.kind === 'greek') append(wrapper, greekName());
							else if (part.kind === 'name' && reading) append(wrapper, correctedName());
							else append(wrapper, document.createTextNode(part.text));
						}
					}
					cursor = Math.min(text.length, match.end - start);
				}
				append(wrapper, document.createTextNode(text.data.slice(cursor)));
				originals.set(wrapper, text);
				text.replaceWith(wrapper);
			}
		}
		for (const element of document.querySelectorAll('[aria-label], [title], img[alt]')) {
			if (element.closest(excluded)) continue;
			for (const name of ['aria-label', 'title', 'alt']) {
				const value = element.getAttribute(name);
				if (!value || value === dMeowPlainText(value, { reading })) continue;
				const saved = attributes.get(element) ?? new Map();
				saved.set(name, value);
				attributes.set(element, saved);
				element.setAttribute(name, dMeowPlainText(value, { reading }));
			}
		}
		title = document.title;
		document.title = dMeowPlainText(title, { reading });
	}
	return { apply, restore };
}
