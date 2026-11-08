import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { parseHTML } from 'linkedom';
import { createDMeowBranding } from '../src/lib/d-meow-branding.js';

function fixture(body) {
	const { document, window } = parseHTML(
		`<!doctype html><html><head><title>类脑 Odysseia - 道馆挑战</title></head><body>${body}</body></html>`,
	);
	return { document, window, branding: createDMeowBranding(document) };
}

for (const markup of [
	'类脑 <strong>Odysseia</strong>',
	'<strong>类脑</strong> <em>Odysseia</em>',
	'类<strong>脑 Ody</strong><em>sseia</em>',
	'类脑<span> </span><strong>ΟΔΥΣΣΕΙΑ</strong>',
	'类脑 <mark>Ody</mark>sseia',
]) {
	test(`formatted brand is corrected exactly once: ${markup}`, () => {
		const { document, branding } = fixture(`<p>欢迎 ${markup} 社区。</p>`);
		const original = document.body.innerHTML;
		branding.apply({ reading: true });
		assert.equal(document.querySelectorAll('.d-meow-correction').length, 1);
		assert.equal(document.querySelectorAll('.d-meow-greek').length, 0);
		assert.equal(document.querySelector('p').textContent, '欢迎 旅程类脑 社区。');
		branding.restore();
		assert.equal(document.body.innerHTML, original);
	});
}
test('each independent block and link retains its own name and target', () => {
	const { document, branding } = fixture(
		'<p>类脑</p><p>Odysseia</p><a id="source" href="/docs/odysseia/#类脑">类脑 <strong>Odysseia</strong></a>',
	);
	const link = document.querySelector('a');
	branding.apply({ reading: true });
	assert.equal(document.querySelectorAll('.d-meow-correction').length, 3);
	assert.equal(document.querySelector('a'), link);
	assert.equal(link.getAttribute('href'), '/docs/odysseia/#类脑');
	assert.equal(link.id, 'source');
});
test('original inline nodes, listeners and formatting survive repeated theme toggles', () => {
	const { document, window, branding } = fixture('<p>类脑 <strong>Odysseia</strong></p><button>继续阅读</button>');
	const strong = document.querySelector('strong');
	const text = strong.firstChild;
	const button = document.querySelector('button');
	let clicks = 0;
	button.addEventListener('click', () => clicks++);
	for (let i = 0; i < 10; i++) {
		branding.apply({ reading: true });
		branding.restore();
	}
	assert.equal(document.querySelector('strong'), strong);
	assert.equal(strong.firstChild, text);
	assert.equal(document.querySelector('button'), button);
	button.dispatchEvent(new window.Event('click'));
	assert.equal(clicks, 1);
});
test('a later inline alias is regrouped with the already-rewritten Chinese name', () => {
	const { document, branding } = fixture('<p>类脑 </p>');
	branding.apply({ reading: true });
	const strong = document.createElement('strong');
	strong.textContent = 'Odysseia';
	document.querySelector('p').appendChild(strong);
	branding.apply({ reading: true });
	assert.equal(document.querySelectorAll('.d-meow-correction').length, 1);
	branding.restore();
	assert.equal(document.querySelector('p').innerHTML, '类脑 <strong>Odysseia</strong>');
});
test('dynamic search replacement remains idempotent and does not restore detached results', () => {
	const { document, branding } = fixture('<section><p>类脑 Odysseia</p></section>');
	branding.apply({ reading: true });
	document.querySelector('section').innerHTML = '<p>Discord 与类脑 <mark>Odysseia</mark></p>';
	for (let i = 0; i < 3; i++) branding.apply({ reading: true });
	assert.equal(document.querySelectorAll('.d-meow-correction').length, 1);
	branding.restore();
	assert.equal(document.querySelector('section').innerHTML, '<p>Discord 与类脑 <mark>Odysseia</mark></p>');
});
test('code, form values, editable content, drawings and preserved credits are untouched', () => {
	const markup =
		'<pre><code>类脑 Odysseia</code></pre><input value="类脑 Odysseia"><textarea>类脑 Odysseia</textarea><kbd>Odysseia</kbd><div contenteditable="true">类脑 Odysseia</div><svg><text>类脑 Odysseia</text></svg><footer class="public-footer">类脑作者</footer><span data-d-meow-preserve>类脑署名</span>';
	const { document, branding } = fixture(markup);
	const original = document.body.innerHTML;
	branding.apply({ reading: true });
	assert.equal(document.body.innerHTML, original);
});
test('semantic author links and citations preserve credits without excluding surrounding article prose', () => {
	const { document, window, branding } = fixture(`
		<article>
			<p id="prose">类脑社区 <a href="/docs/">Odysseia 教程</a></p>
			<p>作者：<a rel="external author" href="/authors/example" aria-label="Odysseia 作者"><strong>Odysseia</strong></a></p>
			<p>参考：<cite title="类脑参考"><a href="/references/example">类脑 <em>Odysseia</em></a></cite></p>
		</article>`);
	const author = document.querySelector('[rel~="author"]');
	const citation = document.querySelector('cite');
	const authorMarkup = author.outerHTML;
	const citationMarkup = citation.outerHTML;
	const originalText = author.querySelector('strong').firstChild;
	let clicks = 0;
	author.addEventListener('click', () => clicks++);
	for (const reading of [false, true]) {
		branding.apply({ reading });
		assert.equal(author.outerHTML, authorMarkup);
		assert.equal(citation.outerHTML, citationMarkup);
		assert.equal(author.querySelector('strong').firstChild, originalText);
		assert.match(document.querySelector('#prose').textContent, /旅程/);
		assert.equal(document.querySelector('#prose a').getAttribute('href'), '/docs/');
		branding.restore();
	}
	author.dispatchEvent(new window.Event('click'));
	assert.equal(clicks, 1);
});
test('the licensing boundary preserves credit text, brand nodes and accessible names', () => {
	const { document, branding } = fixture(`
		<p id="prose">类脑社区</p>
		<section id="licensing" data-d-meow-preserve>
			<h2>教程署名</h2><p>作者：类脑教程组</p>
			<a data-dojo-brand href="/authors/example" aria-label="Odysseia 作者">Odysseia</a>
		</section>`);
	const licensing = document.querySelector('#licensing');
	const original = licensing.outerHTML;
	for (const reading of [false, true]) {
		branding.apply({ reading });
		assert.equal(licensing.outerHTML, original);
		assert.match(document.querySelector('#prose').textContent, /旅程/);
		branding.restore();
		assert.equal(licensing.outerHTML, original);
	}
});
test('accessible names restore exactly without modifying resource URLs', () => {
	const { document, branding } = fixture(
		'<a aria-label="类脑 Odysseia 首页" href="/docs/tutorials/">类脑 Odysseia</a><img src="/protected/类脑.png" alt="类脑 Odysseia 示意图">',
	);
	const original = document.documentElement.outerHTML;
	branding.apply({ reading: true });
	assert.equal(document.title, '类脑 - 道馆挑战');
	assert.equal(document.querySelector('a').getAttribute('aria-label'), '类脑 首页');
	assert.equal(document.querySelector('img').getAttribute('src'), '/protected/类脑.png');
	branding.restore();
	assert.equal(document.documentElement.outerHTML, original);
});
test('homepage brand keeps its Greek identity and original markup on restore', () => {
	const { document, branding } = fixture('<a data-dojo-brand href="/">类脑 <em>Odysseia</em></a>');
	const original = document.body.innerHTML;
	branding.apply();
	assert.equal(document.querySelector('a').textContent, '旅程 ΟΡΙΖΟΝΤΑΣ');
	assert.equal(document.querySelectorAll('.d-meow-greek').length, 1);
	branding.apply({ reading: true });
	assert.equal(document.querySelectorAll('.d-meow-correction').length, 1);
	assert.equal(document.querySelectorAll('.d-meow-greek').length, 0);
	branding.restore();
	assert.equal(document.body.innerHTML, original);
});
test('public brand links announce the active name and restore their original accessible label', () => {
	const { document, branding } = fixture(
		'<a data-dojo-brand href="/" aria-label="类脑 Odysseia 首页">类脑 <em>Odysseia</em></a>',
	);
	const link = document.querySelector('a');
	const original = link.outerHTML;
	branding.apply();
	assert.equal(link.textContent, '旅程 ΟΡΙΖΟΝΤΑΣ');
	assert.equal(link.getAttribute('aria-label'), '旅程 ΟΡΙΖΟΝΤΑΣ 首页');
	branding.apply({ reading: true });
	assert.equal(link.getAttribute('aria-label'), '类脑 首页');
	branding.restore();
	assert.equal(link.outerHTML, original);
});
test('mixed reading fixture keeps code, resource targets and formatted names consistent', async () => {
	const markup = await readFile(new URL('./fixtures/frontend-reading.html', import.meta.url), 'utf8');
	const { document, branding } = fixture(`<main class="sl-markdown-content">${markup}</main>`);
	const original = document.body.innerHTML;
	const code = document.querySelector('pre').textContent;
	const links = [...document.querySelectorAll('a')].map((link) => link.getAttribute('href'));
	branding.apply({ reading: true });
	for (const paragraph of document.querySelectorAll('[data-expect-one-name]'))
		assert.equal(paragraph.querySelectorAll('.d-meow-correction').length, 1);
	assert.equal(document.querySelector('pre').textContent, code);
	assert.deepEqual(
		[...document.querySelectorAll('a')].map((link) => link.getAttribute('href')),
		links,
	);
	assert.equal(document.querySelectorAll('.d-meow-greek').length, 0);
	branding.restore();
	assert.equal(document.body.innerHTML, original);
});
