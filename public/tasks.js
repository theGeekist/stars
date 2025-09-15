import { $ } from "./dom.js";

export async function runTask(task, getDir) {
	const dir = encodeURIComponent(getDir());
	// No current tasks require a directory parameter
	const withDir = [].includes(task);
	const url = withDir ? `/run/${task}?dir=${dir}` : `/run/${task}`;
	$("status").textContent = `Starting ${task}...`;
	try {
		const r = await fetch(url, { method: "POST" });
		const j = await r.json();
		if (!r.ok || !j.ok) throw new Error(j.error || r.statusText);
		$("status").textContent = `Started ${task}`;
		if (j.pid && window.__setRunning)
			window.__setRunning(task, j.pid, !!j.cancellable);
	} catch (e) {
		$("status").textContent = `Error: ${e.message}`;
	}
}

export function wireActions(getDir, appendLogLine) {
	$("saveDir").addEventListener("click", () => {
		localStorage.setItem("exportsDir", getDir());
	});
	document.querySelectorAll("[data-task]").forEach((btn) => {
		btn.addEventListener("click", async () => {
			const task = btn.dataset.task;
			const pid = btn.dataset.pid;
			if (pid) {
				try {
					$("status").textContent = `Canceling ${task} (pid ${pid})...`;
					const r = await fetch(`/run/cancel/${pid}`, { method: "POST" });
					if (!r.ok) {
						const j = await r.json().catch(() => ({}));
						throw new Error(j.error || r.statusText);
					}
					$("status").textContent = `Cancel sent for ${task}`;
				} catch (e) {
					$("status").textContent = `Cancel error: ${e.message}`;
				}
				return;
			}
			appendLogLine(`--- run ${task} @ ${new Date().toISOString()} ---`);
			runTask(task, getDir);
		});
	});
}
