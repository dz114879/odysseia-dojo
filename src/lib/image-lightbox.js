const EXCLUDED_ANCESTOR = 'a, [data-d-meow-ui], [data-dojo-ui], [data-no-lightbox]';
const MIN_ZOOMABLE_DIMENSION = 48;

/** @param {HTMLImageElement} image */
export function isZoomableImage(image) {
	if (!image || image.tagName !== 'IMG') return false;
	if (!image.getAttribute('src')?.trim()) return false;
	if (image.hasAttribute('data-no-lightbox') || image.closest(EXCLUDED_ANCESTOR)) return false;
	const widthAttr = Number.parseInt(image.getAttribute('width') ?? '', 10);
	const heightAttr = Number.parseInt(image.getAttribute('height') ?? '', 10);
	const width = image.naturalWidth || (Number.isFinite(widthAttr) ? widthAttr : 0);
	const height = image.naturalHeight || (Number.isFinite(heightAttr) ? heightAttr : 0);
	if (width > 0 && height > 0 && width < MIN_ZOOMABLE_DIMENSION && height < MIN_ZOOMABLE_DIMENSION) {
		return false;
	}
	return true;
}

/** @param {Document} document @param {string} tag @param {string} className @param {string} [text] */
function makeNode(document, tag, className, text) {
	const element = document.createElement(tag);
	if (className) element.className = className;
	if (text !== undefined) element.textContent = text;
	return element;
}

/**
 * Click-to-zoom lightbox for tutorial screenshots inside `.sl-markdown-content`.
 * Pure DOM implementation so it works identically in browsers and `linkedom` tests.
 * @param {Document} document
 * @param {{ rootSelector?: string }} [options]
 */
export function mountImageLightbox(document, { rootSelector = '.sl-markdown-content' } = {}) {
	const root = document.querySelector(rootSelector);
	if (!root) return () => {};

	const images = [...root.querySelectorAll('img')].filter(isZoomableImage);
	if (images.length === 0) return () => {};

	const events = new AbortController();
	const { signal } = events;
	/** @type {Map<HTMLImageElement, { tabindex: string | null, role: string | null, ariaLabel: string | null }>} */
	const savedAttributes = new Map();

	/** @type {HTMLDialogElement | null} */
	let dialog = null;
	/** @type {HTMLImageElement | null} */
	let stageImage = null;
	/** @type {HTMLElement | null} */
	let caption = null;
	/** @type {HTMLElement | null} */
	let counter = null;
	/** @type {HTMLButtonElement | null} */
	let zoomButton = null;
	/** @type {HTMLButtonElement | null} */
	let prevButton = null;
	/** @type {HTMLButtonElement | null} */
	let nextButton = null;
	/** @type {HTMLImageElement | null} */
	let activeTrigger = null;
	let currentIndex = -1;
	let zoomed = false;

	function setZoom(next) {
		zoomed = next;
		if (!dialog || !zoomButton) return;
		dialog.dataset.zoomed = String(zoomed);
		zoomButton.setAttribute('aria-pressed', String(zoomed));
		zoomButton.textContent = zoomed ? '适应屏幕' : '实际尺寸';
	}

	function renderCurrent() {
		const source = images[currentIndex];
		if (!source || !dialog || !stageImage || !caption || !counter || !prevButton || !nextButton) return;
		const alt = source.getAttribute('alt')?.trim() ?? '';
		stageImage.src = source.currentSrc || source.getAttribute('src') || '';
		stageImage.alt = alt;
		caption.textContent = alt;
		caption.hidden = !alt;
		const multiple = images.length > 1;
		counter.hidden = !multiple;
		counter.textContent = multiple ? `${currentIndex + 1} / ${images.length}` : '';
		prevButton.hidden = !multiple;
		nextButton.hidden = !multiple;
		setZoom(false);
	}

	function step(delta) {
		if (images.length <= 1 || currentIndex < 0) return;
		currentIndex = (currentIndex + delta + images.length) % images.length;
		activeTrigger = images[currentIndex];
		renderCurrent();
	}

	function cleanupOpenState() {
		delete document.documentElement.dataset.dojoLightbox;
		const returnTarget = activeTrigger;
		currentIndex = -1;
		activeTrigger = null;
		setZoom(false);
		if (returnTarget?.isConnected && typeof returnTarget.focus === 'function') {
			try {
				returnTarget.focus({ preventScroll: true });
			} catch {
				returnTarget.focus();
			}
		}
	}

	function closeDialog() {
		if (!dialog) return;
		if (typeof dialog.close === 'function' && dialog.open) {
			dialog.close();
		} else if (dialog.hasAttribute('open')) {
			dialog.removeAttribute('open');
			cleanupOpenState();
		}
	}

	function ensureDialog() {
		if (dialog?.isConnected) return dialog;
		const nextDialog = /** @type {HTMLDialogElement} */ (makeNode(document, 'dialog', 'dojo-lightbox'));
		nextDialog.dataset.dojoUi = '';
		nextDialog.dataset.dMeowUi = '';
		nextDialog.setAttribute('aria-label', '图片预览');

		const frame = makeNode(document, 'div', 'dojo-lightbox-frame');
		const toolbar = makeNode(document, 'div', 'dojo-lightbox-toolbar');
		const nextCounter = makeNode(document, 'span', 'dojo-lightbox-counter');
		nextCounter.hidden = true;
		const actions = makeNode(document, 'div', 'dojo-lightbox-actions');

		const nextZoomButton = /** @type {HTMLButtonElement} */ (
			makeNode(document, 'button', 'dojo-lightbox-btn', '实际尺寸')
		);
		nextZoomButton.type = 'button';
		nextZoomButton.dataset.lightboxZoom = '';
		nextZoomButton.setAttribute('aria-pressed', 'false');
		nextZoomButton.addEventListener('click', () => setZoom(!zoomed), { signal });

		const closeButton = /** @type {HTMLButtonElement} */ (
			makeNode(document, 'button', 'dojo-lightbox-btn dojo-lightbox-close', '关闭')
		);
		closeButton.type = 'button';
		closeButton.dataset.lightboxClose = '';
		closeButton.setAttribute('aria-label', '关闭图片预览');
		closeButton.addEventListener('click', closeDialog, { signal });

		actions.appendChild(nextZoomButton);
		actions.appendChild(closeButton);
		toolbar.appendChild(nextCounter);
		toolbar.appendChild(actions);

		const stage = makeNode(document, 'div', 'dojo-lightbox-stage');
		const nextPrev = /** @type {HTMLButtonElement} */ (
			makeNode(document, 'button', 'dojo-lightbox-nav dojo-lightbox-prev', '‹')
		);
		nextPrev.type = 'button';
		nextPrev.dataset.lightboxPrev = '';
		nextPrev.setAttribute('aria-label', '上一张图片');
		nextPrev.addEventListener('click', () => step(-1), { signal });

		const canvas = makeNode(document, 'div', 'dojo-lightbox-canvas');
		const nextStageImage = /** @type {HTMLImageElement} */ (makeNode(document, 'img', 'dojo-lightbox-image'));
		nextStageImage.draggable = false;
		nextStageImage.addEventListener('click', () => setZoom(!zoomed), { signal });
		canvas.appendChild(nextStageImage);

		const nextNext = /** @type {HTMLButtonElement} */ (
			makeNode(document, 'button', 'dojo-lightbox-nav dojo-lightbox-next', '›')
		);
		nextNext.type = 'button';
		nextNext.dataset.lightboxNext = '';
		nextNext.setAttribute('aria-label', '下一张图片');
		nextNext.addEventListener('click', () => step(1), { signal });

		stage.appendChild(nextPrev);
		stage.appendChild(canvas);
		stage.appendChild(nextNext);

		const nextCaption = makeNode(document, 'p', 'dojo-lightbox-caption');
		nextCaption.hidden = true;

		frame.appendChild(toolbar);
		frame.appendChild(stage);
		frame.appendChild(nextCaption);
		nextDialog.appendChild(frame);

		nextDialog.addEventListener(
			'click',
			(event) => {
				if (event.target === nextDialog) closeDialog();
			},
			{ signal },
		);
		nextDialog.addEventListener(
			'keydown',
			(event) => {
				if (event.key === 'Escape') {
					event.preventDefault();
					closeDialog();
				} else if (event.key === 'ArrowLeft') {
					event.preventDefault();
					step(-1);
				} else if (event.key === 'ArrowRight') {
					event.preventDefault();
					step(1);
				}
			},
			{ signal },
		);
		nextDialog.addEventListener('close', cleanupOpenState, { signal });

		document.body.appendChild(nextDialog);
		dialog = nextDialog;
		stageImage = nextStageImage;
		caption = nextCaption;
		counter = nextCounter;
		zoomButton = nextZoomButton;
		prevButton = nextPrev;
		nextButton = nextNext;
		return nextDialog;
	}

	function openAt(index) {
		const targetDialog = ensureDialog();
		currentIndex = index;
		activeTrigger = images[index];
		renderCurrent();
		document.documentElement.dataset.dojoLightbox = 'true';
		if (typeof targetDialog.showModal === 'function') {
			if (!targetDialog.open) targetDialog.showModal();
		} else {
			targetDialog.setAttribute('open', '');
		}
	}

	images.forEach((image, index) => {
		savedAttributes.set(image, {
			tabindex: image.getAttribute('tabindex'),
			role: image.getAttribute('role'),
			ariaLabel: image.getAttribute('aria-label'),
		});
		const alt = image.getAttribute('alt')?.trim();
		image.dataset.dojoZoomable = 'true';
		image.setAttribute('tabindex', '0');
		image.setAttribute('role', 'button');
		image.setAttribute('aria-label', alt ? `放大查看图片：${alt}` : '放大查看图片');
		image.addEventListener('click', () => openAt(index), { signal });
		image.addEventListener(
			'keydown',
			(event) => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					openAt(index);
				}
			},
			{ signal },
		);
	});

	return () => {
		events.abort();
		delete document.documentElement.dataset.dojoLightbox;
		dialog?.remove();
		dialog = null;
		stageImage = null;
		caption = null;
		counter = null;
		zoomButton = null;
		prevButton = null;
		nextButton = null;
		activeTrigger = null;
		for (const [image, previous] of savedAttributes) {
			delete image.dataset.dojoZoomable;
			if (previous.tabindex === null) image.removeAttribute('tabindex');
			else image.setAttribute('tabindex', previous.tabindex);
			if (previous.role === null) image.removeAttribute('role');
			else image.setAttribute('role', previous.role);
			if (previous.ariaLabel === null) image.removeAttribute('aria-label');
			else image.setAttribute('aria-label', previous.ariaLabel);
		}
		savedAttributes.clear();
	};
}
