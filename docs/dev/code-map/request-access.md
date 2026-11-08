# Request and access map

Use this map for the current request path and the interfaces that enforce
protected delivery. It identifies source owners and the deployed test seam; the
[Worker test seam](../../worker-test-seam.md) remains the operational authority
for running that check.

## Request owners

| What I need to change                                                                    | Source owner and stable entrypoint                                                                                                                                         | Current responsibility                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Worker-first handling and daily D1 lifecycle                                             | [`src/worker.ts`](../../../src/worker.ts), `fetch` and `scheduled`; [`src/lib/quiz-eligibility.ts`](../../../src/lib/quiz-eligibility.ts), `checkQuizEligibility()`        | Dispatches the exact internal quiz-eligibility path to its authenticated API owner, then applies the shared protected-access policy before the Astro Cloudflare handler delegates all other requests to Static Assets or Astro routes; delegates the daily retention lifecycle to its narrow D1 owner. |
| Protected-path classification, Session gate, denial, and protected-response cache policy | [`src/lib/protected-access.ts`](../../../src/lib/protected-access.ts), `applyProtectedAccessPolicy()`                                                                      | Shared module used by both Worker and Astro middleware. It classifies protected documents, Pagefind output, and protected resources before continuation, enforces the Session gate, and sets private no-store responses without injecting an observation-session marker.                               |
| Astro-rendered request handling                                                          | [`src/middleware.ts`](../../../src/middleware.ts), `onRequest`                                                                                                             | Applies `applyProtectedAccessPolicy()` to non-prerendered Astro routes.                                                                                                                                                                                                                                |
| Session claims, signing, verification, and Session Cookie lifecycle                      | [`src/lib/session.ts`](../../../src/lib/session.ts), `issueSession()`, `verifySession()`, `sessionCookie()`, and `clearSessionCookie()`                                    | Owns the signed Session interface. [`src/lib/cookies.ts`](../../../src/lib/cookies.ts) serializes secure Cookies; [`src/lib/session-contract.js`](../../../src/lib/session-contract.js) owns the shared cookie name.                                                                                   |
| OAuth state, safe return target, Discord exchange, identity, and Guild membership        | [`src/lib/discord-oauth.ts`](../../../src/lib/discord-oauth.ts), `startDiscordOAuth()`, `consumeOAuthState()`, and `authenticateDiscordMember()`                           | Owns OAuth-state lifecycle and the Discord-facing authentication implementation.                                                                                                                                                                                                                       |
| OAuth response construction and failure redirects                                        | [`src/lib/oauth-responses.ts`](../../../src/lib/oauth-responses.ts)                                                                                                        | Owns shared OAuth redirects and cookie clearing.                                                                                                                                                                                                                                                       |
| OAuth HTTP endpoints                                                                     | [`discord.ts`](../../../src/pages/api/auth/discord.ts), [`callback.ts`](../../../src/pages/api/auth/callback.ts), and [`logout.ts`](../../../src/pages/api/auth/logout.ts) | Start, complete, and end the OAuth/Session flow.                                                                                                                                                                                                                                                       |
| Disabled browser-observation endpoint                                                    | [`fingerprint.ts`](../../../src/pages/api/fingerprint.ts), `POST /api/fingerprint`                                                                                         | Returns `204 No Content` with `Cache-Control: no-store` without reading the body, verifying a Session, or writing to D1. The [browser observation map](observation.md) owns the retained dormant helpers and tests.                                                                                    |
| Daily retention cleanup                                                                  | [`src/lib/data-retention.ts`](../../../src/lib/data-retention.ts), `removeExpiredActivity()`                                                                               | Uses the scheduled event time for fixed, parameterized, bounded D1 removal from the two V1 activity tables. The [data-retention runbook](../../data-retention-and-investigation.md) owns manual operations.                                                                                            |

The callback's `recordAuthActivity()` is the current D1 write owner. It upserts
the verified member's OAuth activity through `env.DB`; if that write fails, the
callback logs a redacted error and redirects to `/discord-unavailable` without
issuing a Session Cookie. Its schema owner is
[`migrations/0001_create_auth_activity.sql`](../../../migrations/0001_create_auth_activity.sql).

`checkQuizEligibility()` reads `auth_activity.last_successful_oauth_at` in the
inclusive server-side window `[now - 8 days, now]`. A missing, expired, or
future-dated login record retains the wire response
`{"eligible": false, "reason": "fingerprint_missing"}`.

The Worker dispatches the inert fingerprint POST directly to the route's `POST`
export before Astro's Origin check, so bodyless requests also receive `204`.
This exception does not disable Origin checks on other routes.

## Deployed test seam

| Seam                              | Source owner                                                                                      | Relevant evidence                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Production-shaped Worker boundary | [`test/worker-harness.test.mjs`](../../../test/worker-harness.test.mjs), `createTestHarness()`    | Exercises the generated `dist/server/wrangler.json` configuration through HTTP with fixture assets and isolated D1. |
| Test Session issuer               | [`test/support/session.mjs`](../../../test/support/session.mjs), `signedSessionCookie()`          | Creates only test-signed Cookies for boundary requests.                                                             |
| Controllable Discord egress       | [`test/worker-harness.test.mjs`](../../../test/worker-harness.test.mjs), `withDiscordResponder()` | Replaces outbound Discord responses at the Node test boundary instead of contacting Discord.                        |

Run and alter the harness according to the [Worker test seam](../../worker-test-seam.md).
When an interface or seam owner changes, update this map and the operational
page only when its procedure or contract also changes.
