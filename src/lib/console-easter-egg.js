export const CONSOLE_EASTER_EGG_REPO = 'https://github.com/dz114879/odysseia-dojo';

const DEFAULT_BADGE_STYLE =
	'background:#292925;color:#faf8f4;padding:3px 9px;border-radius:99px;font-weight:600;letter-spacing:0.06em;';
const DEFAULT_TITLE_STYLE = 'color:#8a6954;font-weight:700;font-size:13px;';
const DEFAULT_BODY_STYLE = 'color:#5c5d55;font-size:12px;line-height:1.7;';

const D_MEOW_BADGE_STYLE =
	'background:#15384f;color:#eef6fc;padding:3px 9px;border-radius:99px;font-weight:600;letter-spacing:0.06em;';
const D_MEOW_TITLE_STYLE = 'color:#1c4b6c;font-weight:700;font-size:13px;';
const D_MEOW_BODY_STYLE = 'color:#294c65;font-size:12px;line-height:1.7;';

/**
 * Pure presentation banner for DevTools visitors. Never touches auth, storage, or network state.
 * @param {{ console?: Partial<Console>, theme?: 'default' | 'd-meow' }} [options]
 */
export function printConsoleEasterEgg({ console: target = globalThis.console, theme = 'default' } = {}) {
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

	target.log('%c✳ 类脑 ODYSSEIA · 道馆%c  Nice try.', DEFAULT_BADGE_STYLE, DEFAULT_TITLE_STYLE);
	target.log('%c翻控制台也找不到题库答案，这里只有安静排版的 HTML 和一点小彩蛋。', DEFAULT_BODY_STYLE);

	const hints = [
		'1. 首页的类脑娘很好说话，但千万别手贱连戳她 10 下。',
		'2. 在页面空白处盲打某位写过元提示指南的 6 字母大佬名，会发生奇怪的事。',
		'3. 教程免费分享；如果是在闲鱼 / 淘宝花钱买来的，记得去申请退款。',
		`4. 本站程序开源在这里：${CONSOLE_EASTER_EGG_REPO}`,
	];

	if (typeof target.groupCollapsed === 'function' && typeof target.groupEnd === 'function') {
		target.groupCollapsed('%c▸ 既然都按了 F12……（点开看看）', DEFAULT_TITLE_STYLE);
		for (const hint of hints) target.log(`%c${hint}`, DEFAULT_BODY_STYLE);
		target.groupEnd();
	} else {
		for (const hint of hints) target.log(`%c${hint}`, DEFAULT_BODY_STYLE);
	}
	return true;
}

/**
 * Deduplicates console banners across repeated lifecycle callbacks while still reacting to theme switches.
 * @param {{ console?: Partial<Console> }} [options]
 */
export function createConsoleEasterEggController({ console: target = globalThis.console } = {}) {
	/** @type {'default' | 'd-meow' | null} */
	let lastTheme = null;
	return {
		/** @param {'default' | 'd-meow'} [theme] */
		announce(theme = 'default') {
			const normalized = theme === 'd-meow' ? 'd-meow' : 'default';
			if (normalized === lastTheme) return false;
			if (!printConsoleEasterEgg({ console: target, theme: normalized })) return false;
			lastTheme = normalized;
			return true;
		},
		reset() {
			lastTheme = null;
		},
	};
}
