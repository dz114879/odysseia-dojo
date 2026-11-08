# Repository overview

Use this map to locate current owners before changing code. It records the
public repository's checked-in structure; operational procedures remain owned
by the linked documents.

## Responsibility map

| Area                              | Current owner                                                                                                                                                                                                                                                                                                                                                    | Responsibility                                                                                                                                                                                                                                                                              |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime site and route code       | [`src/`](../../../src/)                                                                                                                                                                                                                                                                                                                                          | Astro pages, shared libraries, middleware, Worker entrypoint, components, styles, and content schema.                                                                                                                                                                                       |
| Public presentation and mascot    | [`PublicLayout.astro`](../../../src/components/PublicLayout.astro), [`Mascot.astro`](../../../src/components/Mascot.astro), [`mascot-controller.js`](../../../src/lib/mascot-controller.js), [`site-closure.js`](../../../src/lib/site-closure.js), [`d-meow-branding.js`](../../../src/lib/d-meow-branding.js), and [`public/mascot/`](../../../public/mascot/) | Minimal public pages, locally served artwork/fonts, reversible theme text and browser-only mascot/closure presentation. Authentication and request policy remain unchanged. Behaviour, timings, and asset provenance are documented in [frontend and mascot](../../frontend-and-mascot.md). |
| Public input                      | [`fixtures/`](../../../fixtures/)                                                                                                                                                                                                                                                                                                                                | Tracked, non-sensitive content and protected-resource fixtures for public development and validation.                                                                                                                                                                                       |
| Content materialization           | [`scripts/content-assembly.mjs`](../../../scripts/content-assembly.mjs)                                                                                                                                                                                                                                                                                          | The two public content-input modes and their fixed runtime destinations. The [content assembly contract](../../content-assembly.md) owns the operational rules.                                                                                                                             |
| Build configuration               | [`package.json`](../../../package.json), [`astro.config.mjs`](../../../astro.config.mjs), and [`wrangler.jsonc`](../../../wrangler.jsonc)                                                                                                                                                                                                                        | Command wiring, Astro/Starlight configuration, Cloudflare Worker/static-asset configuration, and D1 migration discovery.                                                                                                                                                                    |
| Build checks                      | [`scripts/validate-public-build-config.mjs`](../../../scripts/validate-public-build-config.mjs), [`scripts/verify-fixture-output.mjs`](../../../scripts/verify-fixture-output.mjs), and [`scripts/verify-public-fixture-boundary.mjs`](../../../scripts/verify-public-fixture-boundary.mjs)                                                                      | Production public-link validation, fixture-build artifact isolation, and public CI/Preview boundary checks.                                                                                                                                                                                 |
| D1 schema                         | [`migrations/`](../../../migrations/)                                                                                                                                                                                                                                                                                                                            | Checked-in D1 migrations used by the Worker configuration and local harness.                                                                                                                                                                                                                |
| V1 D1 retention and investigation | [`src/lib/data-retention.ts`](../../../src/lib/data-retention.ts), [`scripts/investigation-queries/`](../../../scripts/investigation-queries/), and the [data-retention runbook](../../data-retention-and-investigation.md)                                                                                                                                      | Daily Worker cleanup, fixed query/deletion templates, and account-admin procedure.                                                                                                                                                                                                          |
| Public validation                 | [`test/`](../../../test/)                                                                                                                                                                                                                                                                                                                                        | Content assembly, public-build configuration, CI/Preview isolation, browser-observation logic, and production-shaped Worker checks using fixtures.                                                                                                                                          |
| Maintainer documentation          | [`docs/`](../..)                                                                                                                                                                                                                                                                                                                                                 | Developer navigation and operational runbooks linked from the [developer navigator](../README.md).                                                                                                                                                                                          |

## Content flow

For public development and CI, the tracked [`fixtures/`](../../../fixtures/)
corpus is materialized into Git-ignored runtime paths and then consumed by the
Astro/Starlight build. The content-assembly module is the only checked-in
owner of that transition.

Trusted-local work uses the same module to link the allowed roots from the
trusted sibling into those ignored runtime paths. This public repository has no
production materialization interface. The exact allowlist, replacement
behavior, and local-mode constraints are maintained in the
[content assembly contract](../../content-assembly.md).

## Request flow

The deployed request path starts at [`src/worker.ts`](../../../src/worker.ts).
It dispatches the authenticated quiz-eligibility API to
[`src/lib/quiz-eligibility.ts`](../../../src/lib/quiz-eligibility.ts), then
applies the shared protected-content policy before delegating other requests to
Astro's Cloudflare handler.
[`src/middleware.ts`](../../../src/middleware.ts) applies that same policy to
Astro-rendered routes. OAuth endpoint and Session ownership live below
[`src/pages/api/auth/`](../../../src/pages/api/auth/); the detailed owner and
test-seam map is [request and access](request-access.md). The authenticated
[`/api/fingerprint`](../../../src/pages/api/fingerprint.ts) route delegates
observation handling to [`src/lib/observation.ts`](../../../src/lib/observation.ts);
its browser and persistence owners are mapped in [browser observation](observation.md).

## Build and validation flow

[`package.json`](../../../package.json) exposes the maintained npm entrypoints.
They assemble the public fixture input where required, run Astro's configured
Cloudflare build, and use the checked-in scripts to validate public build
configuration, generated fixture artifacts, and public CI/Preview isolation.
The production-shaped Worker test consumes the generated Worker configuration.
The [tooling map](tooling.md) owns the command-to-entrypoint route and
prerequisites.

## Current source boundary

The D1 schema migrations are
[`migrations/0001_create_auth_activity.sql`](../../../migrations/0001_create_auth_activity.sql)
for the OAuth callback's `auth_activity` upsert and
[`migrations/0002_create_fingerprint_observations.sql`](../../../migrations/0002_create_fingerprint_observations.sql)
for per-Session observations. The corresponding source and test seams remain
separate; see [request and access](request-access.md) and
[browser observation](observation.md). Daily removal and manual account-admin
operations are owned by the [data-retention runbook](../../data-retention-and-investigation.md).
