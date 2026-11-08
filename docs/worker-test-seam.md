# Worker test seam

Run the production-shaped local Worker check from a fresh public checkout:

```sh
npm ci
npm run test:worker
```

`test:worker` first assembles the tracked fixture corpus and runs `astro build`.
It then starts Wrangler's supported `createTestHarness()` against the generated
`dist/server/wrangler.json`. The generated configuration loads the deployable
Worker entrypoint, Cloudflare Static Assets with `run_worker_first`, and an
isolated local D1 binding. No real tutorial material, deployment secret, or
external Discord request is needed.

The black-box request tests use only HTTP requests through that harness. They
cover an anonymous public page and required `/_astro/` asset; canonical,
trailing-slash, `index.html`, and encoded protected document/resource aliases;
actual Pagefind bundle and fragment output; and protected images and
attachments. They also cover accepted, tampered, expired, forged, and malformed
sessions;
authentication/classification/routing failures; private cache headers and an
authenticated-then-anonymous reuse attempt. The OAuth start/callback/logout,
return-target, distinct failure-state, and D1 OAuth-activity checks remain at
the same boundary, including fail-closed OAuth-activity writes: a D1 write
failure redirects to `/discord-unavailable` without issuing a Session Cookie.
`POST /api/fingerprint` returns `204 No Content` with `Cache-Control: no-store`
without reading the body, verifying a Session, or writing to D1. Protected HTML
contains no observation toast or injected observation-session marker.
Quiz-eligibility requests cover dedicated-key authentication, strict request
validation, the inclusive eight-day window on
`auth_activity.last_successful_oauth_at`, minimal no-store responses, read-only
behavior, and D1 failure. The same isolated D1
binding seeds exact-boundary and skewed retention records, then invokes the
deployed `scheduled()` entrypoint to prove
the five-round bounded expiry cleanup and its redacted cap-reached signal
without a browser-facing trigger. Authenticated reading checks
also exercise the native Starlight navigation and page features. The Pagefind
check loads the generated bundle against the same Worker URL and searches
fixture Chinese, product, acronym, and `<details>` terms. The test signer and
its fixed secret live only under `test/support/`; production code only receives
configured secrets.

The OAuth routes and their D1 activity write are Astro `src/pages/api/**`
endpoints, while `src/middleware.ts` applies the shared Session policy to
Astro-rendered routes. The custom Worker handles the exact internal
quiz-eligibility path before Astro so every method and content-type rejection
uses the endpoint's fail-closed response contract. The inert fingerprint POST is
also dispatched directly to its route export, before Astro's Origin check can
reject bodyless requests. All other routes retain that check. For other requests,
with `assets.run_worker_first`, the Worker invokes the shared protected-content policy before
delegating to the Astro Cloudflare handler. This is necessary because the
adapter returns matching `ASSETS` before Astro middleware runs.

## Discord boundary

Wrangler's test harness sends Worker outbound `fetch()` calls through the Node
test process's `globalThis.fetch`. The OAuth tests replace that function with a
strict local responder, so they model member, non-member, Guild pagination,
refusal, and failure responses without network access. Harness runtime logs and
the isolated D1 binding prove that access tokens, Cookies, Secrets, and full
Discord responses do not persist or appear in the fail-closed activity-write log.
