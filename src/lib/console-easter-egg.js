export const CONSOLE_SPLASH_TEXTS = [
	'As seen on NAOLEI!',
	'As seen on LEINAO!',
	'May contain nuts!',
	'May contain nailong!',
	'Easter egg!',
	'More than 500 nailongs!',
	'Made in NAOLEI!',
	'Uses Astro!',
	'Uses Starlight!',
	'Keyboard compatible!',
	'Not on steam!',
	'Not on gog!',
	'Not on Xbox!',
	'Not on PS5!',
	'90% bug free!',
	'Fat free!',
	'Sugar free!',
	'Memes free!',
	'Now in 3D!',
	'Play him off, keyboard cat!',
	'Not linear!',
	'umop-apisdn!',
	'Also try Terraria!',
	'Should not be played while driving!',
	'Music by Gunmu!',
	'Art by Gunmu!',
	'Cheat code 5952545F4543494E!',
];

const DEFAULT_BADGE_STYLE =
	'background:#292925;color:#faf8f4;padding:3px 9px;border-radius:99px;font-weight:600;letter-spacing:0.06em;';
const DEFAULT_SPLASH_STYLE =
	'color:#ffff55;font-size:22px;font-weight:800;line-height:1.4;text-shadow:2px 2px 0 #3f3f00,-1px -1px 0 #3f3f00,1px -1px 0 #3f3f00,-1px 1px 0 #3f3f00;';

const D_MEOW_BADGE_STYLE =
	'background:#15384f;color:#eef6fc;padding:3px 9px;border-radius:99px;font-weight:600;letter-spacing:0.06em;';
const D_MEOW_TITLE_STYLE = 'color:#1c4b6c;font-weight:700;font-size:13px;';
const D_MEOW_BODY_STYLE = 'color:#294c65;font-size:12px;line-height:1.7;';

/**
 * @param {() => number} [random]
 */
export function pickConsoleSplash(random = Math.random) {
	const value = Number(random());
	const clamped = Number.isFinite(value) ? Math.min(0.999999999, Math.max(0, value)) : 0;
	const index = Math.floor(clamped * CONSOLE_SPLASH_TEXTS.length);
	return CONSOLE_SPLASH_TEXTS[index];
}

/**
 * Pure presentation banner for DevTools visitors. Never touches auth, storage, or network state.
 * @param {{ console?: Partial<Console>, theme?: 'default' | 'd-meow', random?: () => number }} [options]
 */
export function printConsoleEasterEgg({
	console: target = globalThis.console,
	theme = 'default',
	random = Math.random,
} = {}) {
	if (!target || typeof target.log !== 'function') return false;

	if (theme === 'd-meow') {
		target.log(
			'%cSIGNAL D · 旅程 ΟΡΙΖΟΝΤΑΣ%c  Nice try，这里已经是旅程的形状了。',
			D_MEOW_BADGE_STYLE,
			D_MEOW_TITLE_STYLE,
		);
		target.log(
			'%c（注：这只是纯前端整活皮肤，不会改变任何访问权限；在非输入区再盲打一次暗号就能恢复原样。）',
			D_MEOW_BODY_STYLE,
		);
		return true;
	}

	target.log('%c类脑 ODYSSEIA · 道馆教程', DEFAULT_BADGE_STYLE);
	target.log(`%c${pickConsoleSplash(random)}`, DEFAULT_SPLASH_STYLE);
	return true;
}

/**
 * Deduplicates console banners across repeated lifecycle callbacks while still reacting to theme switches.
 * @param {{ console?: Partial<Console>, random?: () => number }} [options]
 */
export function createConsoleEasterEggController({ console: target = globalThis.console, random = Math.random } = {}) {
	/** @type {'default' | 'd-meow' | null} */
	let lastTheme = null;
	return {
		/** @param {'default' | 'd-meow'} [theme] */
		announce(theme = 'default') {
			const normalized = theme === 'd-meow' ? 'd-meow' : 'default';
			if (normalized === lastTheme) return false;
			if (!printConsoleEasterEgg({ console: target, theme: normalized, random })) return false;
			lastTheme = normalized;
			return true;
		},
		reset() {
			lastTheme = null;
		},
	};
}
