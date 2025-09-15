import { $ } from "./dom.js";

export async function runTask(task, getDir) {
	const dir = encodeURIComponent(getDir());
	const withDir = ["unlisted", "lists", "ingest"].includes(task);
	const url = withDir ? `/run/${task}?dir=${dir}` : `/run/${task}`;
	$("status").textContent = `Starting ${task}...`;
	try {
		const r = await fetch(url, { method: "POST" });
		const j = await r.json();
		if (!r.ok || !j.ok) throw new Error(j.error || r.statusText);
		$("status").textContent = `Started ${task} (pid ${j.pid})`;
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
		btn.addEventListener("click", () => {
			const task = btn.dataset.task;
			appendLogLine(`--- run ${task} @ ${new Date().toISOString()} ---`);
			runTask(task, getDir);
		});
	});
}
