import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';

import {
	authenticateDiscordMember,
	clearOAuthStateCookie,
	consumeOAuthState,
	DiscordOAuthError,
} from '../../../lib/discord-oauth';
import {
	cancelledOAuth,
	deniedOAuth,
	invalidOAuthState,
	oauthRedirect,
	unavailableOAuth,
} from '../../../lib/oauth-responses';
import { issueSession, sessionCookie } from '../../../lib/session';

export const prerender = false;

async function recordAuthActivity(discordUserId: string, discordUsername: string): Promise<void> {
	await env.DB.prepare(
		`INSERT INTO auth_activity (discord_user_id, discord_username_snapshot, last_successful_oauth_at)
			 VALUES (?, ?, ?)
			 ON CONFLICT(discord_user_id) DO UPDATE SET
			 discord_username_snapshot = excluded.discord_username_snapshot,
			 last_successful_oauth_at = excluded.last_successful_oauth_at`,
	)
		.bind(discordUserId, discordUsername, new Date().toISOString())
		.run();
}

export const GET: APIRoute = async ({ request }) => {
	const callbackUrl = new URL(request.url);
	const returnTo = consumeOAuthState(request, callbackUrl.searchParams.get('state'));
	if (!returnTo) return invalidOAuthState();

	if (callbackUrl.searchParams.has('error')) {
		return callbackUrl.searchParams.get('error') === 'access_denied' ? cancelledOAuth() : unavailableOAuth();
	}

	const code = callbackUrl.searchParams.get('code');
	if (!code) return unavailableOAuth();

	let authentication;
	try {
		authentication = await authenticateDiscordMember(code, env);
	} catch (error) {
		if (error instanceof DiscordOAuthError) return unavailableOAuth();
		throw error;
	}

	if (authentication.kind === 'not-member') return deniedOAuth();

	try {
		await recordAuthActivity(authentication.identity.discordUserId, authentication.identity.discordUsername);
	} catch {
		console.error('Unable to record OAuth activity.');
		return unavailableOAuth();
	}

	try {
		const token = await issueSession(authentication.identity, env.SESSION_SECRET);
		return oauthRedirect(returnTo, [sessionCookie(token), clearOAuthStateCookie()]);
	} catch {
		return unavailableOAuth();
	}
};
