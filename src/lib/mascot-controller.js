export const MASCOT_COOLDOWN_MS = 30_000;
export const MASCOT_CLOSE_DELAY_MS = 8_000;

/** @typedef {'happy' | 'annoyed' | 'angry' | 'furious'} MascotMood */
/** @typedef {{clicks: number, mood: MascotMood, phase: 'idle' | 'countdown' | 'closed', secondsRemaining: number}} MascotState */

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

/**
 * Pure interaction controller. Persistence and route blocking live in site-closure modules.
 * Injected clock and scheduler keep timing and lifecycle behaviour testable.
 * @param {{
 *   onState?: (state: MascotState) => void,
 *   onReply?: (text: string) => void,
 *   onClose?: () => void,
 *   onFury?: (closesAt: number) => void,
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
		state = { clicks: 0, mood: 'happy', phase: 'idle', secondsRemaining: 0 };
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
		state.mood = state.clicks >= 10 ? 'furious' : state.clicks >= 7 ? 'angry' : state.clicks >= 4 ? 'annoyed' : 'happy';
		if (state.mood === 'furious') {
			state.phase = 'countdown';
			deadline = now() + MASCOT_CLOSE_DELAY_MS;
			onFury(deadline);
			tick();
		} else {
			emit();
			timer = schedule(reset, MASCOT_COOLDOWN_MS);
		}
		onReply(replies[state.clicks - 1]);
	}

	return {
		click,
		reset,
		snapshot,
		restoreCountdown(closesAt) {
			if (disposed || !Number.isSafeInteger(closesAt) || closesAt <= 0) return;
			clearTimer();
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
