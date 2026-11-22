import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	CONSOLE_SPLASH_TEXTS,
	createConsoleEasterEggController,
	pickConsoleSplash,
	printConsoleEasterEgg,
} from '../src/lib/console-easter-egg.js';

function fakeConsole() {
	const calls = [];
	const target = {
		log: (...args) => calls.push(['log', ...args]),
		groupCollapsed: (...args) => calls.push(['groupCollapsed', ...args]),
		groupEnd: () => calls.push(['groupEnd']),
	};
	return { target, calls };
}

test('prints the default badge and a large splash line without collapsed hint groups', () => {
	const { target, calls } = fakeConsole();
	assert.equal(printConsoleEasterEgg({ console: target, theme: 'default', random: () => 0 }), true);
	assert.equal(calls.length, 2);
	assert.equal(calls[0][0], 'log');
	assert.equal(calls[0][1], '%c类脑 ODYSSEIA · 道馆教程');
	assert.equal(calls[1][0], 'log');
	assert.equal(calls[1][1], `%c${CONSOLE_SPLASH_TEXTS[0]}`);
	assert.match(calls[1][2], /font-size:\s*22px/u);
	assert.equal(
		calls.some(([method]) => method === 'groupCollapsed' || method === 'groupEnd'),
		false,
	);
});

test('selects splash entries across the configured list and clamps edge values', () => {
	assert.equal(
		pickConsoleSplash(() => 0),
		CONSOLE_SPLASH_TEXTS[0],
	);
	assert.equal(
		pickConsoleSplash(() => 0.9999),
		CONSOLE_SPLASH_TEXTS.at(-1),
	);
	assert.equal(
		pickConsoleSplash(() => 1),
		CONSOLE_SPLASH_TEXTS.at(-1),
	);
	assert.equal(
		pickConsoleSplash(() => -0.5),
		CONSOLE_SPLASH_TEXTS[0],
	);
});

test('prints the blue D-Meow banner and deduplicates repeated announcements until theme changes', () => {
	const { target, calls } = fakeConsole();
	const controller = createConsoleEasterEggController({ console: target, random: () => 0.5 });

	assert.equal(controller.announce('default'), true);
	const afterDefault = calls.length;
	assert.equal(controller.announce('default'), false);
	assert.equal(calls.length, afterDefault);

	assert.equal(controller.announce('d-meow'), true);
	assert.match(calls[afterDefault][1], /SIGNAL D/u);
	assert.match(calls[afterDefault][1], /旅程/u);
	assert.equal(controller.announce('d-meow'), false);

	assert.equal(controller.announce('default'), true);
	assert.equal(printConsoleEasterEgg({ console: {} }), false);
});
