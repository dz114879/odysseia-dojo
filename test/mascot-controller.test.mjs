import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMascotController, MASCOT_CLOSE_DELAY_MS, MASCOT_COOLDOWN_MS } from '../src/lib/mascot-controller.js';

function fixture() {
	let time = 0;
	let nextId = 0;
	let closes = 0;
	const timers = new Map();
	const states = [];
	const replies = [];
	const controller = createMascotController({
		now: () => time,
		schedule: (callback, delay) => {
			const id = ++nextId;
			timers.set(id, { at: time + delay, callback });
			return id;
		},
		cancel: (id) => timers.delete(id),
		onState: (state) => states.push(state),
		onReply: (text) => replies.push(text),
		onClose: () => closes++,
	});
	return {
		controller,
		timers,
		states,
		replies,
		get closes() {
			return closes;
		},
		advance(ms, throttled = false) {
			const target = time + ms;
			while (true) {
				const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
				if (!next || next[1].at > target) break;
				time = throttled ? target : next[1].at;
				timers.delete(next[0]);
				next[1].callback();
			}
			time = target;
		},
	};
}

test('each poke replies, with precise 4 / 7 / 10 expression thresholds', () => {
	const f = fixture();
	for (let click = 1; click <= 10; click++) {
		f.controller.click();
		assert.equal(f.replies.length, click);
		assert.equal(
			f.controller.snapshot().mood,
			click < 4 ? 'happy' : click < 7 ? 'annoyed' : click < 10 ? 'angry' : 'furious',
		);
	}
	assert.equal(new Set(f.replies).size, 10);
	assert.deepEqual(f.controller.snapshot(), { clicks: 10, mood: 'furious', phase: 'countdown', secondsRemaining: 8 });
	assert.equal(f.closes, 0);
	assert.equal(f.timers.size, 1);
});

test('30 seconds of inactivity resets patience, measured from the latest poke', () => {
	const f = fixture();
	for (let i = 0; i < 7; i++) f.controller.click();
	f.advance(MASCOT_COOLDOWN_MS - 1);
	assert.equal(f.controller.snapshot().mood, 'angry');
	f.controller.click();
	f.advance(1);
	assert.equal(f.controller.snapshot().clicks, 8);
	f.advance(MASCOT_COOLDOWN_MS - 1);
	assert.equal(f.controller.snapshot().clicks, 0);
	assert.equal(f.controller.snapshot().mood, 'happy');
	assert.equal(f.timers.size, 0);
});

test('furious countdown closes once at its original deadline despite repeated clicks', () => {
	const f = fixture();
	for (let i = 0; i < 10; i++) f.controller.click();
	f.advance(3000);
	assert.equal(f.controller.snapshot().secondsRemaining, 5);
	for (let i = 0; i < 100; i++) f.controller.click();
	assert.equal(f.replies.length, 110);
	assert.equal(f.controller.snapshot().clicks, 10);
	assert.equal(f.timers.size, 1);
	f.advance(MASCOT_CLOSE_DELAY_MS - 3001);
	assert.equal(f.closes, 0);
	f.advance(1);
	assert.equal(f.closes, 1);
	assert.equal(f.controller.snapshot().phase, 'closed');
	f.controller.click();
	f.advance(60_000);
	assert.equal(f.closes, 1);
	assert.equal(f.timers.size, 0);
});

test('background timer throttling uses elapsed time rather than extending the countdown', () => {
	const f = fixture();
	for (let i = 0; i < 10; i++) f.controller.click();
	f.advance(25_000, true);
	assert.equal(f.closes, 1);
	assert.equal(f.controller.snapshot().secondsRemaining, 0);
});

test('making peace cancels closure and allows a fresh greeting', () => {
	const f = fixture();
	for (let i = 0; i < 10; i++) f.controller.click();
	f.advance(7000);
	f.controller.reset();
	f.advance(60_000);
	assert.equal(f.closes, 0);
	f.controller.click();
	assert.equal(f.controller.snapshot().clicks, 1);
	assert.equal(f.replies.at(-1), f.replies[0]);
});

test('closed fallback can reopen without an old timer closing it again', () => {
	const f = fixture();
	for (let i = 0; i < 10; i++) f.controller.click();
	f.advance(MASCOT_CLOSE_DELAY_MS);
	f.controller.reset();
	f.controller.click();
	f.advance(MASCOT_COOLDOWN_MS);
	assert.equal(f.closes, 1);
	assert.equal(f.controller.snapshot().mood, 'happy');
});

test('unmount cancels every timer and makes later input inert', () => {
	for (const clicks of [4, 10]) {
		const f = fixture();
		for (let i = 0; i < clicks; i++) f.controller.click();
		const before = f.controller.snapshot();
		const replies = f.replies.length;
		f.controller.dispose();
		f.controller.reset();
		f.controller.click();
		f.advance(60_000);
		assert.deepEqual(f.controller.snapshot(), before);
		assert.equal(f.replies.length, replies);
		assert.equal(f.closes, 0);
		assert.equal(f.timers.size, 0);
	}
});

test('emitted snapshots cannot mutate internal state', () => {
	const f = fixture();
	f.controller.click();
	f.states[0].clicks = 999;
	assert.equal(f.controller.snapshot().clicks, 1);
});

test('a refreshed page restores the original deadline rather than granting eight more seconds', () => {
	const f = fixture();
	f.advance(4000);
	f.controller.restoreCountdown(8000);
	assert.equal(f.controller.snapshot().mood, 'furious');
	assert.equal(f.controller.snapshot().secondsRemaining, 4);
	f.advance(4000);
	assert.equal(f.closes, 1);
});

test('the persistence hook runs exactly once on the first furious poke', () => {
	const deadlines = [];
	const f = createMascotController({ now: () => 1000, onFury: (value) => deadlines.push(value) });
	for (let i = 0; i < 20; i++) f.click();
	assert.deepEqual(deadlines, [9000]);
	f.dispose();
});
