import { readCookie, secureCookie } from './cookies';
import { bytesToBase64Url } from './base64url';

export const OAUTH_STATE_COOKIE_NAME = 'dojo_oauth_state';
export const OAUTH_STATE_DURATION_SECONDS = 10 * 60;

const DISCORD_API_ORIGIN = 'https://discord.com/api/v10';
const DISCORD_AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const FALLBACK_RETURN_TO = '/docs/tutorials/';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PREFETCH_HEADERS = ['Sec-Purpose', 'Purpose', 'X-Purpose', 'X-Moz'] as const;

interface OAuthEnvironment {
	DISCORD_CLIENT_ID: string;
	DISCORD_CLIENT_SECRET: string;
	DISCORD_REDIRECT_URI: string;
	DISCORD_GUILD_ID: string;
}

interface OAuthState {
	state: string;
	returnTo: string;
}

export interface DiscordIdentity {
	discordUserId: string;
	discordUsername: string;
}

export type DiscordAuthenticationResult =
	| { kind: 'member'; identity: DiscordIdentity }
	| { kind: 'not-member' };

export class DiscordOAuthError extends Error {
	constructor() {
		super('Discord OAuth could not be completed.');
	}
}

function base64UrlToBytes(value: string): Uint8Array | undefined {
	if (!/^[A-Za-z0-9_-]+$/u.test(value)) return undefined;

	try {
		const padded = value.replace(/-/gu, '+').replace(/_/gu, '/') + '='.repeat((4 - (value.length % 4)) % 4);
		const binary = atob(padded);
		return Uint8Array.from(binary, (character) => character.charCodeAt(0));
	} catch {
		return undefined;
	}
}

function randomState(): string {
	return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

function base64(value: string): string {
	let binary = '';
	for (const byte of encoder.encode(value)) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

interface DiscordGuild {
	id: string;
}

function isDiscordGuild(value: unknown): value is DiscordGuild {
	return isRecord(value) && typeof value.id === 'string' && /^[0-9]+$/u.test(value.id);
}

function constantTimeEqual(left: string, right: string): boolean {
	if (left.length !== right.length) return false;
	let difference = 0;
	for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
	return difference === 0;
}

function parseStateCookie(value: string | undefined): OAuthState | undefined {
	if (!value) return undefined;
	const bytes = base64UrlToBytes(value);
	if (!bytes) return undefined;

	try {
		const parsed = JSON.parse(decoder.decode(bytes));
		if (
			!isRecord(parsed) ||
			typeof parsed.state !== 'string' ||
			typeof parsed.returnTo !== 'string' ||
			parsed.state.length < 43
		) {
			return undefined;
		}
		return { state: parsed.state, returnTo: parsed.returnTo };
	} catch {
		return undefined;
	}
}

function validatedConfig(env: OAuthEnvironment) {
	if (
		!env.DISCORD_CLIENT_ID ||
		!env.DISCORD_CLIENT_SECRET ||
		!env.DISCORD_REDIRECT_URI ||
		!env.DISCORD_GUILD_ID
	) {
		throw new DiscordOAuthError();
	}

	try {
		const redirectUrl = new URL(env.DISCORD_REDIRECT_URI);
		if (redirectUrl.protocol !== 'https:') throw new Error('Discord redirect URI must be HTTPS.');
		return {
			clientId: env.DISCORD_CLIENT_ID,
			clientSecret: env.DISCORD_CLIENT_SECRET,
			redirectUri: redirectUrl.toString(),
			guildId: env.DISCORD_GUILD_ID,
		};
	} catch {
		throw new DiscordOAuthError();
	}
}

export function validatedReturnTo(value: string | null | undefined): string {
	if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return FALLBACK_RETURN_TO;

	try {
		const target = new URL(value, 'https://dojo.invalid');
		if (target.origin !== 'https://dojo.invalid') return FALLBACK_RETURN_TO;
		if (!/^\/docs\/(?:tutorials|extensions)\//u.test(target.pathname)) return FALLBACK_RETURN_TO;
		return `${target.pathname}${target.search}${target.hash}`;
	} catch {
		return FALLBACK_RETURN_TO;
	}
}

function isPrefetchRequest(request: Request): boolean {
	return PREFETCH_HEADERS.some((header) => {
		const value = request.headers.get(header);
		return value !== null && /\b(?:prefetch|prerender|preview)\b/iu.test(value);
	});
}

export function startDiscordOAuth(request: Request, env: OAuthEnvironment): Response {
	if (isPrefetchRequest(request)) {
		return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
	}

	const config = validatedConfig(env);
	const state = randomState();
	const returnTo = validatedReturnTo(new URL(request.url).searchParams.get('returnTo'));
	const statePayload = bytesToBase64Url(encoder.encode(JSON.stringify({ state, returnTo } satisfies OAuthState)));
	const authorizationUrl = new URL(DISCORD_AUTHORIZE_URL);
	authorizationUrl.searchParams.set('client_id', config.clientId);
	authorizationUrl.searchParams.set('redirect_uri', config.redirectUri);
	authorizationUrl.searchParams.set('response_type', 'code');
	authorizationUrl.searchParams.set('scope', 'identify guilds');
	authorizationUrl.searchParams.set('state', state);

	return new Response(null, {
		status: 302,
		headers: {
			Location: authorizationUrl.toString(),
			'Cache-Control': 'no-store',
			'Set-Cookie': secureCookie(OAUTH_STATE_COOKIE_NAME, statePayload, OAUTH_STATE_DURATION_SECONDS),
		},
	});
}

export function consumeOAuthState(request: Request, returnedState: string | null): string | undefined {
	if (!returnedState) return undefined;
	const storedState = parseStateCookie(readCookie(request, OAUTH_STATE_COOKIE_NAME));
	if (!storedState || !constantTimeEqual(storedState.state, returnedState)) return undefined;
	return validatedReturnTo(storedState.returnTo);
}

export function clearOAuthStateCookie(): string {
	return secureCookie(OAUTH_STATE_COOKIE_NAME, '', 0);
}

async function discordJson(url: string, init: RequestInit): Promise<unknown> {
	let response: Response;
	try {
		response = await fetch(url, init);
	} catch {
		throw new DiscordOAuthError();
	}
	if (!response.ok) throw new DiscordOAuthError();

	try {
		return await response.json();
	} catch {
		throw new DiscordOAuthError();
	}
}

async function accessTokenForCode(code: string, config: ReturnType<typeof validatedConfig>): Promise<string> {
	const tokenResponse = await discordJson(`${DISCORD_API_ORIGIN}/oauth2/token`, {
		method: 'POST',
		headers: {
			Authorization: `Basic ${base64(`${config.clientId}:${config.clientSecret}`)}`,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			redirect_uri: config.redirectUri,
		}),
	});
	if (!isRecord(tokenResponse) || typeof tokenResponse.access_token !== 'string' || !tokenResponse.access_token) {
		throw new DiscordOAuthError();
	}
	return tokenResponse.access_token;
}

async function identityForToken(accessToken: string): Promise<DiscordIdentity> {
	const userResponse = await discordJson(`${DISCORD_API_ORIGIN}/users/@me`, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	if (
		!isRecord(userResponse) ||
		typeof userResponse.id !== 'string' ||
		!/^[0-9]+$/u.test(userResponse.id) ||
		typeof userResponse.username !== 'string' ||
		!userResponse.username
	) {
		throw new DiscordOAuthError();
	}
	return { discordUserId: userResponse.id, discordUsername: userResponse.username };
}

async function belongsToGuild(accessToken: string, guildId: string): Promise<boolean> {
	let after: string | undefined;
	const cursors = new Set<string>();

	for (let page = 0; page < 100; page += 1) {
		const guildsUrl = new URL(`${DISCORD_API_ORIGIN}/users/@me/guilds`);
		guildsUrl.searchParams.set('limit', '200');
		if (after) guildsUrl.searchParams.set('after', after);
		const response = await discordJson(guildsUrl.toString(), {
			headers: { Authorization: `Bearer ${accessToken}` },
		});
		if (!Array.isArray(response) || !response.every(isDiscordGuild)) throw new DiscordOAuthError();
		if (response.some((guild) => guild.id === guildId)) return true;
		if (response.length < 200) return false;

		const cursor = response.at(-1);
		if (!cursor || cursors.has(cursor.id)) {
			throw new DiscordOAuthError();
		}
		cursors.add(cursor.id);
		after = cursor.id;
	}

	throw new DiscordOAuthError();
}

export async function authenticateDiscordMember(
	code: string,
	env: OAuthEnvironment
): Promise<DiscordAuthenticationResult> {
	const config = validatedConfig(env);
	const accessToken = await accessTokenForCode(code, config);
	const identity = await identityForToken(accessToken);
	const member = await belongsToGuild(accessToken, config.guildId);
	return member ? { kind: 'member', identity } : { kind: 'not-member' };
}
