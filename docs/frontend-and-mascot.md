# Public frontend and mascot

The public homepage uses a warm paper palette, restrained serif headings and a
small illustrated 类脑娘. Public login/error routes share `PublicLayout.astro`;
Starlight reading styles retain its native light/dark theme controls. Authentication,
privacy disclosures, protected-content boundaries and browser observation are unchanged.

## Interaction owners

- `src/components/Mascot.astro`: accessible button, expression images, dialogue live
  region and pre-closure countdown cancellation. Used on the homepage,
  not over reading content. The illustration remains visible with JavaScript disabled.
- `src/lib/mascot-controller.js`: independent state/timing controller. Pokes 1–3 are
  friendly, 4–6 impatient, 7–9 angry, and 10 furious. Each poke produces a new reply.
  The last warning explicitly says that another poke will close the site.
- `src/lib/mascot.ts`: one small speech bubble per click, replacing the prior bubble
  to prevent overlapping text. Bubbles last 3.2 seconds. A 30-second pause resets her
  patience before fury. Fury starts an 8-second countdown; additional clicks neither
  extend it nor create additional close attempts. “好啦，不闹了” cancels the countdown.
- `src/styles/mascot.css`: quiet bubble treatment, expression transitions and a brief
  huff; animations are disabled with `prefers-reduced-motion`.
- `src/lib/site-closure.js`: bounded browser closure state and a pure function for
  choosing the pending/closed/reopened view. It does not intercept HTTP requests.
- `src/lib/site-closure-client.ts`, `SiteClosureGuard.astro`, `ReadingHead.astro`:
  cookie/local-storage synchronization, pending deadline restoration, open-tab and
  back/forward-cache guards shared by public and reading pages.
- `src/pages/closed.astro`: a standalone closed page, not a dismissible dialog.
- `test/mascot-controller.test.mjs`, `test/site-closure.test.mjs`: thresholds,
  browser navigation, restoration, expiry, isolation and lifecycle coverage.

At fury, the original close deadline and its 60-second reopening deadline are saved in
the browser using a site-wide SameSite=Lax cookie and local storage. Refreshing during
the eight-second warning restores that deadline instead of cancelling/restarting it.
“好啦，不闹了” only works before closure starts.

At the deadline the mascot attempts `window.close()` once; if the browser does not
allow this, the page navigates to `/closed`. The client guard on public and tutorial
pages restores that view while the timer is active. No Worker, middleware, API,
protected-resource policy or session implementation is changed. The standalone
closed page is uncached; existing authentication and database rows are untouched.

The closed page has no “make peace” button or Escape-to-dismiss shortcut. Refresh,
direct links and new tabs in the same browser restore the closed view while
JavaScript and storage are available. At expiry,
the cookie expires, local storage is cleaned on the next page check, and the closed
page automatically returns home. Background tabs recheck on focus/visibility/pageshow.

This is a browser-local Easter egg, **not an account ban or tamper-proof access control**.
Disabling JavaScript, clearing the site's cookie and local-storage state, changing
browser/profile or using private browsing can bypass it. Content/search/API requests
are not blocked by the Easter egg; protected resources still require the original
authentication. If all site storage is disabled, persistence cannot be guaranteed.
No global outage, account penalties, identifying data, or tracking are added.

For Windows builds, the output inventory normalizes filesystem separators before
applying its existing URL-path checks. The protected-content allowlist is unchanged.

## D喵 hidden theme

The optional `durvis` Easter egg is entirely client-side presentation. Type the six
letters consecutively outside forms/search/editable content (no modifiers, repeats
or IME composition; at most two seconds between letters). A second complete sequence
restores the original appearance without logging in automatically.

- `DMeowTheme.astro` installs the shared public/Starlight entry and early local theme
  preference. `d-meow-state.js` owns the bounded, non-recording shortcut recognizer
  and exact `旅程 ΟΡΙΖΟΝΤΑΣ` display tokens.
- `d-meow.ts` plays the 4.6-second fictional takeover broadcast, retires the old
  mascot's local closure timer, then navigates to the **existing** `/api/auth/logout`
  endpoint. That endpoint clears the HttpOnly session and redirects home; no OAuth,
  cookie-auth, membership, Worker or database implementation is added or bypassed.
  Interrupted transitions resume the logout on reload. Existing tutorial tabs react
  to the local theme change; pre-takeover bfcache pages return home on restoration.
- The cosmetic preference uses `dojo:theme:v1` in local storage, with session storage
  as a fallback. Only the constant theme name is saved, never typed keys or identity.
  A temporary session-storage flag records an interrupted logout, then is removed.
  Persistence cannot be guaranteed when the browser disables all site storage.
- `d-meow-branding.js` groups inline text across bold, italic and search-highlight
  markup before rewriting a name, preventing duplicate corrections for names such
  as `类脑 **Odysseia**`. It preserves original elements, text nodes, event listeners
  and link targets, and restores them when the theme changes. Public/login wordmarks
  become `旅程 ΟΡΙΖΟΝΤΑΣ`, with the Greek word italicized. The entire reading shell
  (header, navigation, headings, dynamic search results and prose) instead displays
  `<s>旅程</s> 类脑`, with equal font sizes and no trailing Greek alias. Accessible
  labels and browser titles use the corrected plain name `类脑`. Code, source Markdown, URLs,
  anchors, form values, author credit and licensing remain unchanged. This is a
  local fictional skin, never a real community announcement or a content migration.
- `d-meow.css` uses hair-blue paper and dark blue typography, a tilted broadcast
  sheet, a small user-supplied takeover illustration, and two-frame double-hand waving. D喵 is not a poke
  button, cannot be dragged, and never becomes angry or closes the site. Its bubble
  says `旅程宣布独立！`. A small pause control and reduced-motion support stop motion.
- `test/d-meow-state.test.mjs` covers shortcut exclusion/reset/timing and exact name
  tokens. Existing Worker tests cover the logout route and protected access.
- `test/d-meow-branding.test.mjs` covers split formatting, dynamic results, repeated
  toggles, accessible brand labels, node identity, and code/resource preservation.

`public/mascot/d-meow-wave-{1,2}.webp` are two aligned 360×480 transparent frames.
They were generated through the user-requested `gpt-image-2` CLI/API route using
their character reference plus a second two-hand pose reference. Both final frames
have **exactly two hands**, raised in front of the chest with palms facing outward.
The rejected extra-hand draft is not shipped. The final prompt is preserved in
`docs/art/d-meow-prompt.txt`; reference images and API credentials are not redistributed.

The separate fallen mascot and the visible `D喵 / 戳不动的发言人` caption have been
removed from the post-broadcast homepage/reading companion; the normal-theme mascot is unchanged and the pause control
remains available. `public/mascot/d-meow-takeover-cutout.webp` is a 560×560 transparent
version of the user's second scene image, positioned to the side of D喵 and stacked
below on narrow homepages. It is static and non-interactive. This cutout is separated
from D喵 by a slightly wider gap and is not used inside the broadcast. The broadcast
retains the original fallen 类脑娘 plus D喵, using an auto-height two-column grid.
The rotated mascot has a bounded image stage, its caption occupies a separate row,
and the logout status sits below the whole scene so no illustration covers text.
The imagegen CLI with the user-requested `gpt-image-2` produced a silhouette mask
only; local foreground refinement applied that alpha to the original RGB pixels.
The original image was not repainted. Mask prompt: `docs/art/takeover-cutout-mask-prompt.txt`.
Rights in the supplied scene remain with its original owners; background removal
does not grant additional artwork rights. The temporary processing dependencies are
outside the repository and do not change site dependencies.

On tutorial pages the D喵 companion and cutout are a small, normal-flow panel after
the article, not a fixed viewport overlay. Long articles and narrow screens therefore
keep their full reading area. Wide tables keep Starlight's native horizontal scrolling;
plain, non-highlighted code blocks also scroll inside their own width. The homepage
companion and the broadcast retain their separate layouts.

## Frontend PR checks

Run `npm run test:frontend` for the mascot, browser closure, shortcut and DOM branding
regressions. `linkedom` is a pinned development-only dependency for DOM tests; it is
not imported by the site or shipped to visitors. Run the repository's existing
format/lint/type/build and full validation commands as well; the frontend command
does not replace protected-content or Worker tests.

`test/fixtures/frontend-reading.html` is synthetic, non-sensitive test input with
mixed inline formatting, long headings/links/code, a wide table, an image, nested
lists and disclosure elements. It is not part of the six public tutorial fixtures
and is not materialized or published as a tutorial. A local-only QA preview can
substitute it into the built reading shell without adding an authentication bypass
to the application.

The public fixture preview cannot establish compatibility with every private MDX
component or prove real Discord login. Before merging, the maintainer should check
the branch against representative authorized production content and run the existing
Linux fixture CI. Windows symlink-permission failures must not be worked around by
skipping the content-boundary tests. The site operator has confirmed that all mascot
and D喵 artwork shipped in `public/mascot/*.webp` is approved for distribution in
this public repository. This approval does not change the original owners' rights.

## Original artwork and typography

`public/mascot/{happy,annoyed,angry,furious}.webp` are four 616×880 transparent assets
(about 380 KiB total), derived from the user-supplied character reference. They were
generated/edited using the explicitly requested `gpt-image-2` API via the imagegen CLI.
Expression edits preserve the hair, braid, coral flower, vest, book and pose. The flat
green generation background was removed and the cutouts were normalized locally.
The exact prompt set is in `docs/art/`. The user-supplied reference is not redistributed;
reference artwork rights remain with its respective owner. API credentials are not
part of the site, source, build or provenance files.

`public/fonts/` contains Instrument Serif regular/italic and a compact Noto Serif SC
heading-glyph subset, served locally with `font-display: swap`. No Google Fonts request
is made by a visitor. Both families use the SIL Open Font License; the unmodified
license files are alongside the fonts. Noto's subset falls back to local serif fonts
for other glyphs, and reading body copy uses system sans-serif fonts.

Font sources: [Instrument Serif](https://github.com/google/fonts/tree/main/ofl/instrumentserif)
and [Noto Serif SC](https://github.com/google/fonts/tree/main/ofl/notoserifsc).
The heading subset was requested through Google Fonts' `text` parameter and contains:
`类脑道馆挑战社区关于隐私与内容许可边界使用验证访问资格信息收集和说明登录前请先了解今日读到这里让阅读回归安静`.
