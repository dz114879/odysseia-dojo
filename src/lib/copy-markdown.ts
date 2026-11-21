import { exportArticleMarkdown } from './markdown-export.js';

const RESET_MS = 2200;

async function copyText(text: string): Promise<boolean> {
	if (navigator.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			/* Fall back to execCommand when Clipboard API is unavailable or restricted. */
		}
	}

	try {
		const textarea = document.createElement('textarea');
		textarea.value = text;
		textarea.setAttribute('readonly', '');
		textarea.style.position = 'fixed';
		textarea.style.top = '-9999px';
		textarea.style.opacity = '0';
		document.body.appendChild(textarea);
		textarea.select();
		const copied = document.execCommand('copy');
		textarea.remove();
		return copied;
	} catch {
		return false;
	}
}

export function mountCopyMarkdown(root: Document = document) {
	const button = root.querySelector<HTMLButtonElement>('[data-copy-markdown]');
	const label = button?.querySelector<HTMLElement>('[data-copy-markdown-label]');
	const status = root.querySelector<HTMLElement>('[data-copy-markdown-status]');
	const content = root.querySelector('.sl-markdown-content');
	if (!button || !label || !content) return () => {};

	const defaultLabel = label.textContent?.trim() || '复制 Markdown';
	const events = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;

	function resetState() {
		clearTimeout(timer);
		timer = undefined;
		delete button!.dataset.copyState;
		label!.textContent = defaultLabel;
		if (status) status.textContent = '';
	}

	button.hidden = false;
	button.addEventListener(
		'click',
		async () => {
			clearTimeout(timer);
			const markdown = exportArticleMarkdown(root);
			if (!markdown) return;
			const ok = await copyText(markdown);
			button.dataset.copyState = ok ? 'copied' : 'error';
			label.textContent = ok ? '已复制 Markdown' : '复制失败';
			if (status) status.textContent = ok ? '已复制当前页面为 Markdown。' : '复制失败，请手动选中正文复制。';
			timer = setTimeout(resetState, RESET_MS);
		},
		{ signal: events.signal },
	);

	return () => {
		events.abort();
		resetState();
	};
}
