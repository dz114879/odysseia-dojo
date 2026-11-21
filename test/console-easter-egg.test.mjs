import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createConsoleEasterEggController, printConsoleEasterEgg } from '../src/lib/console-easter-egg.js';

function fakeConsole({ withGroups = true } = {}) {
	const calls = [];
	const target = {
		log: (...args) => calls.push(['log', ...args]),
	};
	if (withGroups) {
		target.groupCollapsed = (...args) => calls.push(['groupCollapsed', ...args]);
		target.groupEnd = () => calls.push(['groupEnd']);
	}
	return { target, calls };
}

test('prints the warm default Nice try banner with collapsed F12 hints', () => {
	const { target, calls } = fakeConsole();
	assert.equal(printConsoleEasterEgg({ console: target, theme: 'default' }), true);
	assert.match(calls[0][1], /Nice try\./u);
	assert.equal(
		calls.some(([method]) => method === 'groupCollapsed'),
		true,
	);
	assert.equal(
		calls.some(([method]) => method === 'groupEnd'),
		true,
	);
	assert.equal(
		calls.some(([, text]) => typeof text === 'string' && text.includes('闲鱼')),
		true,
	);
});

test('falls back cleanly to plain logs when groupCollapsed is unavailable', () => {
	const { target, calls } = fakeConsole({ withGroups: false });
	assert.equal(printConsoleEasterEgg({ console: target, theme: 'default' }), true);
	assert.equal(
		calls.every(([method]) => method === 'log'),
		true,
	);
	assert.ok(calls.length >= 6);
});

test('prints the blue D-Meow banner and deduplicates repeated announcements until theme changes', () => {
	const { target, calls } = fakeConsole();
	const controller = createConsoleEasterEggController({ console: target });

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
