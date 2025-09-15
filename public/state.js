import { $ } from "./dom.js";

const running = new Map();

export function setRunning(task, pid, _cancellable = true) {
	const btn = document.querySelector(`[data-task="${task}"]`);
	if (!btn) return;
	btn.classList.add("is-running");
	btn.dataset.pid = String(pid);
	running.set(pid, { task, btn });
}

export function clearRunning(pid, { code } = { code: undefined }) {
	const info = running.get(pid);
	if (!info) return;
	const { task, btn } = info;
	btn.classList.remove("is-running");
	btn.removeAttribute("data-pid");
	running.delete(pid);
	if (code !== undefined)
		$("status").textContent = `${task} finished (code ${code})`;
}

window.__setRunning = setRunning;
