import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { assertProductionPublicBuildConfig, publicSourceRevisionUrl } from '../src/lib/public-build-config.mjs';

test('fixture and local builds do not require production public URLs', () => {
	assert.doesNotThrow(() => assertProductionPublicBuildConfig({}));
});

test('the public footer has a repository fallback without replacing configured revision links', async () => {
	const layout = await readFile(new URL('../src/components/PublicLayout.astro', import.meta.url), 'utf8');
	const config = await readFile(new URL('../astro.config.mjs', import.meta.url), 'utf8');
	assert.match(
		layout,
		/publicSourceRevisionUrl\(import\.meta\.env\)\s*\?\?\s*'https:\/\/github\.com\/dz114879\/odysseia-dojo'/u,
	);
	assert.match(
		layout,
		/<footer\b[^>]*class="public-footer"[^>]*>[\s\S]*class="footer-github-link"\s+href=\{sourceRevisionUrl\}[\s\S]*<\/footer>/u,
	);
	assert.match(layout, /target="_blank"\s+rel="noopener noreferrer"/u);
	assert.doesNotMatch(layout, /sourceRevisionUrl &&/u);
	assert.doesNotMatch(
		layout.match(/<header\b[\s\S]*?<\/header>/u)?.[0] ?? '',
		/header-source-link|github|sourceRevisionUrl/iu,
	);
	assert.doesNotMatch(config, /\bsocial\s*:/u);
});

test('production builds require a canonical origin, public GitHub repository URL, and full public commit SHA', () => {
	assert.throws(
		() => assertProductionPublicBuildConfig({ DEPLOYMENT_MODE: 'production' }),
		/PUBLIC_CANONICAL_URL must be set/u,
	);
	assert.throws(
		() =>
			assertProductionPublicBuildConfig({
				DEPLOYMENT_MODE: 'production',
				PUBLIC_CANONICAL_URL: 'https://example.com',
				PUBLIC_SOURCE_REPOSITORY_URL: 'https://github.com/example/odysseia-dojo',
			}),
		/non-placeholder HTTPS URL/u,
	);
	assert.throws(
		() =>
			assertProductionPublicBuildConfig({
				DEPLOYMENT_MODE: 'production',
				PUBLIC_CANONICAL_URL: 'https://odysseia-dojo.github.io',
				PUBLIC_SOURCE_REPOSITORY_URL: 'https://github.com/example/odysseia-dojo/issues',
			}),
		/HTTPS GitHub repository URL/u,
	);
	assert.throws(
		() =>
			assertProductionPublicBuildConfig({
				DEPLOYMENT_MODE: 'production',
				PUBLIC_CANONICAL_URL: 'https://odysseia-dojo.github.io',
				PUBLIC_SOURCE_REPOSITORY_URL: 'https://github.com/example/odysseia-dojo-content',
				PUBLIC_SOURCE_COMMIT_SHA: '0123456789abcdef0123456789abcdef01234567',
			}),
		/public odysseia-dojo GitHub repository URL/u,
	);
	assert.doesNotThrow(() =>
		assertProductionPublicBuildConfig({
			DEPLOYMENT_MODE: 'production',
			PUBLIC_CANONICAL_URL: 'https://odysseia-dojo.github.io',
			PUBLIC_SOURCE_REPOSITORY_URL: 'https://github.com/example/odysseia-dojo',
			PUBLIC_SOURCE_COMMIT_SHA: '0123456789abcdef0123456789abcdef01234567',
		}),
	);
	assert.throws(
		() =>
			assertProductionPublicBuildConfig({
				DEPLOYMENT_MODE: 'production',
				PUBLIC_CANONICAL_URL: 'https://odysseia-dojo.github.io',
				PUBLIC_SOURCE_REPOSITORY_URL: 'https://github.com/example/odysseia-dojo',
				PUBLIC_SOURCE_COMMIT_SHA: '0123456',
			}),
		/PUBLIC_SOURCE_COMMIT_SHA must be a full lowercase Git commit SHA/u,
	);
	assert.throws(
		() =>
			assertProductionPublicBuildConfig({
				DEPLOYMENT_MODE: 'production',
				PUBLIC_CANONICAL_URL: 'https://odysseia-dojo.github.io',
			}),
		/PUBLIC_SOURCE_REPOSITORY_URL must be set/u,
	);
});

test('production source links pin the public repository to the configured commit', () => {
	assert.equal(publicSourceRevisionUrl({}), undefined);
	assert.throws(
		() =>
			publicSourceRevisionUrl({
				PUBLIC_SOURCE_REPOSITORY_URL: 'https://github.com/example/odysseia-dojo-content',
				PUBLIC_SOURCE_COMMIT_SHA: '0123456789abcdef0123456789abcdef01234567',
			}),
		/public odysseia-dojo GitHub repository URL/u,
	);
	assert.equal(
		publicSourceRevisionUrl({
			PUBLIC_SOURCE_REPOSITORY_URL: 'https://github.com/example/odysseia-dojo',
			PUBLIC_SOURCE_COMMIT_SHA: '0123456789abcdef0123456789abcdef01234567',
		}),
		'https://github.com/example/odysseia-dojo/tree/0123456789abcdef0123456789abcdef01234567',
	);
});
