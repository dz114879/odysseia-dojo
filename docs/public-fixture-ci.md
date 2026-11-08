# Public fixture CI and Preview isolation

This page owns the public repository's CI, fixture-Preview, and manual-browser
acceptance procedure. It covers public fixture evidence only; it does not
validate private content or a production deployment.

## Automated public validation

The checked-in [GitHub Actions workflow](../.github/workflows/public-fixture-ci.yml)
runs for pushes, pull requests, and manual dispatches. It checks out only the
current public repository without persisting checkout credentials, installs the
public lockfile with `npm ci`, and runs:

```sh
npm run validate
```

`validate` and every public format, lint, test, check, build, Worker-test,
reference-validation, and Preview command first run `content:fixtures`. The
[content assembly contract](content-assembly.md) owns the replacement behavior:
it removes runtime inputs before copying the tracked fixture roots. Do not add
that filesystem policy to a workflow or another command.

`validate` runs `verify:fixture-boundary` before the matrix, and `build` invokes
it before generating artifacts. `preview` invokes that guarded build. The guard
fails if a public runtime path is Git-tracked or a symlink, if a production
configuration value is injected, if ignored local `.dev.vars*` or `.env*`
configuration is present (other than the committed examples), if the workflow
asks for a Secret, private content, an additional checkout, or deployment, or
if Worker preview URLs are enabled. Its diagnostics identify only the failed
control, never a configured value.

After Astro's schema check and before the production build, `validate` runs
`verify:fixture-references`. It resolves every fixture Markdown/MDX internal
document link, rejects duplicate stable document URLs, requires every fixture
image to use a real protected tutorial-image file, and confirms referenced
protected attachments are real files. Its diagnostics identify only the failed
control, never a fixture path or body.

The build's fixture-output verifier requires the expected fixture documents,
protected assets, and Pagefind fragments to be files. It rejects output
symlinks, unexpected protected documents, unprotected JSON, archive,
question-bank, sitemap, RSS, Atom, and feed output, and scans both client and
deployable server files for private-content and credential markers. It reports
marker categories rather than content or paths.

The existing [Worker test seam](worker-test-seam.md) remains the behavioral
boundary. It exercises OAuth state and return targets, Sessions, membership
branches, OAuth activity, observation retry and deduplication, protected static
assets and Pagefind, and scheduled cleanup using fixture content and isolated
test bindings.

## Public Preview boundary

`npm run preview` is local-only and starts from a fixture build. The public
Wrangler configuration disables Worker preview URLs and `workers.dev`; the
public workflow has no deployment action or deployment command. A public CI or
Preview must not use a private-content checkout, production Secret, production
D1 database, or production deployment credential.

## Win10 host / VM-LAN browser checklist

This is a repeatable manual acceptance check, not a Playwright gate. Run it in
a public fixture checkout on the VM. Do not run local-content assembly, use real
content, or expose the VM through a tunnel.

1. Install public dependencies and create the fixture build:

   ```sh
   npm ci
   npm run content:fixtures
   npm run build
   ```

2. Start the generated Worker locally on the VM's LAN interface. Use Wrangler's
   local mode and a temporary, untracked test-only environment file; do not use
   a production database or any production values.

   ```sh
   npx wrangler dev --local --config dist/server/wrangler.json --ip 0.0.0.0 --port 8787 --env-file <test-only-file>
   ```

3. From a Win10 host browser, visit the VM LAN URL. Keep the address, test
   Session, and all test configuration out of issue comments and run records.
   For authenticated checks, use only an ephemeral test Session prepared from
   the existing Worker-test support; do not authenticate against Discord or
   reuse any production Cookie.

4. Record only pass/fail and the public commit under test for each item:
   - [ ] The public disclosure and licence details expand before login.
   - [ ] The login control begins the local OAuth flow and retains an allowed
         protected return target; it does not require a production credential.
   - [ ] Desktop and narrow-window navigation are usable, including the
         responsive drawer and current-page state.
   - [ ] An authenticated fixture tutorial shows its table of contents and
         supports the site theme control.
   - [ ] The outdated fixture page shows its warning, and optional fixture
         background material expands and collapses.
   - [ ] A Pagefind query returns fixture-only Chinese, product-name, acronym,
         and optional-details results through the local Worker.
   - [ ] The authenticated fixture page shows a short self-dismissing
         observation success toast once for that test Session; reloading the
         same page in the same Session shows no toast. A deliberately
         unavailable test write shows a neutral toast that keeps its retry and
         dismiss controls without blocking reading.
   - [ ] The public header shows the site name and `隐私说明 | 登录` navigation;
         neither public nor tutorial headers show a GitHub source icon. The public
         footer shows `Made by KKTsN with 💖` and `GitHub ↗`, linking to the public
         repository in fixture builds or the immutable revision when configured.

## Evidence limits

Passing the local commands proves only the checked-in public fixture contract.
It does not prove a hosted GitHub Actions run, a real browser pass, private
content validation, a real-content remote Preview, Cloudflare configuration,
production D1 isolation, or production deployment behavior. Those require
separate external or private-workflow evidence.
