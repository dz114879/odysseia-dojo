import { execFile } from 'node:child_process';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parse } from 'jsonc-parser';

const executeFile = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const defaultProjectRoot = resolve(dirname(scriptPath), '..');
const runtimeRoots = ['src/content/docs', 'public/protected'];
const fixtureCommands = [
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
];
const fixtureBoundaryPrefix = /^npm run content:fixtures\s*&&\s*npm run verify:fixture-boundary(?:\s*&&|\s*$)/u;
const fixtureBuildPrefix = /^npm run content:fixtures\s*&&\s*npm run build(?:\s*&&|\s*$)/u;
const localConfigurationFilePattern = /^\.(?:dev\.vars|env)(?:\..*)?$/u;
const localConfigurationExamples = new Set(['.dev.vars.example', '.env.example']);
const localContentAssemblyPattern = /\b(?:content:local|scripts\/content-assembly\.mjs\s+local)\b/u;
const forbiddenEnvironmentNames = [
	'ANTICHEAT_HASH_SECRET',
	'CLOUDFLARE_ACCOUNT_ID',
	'CLOUDFLARE_API_TOKEN',
	'DISCORD_CLIENT_ID',
	'DISCORD_CLIENT_SECRET',
	'DISCORD_REDIRECT_URI',
	'NODE_AUTH_TOKEN',
	'PUBLIC_CANONICAL_URL',
	'PUBLIC_SOURCE_COMMIT_SHA',
	'PUBLIC_SOURCE_REPOSITORY_URL',
	'SESSION_SECRET',
];

const requiredWorkflowPatterns = [
	{ label: 'pull request trigger', pattern: /^\s{2}pull_request:/mu },
	{ label: 'push trigger', pattern: /^\s{2}push:/mu },
	{ label: 'read-only contents permission', pattern: /^permissions:\n\s{2}contents: read$/mu },
	{ label: 'checkout action', pattern: /uses: actions\/checkout@v6/u },
	{ label: 'credential-free checkout', pattern: /persist-credentials: false/u },
	{ label: 'Node setup action', pattern: /uses: actions\/setup-node@v7/u },
	{ label: 'Node 24', pattern: /node-version: 24/u },
	{ label: 'npm dependency cache', pattern: /cache: npm/u },
	{ label: 'public lockfile installation', pattern: /run: npm ci/u },
	{ label: 'public validation command', pattern: /run: npm run validate/u },
];

const forbiddenWorkflowPatterns = [
	{ label: 'private content reference', pattern: /(?:content:local|odysseia-dojo-content)/iu },
	{ label: 'secret context', pattern: /\$\{\{\s*secrets\./iu },
	{ label: 'workflow environment', pattern: /^\s+env:\s*$/mu },
	{
		label: 'production configuration reference',
		pattern: /(?:SESSION_SECRET|ANTICHEAT_HASH_SECRET|CLOUDFLARE_API_TOKEN)/iu,
	},
	{ label: 'deployment command', pattern: /(?:wrangler\s+deploy|npm\s+run\s+deploy|cloudflare\s+pages\s+deploy)/iu },
	{ label: 'deployment action', pattern: /cloudflare\/(?:pages-action|wrangler-action)/iu },
	{ label: 'D1 command', pattern: /\bwrangler\s+d1\b/iu },
	{ label: 'additional repository checkout', pattern: /^\s*repository\s*:/mu },
];

function errorFor(label) {
	return new Error(`Public fixture boundary check failed: ${label}.`);
}

export function assertNoForbiddenFixtureEnvironment(environment = process.env) {
	const configuredNames = forbiddenEnvironmentNames.filter((name) => environment[name] !== undefined);
	if (environment.DEPLOYMENT_MODE === 'production') configuredNames.push('DEPLOYMENT_MODE');
	if (configuredNames.length > 0) {
		throw errorFor(`refusing production configuration (${configuredNames.join(', ')})`);
	}
}

async function assertNoLocalConfigurationFiles(projectRoot) {
	const entries = await readdir(projectRoot, { withFileTypes: true });
	if (
		entries.some(
			(entry) => localConfigurationFilePattern.test(entry.name) && !localConfigurationExamples.has(entry.name),
		)
	) {
		throw errorFor('fixture commands must not load local configuration files');
	}
}

export function assertFixtureCommands(manifest) {
	for (const command of fixtureCommands) {
		const script = manifest.scripts?.[command] ?? '';
		if (localContentAssemblyPattern.test(script)) {
			throw errorFor(`${command} must not materialize local content`);
		}
		if (!/^npm run content:fixtures(?:\s*&&|\s*$)/u.test(script)) {
			throw errorFor(`${command} must directly reassemble fixtures`);
		}
	}
	if (!fixtureBoundaryPrefix.test(manifest.scripts?.build ?? '')) {
		throw errorFor('build must run the fixture boundary guard before building');
	}
	if (!fixtureBuildPrefix.test(manifest.scripts?.preview ?? '')) {
		throw errorFor('preview must run the boundary-guarded build before serving');
	}
}

export function assertFixtureCiWorkflow(workflow) {
	for (const forbidden of forbiddenWorkflowPatterns) {
		if (forbidden.pattern.test(workflow)) throw errorFor(`workflow contains ${forbidden.label}`);
	}
	for (const requirement of requiredWorkflowPatterns) {
		if (!requirement.pattern.test(workflow)) throw errorFor(`workflow lacks ${requirement.label}`);
	}
}

function assertFixturePreviewConfig(wranglerConfig) {
	const errors = [];
	const config = parse(wranglerConfig, errors, { allowTrailingComma: true, disallowComments: false });
	if (errors.length > 0 || !config || typeof config !== 'object' || Array.isArray(config)) {
		throw errorFor('fixture configuration is not valid JSONC');
	}
	if (config.preview_urls !== false) {
		throw errorFor('fixture configuration permits Worker preview URLs');
	}
	if (config.workers_dev !== false) {
		throw errorFor('fixture configuration permits workers.dev deployment');
	}
}

async function gitOutput(projectRoot, arguments_) {
	const { stdout } = await executeFile('git', ['-C', projectRoot, ...arguments_], { encoding: 'buffer' });
	return stdout.toString('utf8');
}

async function assertNoTrackedRuntimeContent(projectRoot) {
	const trackedRuntimeContent = await gitOutput(projectRoot, ['ls-files', '-z', '--', ...runtimeRoots]);
	if (trackedRuntimeContent.length > 0) throw errorFor('Git tracks materialized runtime content');
}

async function assertNoTrackedSymlinks(projectRoot) {
	const trackedEntries = await gitOutput(projectRoot, ['ls-files', '-s', '-z']);
	if (trackedEntries.split('\0').some((entry) => entry.startsWith('120000 '))) {
		throw errorFor('public tree contains a Git-tracked symlink');
	}
}

async function assertNoRuntimeSymlinks(path) {
	const entry = await lstat(path);
	if (!entry.isDirectory() || entry.isSymbolicLink()) {
		throw errorFor('fixture runtime root is not a real directory');
	}

	for (const child of await readdir(path, { withFileTypes: true })) {
		const childPath = resolve(path, child.name);
		if (child.isSymbolicLink()) throw errorFor('fixture runtime paths contain a symlink');
		if (child.isDirectory()) await assertNoRuntimeSymlinks(childPath);
	}
}

export async function verifyPublicFixtureBoundary({
	projectRoot = defaultProjectRoot,
	environment = process.env,
} = {}) {
	const [packageJson, workflow, wranglerConfig] = await Promise.all([
		readFile(resolve(projectRoot, 'package.json'), 'utf8'),
		readFile(resolve(projectRoot, '.github/workflows/public-fixture-ci.yml'), 'utf8'),
		readFile(resolve(projectRoot, 'wrangler.jsonc'), 'utf8'),
	]);

	assertNoForbiddenFixtureEnvironment(environment);
	await assertNoLocalConfigurationFiles(projectRoot);
	assertFixtureCommands(JSON.parse(packageJson));
	assertFixtureCiWorkflow(workflow);
	assertFixturePreviewConfig(wranglerConfig);
	await assertNoTrackedRuntimeContent(projectRoot);
	await assertNoTrackedSymlinks(projectRoot);
	for (const runtimeRoot of runtimeRoots) {
		await assertNoRuntimeSymlinks(resolve(projectRoot, runtimeRoot));
	}

	console.log(
		'Public fixture boundary: runtime content is ignored and copied, CI is credential-free, and remote previews are disabled.',
	);
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
	verifyPublicFixtureBoundary().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
