import {
	createSiteClosure,
	parseSiteClosure,
	readSiteClosureCookie,
	serializeSiteClosure,
	siteClosureCookie,
	siteClosureView,
	SITE_CLOSURE_STORAGE,
} from './site-closure.js';
import type { SiteClosure } from './site-closure.js';

// Used only when neither persistence channel retained our write; never shadow shared cancellation.
let documentClosure: SiteClosure | null = null;

export function readBrowserClosure(): SiteClosure | null {
	let stored: SiteClosure | null = null;
	let cookie: SiteClosure | null = null;
	try {
		stored = parseSiteClosure(localStorage.getItem(SITE_CLOSURE_STORAGE));
	} catch {
		/* Storage can be disabled. */
	}
	try {
		cookie = readSiteClosureCookie(document.cookie);
	} catch {
		/* Cookies can be disabled. */
	}
	const shared = !stored ? cookie : !cookie || stored.reopensAt >= cookie.reopensAt ? stored : cookie;
	if (shared) {
		documentClosure = null;
		return shared;
	}
	if (documentClosure) documentClosure = parseSiteClosure(serializeSiteClosure(documentClosure));
	return documentClosure;
}

function writeBrowserClosure(closure: SiteClosure | null) {
	documentClosure = null;
	try {
		if (closure) localStorage.setItem(SITE_CLOSURE_STORAGE, serializeSiteClosure(closure));
		else localStorage.removeItem(SITE_CLOSURE_STORAGE);
	} catch {
		/* The cookie also persists normal navigations. */
	}
	try {
		document.cookie = siteClosureCookie(closure, Date.now(), location.protocol === 'https:');
	} catch {
		/* Use local storage if available. */
	}
	// Cookie writes can fail silently, so confirm persistence rather than relying on exceptions.
	if (closure && !readBrowserClosure()) documentClosure = closure;
	window.dispatchEvent(new Event('dojo:closure-change'));
}

export function scheduleBrowserClosure(closesAt: number) {
	writeBrowserClosure(readBrowserClosure() ?? createSiteClosure(closesAt));
}

export function cancelPendingClosure() {
	const closure = readBrowserClosure();
	if (closure && closure.closesAt <= Date.now()) return false;
	writeBrowserClosure(null);
	return true;
}

/** The visual takeover retires the old mascot's browser-local closure timer only. */
export function clearClosureForTheme() {
	writeBrowserClosure(null);
}

let started = false;

/** Shared by public pages and Starlight: synchronizes tabs, timers, and bfcache restores. */
export function startSiteClosureGuard() {
	if (started) return;
	started = true;
	let timer: ReturnType<typeof setTimeout> | undefined;
	function check() {
		clearTimeout(timer);
		const closure = readBrowserClosure();
		const now = Date.now();
		const view = siteClosureView(closure, location.pathname, now);
		if (view.redirect) {
			if (view.phase === 'closed') document.documentElement.dataset.dojoClosed = 'true';
			location.replace(view.redirect);
			return;
		}
		delete document.documentElement.dataset.dojoClosed;
		if (!closure) {
			try {
				const value = localStorage.getItem(SITE_CLOSURE_STORAGE);
				if (value && !parseSiteClosure(value)) localStorage.removeItem(SITE_CLOSURE_STORAGE);
			} catch {
				/* Storage can be disabled. */
			}
			return;
		}
		if (view.phase === 'closed') {
			const remaining = document.querySelector<HTMLElement>('[data-closure-remaining]');
			if (remaining) {
				const seconds = view.remaining;
				remaining.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
			}
		}
		timer = setTimeout(
			check,
			Math.min(1000, Math.max(1, (now < closure.closesAt ? closure.closesAt : closure.reopensAt) - now)),
		);
	}
	window.addEventListener('storage', (event) => {
		if (event.key === SITE_CLOSURE_STORAGE || event.key === null) check();
	});
	window.addEventListener('dojo:closure-change', check);
	window.addEventListener('pageshow', check);
	window.addEventListener('focus', check);
	window.addEventListener('pagehide', () => clearTimeout(timer));
	document.addEventListener('astro:page-load', check);
	document.addEventListener('visibilitychange', () => {
		if (!document.hidden) check();
	});
	check();
}
