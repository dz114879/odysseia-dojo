import assert from 'node:assert/strict';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { apiKeysMatch, checkQuizEligibility, quizEligibilityWindow } from '../src/lib/quiz-eligibility.ts';
import { POST as fingerprintPost } from '../src/pages/api/fingerprint.ts';

test('quiz eligibility credentials compare fixed-length digests', async () => {
	const comparedLengths = [];
	const originalTimingSafeEqual = Object.getOwnPropertyDescriptor(crypto.subtle, 'timingSafeEqual');
	Object.defineProperty(crypto.subtle, 'timingSafeEqual', {
		configurable: true,
		value(left, right) {
			comparedLengths.push([left.byteLength, right.byteLength]);
			return timingSafeEqual(new Uint8Array(left), new Uint8Array(right));
		},
	});

	try {
		assert.equal(await apiKeysMatch('fixture-credential', 'fixture-credential'), true);
		assert.equal(await apiKeysMatch('short', 'fixture-credential'), false);
		assert.equal(await apiKeysMatch('a-much-longer-fixture-credential', 'fixture-credential'), false);
		assert.deepEqual(comparedLengths, [
			[32, 32],
			[32, 32],
			[32, 32],
		]);
	} finally {
		if (originalTimingSafeEqual) {
			Object.defineProperty(crypto.subtle, 'timingSafeEqual', originalTimingSafeEqual);
		} else {
			delete crypto.subtle.timingSafeEqual;
		}
	}
});

test('quiz eligibility window includes the exact eight-day cutoff and request time', () => {
	const now = Date.parse('2026-09-02T10:00:00.000Z');

	assert.deepEqual(quizEligibilityWindow(now), {
		earliest: '2026-08-25T10:00:00.000Z',
		latest: '2026-09-02T10:00:00.000Z',
	});
});

test('disabled fingerprint endpoint does not read request, session, or environment', () => {
	const context = new Proxy(
		{},
		{
			get(_target, property) {
				throw new Error(`Fingerprint endpoint accessed context.${String(property)}`);
			},
		},
	);
	const response = fingerprintPost(context);
	assert.equal(response.status, 204);
	assert.equal(response.headers.get('Cache-Control'), 'no-store');
	assert.equal(response.body, null);
});

test('quiz eligibility uses successful OAuth activity within the inclusive eight-day window', async (t) => {
	const now = Date.parse('2026-09-02T10:00:00.000Z');
	t.mock.method(Date, 'now', () => now);
	const originalTimingSafeEqual = Object.getOwnPropertyDescriptor(crypto.subtle, 'timingSafeEqual');
	Object.defineProperty(crypto.subtle, 'timingSafeEqual', {
		configurable: true,
		value(left, right) {
			return timingSafeEqual(new Uint8Array(left), new Uint8Array(right));
		},
	});
	t.after(() => {
		if (originalTimingSafeEqual) {
			Object.defineProperty(crypto.subtle, 'timingSafeEqual', originalTimingSafeEqual);
		} else {
			delete crypto.subtle.timingSafeEqual;
		}
	});

	const db = new DatabaseSync(':memory:');
	t.after(() => db.close());
	for (const file of ['0001_create_auth_activity.sql', '0002_create_fingerprint_observations.sql']) {
		db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
	}
	const discordUserId = '123456789012345678';
	const apiKey = Buffer.alloc(32, 1).toString('base64url');
	const env = {
		QUIZ_ELIGIBILITY_API_KEY: apiKey,
		DB: {
			prepare(sql) {
				const statement = db.prepare(sql);
				return {
					bind(...values) {
						const parameters = Object.fromEntries(values.map((value, index) => [`?${index + 1}`, value]));
						return { first: async () => statement.get(parameters) ?? null };
					},
				};
			},
		},
	};
	const request = () =>
		new Request('https://dojo.example/api/internal/quiz-eligibility', {
			method: 'POST',
			headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ discordUserId }),
		});
	const cases = [
		{ name: 'recent OAuth without observations', timestamp: '2026-09-01T10:00:00.000Z', eligible: true },
		{ name: 'exact eight-day cutoff', timestamp: '2026-08-25T10:00:00.000Z', eligible: true },
		{ name: 'exact request time', timestamp: '2026-09-02T10:00:00.000Z', eligible: true },
		{ name: 'one millisecond too old', timestamp: '2026-08-25T09:59:59.999Z', eligible: false },
		{ name: 'one millisecond in the future', timestamp: '2026-09-02T10:00:00.001Z', eligible: false },
		{ name: 'no OAuth activity', eligible: false },
		{ name: 'recent observation without OAuth activity', observation: true, eligible: false },
		{
			name: 'another user has recent OAuth activity',
			userId: '987654321098765432',
			timestamp: '2026-09-01T10:00:00.000Z',
			eligible: false,
		},
	];
	for (const scenario of cases) {
		await t.test(scenario.name, async () => {
			db.exec('DELETE FROM auth_activity; DELETE FROM fingerprint_observations;');
			if (scenario.timestamp) {
				db.prepare('INSERT INTO auth_activity (discord_user_id, last_successful_oauth_at) VALUES (?, ?)').run(
					scenario.userId ?? discordUserId,
					scenario.timestamp,
				);
			}
			if (scenario.observation) {
				db.prepare(
					`INSERT INTO fingerprint_observations (id, discord_user_id, session_id_hash, ip_hash, captured_at)
					 VALUES (?, ?, ?, ?, ?)`,
				).run('fixture-observation', discordUserId, 'fixture-session', 'fixture-ip', new Date(now).toISOString());
			}
			const changesBefore = db.prepare('SELECT total_changes() AS changes').get().changes;
			const response = await checkQuizEligibility(request(), env);
			assert.equal(response.status, 200);
			assert.equal(response.headers.get('Cache-Control'), 'no-store');
			assert.deepEqual(
				await response.json(),
				scenario.eligible ? { eligible: true } : { eligible: false, reason: 'fingerprint_missing' },
			);
			assert.equal(db.prepare('SELECT total_changes() AS changes').get().changes, changesBefore);
		});
	}

	await t.test('unavailable activity storage fails closed', async () => {
		db.exec('DROP TABLE auth_activity');
		const response = await checkQuizEligibility(request(), env);
		assert.equal(response.status, 503);
		assert.equal(response.headers.get('Cache-Control'), 'no-store');
		assert.deepEqual(await response.json(), { error: 'request_rejected' });
	});
});
