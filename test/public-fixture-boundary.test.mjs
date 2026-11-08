import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
	assertFixtureCiWorkflow,
	assertFixtureCommands,
	assertNoForbiddenFixtureEnvironment,
	verifyPublicFixtureBoundary,
} from '../scripts/verify-public-fixture-boundary.mjs';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDirectory, '..');
const runFile = promisify(execFile);

function fixtureCommandScripts() {
	const scripts = Object.fromEntries(
		[
			'format',
			'lint',
			'test',
			'check',
			'build',
			'test:worker',
			'test:frontend',
			'verify:fixture-boundary',
			'verify:fixture-references',
			'validate',
			'preview',
		].map((command) => [command, 'npm run content:fixtures && true']),
	);
	scripts.build = 'npm run content:fixtures && npm run verify:fixture-boundary && astro build';
	scripts.preview = 'npm run content:fixtures && npm run build && astro preview';
	return scripts;
}

async function makeBoundaryProject(t) {
	const root = await mkdtemp(resolve(tmpdir(), 'odysseia-dojo-public-boundary-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(resolve(root, '.github/workflows'), { recursive: true });
	await Promise.all([
		copyFile(resolve(projectRoot, 'package.json'), resolve(root, 'package.json')),
		copyFile(resolve(projectRoot, 'wrangler.jsonc'), resolve(root, 'wrangler.jsonc')),
		copyFile(
			resolve(projectRoot, '.github/workflows/public-fixture-ci.yml'),
			resolve(root, '.github/workflows/public-fixture-ci.yml'),
		),
	]);
	await runFile('git', ['init', '--quiet', root]);
	return root;
}

test('public fixture boundary accepts the checked-in public tree', async () => {
	await verifyPublicFixtureBoundary({ projectRoot });
});

test('public fixture boundary rejects injected production configuration without echoing values', async (t) => {
	for (const { name, environmentName, value } of [
		{
			name: 'secret',
			environmentName: 'SESSION_SECRET',
			value: 'F08_PRODUCTION_SECRET_CANARY',
		},
		{
			name: 'public revision',
			environmentName: 'PUBLIC_SOURCE_COMMIT_SHA',
			value: '0123456789abcdef0123456789abcdef01234567',
		},
	]) {
		await t.test(name, () => {
			assert.throws(
				() => assertNoForbiddenFixtureEnvironment({ [environmentName]: value }),
				(error) => {
					assert.match(error.message, new RegExp(environmentName, 'u'));
					assert.doesNotMatch(error.message, new RegExp(value, 'u'));
					return true;
				},
			);
		});
	}
});

test('public fixture boundary rejects ignored local configuration files without echoing values', async (t) => {
	for (const configurationFile of ['.dev.vars', '.env.production']) {
		const root = await makeBoundaryProject(t);
		await Promise.all([
			mkdir(resolve(root, 'src/content/docs'), { recursive: true }),
			mkdir(resolve(root, 'public/protected'), { recursive: true }),
			writeFile(resolve(root, configurationFile), 'SESSION_SECRET=F08_LOCAL_CONFIGURATION_CANARY\n', 'utf8'),
		]);

		await assert.rejects(verifyPublicFixtureBoundary({ projectRoot: root, environment: {} }), (error) => {
			assert.match(error.message, /local configuration files/u);
			assert.doesNotMatch(error.message, /F08_LOCAL_CONFIGURATION_CANARY/u);
			return true;
		});
	}
});

test('public fixture boundary rejects workflows that request repository secrets', () => {
	assert.throws(
		() => assertFixtureCiWorkflow('jobs:\n  validate:\n    env:\n      TOKEN: ${{ secrets.DEPLOY_TOKEN }}\n'),
		/secret context/u,
	);
});

test('public fixture boundary rejects workflows that can operate on D1', () => {
	assert.throws(
		() => assertFixtureCiWorkflow('jobs:\n  validate:\n    steps:\n      - run: wrangler d1 execute'),
		/D1 command/u,
	);
});

test('public fixture boundary rejects enabled Preview URLs despite a false comment', async (t) => {
	const root = await makeBoundaryProject(t);
	await Promise.all([
		writeFile(
			resolve(root, 'wrangler.jsonc'),
			'{\n  // "preview_urls": false\n  "preview_urls": true,\n  "workers_dev": false\n}\n',
			'utf8',
		),
		mkdir(resolve(root, 'src/content/docs'), { recursive: true }),
		mkdir(resolve(root, 'public/protected'), { recursive: true }),
	]);

	await assert.rejects(
		verifyPublicFixtureBoundary({ projectRoot: root, environment: {} }),
		/fixture configuration permits Worker preview URLs/u,
	);
});

test('public fixture boundary rejects a command that assembles fixtures after work', () => {
	const scripts = fixtureCommandScripts();
	scripts.build = 'astro build && npm run content:fixtures';

	assert.throws(() => assertFixtureCommands({ scripts }), /build must directly reassemble fixtures/u);
});

test('public fixture boundary rejects frontend tests that skip fixture preparation', () => {
	const scripts = fixtureCommandScripts();
	scripts['test:frontend'] = 'node --test test/d-meow-state.test.mjs';
	assert.throws(() => assertFixtureCommands({ scripts }), /test:frontend must directly reassemble fixtures/u);
});

test('public fixture boundary rejects a build path that skips environment verification', () => {
	const scripts = fixtureCommandScripts();
	scripts.build = 'npm run content:fixtures && astro build';

	assert.throws(() => assertFixtureCommands({ scripts }), /build must run the fixture boundary guard/u);
});

test('public fixture boundary rejects a Preview path that skips the boundary-guarded build', () => {
	const scripts = fixtureCommandScripts();
	scripts.preview = 'npm run content:fixtures && astro preview';

	assert.throws(() => assertFixtureCommands({ scripts }), /preview must run the boundary-guarded build/u);
});

test('public fixture boundary rejects a fixture-prefixed command that materializes local content', () => {
	const scripts = fixtureCommandScripts();
	scripts.preview = 'npm run content:fixtures && npm run build && npm run content:local && astro preview';

	assert.throws(() => assertFixtureCommands({ scripts }), /preview must not materialize local content/u);
});

test('public fixture boundary rejects a fixture-prefixed command that invokes local assembly directly', () => {
	const scripts = fixtureCommandScripts();
	scripts.build =
		'npm run content:fixtures && npm run verify:fixture-boundary && node scripts/content-assembly.mjs local && astro build';

	assert.throws(() => assertFixtureCommands({ scripts }), /build must not materialize local content/u);
});

test('public fixture boundary rejects Git-tracked runtime content without naming it', async (t) => {
	const root = await makeBoundaryProject(t);
	const trackedRuntimeFile = resolve(root, 'src/content/docs/tutorials/should-not-track.md');
	await mkdir(resolve(trackedRuntimeFile, '..'), { recursive: true });
	await writeFile(trackedRuntimeFile, 'fixture sentinel', 'utf8');
	await runFile('git', ['-C', root, 'add', 'src/content/docs/tutorials/should-not-track.md']);

	await assert.rejects(verifyPublicFixtureBoundary({ projectRoot: root, environment: {} }), (error) => {
		assert.match(error.message, /Git tracks materialized runtime content/u);
		assert.doesNotMatch(error.message, /should-not-track/u);
		return true;
	});
});

test('public fixture boundary rejects a runtime symlink without naming it', async (t) => {
	const root = await makeBoundaryProject(t);
	const externalRoot = resolve(root, 'external-content');
	await mkdir(externalRoot);
	await mkdir(resolve(root, 'src/content/docs'), { recursive: true });
	await symlink(externalRoot, resolve(root, 'src/content/docs/tutorials'), 'dir');

	await assert.rejects(verifyPublicFixtureBoundary({ projectRoot: root, environment: {} }), (error) => {
		assert.match(error.message, /fixture runtime paths contain a symlink/u);
		assert.doesNotMatch(error.message, /external-content/u);
		return true;
	});
});
