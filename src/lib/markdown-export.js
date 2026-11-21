const IGNORED_SELECTOR =
	'script, style, noscript, template, [hidden], .sl-anchor-link, .sr-only, [data-d-meow-ui], [data-dojo-ui], .expressive-code .copy';

const BLOCK_TAGS = new Set([
	'ADDRESS',
	'ARTICLE',
	'ASIDE',
	'BLOCKQUOTE',
	'DETAILS',
	'DIV',
	'DL',
	'FIELDSET',
	'FIGCAPTION',
	'FIGURE',
	'FOOTER',
	'FORM',
	'H1',
	'H2',
	'H3',
	'H4',
	'H5',
	'H6',
	'HEADER',
	'HR',
	'LI',
	'MAIN',
	'NAV',
	'OL',
	'P',
	'PRE',
	'SECTION',
	'SUMMARY',
	'TABLE',
	'UL',
]);

/** @param {Node} node */
function isElement(node) {
	return node.nodeType === 1;
}

/** @param {Element} element */
function isIgnored(element) {
	return element.matches(IGNORED_SELECTOR);
}

/** @param {string} value */
function collapseWhitespace(value) {
	return value.replace(/\s+/gu, ' ');
}

/** @param {string} text */
function inlineCode(text) {
	const runs = text.match(/`+/gu) ?? [];
	const maxRun = runs.reduce((longest, run) => Math.max(longest, run.length), 0);
	const fence = '`'.repeat(maxRun + 1);
	const needsPadding = text.startsWith('`') || text.endsWith('`') || (text.startsWith(' ') && text.endsWith(' '));
	return needsPadding ? `${fence} ${text} ${fence}` : `${fence}${text}${fence}`;
}

/** @param {string} text @param {string} language */
function fencedCodeBlock(text, language = '') {
	const normalized = text.replace(/\r\n?/gu, '\n').replace(/^\n+|\n+$/gu, '');
	const runs = normalized.match(/`{3,}/gu) ?? [];
	const maxRun = runs.reduce((longest, run) => Math.max(longest, run.length), 2);
	const fence = '`'.repeat(Math.max(3, maxRun + 1));
	const info = language.trim();
	return `${fence}${info}\n${normalized}\n${fence}`;
}

/** @param {Element} element */
function detectCodeLanguage(element) {
	const dataLang = element.getAttribute('data-language')?.trim();
	if (dataLang && dataLang !== 'plaintext' && dataLang !== 'text') return dataLang;
	const code = element.tagName === 'CODE' ? element : element.querySelector('code');
	for (const candidate of [element, code]) {
		if (!candidate) continue;
		const className = candidate.getAttribute('class') ?? '';
		const match = className.match(/\blanguage-([A-Za-z0-9_+#.-]+)/u);
		if (match && match[1] !== 'plaintext' && match[1] !== 'text') return match[1];
	}
	return '';
}

/** @param {Element} pre */
function extractPreText(pre) {
	const lines = [...pre.querySelectorAll('.ec-line')];
	if (lines.length > 0) {
		return lines
			.map((line) => {
				const codeCell = line.querySelector('.code') ?? line;
				return (codeCell.textContent ?? '').replace(/\n$/u, '');
			})
			.join('\n');
	}
	return pre.textContent ?? '';
}

/** @param {string} text */
function escapeAltText(text) {
	return collapseWhitespace(text)
		.trim()
		.replace(/([[\]])/gu, '\\$1');
}

/** @param {string} text */
function escapeTableCell(text) {
	return text
		.replace(/\|/gu, '\\|')
		.replace(/\r?\n+/gu, '<br>')
		.trim();
}

/** @param {Node} node @returns {string} */
function renderInline(node) {
	if (node.nodeType === 3) {
		return collapseWhitespace(node.nodeValue ?? '');
	}
	if (!isElement(node)) return '';
	const element = /** @type {Element} */ (node);
	if (isIgnored(element)) return '';

	if (element.classList.contains('d-meow-correction')) {
		const original = element.querySelector('.d-meow-original');
		return original ? collapseWhitespace(original.textContent ?? '').trim() : '';
	}

	const tag = element.tagName;
	if (tag === 'BR') return '  \n';
	if (tag === 'IMG') {
		const src = element.getAttribute('src')?.trim();
		if (!src) return '';
		const alt = escapeAltText(element.getAttribute('alt') ?? '');
		return `![${alt}](${src})`;
	}
	if (tag === 'CODE' || tag === 'KBD') {
		const text = (element.textContent ?? '').replace(/\r?\n+/gu, ' ');
		return text ? inlineCode(text) : '';
	}

	const inner = renderInlineChildren(element);
	if (tag === 'STRONG' || tag === 'B') {
		const trimmed = inner.trim();
		return trimmed ? `**${trimmed}**` : '';
	}
	if (tag === 'EM' || tag === 'I') {
		const trimmed = inner.trim();
		return trimmed ? `*${trimmed}*` : '';
	}
	if (tag === 'S' || tag === 'DEL') {
		const trimmed = inner.trim();
		return trimmed ? `~~${trimmed}~~` : '';
	}
	if (tag === 'A') {
		const href = element.getAttribute('href')?.trim();
		const label = inner.trim();
		if (!href) return label;
		if (!label) return href;
		return `[${label}](${href})`;
	}
	return inner;
}

/** @param {Element} parent @returns {string} */
function renderInlineChildren(parent) {
	let output = '';
	for (const child of parent.childNodes) {
		output += renderInline(child);
	}
	return output.replace(/[ \t]+\n/gu, '\n').replace(/\n[ \t]+/gu, '\n');
}

/** @param {string} markdown */
function quoteMarkdown(markdown) {
	return markdown
		.trim()
		.split('\n')
		.map((line) => (line.trim() ? `> ${line}` : '>'))
		.join('\n');
}

/** @param {Element} table */
function renderTable(table) {
	const headerRows = [...table.querySelectorAll('thead tr')];
	const bodyRows = [...table.querySelectorAll('tbody tr')];
	const allRows =
		headerRows.length || bodyRows.length ? [...headerRows, ...bodyRows] : [...table.querySelectorAll('tr')];
	if (allRows.length === 0) return '';

	const matrix = allRows.map((row) =>
		[...row.children]
			.filter((cell) => cell.tagName === 'TH' || cell.tagName === 'TD')
			.map((cell) => escapeTableCell(renderInlineChildren(cell))),
	);
	const colCount = matrix.reduce((max, row) => Math.max(max, row.length), 0);
	if (colCount === 0) return '';

	const normalizeRow = (row) => Array.from({ length: colCount }, (_, index) => row[index] ?? '');
	const [header, ...rows] = matrix.map(normalizeRow);
	const separator = Array.from({ length: colCount }, () => '---');
	const formatRow = (cells) => `| ${cells.join(' | ')} |`;

	return [formatRow(header), formatRow(separator), ...rows.map(formatRow)].join('\n');
}

/** @param {Element} list @param {number} depth */
function renderList(list, depth = 0) {
	const ordered = list.tagName === 'OL';
	const start = ordered ? Number.parseInt(list.getAttribute('start') ?? '1', 10) || 1 : 1;
	const indent = '  '.repeat(depth);
	const items = [...list.children].filter((child) => child.tagName === 'LI');
	const lines = [];

	items.forEach((item, index) => {
		const marker = ordered ? `${start + index}. ` : '- ';
		let checkbox = '';
		const inlineParts = [];
		const nestedBlocks = [];

		for (const child of item.childNodes) {
			if (isElement(child)) {
				const element = /** @type {Element} */ (child);
				if (isIgnored(element)) continue;
				if (element.tagName === 'INPUT' && element.getAttribute('type') === 'checkbox') {
					checkbox = element.hasAttribute('checked') ? '[x] ' : '[ ] ';
					continue;
				}
				if (element.tagName === 'UL' || element.tagName === 'OL') {
					const nested = renderList(element, depth + 1);
					if (nested) nestedBlocks.push(nested);
					continue;
				}
				if (BLOCK_TAGS.has(element.tagName)) {
					const rendered = renderBlock(element, depth + 1);
					if (rendered) {
						if (inlineParts.length === 0 && element.tagName === 'P' && !rendered.includes('\n')) {
							inlineParts.push(rendered);
						} else {
							nestedBlocks.push(
								rendered
									.split('\n')
									.map((line) => (line ? `${'  '.repeat(depth + 1)}${line}` : ''))
									.join('\n'),
							);
						}
					}
					continue;
				}
			}
			const text = renderInline(child);
			if (text) inlineParts.push(text);
		}

		const headline = inlineParts.join('').trim();
		if (headline || checkbox) {
			lines.push(`${indent}${marker}${checkbox}${headline}`.trimEnd());
		} else if (nestedBlocks.length > 0) {
			lines.push(`${indent}${marker}`.trimEnd());
		}
		for (const block of nestedBlocks) lines.push(block);
	});

	return lines.join('\n');
}

/** @param {Element} aside */
function renderAside(aside) {
	const titleNode = aside.querySelector('.starlight-aside__title');
	const contentNode = aside.querySelector('.starlight-aside__content');
	const blocks = [];
	if (titleNode) {
		const titleText = renderInlineChildren(titleNode).trim();
		if (titleText) blocks.push(`**${titleText}**`);
	}
	if (contentNode) {
		const body = renderBlocks(contentNode);
		if (body) blocks.push(body);
	} else if (!titleNode) {
		const body = renderBlocks(aside);
		if (body) blocks.push(body);
	}
	return blocks.length ? quoteMarkdown(blocks.join('\n\n')) : '';
}

/** @param {Element} details */
function renderDetails(details) {
	const summaryNode = [...details.children].find((child) => child.tagName === 'SUMMARY');
	const summaryText = summaryNode ? renderInlineChildren(summaryNode).trim() : '';
	const bodyParts = [];
	for (const child of details.childNodes) {
		if (child === summaryNode) continue;
		const rendered = renderNodeAsBlock(child, 0);
		if (rendered) bodyParts.push(rendered);
	}
	const body = bodyParts.join('\n\n').trim();
	const openLine = summaryText ? `<details>\n<summary>${summaryText}</summary>` : '<details>';
	return body ? `${openLine}\n\n${body}\n\n</details>` : `${openLine}\n</details>`;
}

/** @param {Element} figure */
function renderExpressiveCode(figure) {
	const pre = figure.querySelector('pre');
	if (!pre) return '';
	const language = detectCodeLanguage(pre);
	const title = figure.querySelector('figcaption .title, .header .title')?.textContent?.trim() ?? '';
	const info = title ? (language ? `${language} title="${title}"` : `title="${title}"`) : language;
	return fencedCodeBlock(extractPreText(pre), info);
}

/** @param {Element} element @param {number} depth @returns {string} */
function renderBlock(element, depth = 0) {
	if (isIgnored(element)) return '';
	const tag = element.tagName;

	if (element.classList.contains('expressive-code')) {
		return renderExpressiveCode(element);
	}
	if (element.classList.contains('sl-heading-wrapper')) {
		const heading = element.querySelector('h1, h2, h3, h4, h5, h6');
		return heading ? renderBlock(heading, depth) : '';
	}
	if (/^H[1-6]$/u.test(tag)) {
		const level = Number(tag[1]);
		const text = renderInlineChildren(element).trim();
		return text ? `${'#'.repeat(level)} ${text}` : '';
	}
	if (tag === 'P') {
		return renderInlineChildren(element).trim();
	}
	if (tag === 'HR') {
		return '---';
	}
	if (tag === 'PRE') {
		return fencedCodeBlock(extractPreText(element), detectCodeLanguage(element));
	}
	if (tag === 'BLOCKQUOTE') {
		const body = renderBlocks(element, depth);
		return body ? quoteMarkdown(body) : '';
	}
	if (tag === 'ASIDE') {
		return renderAside(element);
	}
	if (tag === 'UL' || tag === 'OL') {
		return renderList(element, depth);
	}
	if (tag === 'TABLE') {
		return renderTable(element);
	}
	if (tag === 'DETAILS') {
		return renderDetails(element);
	}
	if (tag === 'FIGURE') {
		if (element.querySelector('pre')) return renderExpressiveCode(element);
		const parts = [];
		for (const child of element.childNodes) {
			const rendered = renderNodeAsBlock(child, depth);
			if (rendered) parts.push(rendered);
		}
		return parts.join('\n\n');
	}
	if (tag === 'FIGCAPTION') {
		const text = renderInlineChildren(element).trim();
		return text ? `*${text}*` : '';
	}

	return renderBlocks(element, depth);
}

/** @param {Node} node @param {number} depth */
function renderNodeAsBlock(node, depth = 0) {
	if (node.nodeType === 3) {
		return collapseWhitespace(node.nodeValue ?? '').trim();
	}
	if (!isElement(node)) return '';
	const element = /** @type {Element} */ (node);
	if (isIgnored(element)) return '';
	if (BLOCK_TAGS.has(element.tagName) || element.classList.contains('expressive-code')) {
		return renderBlock(element, depth);
	}
	return renderInline(element).trim();
}

/** @param {Element} container @param {number} depth */
function renderBlocks(container, depth = 0) {
	const blocks = [];
	let inlineBuffer = '';

	const flushInline = () => {
		const trimmed = inlineBuffer.trim();
		if (trimmed) blocks.push(trimmed);
		inlineBuffer = '';
	};

	for (const child of container.childNodes) {
		if (isElement(child)) {
			const element = /** @type {Element} */ (child);
			if (isIgnored(element)) continue;
			if (BLOCK_TAGS.has(element.tagName) || element.classList.contains('expressive-code')) {
				flushInline();
				const rendered = renderBlock(element, depth);
				if (rendered) blocks.push(rendered);
				continue;
			}
		}
		inlineBuffer += renderInline(child);
	}
	flushInline();

	return blocks.join('\n\n');
}

/**
 * Serializes the rendered Starlight reading page into clean Markdown.
 * Presentation-only overlays (D喵 companion, anchor buttons, copy controls) are excluded,
 * and D喵 reading corrections resolve cleanly to the original name.
 * @param {Document} document
 * @returns {string}
 */
export function exportArticleMarkdown(document) {
	const sections = [];
	const heading = document.querySelector('.dojo-doc-heading h1, main h1');
	if (heading) {
		const title = renderInlineChildren(heading).trim();
		if (title) sections.push(`# ${title}`);
	}

	const outdated = document.querySelector('[data-outdated-notice]');
	if (outdated) {
		const notice = renderInlineChildren(outdated).trim();
		if (notice) sections.push(quoteMarkdown(notice));
	}

	const content = document.querySelector('.sl-markdown-content');
	if (content) {
		const body = renderBlocks(content);
		if (body) sections.push(body);
	}

	const result = sections
		.join('\n\n')
		.replace(/\n{3,}/gu, '\n\n')
		.trim();
	return result ? `${result}\n` : '';
}
