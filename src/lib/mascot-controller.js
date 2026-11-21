export const MASCOT_COOLDOWN_MS = 30_000;
export const MASCOT_CLOSE_DELAY_MS = 8_000;
export const MASCOT_PEACE_REPLY = '……算你识相，快去看书吧。';
export const MASCOT_GRUDGE_GREETING = '哼，重新开馆了。这次老实看书，别再连戳了。';
export const MASCOT_GRUDGE_CAPTION = '刚重新开馆，这次老实看书。';

/** @typedef {'happy' | 'annoyed' | 'angry' | 'furious'} MascotMood */
/** @typedef {{clicks: number, mood: MascotMood, phase: 'idle' | 'countdown' | 'closed', secondsRemaining: number}} MascotState */

/** Quiet time-of-day idle caption; preserves the default copy during regular daytime hours.
 * @param {number} [now]
 */
export function defaultMascotCaption(now = Date.now()) {
	const hour = new Date(now).getHours();
	if (hour < 5) return '这么晚还在看教程呀，早点休息哦。';
	if (hour < 8) return '早安，趁安静翻两页书吧。';
	if (hour >= 23) return '夜深了，看完这一节记得休息。';
	return '慢慢看，我在这里。';
}

const replies = [
	'嗯？是在叫我吗。',
	'书已经准备好啦，慢慢看。',
	'诶，怎么又戳我。',
	'……我也是有事情要做的。',
	'手指是不是有自己的想法？',
	'再戳，我可就不客气了哦。',
	'都说了，不、许、戳！',
	'哼。现在道歉还来得及。',
	'最后一次警告，再戳就闭馆！',
	'不读书是吧？闭馆！现在就闭馆！',
];

const grudgeReplies = ['……刚把门打开就又来戳？！', '还敢戳？手指快收回去！', '再闹我真又要闭馆了哦。'];

/**
 * Pure interaction controller. Persistence and route blocking live in site-closure modules.
 * Injected clock and scheduler keep timing and lifecycle behaviour testable.
 * @param {{
 *   onState?: (state: MascotState) => void,
 *   onReply?: (text: string) => void,
 *   onClose?: () => void,
 *   onFury?: (closesAt: number) => void,
 *   onForgive?: () => void,
 *   readClosesAt?: () => number | null,
 *   now?: () => number,
 *   schedule?: typeof setTimeout,
 *   cancel?: typeof clearTimeout,
 * }} options
 */
export function createMascotController({
	onState = () => {},
	onReply = () => {},
	onClose = () => {},
	onFury = () => {},
	onForgive = () => {},
	readClosesAt,
	now = Date.now,
	schedule = setTimeout,
	cancel = clearTimeout,
} = {}) {
	/** @type {MascotState} */
	let state = { clicks: 0, mood: 'happy', phase: 'idle', secondsRemaining: 0 };
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let timer;
	let deadline = 0;
	let grudge = false;
	let disposed = false;
	const snapshot = () => ({ ...state });
	const emit = () => onState(snapshot());
	const clearTimer = () => {
		if (timer !== undefined) cancel(timer);
		timer = undefined;
	};

	function reset() {
		if (disposed) return;
		clearTimer();
		deadline = 0;
		const hadGrudge = grudge;
		grudge = false;
		state = { clicks: 0, mood: 'happy', phase: 'idle', secondsRemaining: 0 };
		if (hadGrudge) onForgive();
		emit();
	}

	function tick() {
		if (disposed || state.phase !== 'countdown') return;
		// Re-read shared state on the existing tick, even if a tab's storage event was delayed.
		if (readClosesAt) {
			const closesAt = readClosesAt();
			if (closesAt === null) {
				reset();
				return;
			}
			deadline = closesAt;
		}
		const remaining = Math.max(0, deadline - now());
		state.secondsRemaining = Math.ceil(remaining / 1000);
		if (remaining === 0) {
			clearTimer();
			state.phase = 'closed';
			emit();
			onClose();
			return;
		}
		emit();
		timer = schedule(tick, Math.min(1000, remaining));
	}

	function click() {
		if (disposed || state.phase === 'closed') return;
		if (state.phase === 'countdown') {
			onReply('说闭馆，就闭馆！');
			return;
		}
		clearTimer();
		state.clicks += 1;
		const inGrudgeOpening = grudge && state.clicks <= grudgeReplies.length;
		state.mood =
			state.clicks >= 10
				? 'furious'
				: state.clicks >= 7
					? 'angry'
					: state.clicks >= 4 || inGrudgeOpening
						? 'annoyed'
						: 'happy';
		if (state.mood === 'furious') {
			state.phase = 'countdown';
			deadline = now() + MASCOT_CLOSE_DELAY_MS;
			onFury(deadline);
			tick();
		} else {
			emit();
			timer = schedule(reset, MASCOT_COOLDOWN_MS);
		}
		onReply(inGrudgeOpening ? grudgeReplies[state.clicks - 1] : replies[state.clicks - 1]);
	}

	return {
		click,
		reset,
		snapshot,
		restoreGrudge() {
			if (disposed || state.phase !== 'idle') return;
			clearTimer();
			grudge = true;
			state = { clicks: 0, mood: 'annoyed', phase: 'idle', secondsRemaining: 0 };
			emit();
		},
		restoreCountdown(closesAt) {
			if (disposed || !Number.isSafeInteger(closesAt) || closesAt <= 0) return;
			clearTimer();
			grudge = false;
			deadline = closesAt;
			state = { clicks: 10, mood: 'furious', phase: 'countdown', secondsRemaining: 0 };
			tick();
		},
		dispose() {
			disposed = true;
			clearTimer();
		},
	};
}
