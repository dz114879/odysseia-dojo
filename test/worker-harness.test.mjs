import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { after, afterEach, before, describe, test } from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createTestHarness } from 'wrangler';
import { decodeJwt } from 'jose';
import { parseHTML } from 'linkedom';

import { publicSourceRevisionUrl } from '../src/lib/public-build-config.mjs';

import { signedSessionCookie, TEST_SESSION_SECRET } from './support/session.mjs';

const TEST_DISCORD_CLIENT_ID = 'test-discord-client-id';
const TEST_DISCORD_CLIENT_SECRET = 'test-discord-client-secret';
const TEST_DISCORD_REDIRECT_URI = 'https://dojo.test/api/auth/callback';
const TEST_DISCORD_GUILD_ID = '1134557553011998840';
const TEST_DISCORD_ACCESS_TOKEN = 'test-discord-access-token';
const TEST_ANTICHEAT_HASH_SECRET = '0123456789abcdef0123456789abcdef';
const TEST_QUIZ_ELIGIBILITY_API_KEY = 'Zml4dHVyZS1vbmx5LXF1aXotZWxpZ2liaWxpdHktc2VjcmV0';
const TEST_QUIZ_DISCORD_USER_ID = '123456789012345678';

const TEST_BASE_WORKER_SECRETS = {
	SESSION_SECRET: TEST_SESSION_SECRET,
	DISCORD_CLIENT_ID: TEST_DISCORD_CLIENT_ID,
	DISCORD_CLIENT_SECRET: TEST_DISCORD_CLIENT_SECRET,
	DISCORD_REDIRECT_URI: TEST_DISCORD_REDIRECT_URI,
	DISCORD_GUILD_ID: TEST_DISCORD_GUILD_ID,
	ANTICHEAT_HASH_SECRET: TEST_ANTICHEAT_HASH_SECRET,
};
const TEST_WORKER_SECRETS = {
	...TEST_BASE_WORKER_SECRETS,
	QUIZ_ELIGIBILITY_API_KEY: TEST_QUIZ_ELIGIBILITY_API_KEY,
};

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDirectory, '..');
const harness = createTestHarness({
	root: projectRoot,
	workers: [
		{
			configPath: './dist/server/wrangler.json',
			secrets: TEST_WORKER_SECRETS,
		},
	],
});

const worker = harness.getWorker();
let harnessUrl;

function responseCookies(response) {
	if (typeof response.headers.getSetCookie === 'function') return response.headers.getSetCookie();
	const header = response.headers.get('set-cookie');
	return header ? header.split(/,(?=\s*[^;\s]+=)/u) : [];
}

function responseCookie(response, name) {
	const cookie = responseCookies(response).find((value) => value.startsWith(`${name}=`));
	assert.ok(cookie, `Expected ${name} to be set.`);
	return cookie;
}

function cookiePair(cookie) {
	return cookie.split(';', 1)[0];
}

function cookieValue(cookie) {
	return decodeURIComponent(cookiePair(cookie).slice(cookiePair(cookie).indexOf('=') + 1));
}

function locationPath(response) {
	const location = response.headers.get('location');
	assert.ok(location, 'Expected a redirect location.');
	const url = new URL(location, 'https://worker.test');
	return `${url.pathname}${url.search}${url.hash}`;
}

async function pagefindFragmentPath() {
	const fragmentDirectory = resolve(projectRoot, 'dist/client/pagefind/fragment');
	const entry = (await readdir(fragmentDirectory, { withFileTypes: true })).find((candidate) => candidate.isFile());
	assert.ok(entry, 'Expected the production fixture build to contain a Pagefind fragment.');
	return `/pagefind/fragment/${entry.name}`;
}

async function astroStylesheetPath() {
	const assetDirectory = resolve(projectRoot, 'dist/client/_astro');
	const entry = (await readdir(assetDirectory, { withFileTypes: true })).find(
		(candidate) => candidate.isFile() && candidate.name.endsWith('.css'),
	);
	assert.ok(entry, 'Expected the production fixture build to contain an /_astro/ stylesheet.');
	return `/_astro/${entry.name}`;
}

async function beginOAuth(returnTo = '/docs/tutorials/') {
	const url = new URL('https://worker.test/api/auth/discord');
	url.searchParams.set('returnTo', returnTo);
	const response = await harness.fetch(`${url.pathname}${url.search}`, { redirect: 'manual' });
	assert.equal(response.status, 302);
	const authorizationUrl = new URL(response.headers.get('location'));
	const state = authorizationUrl.searchParams.get('state');
	assert.ok(state, 'OAuth authorization URL must include state.');
	return {
		authorizationUrl,
		response,
		state,
		stateCookie: cookiePair(responseCookie(response, 'dojo_oauth_state')),
	};
}

async function finishOAuth(start, params = {}) {
	const callbackUrl = new URL('https://worker.test/api/auth/callback');
	callbackUrl.searchParams.set('state', params.state ?? start.state);
	for (const [name, value] of Object.entries(params)) {
		if (name !== 'state' && value !== undefined) callbackUrl.searchParams.set(name, value);
	}
	return harness.fetch(`${callbackUrl.pathname}${callbackUrl.search}`, {
		redirect: 'manual',
		headers: { Cookie: start.stateCookie },
	});
}

async function applyD1Migrations() {
	const env = await worker.getEnv();
	await worker.applyD1Migrations('DB');
	return env;
}

function fingerprintPayload(overrides = {}) {
	return {
		payloadVersion: 1,
		browserFingerprint: 'fixture-browser-fingerprint',
		canvasHash: 'fixture-canvas-hash',
		webglHash: 'fixture-webgl-hash',
		platform: 'FixtureOS',
		timezone: 'Asia/Hong_Kong',
		screenResolution: '1920x1080',
		language: 'zh-CN',
		...overrides,
	};
}

async function submitFingerprint(payload = fingerprintPayload(), options = {}) {
	const cookie = options.cookie === undefined ? await signedSessionCookie() : options.cookie;
	const headers = new Headers({
		'content-type': 'application/json',
		'user-agent': options.userAgent ?? 'FixtureBrowser/1.0',
	});
	if (cookie) headers.set('Cookie', cookie);
	if (options.ip !== null) headers.set('cf-connecting-ip', options.ip ?? '203.0.113.45');

	return harness.fetch('/api/fingerprint', {
		method: 'POST',
		headers,
		body: JSON.stringify(payload),
		cf: {
			country: options.country ?? 'HK',
			asn: options.asn ?? 13335,
		},
	});
}

async function observationCount(env) {
	const result = await env.DB.prepare('SELECT COUNT(*) AS count FROM fingerprint_observations').first();
	return result?.count;
}

async function seedEligibilityObservation(env, discordUserId, capturedAt, suffix) {
	await env.DB.prepare(
		'INSERT INTO fingerprint_observations (id, discord_user_id, session_id_hash, ip_hash, captured_at) VALUES (?1, ?2, ?3, ?4, ?5)',
	)
		.bind(
			`eligibility-${suffix}`,
			discordUserId,
			`eligibility-session-${suffix}`,
			`eligibility-ip-${suffix}`,
			capturedAt,
		)
		.run();
}

async function requestQuizEligibility({
	method = 'POST',
	authorization = `Bearer ${TEST_QUIZ_ELIGIBILITY_API_KEY}`,
	contentType = 'application/json',
	body = JSON.stringify({ discordUserId: TEST_QUIZ_DISCORD_USER_ID }),
} = {}) {
	const headers = new Headers();
	if (authorization !== null) headers.set('authorization', authorization);
	if (contentType !== null) headers.set('content-type', contentType);
	return harness.fetch('/api/internal/quiz-eligibility', {
		method,
		headers,
		body: method === 'GET' || method === 'HEAD' ? undefined : body,
	});
}

async function activityCount(env, table) {
	const result = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first();
	return result?.count;
}

async function seedRetentionObservations(env, timestamp, count, prefix) {
	const statements = [];
	for (let index = 0; index < count; index += 1) {
		statements.push(
			env.DB.prepare(
				'INSERT INTO fingerprint_observations (id, discord_user_id, session_id_hash, ip_hash, captured_at) VALUES (?, ?, ?, ?, ?)',
			).bind(
				`${prefix}-observation-${index}`,
				`${prefix}-discord-user-${index}`,
				`${prefix}-session-${index}`,
				`${prefix}-ip-${index}`,
				timestamp,
			),
		);
	}
	await env.DB.batch(statements);
}

async function seedRetentionOAuthActivity(env, timestamp, count, prefix) {
	const statements = [];
	for (let index = 0; index < count; index += 1) {
		statements.push(
			env.DB.prepare(
				'INSERT INTO auth_activity (discord_user_id, discord_username_snapshot, last_successful_oauth_at) VALUES (?, ?, ?)',
			).bind(`${prefix}-auth-user-${index}`, `${prefix}-member-${index}`, timestamp),
		);
	}
	await env.DB.batch(statements);
}

async function seedRetentionActivity(env, timestamp, count, prefix) {
	await seedRetentionObservations(env, timestamp, count, prefix);
	await seedRetentionOAuthActivity(env, timestamp, count, prefix);
}

function jsonResponse(value, status = 200) {
	return new Response(JSON.stringify(value), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

async function withDiscordResponder(responder, action) {
	const originalFetch = globalThis.fetch;
	const requests = [];
	globalThis.fetch = async (input, init) => {
		const request = new Request(input, init);
		if (new URL(request.url).origin !== 'https://discord.com') return originalFetch(input, init);
		requests.push(request);
		return responder(request, requests);
	};

	try {
		return await action(requests);
	} finally {
		globalThis.fetch = originalFetch;
	}
}

function memberResponder({ guildPages = [[{ id: TEST_DISCORD_GUILD_ID }]], username = 'fixture-member' } = {}) {
	let guildPage = 0;
	return async (request) => {
		const url = new URL(request.url);
		if (url.pathname === '/api/v10/oauth2/token') {
			assert.equal(request.method, 'POST');
			assert.match(request.headers.get('authorization') ?? '', /^Basic /u);
			assert.equal(request.headers.get('content-type'), 'application/x-www-form-urlencoded');
			assert.equal(
				await request.text(),
				new URLSearchParams({
					grant_type: 'authorization_code',
					code: 'fixture-authorization-code',
					redirect_uri: TEST_DISCORD_REDIRECT_URI,
				}).toString(),
			);
			return jsonResponse({ access_token: TEST_DISCORD_ACCESS_TOKEN, token_type: 'Bearer' });
		}
		if (url.pathname === '/api/v10/users/@me') {
			assert.equal(request.headers.get('authorization'), `Bearer ${TEST_DISCORD_ACCESS_TOKEN}`);
			return jsonResponse({ id: '123456789012345678', username });
		}
		if (url.pathname === '/api/v10/users/@me/guilds') {
			assert.equal(request.headers.get('authorization'), `Bearer ${TEST_DISCORD_ACCESS_TOKEN}`);
			assert.equal(url.searchParams.get('limit'), '200');
			const page = guildPages[guildPage++];
			assert.ok(page, 'Unexpected extra guild-page request.');
			return jsonResponse(page);
		}
		throw new Error(`Unexpected Discord request: ${request.method} ${url.pathname}`);
	};
}

async function searchPagefind(query, cookie) {
	const originalFetch = globalThis.fetch;
	const requestedUrls = [];
	globalThis.fetch = async (input, init) => {
		const request = new Request(input, init);
		const url = new URL(request.url, harnessUrl);
		requestedUrls.push(url.toString());
		if (url.origin !== harnessUrl.origin || !url.pathname.startsWith('/pagefind/')) {
			return originalFetch(input, init);
		}
		const headers = new Headers(request.headers);
		headers.set('Cookie', cookie);
		return harness.fetch(`${url.pathname}${url.search}`, { headers });
	};

	const moduleUrl = `${pathToFileURL(resolve(projectRoot, 'dist/client/pagefind/pagefind.js')).href}?test=${Date.now()}-${Math.random()}`;
	try {
		const pagefind = await import(moduleUrl);
		await pagefind.options({ basePath: new URL('/pagefind/', harnessUrl).toString() });
		const result = await pagefind.search(query);
		const firstResult = result.results[0] ? await result.results[0].data() : undefined;
		await pagefind.destroy();
		return { result, firstResult };
	} catch (error) {
		throw new Error(`${error.message}\nPagefind requested: ${requestedUrls.join(', ')}`, { cause: error });
	} finally {
		globalThis.fetch = originalFetch;
	}
}

describe('production Worker test seam', { concurrency: false }, () => {
	before(async () => {
		harnessUrl = (await harness.listen()).url;
	});

	afterEach(async () => {
		await harness.reset();
	});

	after(async () => {
		await harness.close();
	});

	test('serves the public page and static assets anonymously', async () => {
		const response = await harness.fetch('/');
		assert.equal(response.status, 200);
		const body = await response.text();
		assert.match(body, /类脑 Odysseia - 道馆挑战/u);

		const stylesheet = await harness.fetch(await astroStylesheetPath());
		assert.equal(stylesheet.status, 200);
		assert.match(stylesheet.headers.get('content-type') ?? '', /^text\/css/u);

		const asset = await harness.fetch('/favicon.svg');
		assert.equal(asset.status, 200);
		assert.match(asset.headers.get('content-type') ?? '', /^image\/svg\+xml/u);
	});

	test('renders public disclosures and login/failure pages anonymously without an observation trigger', async () => {
		const [home, login, accessDenied, cancelled, unavailable] = await Promise.all([
			harness.fetch('/'),
			harness.fetch('/login'),
			harness.fetch('/access-denied'),
			harness.fetch('/auth-cancelled'),
			harness.fetch('/discord-unavailable'),
		]);
		assert.equal(home.status, 200);
		assert.equal(login.status, 200);
		assert.equal(accessDenied.status, 200);
		assert.equal(cancelled.status, 200);
		assert.equal(unavailable.status, 200);
		assert.equal(home.headers.get('set-cookie'), null);
		assert.equal(login.headers.get('set-cookie'), null);
		assert.equal(accessDenied.headers.get('set-cookie'), null);

		const homeBody = await home.text();
		assert.match(homeBody, /<title>类脑 Odysseia - 道馆挑战<\/title>/u);
		const { document: homeDocument } = parseHTML(homeBody);
		assert.equal(homeDocument.querySelector('#site-title [data-dojo-brand]')?.textContent, '类脑 Odysseia');
		assert.match(homeDocument.querySelector('#site-title')?.textContent ?? '', /道馆挑战/u);
		assert.match(homeDocument.querySelector('.hero-intro')?.textContent ?? '', /通过 Discord 验证身份/u);
		assert.ok(homeDocument.querySelector('[data-mascot-button]'));
		assert.doesNotMatch(homeBody, /教程与答题范围/u);
		assert.doesNotMatch(homeBody, /现行答题规则/u);
		assert.doesNotMatch(homeBody, /href="\/#rules"/u);
		assert.match(homeBody, /<summary>查看完整隐私说明<\/summary>/u);
		assert.match(homeBody, /<summary>查看教程署名、许可与内容边界<\/summary>/u);
		assert.match(homeBody, /Discord 用户 ID、当时的用户名快照/u);
		assert.match(homeBody, /不保存 Discord 授权令牌。/u);
		assert.match(homeBody, /HMAC-SHA256/u);
		assert.match(homeBody, /数据库里没有明文 IP，也没有明文 User-Agent。/u);
		assert.match(homeBody, /不会只凭单一信号自动给你评分、处罚或封禁/u);
		assert.match(homeBody, /茉莉只会把你的 Discord 用户 ID 发给网站/u);
		assert.match(homeBody, /最近 8 天内有没有你的反作弊记录，只回答你现在能不能答题。/u);
		assert.match(homeBody, /不会为这类查询另存查询时间、结果或审计记录。/u);
		assert.match(homeBody, /哈希值、记录时间和人工调查内容都不会返回给茉莉/u);
		assert.match(homeBody, /超过 90 天后进入每日清理范围/u);
		assert.match(homeBody, /下一次成功清理/u);
		assert.match(homeBody, /最多还会额外保留 7 天/u);
		assert.match(homeBody, /数据托管在 Cloudflare，网站不承诺把它们存放在某个特定地区。/u);
		assert.match(homeBody, /请通过社区联系/u);
		assert.doesNotMatch(homeBody, /防代打/u);
		assert.doesNotMatch(homeBody, /Session nonce/u);
		assert.doesNotMatch(homeBody, /Time Travel/u);
		assert.doesNotMatch(homeBody, /location hint/u);
		assert.doesNotMatch(homeBody, /最多删除 100 条/u);
		const navigation = homeDocument.querySelector('header nav[aria-label="公开导航"]');
		assert.ok(navigation, 'Public header navigation must be present.');
		assert.deepEqual(
			[...navigation.querySelectorAll('a')].map((link) => [link.textContent, link.getAttribute('href')]),
			[
				['隐私说明', '/#privacy'],
				['登录', '/login'],
			],
		);
		assert.equal(homeDocument.querySelector('header .header-source-link, header a[href*="github.com"]'), null);
		const sourceLink = homeDocument.querySelector('footer.public-footer .footer-github-link');
		assert.equal(
			sourceLink?.getAttribute('href'),
			publicSourceRevisionUrl() ?? 'https://github.com/dz114879/odysseia-dojo',
		);
		assert.equal(sourceLink?.textContent, 'GitHub ↗');
		assert.equal(sourceLink?.getAttribute('target'), '_blank');
		assert.equal(sourceLink?.getAttribute('rel'), 'noopener noreferrer');
		assert.match(homeBody, /AGPL-3\.0-or-later/u);
		assert.match(homeBody, /CC BY-NC 4\.0/u);
		assert.match(homeBody, /Made by KKTsN with 💖/u);
		assert.doesNotMatch(homeBody, /生产发布时，网站程序源代码链接会指向/u);
		assert.doesNotMatch(homeBody, /api\/fingerprint/u);

		const loginBody = await login.text();
		const noticeIndex = loginBody.indexOf('登录前请先了解');
		const loginButtonIndex = loginBody.indexOf('使用 Discord 登录');
		assert.ok(noticeIndex >= 0 && noticeIndex < loginButtonIndex, 'The notice must precede the OAuth button.');
		assert.match(loginBody, /首页隐私说明/u);
		assert.doesNotMatch(loginBody, /type="checkbox"/u);

		assert.match(await accessDenied.text(), /您不在类脑 ODYSSEIA 服务器，请先加入。/u);
		assert.match(await cancelled.text(), /Discord 授权未完成，无法验证您的访问资格。/u);
		assert.match(await unavailable.text(), /暂时无法连接 Discord，请稍后重试。/u);
	});

	test('starts a constrained Discord OAuth flow with a short-lived protected state cookie', async () => {
		const start = await beginOAuth('/docs/tutorials/discord-and-odysseia/?source=login#search-terms');

		assert.equal(start.authorizationUrl.origin, 'https://discord.com');
		assert.equal(start.authorizationUrl.pathname, '/oauth2/authorize');
		assert.equal(start.authorizationUrl.searchParams.get('client_id'), TEST_DISCORD_CLIENT_ID);
		assert.equal(start.authorizationUrl.searchParams.get('redirect_uri'), TEST_DISCORD_REDIRECT_URI);
		assert.equal(start.authorizationUrl.searchParams.get('response_type'), 'code');
		assert.equal(start.authorizationUrl.searchParams.get('scope'), 'identify guilds');
		assert.ok(start.state.length >= 43, 'OAuth state must contain at least 256 bits of encoded randomness.');
		assert.equal(start.authorizationUrl.searchParams.has('bot'), false);
		assert.equal(start.authorizationUrl.searchParams.has('applications.commands'), false);
		assert.equal(start.response.headers.get('cache-control'), 'no-store');

		const stateCookie = responseCookie(start.response, 'dojo_oauth_state');
		assert.match(stateCookie, /HttpOnly/u);
		assert.match(stateCookie, /Secure/u);
		assert.match(stateCookie, /SameSite=Lax/u);
		assert.match(stateCookie, /Path=\//u);
		assert.match(stateCookie, /Max-Age=600/u);
	});

	test('issues a fixed session after identity and paginated Guild membership verification', async () => {
		const env = await applyD1Migrations();
		const firstPage = Array.from({ length: 200 }, (_, index) => ({ id: String(index + 1) }));
		const start = await beginOAuth('/docs/tutorials/discord-and-odysseia/?source=login#search-terms');

		const response = await withDiscordResponder(
			memberResponder({ guildPages: [firstPage, [{ id: TEST_DISCORD_GUILD_ID }]] }),
			async (requests) => {
				const callback = await finishOAuth(start, { code: 'fixture-authorization-code' });
				const guildRequests = requests.filter((request) => new URL(request.url).pathname.endsWith('/users/@me/guilds'));
				assert.equal(guildRequests.length, 2);
				assert.equal(new URL(guildRequests[1].url).searchParams.get('after'), '200');
				return callback;
			},
		);

		assert.equal(response.status, 302);
		assert.equal(locationPath(response), '/docs/tutorials/discord-and-odysseia/?source=login#search-terms');
		assert.equal(response.headers.get('cache-control'), 'no-store');

		const sessionCookie = responseCookie(response, 'dojo_session');
		assert.match(sessionCookie, /HttpOnly/u);
		assert.match(sessionCookie, /Secure/u);
		assert.match(sessionCookie, /SameSite=Lax/u);
		assert.match(sessionCookie, /Path=\//u);
		assert.match(sessionCookie, /Max-Age=691200/u);
		const claims = decodeJwt(cookieValue(sessionCookie));
		assert.equal(claims.discordUserId, '123456789012345678');
		assert.equal(claims.discordUsername, 'fixture-member');
		assert.equal(typeof claims.sessionNonce, 'string');
		assert.ok(claims.sessionNonce.length >= 43);
		assert.equal(typeof claims.guildVerifiedAt, 'number');
		assert.equal(claims.exp - claims.iat, 691200);

		const clearedState = responseCookie(response, 'dojo_oauth_state');
		assert.match(clearedState, /Max-Age=0/u);

		const storedActivity = await env.DB.prepare(
			'SELECT discord_user_id, discord_username_snapshot, last_successful_oauth_at FROM auth_activity',
		).first();
		assert.deepEqual(storedActivity?.discord_user_id, '123456789012345678');
		assert.deepEqual(storedActivity?.discord_username_snapshot, 'fixture-member');
		assert.match(storedActivity?.last_successful_oauth_at ?? '', /^\d{4}-\d{2}-\d{2}T/u);
		assert.doesNotMatch(JSON.stringify(storedActivity), /test-discord-access-token|dojo_session|test-session-secret/u);
	});

	test('rejects missing or mismatched OAuth state before any Discord request', async () => {
		const start = await beginOAuth();
		await withDiscordResponder(
			async () => {
				throw new Error('Discord must not be reached for an invalid state.');
			},
			async (requests) => {
				const missing = await harness.fetch('/api/auth/callback?code=fixture-authorization-code', {
					redirect: 'manual',
					headers: { Cookie: start.stateCookie },
				});
				assert.equal(missing.status, 400);
				assert.equal(missing.headers.get('cache-control'), 'no-store');
				assert.match(responseCookie(missing, 'dojo_oauth_state'), /Max-Age=0/u);

				const mismatched = await finishOAuth(start, {
					code: 'fixture-authorization-code',
					state: 'wrong-state',
				});
				assert.equal(mismatched.status, 400);
				assert.match(responseCookie(mismatched, 'dojo_oauth_state'), /Max-Age=0/u);
				assert.equal(requests.length, 0);
			},
		);
	});

	test('distinguishes a declined authorization, a non-member, and a Discord failure', async () => {
		const declinedStart = await beginOAuth();
		const declined = await finishOAuth(declinedStart, { error: 'access_denied' });
		assert.equal(declined.status, 302);
		assert.equal(locationPath(declined), '/auth-cancelled');

		const nonMemberStart = await beginOAuth();
		const nonMember = await withDiscordResponder(memberResponder({ guildPages: [[]] }), () =>
			finishOAuth(nonMemberStart, { code: 'fixture-authorization-code' }),
		);
		assert.equal(nonMember.status, 302);
		assert.equal(locationPath(nonMember), '/access-denied');
		assert.match(responseCookie(nonMember, 'dojo_session'), /Max-Age=0/u);

		const failedStart = await beginOAuth();
		const failed = await withDiscordResponder(
			async (request) => {
				assert.equal(new URL(request.url).pathname, '/api/v10/oauth2/token');
				return new Response('Discord is unavailable', { status: 503 });
			},
			() => finishOAuth(failedStart, { code: 'fixture-authorization-code' }),
		);
		assert.equal(failed.status, 302);
		assert.equal(locationPath(failed), '/discord-unavailable');
	});

	test('treats malformed Guild payloads as Discord failures instead of non-membership', async () => {
		for (const guildPage of [[{}], ['not-a-guild']]) {
			const start = await beginOAuth();
			const response = await withDiscordResponder(memberResponder({ guildPages: [guildPage] }), () =>
				finishOAuth(start, { code: 'fixture-authorization-code' }),
			);

			assert.equal(response.status, 302);
			assert.equal(locationPath(response), '/discord-unavailable');
		}
	});

	test('falls back to the tutorial root for unsafe OAuth return targets', async () => {
		await applyD1Migrations();
		for (const unsafeReturnTo of [
			'//example.invalid/steal',
			'https://example.invalid/steal',
			'/docs/other/',
			'/public/',
		]) {
			const start = await beginOAuth(unsafeReturnTo);
			const response = await withDiscordResponder(memberResponder(), () =>
				finishOAuth(start, { code: 'fixture-authorization-code' }),
			);
			assert.equal(locationPath(response), '/docs/tutorials/', unsafeReturnTo);
		}
	});

	test('keeps a verified member signed in when only the OAuth activity upsert fails', async () => {
		const env = await worker.getEnv();
		await env.DB.prepare('DROP TABLE IF EXISTS auth_activity').run();
		const start = await beginOAuth();
		harness.clearLogs();
		const response = await withDiscordResponder(memberResponder(), () =>
			finishOAuth(start, { code: 'fixture-authorization-code' }),
		);
		assert.equal(response.status, 302);
		assert.equal(locationPath(response), '/docs/tutorials/');
		assert.ok(responseCookies(response).some((cookie) => cookie.startsWith('dojo_session=')));
		const errors = harness
			.getLogs()
			.filter((log) => log.level === 'error')
			.map((log) => log.message);
		assert.deepEqual(errors, ['Unable to record OAuth activity.']);
		assert.doesNotMatch(
			errors.join('\n'),
			/test-discord-access-token|dojo_session|test-session-secret|123456789012345678/u,
		);
	});

	test('clears the fixed session cookie at logout', async () => {
		const response = await harness.fetch('/api/auth/logout', {
			redirect: 'manual',
			headers: { Cookie: await signedSessionCookie() },
		});
		assert.equal(response.status, 302);
		assert.equal(locationPath(response), '/');
		const cookie = responseCookie(response, 'dojo_session');
		assert.match(cookie, /HttpOnly/u);
		assert.match(cookie, /Secure/u);
		assert.match(cookie, /SameSite=Lax/u);
		assert.match(cookie, /Path=\//u);
		assert.match(cookie, /Max-Age=0/u);
	});

	test('records a single authenticated observation from trusted server context', async () => {
		const env = await applyD1Migrations();
		const first = await submitFingerprint();
		assert.equal(first.status, 204);
		assert.equal(first.headers.get('cache-control'), 'no-store');
		assert.equal(await first.text(), '');

		const row = await env.DB.prepare(
			`SELECT discord_user_id, discord_username_snapshot, session_id_hash,
				 browser_fingerprint_hash, canvas_hash, webgl_hash, user_agent_hash,
				 platform, timezone, screen_resolution, language, ip_hash, ip_prefix_hash,
				 country, asn, payload_version, hash_key_version, captured_at
				 FROM fingerprint_observations`,
		).first();
		const { captured_at: capturedAt, ...storedObservation } = row ?? {};
		assert.deepEqual(storedObservation, {
			discord_user_id: '123456789012345678',
			discord_username_snapshot: 'fixture-member',
			session_id_hash: '693a16da541907663959787e855b6b62c35681eb24e6768de8e296c1ddc95aac',
			browser_fingerprint_hash: '80a34e9a54d59c71dffea5a98b9ff3be51e3c04486c048da6df8bfa86d49bcbc',
			canvas_hash: '0ccad888e994438b6f8e8ad354b9422687955df3636e06cbfcf23fb9013a3c8c',
			webgl_hash: 'ed8c51e4774b3e4de8f70ec623c6baceacdb3165e8e7e7b8dd598f614499ca50',
			user_agent_hash: 'a6f9d39f3f9ad84db619b1df458c882b86c6ef73a700246b1cf7d2302688a15c',
			platform: 'FixtureOS',
			timezone: 'Asia/Hong_Kong',
			screen_resolution: '1920x1080',
			language: 'zh-CN',
			ip_hash: '8e92c20dee08a0072490306807fd2e9caeee87f51fbe65b5899945bab3cc19a0',
			ip_prefix_hash: 'bbf66f093fcad99656736f74a2b11247454720554e0aeabb62047587d9e8cf53',
			country: 'HK',
			asn: 13335,
			payload_version: 1,
			hash_key_version: 1,
		});
		assert.match(capturedAt ?? '', /^\d{4}-\d{2}-\d{2}T/u);

		const duplicate = await submitFingerprint();
		assert.equal(duplicate.status, 204);
		assert.equal(duplicate.headers.get('cache-control'), 'no-store');
		assert.equal(await observationCount(env), 1);

		const oauthActivity = await env.DB.prepare('SELECT discord_user_id FROM auth_activity').all();
		assert.deepEqual(oauthActivity.results, []);
	});

	test('rejects client-controlled trusted fields and missing server context without writing an observation', async () => {
		const env = await applyD1Migrations();
		const unauthenticated = await submitFingerprint(fingerprintPayload(), { cookie: null });
		assert.equal(unauthenticated.status, 401);
		assert.equal(unauthenticated.headers.get('cache-control'), 'no-store');

		const spoofed = await submitFingerprint(
			fingerprintPayload({
				discordUserId: 'forged-discord-id',
				ip: '198.51.100.9',
				userAgent: 'forged-user-agent',
				capturedAt: '2000-01-01T00:00:00.000Z',
			}),
		);
		assert.equal(spoofed.status, 400);
		assert.equal(spoofed.headers.get('cache-control'), 'no-store');

		const unusableTrustedIp = await submitFingerprint(fingerprintPayload(), { ip: 'not-a-valid-ip' });
		assert.equal(unusableTrustedIp.status, 503);
		assert.equal(unusableTrustedIp.headers.get('cache-control'), 'no-store');
		assert.equal(await observationCount(env), 0);
	});

	test('keeps a failed observation write retryable for the same Session', async () => {
		const env = await applyD1Migrations();
		await env.DB.prepare(
			`CREATE TRIGGER force_observation_insert_failure
				 BEFORE INSERT ON fingerprint_observations
				 BEGIN
					SELECT RAISE(ABORT, 'fixture observation write failure');
				 END`,
		).run();

		const failed = await submitFingerprint();
		assert.equal(failed.status, 503);
		assert.equal(failed.headers.get('cache-control'), 'no-store');
		assert.equal(await observationCount(env), 0);

		await env.DB.prepare('DROP TRIGGER force_observation_insert_failure').run();
		const retry = await submitFingerprint();
		assert.equal(retry.status, 204);
		assert.equal(retry.headers.get('cache-control'), 'no-store');
		assert.equal(await observationCount(env), 1);
	});

	test('returns the minimal missing-observation eligibility decision', async () => {
		const env = await applyD1Migrations();
		const response = await requestQuizEligibility({ contentType: 'application/json; charset=utf-8' });

		assert.equal(response.status, 200);
		assert.equal(response.headers.get('cache-control'), 'no-store');
		assert.match(response.headers.get('content-type') ?? '', /^application\/json/u);
		assert.equal(await response.text(), '{"eligible":false,"reason":"fingerprint_missing"}');
		assert.equal(await observationCount(env), 0);
	});

	test('rejects missing and incorrect Bearer credentials before D1 access', async () => {
		for (const [index, authorization] of [
			null,
			TEST_QUIZ_ELIGIBILITY_API_KEY,
			'Basic fixture-credential',
			`Bearer ${TEST_QUIZ_ELIGIBILITY_API_KEY.slice(0, -1)}A`,
			`Bearer ${TEST_QUIZ_ELIGIBILITY_API_KEY.slice(0, -1)}`,
			`Bearer ${TEST_QUIZ_ELIGIBILITY_API_KEY}A`,
		].entries()) {
			const response = await requestQuizEligibility({ authorization });
			assert.equal(response.status, 401, `credential vector ${index}`);
			assert.equal(response.headers.get('cache-control'), 'no-store');
			assert.equal(await response.text(), '{"error":"request_rejected"}');
			// Isolate vectors because Wrangler's local listener can drop a reused connection after consecutive 401 responses.
			await harness.reset();
		}
	});

	test('fails closed when the eligibility API key configuration is missing or malformed', async () => {
		for (const configuredKey of [undefined, 'short-fixture-key']) {
			const isolatedHarness = createTestHarness({
				root: projectRoot,
				workers: [
					{
						configPath: './dist/server/wrangler.json',
						secrets:
							configuredKey === undefined
								? TEST_BASE_WORKER_SECRETS
								: { ...TEST_BASE_WORKER_SECRETS, QUIZ_ELIGIBILITY_API_KEY: configuredKey },
					},
				],
			});
			await isolatedHarness.listen();
			try {
				const response = await isolatedHarness.fetch('/api/internal/quiz-eligibility', {
					method: 'POST',
					headers: {
						authorization: `Bearer ${TEST_QUIZ_ELIGIBILITY_API_KEY}`,
						'content-type': 'application/json',
					},
					body: JSON.stringify({ discordUserId: TEST_QUIZ_DISCORD_USER_ID }),
				});
				assert.equal(response.status, 503);
				assert.equal(response.headers.get('cache-control'), 'no-store');
				assert.equal(await response.text(), '{"error":"request_rejected"}');
			} finally {
				await isolatedHarness.close();
			}
		}
	});

	test('rejects unsupported methods, media types, and invalid or oversized bodies before D1 access', async (t) => {
		const cases = [
			{ name: 'unsupported method', request: { method: 'GET' }, status: 405 },
			{ name: 'missing content type', request: { contentType: null }, status: 415 },
			{ name: 'wrong content type', request: { contentType: 'text/plain' }, status: 415 },
			{
				name: 'oversized body',
				request: {
					body: JSON.stringify({ discordUserId: TEST_QUIZ_DISCORD_USER_ID, padding: 'x'.repeat(1_024) }),
				},
				status: 413,
			},
			{ name: 'malformed JSON', request: { body: '{' }, status: 400 },
			{ name: 'array body', request: { body: '[]' }, status: 400 },
			{ name: 'missing field', request: { body: '{}' }, status: 400 },
			{
				name: 'unknown field',
				request: { body: JSON.stringify({ discordUserId: TEST_QUIZ_DISCORD_USER_ID, extra: true }) },
				status: 400,
			},
			{ name: 'numeric ID', request: { body: '{"discordUserId":123456789012345678}' }, status: 400 },
			{ name: 'short ID', request: { body: '{"discordUserId":"1234567890123456"}' }, status: 400 },
			{ name: 'long ID', request: { body: '{"discordUserId":"123456789012345678901"}' }, status: 400 },
			{
				name: 'non-ASCII digits',
				request: { body: '{"discordUserId":"１２３４５６７８９０１２３４５６７"}' },
				status: 400,
			},
		];

		for (const fixture of cases) {
			await t.test(fixture.name, async () => {
				const response = await requestQuizEligibility(fixture.request);
				assert.equal(response.status, fixture.status);
				assert.equal(response.headers.get('cache-control'), 'no-store');
				assert.equal(await response.text(), '{"error":"request_rejected"}');
			});
		}
	});

	test('uses the server eight-day window and excludes future observations', async () => {
		const env = await applyD1Migrations();
		const now = Date.now();
		const day = 24 * 60 * 60 * 1_000;
		const expiredUserId = '223456789012345678';
		const futureUserId = '323456789012345678';
		const mixedUserId = '423456789012345678';

		await seedEligibilityObservation(
			env,
			TEST_QUIZ_DISCORD_USER_ID,
			new Date(now - 8 * day + 60_000).toISOString(),
			'current',
		);
		await seedEligibilityObservation(env, expiredUserId, new Date(now - 8 * day - 60_000).toISOString(), 'expired');
		await seedEligibilityObservation(env, futureUserId, new Date(now + 60_000).toISOString(), 'future');
		await seedEligibilityObservation(env, mixedUserId, new Date(now - 2 * day).toISOString(), 'mixed-current');
		await seedEligibilityObservation(env, mixedUserId, new Date(now - day).toISOString(), 'mixed-latest-current');
		await seedEligibilityObservation(env, mixedUserId, new Date(now + day).toISOString(), 'mixed-future');

		const eligible = await requestQuizEligibility();
		const expired = await requestQuizEligibility({ body: JSON.stringify({ discordUserId: expiredUserId }) });
		const future = await requestQuizEligibility({ body: JSON.stringify({ discordUserId: futureUserId }) });
		const mixed = await requestQuizEligibility({ body: JSON.stringify({ discordUserId: mixedUserId }) });

		for (const response of [eligible, expired, future, mixed]) {
			assert.equal(response.status, 200);
			assert.equal(response.headers.get('cache-control'), 'no-store');
		}
		assert.equal(await eligible.text(), '{"eligible":true}');
		assert.equal(await expired.text(), '{"eligible":false,"reason":"fingerprint_missing"}');
		assert.equal(await future.text(), '{"eligible":false,"reason":"fingerprint_missing"}');
		assert.equal(await mixed.text(), '{"eligible":true}');
		assert.equal(await observationCount(env), 6);
	});

	test('returns a generic non-cacheable service failure when D1 is unavailable', async () => {
		const env = await applyD1Migrations();
		await env.DB.prepare('DROP TABLE fingerprint_observations').run();
		harness.clearLogs();

		const response = await requestQuizEligibility();
		assert.equal(response.status, 503);
		assert.equal(response.headers.get('cache-control'), 'no-store');
		assert.equal(await response.text(), '{"error":"request_rejected"}');

		const output = JSON.stringify(harness.getLogs());
		assert.doesNotMatch(output, new RegExp(TEST_QUIZ_ELIGIBILITY_API_KEY, 'u'));
		assert.doesNotMatch(output, new RegExp(TEST_QUIZ_DISCORD_USER_ID, 'u'));
	});

	test('fails closed for an anonymous protected document request', async () => {
		const document = await harness.fetch('/docs/tutorials/discord-and-odysseia/', { redirect: 'manual' });
		assert.equal(document.status, 302);
		assert.equal(document.headers.get('location'), '/login?returnTo=%2Fdocs%2Ftutorials%2Fdiscord-and-odysseia%2F');
		assert.equal(document.headers.get('cache-control'), 'no-store');
	});

	test('fails closed for encoded and index-file aliases of protected output', async () => {
		const fragmentPath = await pagefindFragmentPath();
		const fragmentName = fragmentPath.split('/').at(-1);
		assert.ok(fragmentName, 'Expected the Pagefind fragment path to have a filename.');

		for (const path of [
			'/docs/tutorials/discord-and-odysseia',
			'/docs/tutorials/discord-and-odysseia/index.html',
			'/docs%2Ftutorials%2Fdiscord-and-odysseia%2Findex.html',
			'/docs%252Ftutorials%252Fdiscord-and-odysseia%252Findex.html',
			'/docs/extensions/account-safety/index.html',
			'/docs%2Fextensions%2Faccount-safety%2Findex.html',
		]) {
			const response = await harness.fetch(path, { redirect: 'manual' });
			assert.equal(response.status, 302, path);
			assert.match(response.headers.get('location') ?? '', /^\/login\?returnTo=/u, path);
			assert.equal(response.headers.get('cache-control'), 'no-store', path);
			assert.equal(await response.text(), '', path);
		}

		for (const path of [
			'/pagefind/pagefind.js',
			'/pagefind%2Fpagefind.js',
			fragmentPath,
			`/pagefind%2Ffragment%2F${fragmentName}`,
			'/protected/tutorial-images/fixture-api-settings.svg',
			'/protected%2Ftutorial-images%2Ffixture-api-settings.svg',
			'/protected/attachments/fixture-reading-checklist.txt',
			'/protected%2Fattachments%2Ffixture-reading-checklist.txt',
		]) {
			const response = await harness.fetch(path);
			assert.equal(response.status, 401, path);
			assert.equal(response.headers.get('cache-control'), 'no-store', path);
			assert.equal(await response.text(), 'Authentication is required to access this resource.', path);
		}
	});

	test('serves protected fixture output only for a token accepted by the production verifier', async () => {
		const cookie = await signedSessionCookie();
		const headers = { Cookie: cookie };
		const fragmentPath = await pagefindFragmentPath();

		const document = await harness.fetch('/docs/tutorials/discord-and-odysseia/', { headers });
		assert.equal(document.status, 200);
		assert.match(document.headers.get('content-type') ?? '', /^text\/html/u);
		assert.equal(document.headers.get('cache-control'), 'private, no-store, max-age=0');
		assert.match(await document.text(), /Discord/u);

		const resource = await harness.fetch('/protected/tutorial-images/fixture-api-settings.svg', { headers });
		assert.equal(resource.status, 200);
		assert.equal(resource.headers.get('cache-control'), 'private, no-store, max-age=0');
		assert.match(await resource.text(), /<svg/u);

		const attachment = await harness.fetch('/protected/attachments/fixture-reading-checklist.txt', { headers });
		assert.equal(attachment.status, 200);
		assert.equal(attachment.headers.get('cache-control'), 'private, no-store, max-age=0');
		assert.match(await attachment.text(), /Fixture reading checklist/u);

		const fragment = await harness.fetch(fragmentPath, { headers });
		assert.equal(fragment.status, 200);
		assert.equal(fragment.headers.get('cache-control'), 'private, no-store, max-age=0');
	});

	test('keeps directory-first indexes and separates the compact homepage disclosures', async () => {
		const headers = { Cookie: await signedSessionCookie() };
		const [tutorialIndex, extensionIndex, home] = await Promise.all([
			harness.fetch('/docs/tutorials/', { headers }),
			harness.fetch('/docs/extensions/', { headers }),
			harness.fetch('/'),
		]);
		assert.equal(tutorialIndex.status, 200);
		assert.equal(extensionIndex.status, 200);
		assert.equal(home.status, 200);

		const tutorialIndexBody = await tutorialIndex.text();
		const tutorialDirectory = tutorialIndexBody.indexOf('href="/docs/tutorials/discord-and-odysseia/"');
		const tutorialExplanation = tutorialIndexBody.indexOf('Fixture 说明');
		assert.ok(tutorialDirectory >= 0, 'The tutorial directory must render.');
		assert.ok(tutorialExplanation >= 0, 'The fixture explanation must render.');
		assert.ok(tutorialDirectory < tutorialExplanation, 'The tutorial directory must come first.');

		const extensionIndexBody = await extensionIndex.text();
		const extensionDirectory = extensionIndexBody.indexOf('href="/docs/extensions/account-safety/"');
		const extensionScopeNote = extensionIndexBody.indexOf('扩展阅读仅作补充');
		assert.ok(extensionDirectory >= 0, 'The extension directory must render.');
		assert.ok(extensionScopeNote >= 0, 'The short extension scope note must render.');
		assert.ok(extensionDirectory < extensionScopeNote, 'The extension directory must come first.');

		const homeBody = await home.text();
		assert.doesNotMatch(homeBody, /id="reading"/u);
		assert.doesNotMatch(homeBody, /id="rules"/u);
		assert.match(homeBody, /<details>/u);
		assert.match(homeBody, /KKTsN/u);
		assert.match(homeBody, /@kk1189_61801/u);
		assert.match(homeBody, /@10091009mc--钓鱼大亨/u);
		assert.match(homeBody, /@aurelia119/u);
		assert.match(homeBody, /CC BY-NC 4\.0/u);
	});

	test('keeps the native Starlight reading experience available to authenticated readers', async () => {
		const sessionIssuedAt = Math.floor(Date.now() / 1_000) - 120;
		const headers = { Cookie: await signedSessionCookie({ issuedAt: sessionIssuedAt }) };
		const [tutorial, extension, outdated, resourcePage] = await Promise.all([
			harness.fetch('/docs/tutorials/discord-and-odysseia/', { headers }),
			harness.fetch('/docs/extensions/account-safety/', { headers }),
			harness.fetch('/docs/extensions/legacy-interface/', { headers }),
			harness.fetch('/docs/tutorials/sillytavern-api/', { headers }),
		]);
		assert.equal(tutorial.status, 200);
		assert.equal(extension.status, 200);
		assert.equal(outdated.status, 200);
		assert.equal(resourcePage.status, 200);

		const tutorialBody = await tutorial.text();
		assert.match(tutorialBody, /<html lang="zh-CN"/u);
		assert.match(tutorialBody, /<nav class="sidebar/u);
		assert.match(tutorialBody, /基础教程/u);
		assert.match(tutorialBody, /扩展阅读/u);
		assert.match(tutorialBody, /aria-current="page"/u);
		assert.match(tutorialBody, /right-sidebar/u);
		assert.doesNotMatch(tutorialBody, /rel="prev"/u);
		assert.doesNotMatch(tutorialBody, /rel="next"/u);
		assert.match(tutorialBody, /class="sl-anchor-link"/u);
		assert.match(tutorialBody, /<details>/u);
		assert.match(tutorialBody, /<summary>可选：进一步了解<\/summary>/u);
		assert.match(tutorialBody, /starlight-menu-button/u);
		assert.match(tutorialBody, /starlight-theme-select/u);
		const { document: tutorialDocument } = parseHTML(tutorialBody);
		assert.equal(tutorialDocument.querySelector('header .header-source-link, header a[href*="github.com"]'), null);
		assert.match(tutorialBody, /data-content-category="tutorial"/u);
		assert.match(tutorialBody, /data-observation-toast/u);
		assert.match(tutorialBody, /data-observation-retry/u);
		assert.match(tutorialBody, new RegExp(`data-observation-session="${sessionIssuedAt}"`, 'u'));
		assert.doesNotMatch(tutorialBody, /重新记录防代打观测/u);
		assert.equal([...tutorialBody.matchAll(/<h1(?:\s|>)/gu)].length, 1);
		assert.doesNotMatch(tutorialBody, /基础教程属于答题范围/u);

		const extensionBody = await extension.text();
		assert.match(extensionBody, /data-content-category="extension"/u);
		assert.equal([...extensionBody.matchAll(/<h1(?:\s|>)/gu)].length, 1);
		assert.doesNotMatch(extensionBody, /扩展阅读不属于答题范围/u);

		const outdatedBody = await outdated.text();
		assert.match(outdatedBody, /data-outdated-notice/u);
		assert.match(outdatedBody, /本文部分内容可能已经过时。/u);
		assert.doesNotMatch(outdatedBody, /请结合当前界面和最新说明阅读/u);
		assert.match(outdatedBody, /<h1\b[^>]*>[\s\S]*?<\/h1>\s*<aside\b[^>]*\bdata-outdated-notice\b/u);

		const resourceBody = await resourcePage.text();
		assert.match(resourceBody, /src="\/protected\/tutorial-images\/fixture-api-settings\.svg"/u);
		assert.match(resourceBody, /href="\/protected\/attachments\/fixture-reading-checklist\.txt"/u);
		assert.doesNotMatch(resourceBody, /_astro\/[^"']*fixture-api-settings/u);
		assert.match(resourceBody, /（图）/u);
	});

	test('ships native-compatible reading layout styles', async () => {
		const response = await harness.fetch('/docs/tutorials/discord-and-odysseia/', {
			headers: { Cookie: await signedSessionCookie() },
		});
		assert.equal(response.status, 200);

		const page = await response.text();
		const stylesheets = [...page.matchAll(/<link[^>]+href="([^"]+\.css)"/gu)].map((match) => match[1]);
		assert.ok(stylesheets.length > 0, 'The reading page must load a stylesheet.');
		const stylesheet = (await Promise.all(stylesheets.map(async (path) => (await harness.fetch(path)).text()))).join(
			'\n',
		);
		assert.match(stylesheet, /--sl-content-width\s*:\s*min\(66rem,\s*92vw\)/u);
		assert.match(
			stylesheet,
			/mobile-starlight-toc\s+\.isMobile\s+a\s*\{[^}]*-webkit-tap-highlight-color\s*:\s*transparent/u,
		);
		assert.match(stylesheet, /overflow-wrap\s*:\s*anywhere/u);
	});

	test('protects the Pagefind bundle and returns fixture matches for Chinese, product, acronym, and details terms', async () => {
		const anonymous = await harness.fetch('/pagefind/pagefind.js');
		assert.equal(anonymous.status, 401);
		assert.equal(anonymous.headers.get('cache-control'), 'no-store');

		const cookie = await signedSessionCookie();
		const authenticated = await harness.fetch('/pagefind/pagefind.js', { headers: { Cookie: cookie } });
		assert.equal(authenticated.status, 200);
		assert.equal(authenticated.headers.get('cache-control'), 'private, no-store, max-age=0');

		for (const query of ['道馆', 'SillyTavern', 'API', 'fixture fragment']) {
			const { result, firstResult } = await searchPagefind(query, cookie);
			assert.ok(result.results.length > 0, `Expected Pagefind fixture results for ${query}.`);
			assert.match(new URL(firstResult?.url ?? '/', harnessUrl).pathname, /^\/docs\/(?:tutorials|extensions)\//u);
		}
	});

	test('rejects a tampered token before static assets are fetched', async () => {
		const cookie = `${await signedSessionCookie()}tampered`;
		const response = await harness.fetch('/protected/attachments/fixture-reading-checklist.txt', {
			headers: { Cookie: cookie },
		});

		assert.equal(response.status, 401);
		assert.equal(response.headers.get('cache-control'), 'no-store');
		const body = await response.text();
		assert.equal(body, 'Authentication is required to access this resource.');
		assert.doesNotMatch(body, /Fixture reading checklist/u);
	});

	test('rejects an expired token before protected documents are fetched', async () => {
		const cookie = await signedSessionCookie({ expirationTime: Math.floor(Date.now() / 1_000) - 60 });
		const response = await harness.fetch('/docs/tutorials/discord-and-odysseia/', {
			redirect: 'manual',
			headers: { Cookie: cookie },
		});

		assert.equal(response.status, 302);
		assert.equal(locationPath(response), '/login?returnTo=%2Fdocs%2Ftutorials%2Fdiscord-and-odysseia%2F');
		assert.equal(response.headers.get('cache-control'), 'no-store');
	});

	test('rejects forged and malformed Sessions before protected resources are fetched', async (t) => {
		const sessionRejections = [
			{
				name: 'forged Session signature',
				cookie: await signedSessionCookie({
					secret: 'different-test-session-secret-that-is-longer-than-thirty-two-bytes',
				}),
			},
			{ name: 'malformed Session Cookie encoding', cookie: 'dojo_session=%' },
		];

		for (const { name, cookie } of sessionRejections) {
			await t.test(name, async () => {
				const response = await harness.fetch('/pagefind%2Fpagefind.js', { headers: { Cookie: cookie } });
				assert.equal(response.status, 401);
				assert.equal(response.headers.get('cache-control'), 'no-store');
				assert.equal(await response.text(), 'Authentication is required to access this resource.');
			});
		}
	});

	test('fails closed when protected-path classification fails', async () => {
		const malformedPath = await harness.fetch('/docs%2Ftutorials%2Fdiscord-and-odysseia%2Findex.html%FF', {
			redirect: 'manual',
		});
		assert.equal(malformedPath.status, 503);
		assert.equal(malformedPath.headers.get('cache-control'), 'no-store');
		assert.equal(await malformedPath.text(), 'Protected content is temporarily unavailable.');
	});

	test('preserves an authenticated downstream 404 as a private protected response', async () => {
		const missingProtectedRoute = await harness.fetch('/docs/tutorials/no-such-fixture/index.html', {
			headers: { Cookie: await signedSessionCookie() },
		});
		assert.equal(missingProtectedRoute.status, 404);
		assert.equal(missingProtectedRoute.headers.get('cache-control'), 'private, no-store, max-age=0');
	});

	test('does not make authenticated protected output reusable by anonymous requests', async () => {
		const path = '/docs/tutorials/discord-and-odysseia/';
		const authenticated = await harness.fetch(path, { headers: { Cookie: await signedSessionCookie() } });
		assert.equal(authenticated.status, 200);
		assert.equal(authenticated.headers.get('cache-control'), 'private, no-store, max-age=0');
		assert.match(await authenticated.text(), /Discord/u);

		const anonymous = await harness.fetch(path, { redirect: 'manual' });
		assert.equal(anonymous.status, 302);
		assert.equal(anonymous.headers.get('cache-control'), 'no-store');
		assert.equal(await anonymous.text(), '');

		const fragmentPath = await pagefindFragmentPath();
		const authenticatedFragment = await harness.fetch(fragmentPath, {
			headers: { Cookie: await signedSessionCookie() },
		});
		assert.equal(authenticatedFragment.status, 200);
		assert.equal(authenticatedFragment.headers.get('cache-control'), 'private, no-store, max-age=0');

		const anonymousFragment = await harness.fetch(fragmentPath);
		assert.equal(anonymousFragment.status, 401);
		assert.equal(anonymousFragment.headers.get('cache-control'), 'no-store');
		assert.equal(await anonymousFragment.text(), 'Authentication is required to access this resource.');
	});

	test('cleans expired activity through bounded paired batches and preserves the exact cutoff boundary', async () => {
		const env = await applyD1Migrations();
		const scheduledTime = new Date('2026-08-26T00:00:00.000Z');
		const expiredAt = '2026-05-27T23:59:59.999Z';
		const retentionBoundary = '2026-05-28T00:00:00.000Z';
		const deployedConfig = JSON.parse(await readFile(resolve(projectRoot, 'dist/server/wrangler.json'), 'utf8'));
		assert.deepEqual(deployedConfig.triggers?.crons, ['0 0 * * *']);

		await seedRetentionActivity(env, expiredAt, 401, 'expired');
		await seedRetentionActivity(env, retentionBoundary, 1, 'retained');
		harness.clearLogs();

		const cleanup = await worker.scheduled({ cron: '0 0 * * *', scheduledTime });
		assert.equal(cleanup.outcome, 'ok');
		assert.equal(await activityCount(env, 'fingerprint_observations'), 1);
		assert.equal(await activityCount(env, 'auth_activity'), 1);
		assert.deepEqual(
			harness
				.getLogs()
				.filter((log) => log.level === 'error')
				.map((log) => log.message),
			[],
		);

		const [observation, oauthActivity] = await Promise.all([
			env.DB.prepare('SELECT captured_at FROM fingerprint_observations').first(),
			env.DB.prepare('SELECT last_successful_oauth_at FROM auth_activity').first(),
		]);
		assert.deepEqual(observation, { captured_at: retentionBoundary });
		assert.deepEqual(oauthActivity, { last_successful_oauth_at: retentionBoundary });
	});

	test('caps a skewed retention cleanup after five paired batches and emits a redacted signal', async () => {
		const env = await applyD1Migrations();
		const scheduledTime = new Date('2026-08-26T00:00:00.000Z');
		const expiredAt = '2026-05-27T23:59:59.999Z';
		const retentionBoundary = '2026-05-28T00:00:00.000Z';

		await seedRetentionObservations(env, expiredAt, 501, 'expired');
		await seedRetentionOAuthActivity(env, expiredAt, 1, 'expired');
		await seedRetentionObservations(env, retentionBoundary, 1, 'retained');
		await seedRetentionOAuthActivity(env, retentionBoundary, 1, 'retained');
		harness.clearLogs();

		const cleanup = await worker.scheduled({ cron: '0 0 * * *', scheduledTime });
		assert.equal(cleanup.outcome, 'ok');
		assert.equal(await activityCount(env, 'fingerprint_observations'), 2);
		assert.equal(await activityCount(env, 'auth_activity'), 1);

		const [observations, oauthActivity] = await Promise.all([
			env.DB.prepare('SELECT captured_at FROM fingerprint_observations ORDER BY captured_at ASC').all(),
			env.DB.prepare('SELECT last_successful_oauth_at FROM auth_activity').all(),
		]);
		assert.deepEqual(observations.results, [{ captured_at: expiredAt }, { captured_at: retentionBoundary }]);
		assert.deepEqual(oauthActivity.results, [{ last_successful_oauth_at: retentionBoundary }]);

		const errors = harness
			.getLogs()
			.filter((log) => log.level === 'error')
			.map((log) => log.message);
		assert.deepEqual(errors, ['Retention cleanup reached its configured batch cap.']);
		assert.doesNotMatch(errors.join('\n'), /expired|retained|2026-|cookie|token|secret|ip/u);
	});
});
