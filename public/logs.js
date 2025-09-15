import { $ } from "./dom.js";

export function initLogs() {
	const logEl = $("log");
	const MAX = 1000;
	const state = { pending: [], flushing: false, lineCount: 0 };

	function appendLines(lines) {
		if (!lines.length) return;
		state.pending.push(...lines);
		if (state.flushing) return;
		state.flushing = true;
		requestAnimationFrame(() => {
			const frag = document.createDocumentFragment();
			for (const l of state.pending) {
				const node = document.createTextNode(l + "\n");
				frag.appendChild(node);
				state.lineCount++;
			}
			state.pending.length = 0;
			logEl.appendChild(frag);
			while (state.lineCount > MAX && logEl.firstChild) {
				logEl.removeChild(logEl.firstChild);
				state.lineCount--;
			}
			logEl.scrollTop = logEl.scrollHeight;
			state.flushing = false;
		});
	}

	function clear() {
		while (logEl.firstChild) logEl.removeChild(logEl.firstChild);
		state.lineCount = 0;
	}

	function connect(onLine) {
		try {
			const es = new EventSource("/logs");
			es.onmessage = (ev) => {
				const text = ev.data || "";
				appendLines([text]);
				onLine?.(text);
			};
		} catch (e) {
			console.error("SSE not available", e);
		}
	}

	return { appendLines, clear, connect };
}
