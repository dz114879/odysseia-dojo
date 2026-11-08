import { createMascotController } from './mascot-controller.js';
import { cancelPendingClosure, readBrowserClosure, scheduleBrowserClosure } from './site-closure-client';
import { SITE_CLOSURE_PATH } from './site-closure.js';

const captions = {
	happy: '慢慢看，我在这里。',
	annoyed: '好好看书，不许捣乱。',
	angry: '类脑娘的耐心快用完了。',
	furious: '哼！今天就到这里！',
};

export function mountMascot(root: HTMLElement) {
	const button = root.querySelector<HTMLButtonElement>('[data-mascot-button]');
	const words = root.querySelector<HTMLElement>('[data-mascot-words]');
	const live = root.querySelector<HTMLElement>('[data-mascot-live]');
	const caption = root.querySelector<HTMLElement>('[data-mascot-caption]');
	const countdown = root.querySelector<HTMLElement>('[data-mascot-countdown]');
	const seconds = root.querySelector<HTMLElement>('[data-mascot-seconds]');
	const cancel = root.querySelector<HTMLButtonElement>('[data-mascot-cancel]');
	if (!button || !words || !live || !caption || !countdown || !seconds || !cancel) return () => {};
	if (document.documentElement.dataset.dojoTheme === 'd-meow') {
		button.disabled = true;
		return () => {};
	}

	const events = new AbortController();
	const wordTimers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
	function removeWord(word: HTMLElement) {
		clearTimeout(wordTimers.get(word));
		wordTimers.delete(word);
		word.remove();
	}
	function clearWords() {
		for (const word of wordTimers.keys()) removeWord(word);
		live!.textContent = '';
	}
	const controller = createMascotController({
		onFury: scheduleBrowserClosure,
		readClosesAt: () => readBrowserClosure()?.closesAt ?? null,
		onState(state) {
			root.dataset.mood = state.mood;
			caption.textContent = captions[state.mood];
			countdown.hidden = state.phase !== 'countdown';
			seconds.textContent = String(state.secondsRemaining);
			if (state.clicks === 0) clearWords();
		},
		onReply(text) {
			// One fresh bubble per click, without overlapping text under rapid input.
			if (wordTimers.size >= 1) removeWord(wordTimers.keys().next().value!);
			const word = document.createElement('span');
			word.className = 'mascot-word';
			word.textContent = text;
			words.appendChild(word);
			wordTimers.set(
				word,
				setTimeout(() => removeWord(word), 3200),
			);
			live.textContent = text;
		},
		onClose() {
			// Browsers normally only allow closing script-opened tabs. Never try to bypass this.
			try {
				window.close();
			} catch {
				// Sandboxed browsers may throw instead of ignoring close().
			}
			if (!window.closed) location.replace(SITE_CLOSURE_PATH);
		},
	});

	const { signal } = events;
	// Restore the original deadline; refresh must not restart or dismiss the countdown.
	controller.reset();
	const pending = readBrowserClosure();
	if (pending) controller.restoreCountdown(pending.closesAt);
	button.disabled = false;
	root.dataset.ready = 'true';
	button.addEventListener('click', () => controller.click(), { signal });
	cancel.addEventListener(
		'click',
		() => {
			if (!cancelPendingClosure()) {
				location.replace(SITE_CLOSURE_PATH);
				return;
			}
			controller.reset();
			button.focus({ preventScroll: true });
		},
		{ signal },
	);

	return () => {
		events.abort();
		controller.dispose();
		clearWords();
		button.disabled = true;
		delete root.dataset.ready;
	};
}
