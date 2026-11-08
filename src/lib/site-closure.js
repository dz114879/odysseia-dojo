import { MASCOT_CLOSE_DELAY_MS } from './mascot-controller.js';

export const SITE_CLOSURE_MS = 60_000;
export const SITE_CLOSURE_COOKIE = 'dojo_mascot_closure';
export const SITE_CLOSURE_STORAGE = 'dojo:mascot-closure:v1';
export const SITE_CLOSURE_PATH = '/closed';

/** @typedef {{ closesAt: number, reopensAt: number }} SiteClosure */

/** @param {number} closesAt @returns {SiteClosure} */
export function createSiteClosure(closesAt) {
	return { closesAt, reopensAt: closesAt + SITE_CLOSURE_MS };
}

/** @param {SiteClosure} closure */
export function serializeSiteClosure(closure) {
	return `${closure.closesAt}.${closure.reopensAt}`;
}

/** Bounded browser-local UX state, never an authentication or moderation credential.
 * @param {string | null | undefined} value
 * @param {number} now
 * @returns {SiteClosure | null}
 */
export function parseSiteClosure(value, now = Date.now()) {
	if (!value || !/^\d{1,16}\.\d{1,16}$/.test(value)) return null;
	const [closesAt, reopensAt] = value.split('.').map(Number);
	if (!Number.isSafeInteger(closesAt) || !Number.isSafeInteger(reopensAt)) return null;
	if (closesAt <= 0 || reopensAt - closesAt !== SITE_CLOSURE_MS) return null;
	if (closesAt > now + MASCOT_CLOSE_DELAY_MS || reopensAt <= now) return null;
	return { closesAt, reopensAt };
}

/** @param {string | null} cookies @param {number} now */
export function readSiteClosureCookie(cookies, now = Date.now()) {
	for (const part of (cookies ?? '').split(';')) {
		const entry = part.trim();
		if (!entry.startsWith(`${SITE_CLOSURE_COOKIE}=`)) continue;
		const parsed = parseSiteClosure(entry.slice(SITE_CLOSURE_COOKIE.length + 1), now);
		if (parsed) return parsed;
	}
	return null;
}

/** @param {SiteClosure | null} closure @param {number} now @param {boolean} secure */
export function siteClosureCookie(closure, now = Date.now(), secure = false) {
	const value = closure ? serializeSiteClosure(closure) : '';
	const maxAge = closure ? Math.max(0, Math.ceil((closure.reopensAt - now) / 1000)) : 0;
	return `${SITE_CLOSURE_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** Browser navigation/presentation only. Does not authorize or reject any HTTP request.
 * @param {SiteClosure | null} closure
 * @param {string} pathname
 * @param {number} now
 */
export function siteClosureView(closure, pathname, now = Date.now()) {
	const valid = closure && parseSiteClosure(serializeSiteClosure(closure), now);
	const onClosedPage = /^\/closed\/?$/.test(pathname);
	if (!valid) return { phase: 'open', redirect: onClosedPage ? '/' : null, remaining: 0 };
	if (now < valid.closesAt) return { phase: 'pending', redirect: onClosedPage ? '/' : null, remaining: 0 };
	return {
		phase: 'closed',
		redirect: onClosedPage ? null : SITE_CLOSURE_PATH,
		remaining: Math.max(0, Math.ceil((valid.reopensAt - now) / 1000)),
	};
}
