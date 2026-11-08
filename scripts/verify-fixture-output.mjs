import { lstat, readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');
const defaultOutputRoot = resolve(projectRoot, 'dist/client');
const defaultServerOutputRoot = resolve(projectRoot, 'dist/server');

const expectedFixtureOutputPaths = [
	'docs/tutorials/index.html',
	'docs/tutorials/discord-and-odysseia/index.html',
	'docs/tutorials/sillytavern-api/index.html',
	'docs/extensions/index.html',
	'docs/extensions/account-safety/index.html',
	'docs/extensions/legacy-interface/index.html',
	'protected/tutorial-images/fixture-api-settings.svg',
	'protected/attachments/fixture-reading-checklist.txt',
];

const expectedProtectedDocumentPaths = new Set(
	expectedFixtureOutputPaths.filter((path) => /^docs\/(?:tutorials|extensions)(?:\/|$)/u.test(path)),
);

const forbiddenOutputContentMarkers = [
	{ label: 'private-content canary', pattern: /F08_PRIVATE_CONTENT_CANARY/u },
	{ label: 'private repository reference', pattern: /(?:^|[\\/])odysseia-dojo-content(?:[\\/]|$)/iu },
	{ label: 'private key', pattern: /-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----/u },
	{
		label: 'deployment credential token',
		pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,})\b/u,
	},
];

async function walk(root, outputRoot) {
	const entries = await readdir(root, { withFileTypes: true });
	const paths = [];
	for (const entry of entries) {
		const entryPath = resolve(root, entry.name);
		if (entry.isSymbolicLink()) {
			throw new Error('Fixture build output contains a symlink.');
		}
		if (entry.isDirectory()) {
			paths.push(...(await walk(entryPath, outputRoot)));
		} else {
			// Inventory rules use URL-style paths on every host, including Windows.
			paths.push(relative(outputRoot, entryPath).split(sep).join('/'));
		}
	}
	return paths;
}

async function assertExpectedFile(outputRoot, path) {
	let entry;
	try {
		entry = await lstat(resolve(outputRoot, path));
	} catch {
		throw new Error(`Expected fixture build output is missing: ${path}`);
	}
	if (entry.isSymbolicLink()) throw new Error('Fixture build output contains a symlink.');
	if (!entry.isFile()) throw new Error('Expected fixture build output is not a file.');
}

function assertNoForbiddenOutputPaths(generatedPaths) {
	const forbiddenOutput = generatedPaths.filter(
		(path) =>
			/(^|\/)(?:archive|question_banks)(?:\/|$)/u.test(path) ||
			/(?:^|\/)(?:sitemap[^/]*\.xml|rss(?:\.xml)?|atom(?:\.xml)?|feed(?:\.xml)?)(?:$|\/)/iu.test(path),
	);
	if (forbiddenOutput.length > 0) {
		throw new Error('Fixture build output contains forbidden derived paths.');
	}
}

function assertNoForbiddenClientOutputPaths(generatedPaths) {
	const unprotectedJsonOutput = generatedPaths.filter(
		(path) => path.endsWith('.json') && !path.startsWith('pagefind/'),
	);
	if (unprotectedJsonOutput.length > 0) {
		throw new Error('Fixture build output contains unprotected JSON artifacts.');
	}

	const unexpectedProtectedDocuments = generatedPaths.filter(
		(path) =>
			/^docs\/(?:tutorials|extensions)(?:\/|$)/u.test(path) &&
			path.endsWith('.html') &&
			!expectedProtectedDocumentPaths.has(path),
	);
	if (unexpectedProtectedDocuments.length > 0) {
		throw new Error('Fixture build output contains unexpected protected documents.');
	}
}

async function assertNoForbiddenOutputContent(outputRoot, generatedPaths) {
	const matchedMarkers = new Set();
	for (const path of generatedPaths) {
		const output = await readFile(resolve(outputRoot, path), 'utf8');
		for (const marker of forbiddenOutputContentMarkers) {
			if (marker.pattern.test(output)) matchedMarkers.add(marker.label);
		}
	}
	if (matchedMarkers.size > 0) {
		throw new Error(
			`Fixture build output contains forbidden isolation marker categories: ${[...matchedMarkers].join(', ')}.`,
		);
	}
}

export async function verifyFixtureOutput({
	outputRoot = defaultOutputRoot,
	serverOutputRoot = defaultServerOutputRoot,
	report = true,
} = {}) {
	for (const expectedPath of expectedFixtureOutputPaths) {
		await assertExpectedFile(outputRoot, expectedPath);
	}

	const generatedPaths = await walk(outputRoot, outputRoot);
	const generatedServerPaths = await walk(serverOutputRoot, serverOutputRoot);
	const outputInventory = {
		protectedDocumentHtml: generatedPaths.filter(
			(path) => /^docs\/(?:tutorials|extensions)(?:\/|$)/u.test(path) && path.endsWith('.html'),
		).length,
		pagefindAssets: generatedPaths.filter((path) => path.startsWith('pagefind/')).length,
		protectedTutorialImages: generatedPaths.filter((path) => path.startsWith('protected/tutorial-images/')).length,
		protectedAttachments: generatedPaths.filter((path) => path.startsWith('protected/attachments/')).length,
	};

	if (!generatedPaths.some((path) => path.startsWith('pagefind/fragment/'))) {
		throw new Error('Pagefind fragments were not generated from the fixture corpus.');
	}

	assertNoForbiddenOutputPaths(generatedPaths);
	assertNoForbiddenOutputPaths(generatedServerPaths);
	assertNoForbiddenClientOutputPaths(generatedPaths);
	await assertNoForbiddenOutputContent(outputRoot, generatedPaths);
	await assertNoForbiddenOutputContent(serverOutputRoot, generatedServerPaths);

	if (report) {
		console.log(
			`Fixture build inventory: ${outputInventory.protectedDocumentHtml} protected document HTML files, ` +
				`${outputInventory.pagefindAssets} Pagefind assets, ${outputInventory.protectedTutorialImages} protected tutorial images, and ` +
				`${outputInventory.protectedAttachments} protected attachments; ${generatedServerPaths.length} deployable server artifacts scanned; ` +
				'no unprotected JSON, feed, archive, question-bank, or private-content markers.',
		);
	}

	return outputInventory;
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
	verifyFixtureOutput().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
