import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { parseHTML } from 'linkedom';
import { createDMeowBranding } from '../src/lib/d-meow-branding.js';
import { exportArticleMarkdown } from '../src/lib/markdown-export.js';

function makeDoc(body, { title = 'SillyTavern 与 API', outdated = false } = {}) {
	const { document } = parseHTML(`<!doctype html><html><body>
		<main>
			<div class="dojo-doc-heading">
				<div class="dojo-doc-meta">
					<p class="dojo-doc-category">基础教程</p>
					<button class="dojo-copy-markdown" data-copy-markdown data-dojo-ui type="button">复制 Markdown</button>
				</div>
				<h1 id="_top">${title}</h1>
				${outdated ? '<aside class="dojo-outdated-notice" data-outdated-notice>本文部分内容可能已经过时。</aside>' : ''}
			</div>
			<div class="sl-markdown-content">${body}</div>
		</main>
	</body></html>`);
	return document;
}

test('serializes headings, inline formatting, links, images and strips Starlight anchor chrome', () => {
	const doc = makeDoc(
		`
		<div class="sl-heading-wrapper level-h2">
			<h2 id="intro">准备工作</h2>
			<a class="sl-anchor-link" href="#intro"><span class="sl-anchor-icon">#</span><span class="sr-only">Section titled 准备工作</span></a>
		</div>
		<p>支持 <strong>加粗</strong>、<em>斜体</em>、<s>删除线</s>、<code>inline</code> 与 <code>a \`b\` c</code>。</p>
		<p>查看 <a href="/protected/attachments/checklist.txt">清单</a>。</p>
		<p><img src="/protected/tutorial-images/example.svg" alt="API [设置] 示意"></p>
	`,
		{ outdated: true },
	);

	const md = exportArticleMarkdown(doc);
	assert.equal(
		md,
		[
			'# SillyTavern 与 API',
			'',
			'> 本文部分内容可能已经过时。',
			'',
			'## 准备工作',
			'',
			'支持 **加粗**、*斜体*、~~删除线~~、`inline` 与 ``a `b` c``。',
			'',
			'查看 [清单](/protected/attachments/checklist.txt)。',
			'',
			'![API \\[设置\\] 示意](/protected/tutorial-images/example.svg)',
			'',
		].join('\n'),
	);
});

test('serializes Expressive Code blocks, dynamic fences, lists, tables, asides and details', () => {
	const doc = makeDoc(`
		<div class="expressive-code">
			<figure class="frame has-title">
				<figcaption class="header"><span class="title">config.json</span></figcaption>
				<pre data-language="json"><code><div class="ec-line"><div class="code">{</div></div><div class="ec-line"><div class="code">  "ok": true</div></div><div class="ec-line"><div class="code">}</div></div></code></pre>
				<div class="copy"><button type="button">Copy</button></div>
			</figure>
		</div>
		<pre><code class="language-markdown">\`\`\`js
console.log(1);
\`\`\`</code></pre>
		<aside class="starlight-aside starlight-aside--note">
			<p class="starlight-aside__title">提示</p>
			<div class="starlight-aside__content"><p>免费分享，请勿轻信倒卖。</p></div>
		</aside>
		<ol start="2">
			<li>第一项</li>
			<li><input type="checkbox" checked> 已完成
				<ul>
					<li>嵌套子项</li>
				</ul>
			</li>
		</ol>
		<table>
			<thead><tr><th>名称</th><th>说明</th></tr></thead>
			<tbody><tr><td>API</td><td>A | B</td></tr></tbody>
		</table>
		<details>
			<summary>展开详情</summary>
			<p>折叠里的正文。</p>
		</details>
		<hr>
	`);

	const md = exportArticleMarkdown(doc);
	assert.match(md, /```json title="config\.json"\n\{\n {2}"ok": true\n\}\n```/u);
	assert.match(md, /````markdown\n```js\nconsole\.log\(1\);\n```\n````/u);
	assert.match(md, /> \*\*提示\*\*\n>\n> 免费分享，请勿轻信倒卖。/u);
	assert.match(md, /2\. 第一项\n3\. \[x\] 已完成\n {2}- 嵌套子项/u);
	assert.match(md, /\| 名称 \| 说明 \|\n\| --- \| --- \|\n\| API \| A \\\| B \|/u);
	assert.match(md, /<details>\n<summary>展开详情<\/summary>\n\n折叠里的正文。\n\n<\/details>/u);
	assert.match(md, /\n---\n$/u);
	assert.doesNotMatch(md, /Copy/u);
	assert.doesNotMatch(md, /复制 Markdown/u);
});

test('exports clean original text without D-Meow UI or strikethrough corrections when D-Meow theme is active', async () => {
	const fixtureHtml = await readFile(new URL('./fixtures/frontend-reading.html', import.meta.url), 'utf8');
	const doc = makeDoc(fixtureHtml, { title: 'Discord 与类脑 Odysseia' });
	const companion = doc.createElement('figure');
	companion.dataset.dMeowUi = '';
	companion.innerHTML = '<div class="d-meow-bubble">旅程宣布独立！</div><button>暂停摆手</button>';
	doc.querySelector('.sl-markdown-content').appendChild(companion);

	const branding = createDMeowBranding(doc);
	branding.apply({ reading: true });

	const md = exportArticleMarkdown(doc);
	assert.match(md, /^# Discord 与类脑/u);
	assert.match(md, /## 格式混排与名称替换/u);
	assert.match(md, /欢迎阅读类脑社区的教程。|欢迎阅读类脑 社区的教程。/u);
	assert.match(md, /const community = "类脑 Odysseia";/u);
	assert.match(md, /\| 项目 \| 设备配置 \|/u);
	assert.match(md, /!\[非敏感的公开示例图片\]\(\/protected\/tutorial-images\/fixture-api-settings\.svg\)/u);
	assert.doesNotMatch(md, /旅程/u);
	assert.doesNotMatch(md, /暂停摆手/u);
});
