interface QuizEligibilityRequest {
	discordUserId: string;
}

const ELIGIBILITY_WINDOW_MILLISECONDS = 8 * 24 * 60 * 60 * 1_000;
const MAX_QUIZ_ELIGIBILITY_BODY_BYTES = 1_024;

type QuizEligibilityEnvironment = Pick<DojoEnvironment, 'DB'> &
	Partial<Pick<DojoEnvironment, 'QUIZ_ELIGIBILITY_API_KEY'>>;

interface TimingSafeSubtleCrypto extends SubtleCrypto {
	timingSafeEqual(left: BufferSource, right: BufferSource): boolean;
}

type QuizEligibilityRequestParseResult = { payload: QuizEligibilityRequest } | { failureStatus: 400 | 413 };

function errorResponse(status: number): Response {
	return Response.json({ error: 'request_rejected' }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function apiKeysMatch(provided: string, configured: string): Promise<boolean> {
	const encoder = new TextEncoder();
	const subtle = crypto.subtle as TimingSafeSubtleCrypto;
	const [providedDigest, configuredDigest] = await Promise.all([
		subtle.digest('SHA-256', encoder.encode(provided)),
		subtle.digest('SHA-256', encoder.encode(configured)),
	]);
	return subtle.timingSafeEqual(providedDigest, configuredDigest);
}

function bearerCredential(request: Request): string {
	return /^Bearer ([^\s]+)$/iu.exec(request.headers.get('authorization') ?? '')?.[1] ?? '';
}

function validConfiguredApiKey(value: unknown): value is string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value) || value.length % 4 === 1) return false;

	try {
		const base64 = value
			.replaceAll('-', '+')
			.replaceAll('_', '/')
			.padEnd(Math.ceil(value.length / 4) * 4, '=');
		return atob(base64).length >= 32;
	} catch {
		return false;
	}
}

export function quizEligibilityWindow(now: number): { earliest: string; latest: string } {
	return {
		earliest: new Date(now - ELIGIBILITY_WINDOW_MILLISECONDS).toISOString(),
		latest: new Date(now).toISOString(),
	};
}

async function parseQuizEligibilityRequest(request: Request): Promise<QuizEligibilityRequestParseResult> {
	const contentLength = request.headers.get('content-length');
	if (contentLength !== null && Number(contentLength) > MAX_QUIZ_ELIGIBILITY_BODY_BYTES) {
		return { failureStatus: 413 };
	}

	const body = request.body;
	if (!body) return { failureStatus: 400 };

	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	const reader = body.getReader();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value.byteLength > MAX_QUIZ_ELIGIBILITY_BODY_BYTES - byteLength) {
				try {
					await reader.cancel();
				} catch {
					// The response remains a stable 413 even if stream cancellation fails.
				}
				return { failureStatus: 413 };
			}
			chunks.push(value);
			byteLength += value.byteLength;
		}
	} catch {
		return { failureStatus: 400 };
	} finally {
		reader.releaseLock();
	}

	const bytes = new Uint8Array(byteLength);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}

	let value: unknown;
	try {
		value = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return { failureStatus: 400 };
	}

	if (typeof value !== 'object' || value === null || Array.isArray(value)) return { failureStatus: 400 };
	const payload = value as Record<string, unknown>;
	if (Object.keys(payload).length !== 1 || !Object.hasOwn(payload, 'discordUserId')) return { failureStatus: 400 };
	if (typeof payload.discordUserId !== 'string' || !/^[0-9]{17,20}$/u.test(payload.discordUserId)) {
		return { failureStatus: 400 };
	}

	return { payload: { discordUserId: payload.discordUserId } };
}

function eligibilityResponse(eligible: boolean): Response {
	return Response.json(eligible ? { eligible: true } : { eligible: false, reason: 'fingerprint_missing' }, {
		headers: { 'Cache-Control': 'no-store' },
	});
}

export async function checkQuizEligibility(request: Request, env: QuizEligibilityEnvironment): Promise<Response> {
	if (request.method !== 'POST') return errorResponse(405);
	if (!validConfiguredApiKey(env.QUIZ_ELIGIBILITY_API_KEY)) return errorResponse(503);

	try {
		if (!(await apiKeysMatch(bearerCredential(request), env.QUIZ_ELIGIBILITY_API_KEY))) {
			return errorResponse(401);
		}
	} catch {
		return errorResponse(503);
	}

	const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
	if (contentType !== 'application/json') return errorResponse(415);
	const parsedRequest = await parseQuizEligibilityRequest(request);
	if ('failureStatus' in parsedRequest) return errorResponse(parsedRequest.failureStatus);
	const { payload } = parsedRequest;
	const window = quizEligibilityWindow(Date.now());
	let authActivity: { last_successful_oauth_at: string } | null;
	try {
		authActivity = await env.DB.prepare(
			`SELECT last_successful_oauth_at
				 FROM auth_activity
				 WHERE discord_user_id = ?1 AND last_successful_oauth_at >= ?2 AND last_successful_oauth_at <= ?3
				 LIMIT 1`,
		)
			.bind(payload.discordUserId, window.earliest, window.latest)
			.first<{ last_successful_oauth_at: string }>();
	} catch {
		return errorResponse(503);
	}

	return eligibilityResponse(authActivity !== null);
}
