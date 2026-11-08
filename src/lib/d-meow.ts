import {
	createDMeowSequence,
	isDMeowReadingPage,
	D_MEOW_BRAND,
	D_MEOW_LOGOUT,
	D_MEOW_PENDING,
	D_MEOW_STORAGE,
	D_MEOW_THEME,
} from './d-meow-state.js';
import { createDMeowBranding } from './d-meow-branding.js';
import { clearClosureForTheme } from './site-closure-client';

let branding: ReturnType<typeof createDMeowBranding> | undefined;
let observer: MutationObserver | undefined;
let widget: HTMLElement | undefined;
let started = false;
let active = false;
let transitioning = false;
let transitionTimer: ReturnType<typeof setTimeout> | undefined;

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
	const result = document.createElement(tag);
	result.className = className;
	if (text !== undefined) result.textContent = text;
	return result;
}

// appendChild avoids the repository's Cloudflare HTMLRewriter Element.append type collision.
function append(parent: Node, ...children: Node[]) {
	for (const child of children) parent.appendChild(child);
}

function preference() {
	try {
		return localStorage.getItem(D_MEOW_STORAGE) === D_MEOW_THEME;
	} catch {
		try {
			return sessionStorage.getItem(D_MEOW_STORAGE) === D_MEOW_THEME;
		} catch {
			return document.documentElement.dataset.dojoTheme === D_MEOW_THEME;
		}
	}
}

function savePreference(value: boolean) {
	for (const storage of ['localStorage', 'sessionStorage'] as const) {
		try {
			if (value) window[storage].setItem(D_MEOW_STORAGE, D_MEOW_THEME);
			else window[storage].removeItem(D_MEOW_STORAGE);
		} catch {
			/* A disabled store must not break navigation or reading. */
		}
	}
}

function pendingLogout() {
	try {
		return sessionStorage.getItem(D_MEOW_PENDING) === '1';
	} catch {
		return false;
	}
}

function setPendingLogout(value: boolean) {
	try {
		if (value) sessionStorage.setItem(D_MEOW_PENDING, '1');
		else sessionStorage.removeItem(D_MEOW_PENDING);
	} catch {
		/* The ordinary navigation still performs logout. */
	}
}

function applyBranding() {
	observer?.disconnect();
	// Apply the correction to the entire reading shell, not only Markdown prose.
	const reading = isDMeowReadingPage(location.pathname) || Boolean(document.querySelector('.sl-markdown-content'));
	branding ??= createDMeowBranding(document);
	branding.apply({ reading });
	observer?.observe(document.body, { childList: true, subtree: true, characterData: true });
}

function restoreBranding() {
	observer?.disconnect();
	branding?.restore();
}

function sprite() {
	const art = node('span', 'd-meow-sprite');
	art.setAttribute('aria-hidden', 'true');
	for (let frame = 1; frame <= 2; frame++) {
		const image = node('img', `d-meow-frame d-meow-frame-${frame}`);
		image.src = `/mascot/d-meow-wave-${frame}.webp`;
		image.width = 360;
		image.height = 480;
		image.alt = '';
		image.draggable = false;
		append(art, image);
	}
	return art;
}

function takeoverArt() {
	const sideArt = node('img', 'd-meow-side-art');
	sideArt.src = '/mascot/d-meow-takeover-cutout.webp';
	sideArt.alt = '黄色角色和类脑娘的彩蛋插画';
	sideArt.width = 560;
	sideArt.height = 560;
	sideArt.draggable = false;
	sideArt.decoding = 'async';
	return sideArt;
}

function createWidget(includeSideArt = true) {
	const figure = node('figure', 'd-meow-companion');
	figure.dataset.dMeowUi = '';
	figure.setAttribute('aria-label', 'D喵，旅程发言人');
	const bubble = node('div', 'd-meow-bubble', '旅程宣布独立！');
	const pause = node('button', 'd-meow-pause', '暂停摆手');
	pause.type = 'button';
	pause.setAttribute('aria-pressed', 'false');
	pause.addEventListener('click', () => {
		const paused = figure.dataset.paused !== 'true';
		figure.dataset.paused = String(paused);
		pause.setAttribute('aria-pressed', String(paused));
		pause.textContent = paused ? '继续摆手' : '暂停摆手';
	});
	append(figure, bubble, sprite());
	if (includeSideArt) append(figure, takeoverArt());
	append(figure, pause);
	return figure;
}

function defeatedMascot() {
	const figure = node('figure', 'd-meow-defeated');
	const stage = node('div', 'd-meow-defeated-art');
	const image = node('img', '');
	image.src = '/mascot/angry.webp';
	image.alt = '倒在一旁的类脑娘';
	image.width = 616;
	image.height = 880;
	image.draggable = false;
	append(stage, image);
	append(figure, stage, node('figcaption', '', '……我记住了。'));
	return figure;
}

function applyTheme(value: boolean) {
	active = value;
	if (value) document.documentElement.dataset.dojoTheme = D_MEOW_THEME;
	else delete document.documentElement.dataset.dojoTheme;
	for (const mascot of document.querySelectorAll<HTMLElement>('[data-mascot]')) {
		mascot.inert = value;
		if (value) mascot.setAttribute('aria-hidden', 'true');
		else mascot.removeAttribute('aria-hidden');
	}
	if (value) {
		applyBranding();
		if (!widget?.isConnected) {
			widget = createWidget();
			const hero = document.querySelector('.public-hero');
			const readingPanel = document.querySelector('.sl-markdown-content')?.parentElement;
			widget.dataset.placement = hero ? 'hero' : 'reading';
			// The article companion occupies normal document flow, never covers text or links.
			append(hero ?? readingPanel ?? document.querySelector('main') ?? document.body, widget);
		}
	} else {
		restoreBranding();
		widget?.remove();
		widget = undefined;
	}
	window.dispatchEvent(new Event('dojo:theme-change'));
}

function finishTakeover() {
	clearTimeout(transitionTimer);
	setPendingLogout(false);
	// HttpOnly sessions are invalidated by the EXISTING server logout route, never by JS.
	// Its redirect returns to '/'. No fake session, auth bypass, or backend patch is added.
	location.replace(D_MEOW_LOGOUT);
}

function takeover() {
	if (transitioning) return;
	transitioning = true;
	setPendingLogout(true);
	savePreference(true);
	applyTheme(true);
	clearClosureForTheme();
	document.documentElement.dataset.dojoTakeover = 'true';
	const dialog = node('dialog', 'd-meow-takeover');
	dialog.dataset.dMeowUi = '';
	dialog.setAttribute('aria-labelledby', 'd-meow-takeover-title');
	const panel = node('div', 'd-meow-broadcast');
	const kicker = node('p', 'd-meow-broadcast-kicker', '紧 急 插 播  /  SIGNAL D');
	const heading = node('h2', 'd-meow-broadcast-title');
	heading.id = 'd-meow-takeover-title';
	append(heading, node('span', '', '类脑 Odysseia'), node('span', '', '已被旅程占领。'));
	const stamp = node('span', 'd-meow-stamp', '接管完毕');
	const scene = node('div', 'd-meow-broadcast-scene');
	const victor = createWidget(false);
	victor.querySelector('button')?.remove();
	// Both illustrations occupy grid cells; neither can cover the status below.
	append(scene, defeatedMascot(), victor);
	const status = node('p', 'd-meow-broadcast-status', '正在退出当前登录，返回首页…');
	status.setAttribute('role', 'status');
	append(panel, kicker, heading, stamp, scene, status, node('div', 'd-meow-progress'));
	append(dialog, panel);
	dialog.addEventListener('cancel', (event) => event.preventDefault());
	append(document.body, dialog);
	dialog.showModal();
	transitionTimer = setTimeout(finishTakeover, matchMedia('(prefers-reduced-motion: reduce)').matches ? 2200 : 4600);
}

function editableEvent(event: KeyboardEvent) {
	return event
		.composedPath()
		.some(
			(part) =>
				part instanceof HTMLElement &&
				(part.isContentEditable ||
					part.matches('input, textarea, select, [role="textbox"], [role="searchbox"], [role="combobox"]')),
		);
}

export function startDMeowTheme() {
	if (started) return;
	started = true;
	const sequence = createDMeowSequence();
	observer = new MutationObserver((records) => {
		if (!active) return;
		if (
			records.every((record) =>
				(record.target instanceof Element ? record.target : record.target.parentElement)?.closest('[data-d-meow-ui]'),
			)
		)
			return;
		applyBranding();
	});
	function initialize() {
		applyTheme(preference());
		if (pendingLogout()) finishTakeover();
	}
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
	else initialize();
	document.addEventListener('keydown', (event) => {
		if (transitioning) return;
		if (
			!sequence.feed({
				key: event.key,
				editable: editableEvent(event),
				modifier: event.ctrlKey || event.metaKey || event.altKey,
				repeat: event.repeat,
				composing: event.isComposing,
			})
		)
			return;
		if (active) {
			savePreference(false);
			applyTheme(false);
		} else takeover();
	});
	window.addEventListener('blur', () => sequence.reset());
	window.addEventListener('storage', (event) => {
		if (event.key !== D_MEOW_STORAGE && event.key !== null) return;
		const next = preference();
		if (next === active) return;
		applyTheme(next);
		if (next && isDMeowReadingPage(location.pathname)) location.replace('/');
	});
	window.addEventListener('pagehide', () => {
		clearTimeout(transitionTimer);
		observer?.disconnect();
	});
	window.addEventListener('pageshow', (event) => {
		if (!event.persisted) return;
		if (pendingLogout()) {
			finishTakeover();
			return;
		}
		const next = preference();
		const changed = next !== active;
		if (transitioning || (changed && next && isDMeowReadingPage(location.pathname))) {
			location.replace('/');
			return;
		}
		applyTheme(next);
	});
	document.addEventListener('astro:page-load', initialize);
}

// Keep the human-readable name next to its DOM behavior for code-search consumers.
export { D_MEOW_BRAND };
