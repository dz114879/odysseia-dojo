import { createConsoleEasterEggController } from './console-easter-egg.js';
import { D_MEOW_THEME } from './d-meow-state.js';

let started = false;

export function startConsoleEasterEgg() {
	if (started) return;
	started = true;
	const controller = createConsoleEasterEggController();
	const currentTheme = () => (document.documentElement.dataset.dojoTheme === D_MEOW_THEME ? 'd-meow' : 'default');
	const announce = () => controller.announce(currentTheme());

	announce();
	window.addEventListener('dojo:theme-change', announce);
	document.addEventListener('astro:page-load', announce);
}
