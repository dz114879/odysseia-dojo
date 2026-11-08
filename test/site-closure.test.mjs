import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';
import ts from 'typescript';
import {
	createSiteClosure,
	parseSiteClosure,
	readSiteClosureCookie,
	serializeSiteClosure,
	siteClosureCookie,
	siteClosureView,
	SITE_CLOSURE_COOKIE,
	SITE_CLOSURE_MS,
} from '../src/lib/site-closure.js';

const now = 1_800_000_000_000;
const closure = createSiteClosure(now);
const cookie = `${SITE_CLOSURE_COOKIE}=${serializeSiteClosure(closure)}`;

test('closure lasts exactly 60 seconds after the original close deadline', () => {
	assert.equal(closure.reopensAt - closure.closesAt, SITE_CLOSURE_MS);
	assert.deepEqual(parseSiteClosure(serializeSiteClosure(closure), now), closure);
	assert.ok(parseSiteClosure(serializeSiteClosure(closure), closure.reopensAt - 1));
	assert.equal(parseSiteClosure(serializeSiteClosure(closure), closure.reopensAt), null);
});

test('accepts the pending 8-second countdown without restarting it', () => {
	const pending = createSiteClosure(now + 8000);
	assert.deepEqual(parseSiteClosure(serializeSiteClosure(pending), now), pending);
	assert.equal(siteClosureView(pending, '/', now).phase, 'pending');
	assert.equal(siteClosureView(pending, '/', now + 8000).redirect, '/closed');
});

test('malformed, oversized, expired and unbounded closure values cannot trap a browser', () => {
	for (const value of [
		null,
		'',
		'NaN.NaN',
		'1e12.2e12',
		'1.2.3',
		'-1.0',
		'999999999999999999.0',
		`${now}.${now + 999999}`,
		`${now + 8001}.${now + 8001 + SITE_CLOSURE_MS}`,
	]) {
		assert.equal(parseSiteClosure(value, now), null, String(value));
	}
	assert.equal(parseSiteClosure(serializeSiteClosure(createSiteClosure(now - 60_000)), now), null);
});

test('cookie is site-wide, bounded and secure over HTTPS without touching session cookies', () => {
	const encoded = siteClosureCookie(createSiteClosure(now + 8000), now, true);
	assert.match(encoded, /Path=\/; Max-Age=68; SameSite=Lax; Secure$/);
	assert.deepEqual(readSiteClosureCookie(`session=untouched; ${cookie}; other=value`, now), closure);
	assert.equal(readSiteClosureCookie(`prefix_${cookie}`, now), null);
	assert.match(siteClosureCookie(null, now), /^dojo_mascot_closure=; Path=\/; Max-Age=0; SameSite=Lax$/);
});

test('browser navigation keeps closure across home, login and tutorial refreshes', () => {
	for (const path of ['/', '/login', '/docs/tutorials/', '/docs/tutorials/index.html'])
		assert.equal(siteClosureView(closure, path, now).redirect, '/closed');
	assert.deepEqual(siteClosureView(closure, '/closed', now + 30_001), {
		phase: 'closed',
		redirect: null,
		remaining: 30,
	});
	assert.equal(siteClosureView(closure, '/closed/', now).redirect, null);
});

test('expiry and cancellation reopen the browser without an old redirect loop', () => {
	assert.equal(siteClosureView(closure, '/closed', closure.reopensAt).redirect, '/');
	assert.equal(siteClosureView(null, '/closed', now).redirect, '/');
	assert.equal(siteClosureView(null, '/docs/tutorials/', now).redirect, null);
	assert.equal(siteClosureView(createSiteClosure(now + 8000), '/closed', now).redirect, '/');
});

function browserClients() {
	let time = now;
	let cookie = '';
	let nextTimer = 0;
	const storage = new Map();
	const timers = new Map();
	function client({ scriptOpened = false, storageDisabled = false, cookiesDisabled = false } = {}) {
		const { document, window: dom } = parseHTML(`<!doctype html><html><body>
			<section data-mascot>
				<button data-mascot-button></button><div data-mascot-words></div>
				<p data-mascot-live></p><p data-mascot-caption></p>
				<div data-mascot-countdown hidden><span data-mascot-seconds></span></div>
				<button data-mascot-cancel></button>
			</section></body></html>`);
		Object.defineProperty(document, 'cookie', {
			get: () => (cookiesDisabled ? '' : cookie),
			set: (value) => {
				if (cookiesDisabled) return;
				cookie = value.includes('Max-Age=0') ? '' : value.split(';')[0];
			},
		});
		const redirects = [];
		let closeAttempts = 0;
		const window = new EventTarget();
		window.closed = false;
		window.close = () => {
			closeAttempts++;
			window.closed = scriptOpened;
		};
		const globals = {
			document,
			window,
			Event,
			AbortController,
			location: { pathname: '/', protocol: 'https:', replace: (path) => redirects.push(path) },
			localStorage: {
				getItem(key) {
					if (storageDisabled) throw new Error('Storage disabled');
					return storage.get(key) ?? null;
				},
				setItem(key, value) {
					if (storageDisabled) throw new Error('Storage disabled');
					storage.set(key, value);
				},
				removeItem(key) {
					if (storageDisabled) throw new Error('Storage disabled');
					storage.delete(key);
				},
			},
			Date: class extends Date {
				static now() {
					return time;
				}
			},
			setTimeout(callback, delay) {
				const id = ++nextTimer;
				timers.set(id, { at: time + delay, callback });
				return id;
			},
			clearTimeout: (id) => timers.delete(id),
		};
		const modules = new Map();
		function load(name) {
			if (modules.has(name)) return modules.get(name);
			const file = new URL(`../src/lib/${name}`, import.meta.url);
			const source = ts.transpileModule(readFileSync(file, 'utf8'), {
				compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
			}).outputText;
			const exports = {};
			modules.set(name, exports);
			runInNewContext(source, {
				...globals,
				exports,
				require: (specifier) => load(specifier.slice(2) + (/\.[jt]s$/.test(specifier) ? '' : '.ts')),
			});
			return exports;
		}
		const root = document.querySelector('[data-mascot]');
		root.querySelector('[data-mascot-cancel]').focus = () => {};
		const dispose = load('mascot.ts').mountMascot(root);
		return {
			root,
			redirects,
			dispose,
			get closeAttempts() {
				return closeAttempts;
			},
			poke: () => root.querySelector('[data-mascot-button]').dispatchEvent(new dom.Event('click')),
			cancel: () => root.querySelector('[data-mascot-cancel]').dispatchEvent(new dom.Event('click')),
		};
	}
	return {
		client,
		advance(ms) {
			const target = time + ms;
			while (true) {
				const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
				if (!next || next[1].at > target) break;
				time = next[1].at;
				timers.delete(next[0]);
				next[1].callback();
			}
			time = target;
		},
	};
}

for (const scriptOpened of [false, true]) {
	test(`cancellation in a second client prevents stale closure (script-opened: ${scriptOpened})`, () => {
		const browser = browserClients();
		const first = browser.client({ scriptOpened });
		for (let i = 0; i < 10; i++) first.poke();
		browser.advance(3000);
		const second = browser.client();
		assert.equal(second.root.querySelector('[data-mascot-seconds]').textContent, '5');
		second.cancel();
		// No storage event is delivered: the existing countdown tick must consult shared state.
		browser.advance(1000);
		assert.equal(first.root.dataset.mood, 'happy');
		browser.advance(4000);
		for (const tab of [first, second]) {
			assert.equal(tab.closeAttempts, 0);
			assert.deepEqual(tab.redirects, []);
			assert.equal(tab.root.dataset.mood, 'happy');
			assert.equal(tab.root.querySelector('[data-mascot-countdown]').hidden, true);
		}
		first.poke();
		assert.equal(first.root.dataset.mood, 'happy');
		first.dispose();
		second.dispose();
	});
}

test('two clients still close at the shared original deadline without cancellation', () => {
	const browser = browserClients();
	const first = browser.client({ scriptOpened: true });
	for (let i = 0; i < 10; i++) first.poke();
	browser.advance(3000);
	const second = browser.client();
	browser.advance(4999);
	assert.equal(first.closeAttempts, 0);
	assert.equal(second.closeAttempts, 0);
	browser.advance(1);
	assert.equal(first.closeAttempts, 1);
	assert.deepEqual(first.redirects, []);
	assert.equal(second.closeAttempts, 1);
	assert.deepEqual(second.redirects, ['/closed']);
	first.dispose();
	second.dispose();
});

test('unavailable persistence keeps countdown and cancellation local to the current document', () => {
	const browser = browserClients();
	const first = browser.client({ storageDisabled: true, cookiesDisabled: true, scriptOpened: true });
	for (let i = 0; i < 10; i++) first.poke();
	browser.advance(3000);
	assert.equal(first.root.querySelector('[data-mascot-seconds]').textContent, '5');
	const second = browser.client({ storageDisabled: true, cookiesDisabled: true });
	assert.equal(second.root.dataset.mood, 'happy');
	first.cancel();
	browser.advance(5000);
	assert.equal(first.closeAttempts, 0);
	assert.equal(first.root.dataset.mood, 'happy');
	for (let i = 0; i < 10; i++) first.poke();
	browser.advance(8000);
	assert.equal(first.closeAttempts, 1);
	assert.equal(second.closeAttempts, 0);
	first.dispose();
	second.dispose();
});

for (const unavailable of [{ storageDisabled: true }, { cookiesDisabled: true }]) {
	test(`one remaining persistence channel still honors cross-client cancellation: ${JSON.stringify(unavailable)}`, () => {
		const browser = browserClients();
		const first = browser.client(unavailable);
		for (let i = 0; i < 10; i++) first.poke();
		browser.advance(3000);
		const second = browser.client(unavailable);
		assert.equal(second.root.querySelector('[data-mascot-seconds]').textContent, '5');
		second.cancel();
		browser.advance(5000);
		assert.equal(first.closeAttempts, 0);
		assert.equal(second.closeAttempts, 0);
		assert.deepEqual(first.redirects, []);
		assert.equal(first.root.dataset.mood, 'happy');
		first.dispose();
		second.dispose();
	});
}
