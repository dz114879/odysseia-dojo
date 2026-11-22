import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHTML } from 'linkedom';
import { isZoomableImage, mountImageLightbox } from '../src/lib/image-lightbox.js';

function fixture(markup) {
	const { document, window } = parseHTML(
		`<!doctype html><html><body><div class="sl-markdown-content">${markup}</div></body></html>`,
	);
	return { document, window };
}

test('identifies zoomable tutorial images and excludes linked, UI, opted-out and tiny icon images', () => {
	const { document } = fixture(`
		<img id="ok" src="/protected/tutorial-images/a.svg" width="800" height="450" alt="示意图">
		<a href="/docs/"><img id="linked" src="/protected/tutorial-images/b.svg" width="800" height="450" alt="带链接"></a>
		<div data-d-meow-ui><img id="dmeow" src="/mascot/d-meow-wave-1.webp" width="360" height="480" alt=""></div>
		<img id="opted-out" data-no-lightbox src="/protected/tutorial-images/c.svg" width="800" height="450" alt="禁用">
		<img id="tiny" src="/favicon.svg" width="20" height="20" alt="小图标">
	`);

	assert.equal(isZoomableImage(document.querySelector('#ok')), true);
	assert.equal(isZoomableImage(document.querySelector('#linked')), false);
	assert.equal(isZoomableImage(document.querySelector('#dmeow')), false);
	assert.equal(isZoomableImage(document.querySelector('#opted-out')), false);
	assert.equal(isZoomableImage(document.querySelector('#tiny')), false);
});

test('opens on click or keyboard, navigates multiple screenshots, toggles zoom and cleans up on dispose', () => {
	const { document, window } = fixture(`
		<p><img id="first" src="/protected/tutorial-images/one.svg" width="1200" height="700" alt="第一张设置图"></p>
		<p><img id="second" src="/protected/tutorial-images/two.svg" width="1200" height="700" alt="第二张设置图"></p>
	`);
	const first = document.querySelector('#first');
	const second = document.querySelector('#second');
	let focusedTarget = null;
	first.focus = () => {
		focusedTarget = first;
	};
	second.focus = () => {
		focusedTarget = second;
	};

	const dispose = mountImageLightbox(document);
	assert.equal(first.dataset.dojoZoomable, 'true');
	assert.equal(first.getAttribute('role'), 'button');
	assert.equal(first.getAttribute('tabindex'), '0');
	assert.equal(first.getAttribute('aria-label'), '放大查看图片：第一张设置图');

	first.dispatchEvent(new window.Event('click'));
	const dialog = document.querySelector('dialog.dojo-lightbox');
	assert.ok(dialog, 'Expected lightbox dialog to open.');
	assert.equal(dialog.hasAttribute('open'), true);
	assert.equal(document.documentElement.dataset.dojoLightbox, 'true');
	assert.equal(dialog.querySelector('.dojo-lightbox-image').getAttribute('src'), '/protected/tutorial-images/one.svg');
	assert.equal(dialog.querySelector('.dojo-lightbox-caption').textContent, '第一张设置图');
	assert.equal(dialog.querySelector('.dojo-lightbox-counter').textContent, '1 / 2');

	// Toggle 1:1 zoom
	const zoomBtn = dialog.querySelector('[data-lightbox-zoom]');
	zoomBtn.dispatchEvent(new window.Event('click'));
	assert.equal(dialog.dataset.zoomed, 'true');
	assert.equal(zoomBtn.getAttribute('aria-pressed'), 'true');

	// Navigate to next screenshot resets zoom
	dialog.querySelector('[data-lightbox-next]').dispatchEvent(new window.Event('click'));
	assert.equal(dialog.dataset.zoomed, 'false');
	assert.equal(dialog.querySelector('.dojo-lightbox-image').getAttribute('src'), '/protected/tutorial-images/two.svg');
	assert.equal(dialog.querySelector('.dojo-lightbox-counter').textContent, '2 / 2');

	// Keyboard ArrowLeft wraps back to first
	const leftEvent = new window.Event('keydown');
	leftEvent.key = 'ArrowLeft';
	dialog.dispatchEvent(leftEvent);
	assert.equal(dialog.querySelector('.dojo-lightbox-counter').textContent, '1 / 2');

	// Close restores focus and clears scroll lock
	dialog.querySelector('[data-lightbox-close]').dispatchEvent(new window.Event('click'));
	assert.equal(dialog.hasAttribute('open'), false);
	assert.equal(document.documentElement.dataset.dojoLightbox, undefined);
	assert.equal(focusedTarget, first);

	// Enter key on second image reopens directly on image 2
	const enterEvent = new window.Event('keydown');
	enterEvent.key = 'Enter';
	second.dispatchEvent(enterEvent);
	assert.equal(dialog.hasAttribute('open'), true);
	assert.equal(dialog.querySelector('.dojo-lightbox-counter').textContent, '2 / 2');

	// Dispose removes dialog and restores image attributes
	dispose();
	assert.equal(document.querySelector('dialog.dojo-lightbox'), null);
	assert.equal(document.documentElement.dataset.dojoLightbox, undefined);
	assert.equal(first.dataset.dojoZoomable, undefined);
	assert.equal(first.getAttribute('tabindex'), null);
	assert.equal(first.getAttribute('role'), null);
	assert.equal(first.getAttribute('aria-label'), null);
});
