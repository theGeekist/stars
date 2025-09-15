import { ensureCancelButton, $ } from "./dom.js";

const running = new Map();

export function setRunning(task, pid, cancellable = true) {
	const btn = document.querySelector(`[data-task="${task}"]`);
	if (!btn) return;
	btn.disabled = true;
	btn.dataset.pid = String(pid);
	btn.textContent = `${task} (running…)`;
	const cancelBtn = ensureCancelButton(btn);
	if (cancellable) {
		cancelBtn.style.display = "inline-block";
		cancelBtn.onclick = async () => {
			try {
				$("status").textContent = `Canceling ${task} (pid ${pid})...`;
				const r = await fetch(`/run/cancel/${pid}`, { method: "POST" });
				if (!r.ok) {
					const j = await r.json().catch(() => ({}));
					throw new Error(j.error || r.statusText);
				}
				$("status").textContent = `Sent cancel for ${task} (pid ${pid})`;
			} catch (e) {
				$("status").textContent = `Cancel error: ${e.message}`;
			}
		};
	} else {
		cancelBtn.style.display = "none";
		cancelBtn.onclick = null;
	}
	running.set(pid, { task, btn, cancelBtn });
}

export function clearRunning(pid, { code } = { code: undefined }) {
	const info = running.get(pid);
	if (!info) return;
	const { task, btn, cancelBtn } = info;
	btn.disabled = false;
	btn.textContent = task;
	btn.removeAttribute("data-pid");
	if (cancelBtn) cancelBtn.style.display = "none";
	running.delete(pid);
	if (code !== undefined)
		$("status").textContent = `${task} finished (pid ${pid}, code ${code})`;
}

window.__setRunning = setRunning;
