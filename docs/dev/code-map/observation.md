# Browser observation map

Browser observation is disabled for the V1.2 launch cutover. This map records
the retained dormant helpers and their trust boundary; the [Worker test
seam](../../worker-test-seam.md) owns the operational harness procedure.

## Source owners and stable entrypoints

| Concern                                                                                                    | Current owner                                                                                                         | Stable entrypoint                                                          |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Observation HTTP handling, payload validation, trusted-context assembly, keyed hashing, and D1 persistence | [`src/lib/observation.ts`](../../../src/lib/observation.ts)                                                           | `recordFingerprintObservation()`                                           |
| Dynamic HTTP route                                                                                         | [`src/pages/api/fingerprint.ts`](../../../src/pages/api/fingerprint.ts)                                               | `POST /api/fingerprint`                                                    |
| Browser collection and protected-page trigger                                                              | [`src/lib/browser-observation.ts`](../../../src/lib/browser-observation.ts)                                           | `collectBrowserObservation()` and `startBrowserObservation()`              |
| Controllable collection/posting flow                                                                       | [`src/lib/observation-client.js`](../../../src/lib/observation-client.js)                                             | `createObservationController()`                                            |
| Payload compatibility version                                                                              | [`src/lib/observation-contract.js`](../../../src/lib/observation-contract.js)                                         | `OBSERVATION_PAYLOAD_VERSION`                                              |
| IP normalization, prefixes, and versioned hash inputs                                                      | [`src/lib/observation-logic.js`](../../../src/lib/observation-logic.js)                                               | `normalizeIp()`, `networkPrefix()`, and `hashObservationValue()`           |
| Browser collector configuration                                                                            | [`src/lib/thumbmark-options.js`](../../../src/lib/thumbmark-options.js) and [`package.json`](../../../package.json)   | `THUMBMARK_OPTIONS` and the exact npm package pin                          |
| Observation schema                                                                                         | [`migrations/0002_create_fingerprint_observations.sql`](../../../migrations/0002_create_fingerprint_observations.sql) | D1 migration discovery through [`wrangler.jsonc`](../../../wrangler.jsonc) |

`ProtectedPageTitle.astro` is configured by Starlight for protected document
pages and no longer imports or renders
[`ObservationToast.astro`](../../../src/components/ObservationToast.astro).
The retained toast component and browser collector have no active page entry;
protected pages load no ThumbmarkJS code and send no `/api/fingerprint` requests.

`applyProtectedAccessPolicy()` in
[`src/lib/protected-access.ts`](../../../src/lib/protected-access.ts) keeps the
Session gate and private no-store responses without running the dormant
`withObservationSessionMarker()` HTML rewriter.

`POST /api/fingerprint` immediately returns `204 No Content` with
`Cache-Control: no-store` without reading the body, verifying a Session, or
calling `recordFingerprintObservation()`. Helpers, unit tests, and the existing
D1 migration remain in place; scheduled retention still removes historical rows.

## Trust and persistence boundary

The following describes retained helper behavior, not active collection.

The browser controller sends only the allowlisted browser signals and the
payload version to the same-origin route. Collection configuration enables the
approved components only, disables sampled logging, and does not configure a
vendor API path.

`recordFingerprintObservation()` verifies the existing Session before parsing a
request. Identity and Session nonce come from that verified Session; network
metadata and the client address come from the Worker request; User-Agent and
capture time are derived server-side. The module rejects extra client fields,
uses keyed hashes for sensitive correlation values, and never returns stored
observation data. Its D1 insert is parameterized and uses the session-hash
unique constraint for idempotence; a failed insert does not create a local
success authority.

The controller's local-storage marker holds the login marker of the last
successful write and can suppress an automatic repeat attempt only. A page
without a login marker cannot suppress an attempt. The marker never establishes
persistence, and the retry action always attempts collection and posting again.
Collection or posting failure leaves the protected page usable and exposes only
a neutral toast with a retry control; a successful write shows a short
self-dismissing toast once per login.

The observation path records data only. It does not make access decisions or
produce an automated assessment of a reader.

## Validation route

[`test/observation-logic.test.mjs`](../../../test/observation-logic.test.mjs)
covers normalization, prefix, and keyed-hash vectors.
[`test/observation-client.test.mjs`](../../../test/observation-client.test.mjs)
uses a controllable collector and poster to cover allowlisting and retry states.
The production-shaped HTTP and D1 coverage in
[`test/worker-harness.test.mjs`](../../../test/worker-harness.test.mjs) verifies
the disabled endpoint and absence of toast and session-marker injection. Run the
maintained commands through the [tooling map](tooling.md), or use
`npm run validate` for the full public validation set.
