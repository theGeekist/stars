import { $ } from "./dom.js";
import { initLogs } from "./logs.js";
import { setRunning, clearRunning } from "./state.js";
import { refreshDashboard } from "./dashboard.js";
import { wireActions } from "./tasks.js";

const DIR_KEY = "exportsDir";

function getDir() {
	return $("dir").value.trim() || "./exports";
}
function setDir(v) {
	$("dir").value = v;
}

function parseEventLine(text) {
	if (text.startsWith("[start]")) {
		const pid = Number((text.match(/pid=(\d+)/) || [])[1]);
		const task = (text.match(/task=([^\s]+)/) || [])[1];
		const inproc = text.includes("cmd=inproc");
		if (pid && task) setRunning(task, pid, !inproc);
	} else if (text.startsWith("[end]")) {
		const pid = Number((text.match(/pid=(\d+)/) || [])[1]);
		const codeStr = (text.match(/code=([^\s]+)/) || [])[1];
		const code = codeStr !== undefined ? Number(codeStr) : undefined;
		if (pid) clearRunning(pid, { code });
	} else if (text.startsWith("[end-error]")) {
		const pid = Number((text.match(/pid=(\d+)/) || [])[1]);
		if (pid) clearRunning(pid);
	} else if (text.startsWith("[cancel]")) {
		const pid = Number((text.match(/pid=(\d+)/) || [])[1]);
		if (pid) $("status").textContent = `Canceled pid ${pid}`;
	}
}

function init() {
	const saved = localStorage.getItem(DIR_KEY) || "./exports";
	setDir(saved);

	const logs = initLogs();
	logs.connect(parseEventLine);
	$("clearLog").addEventListener("click", logs.clear);

	wireActions(getDir, (line) => logs.appendLines([line]));

	(async () => {
		try {
			const r = await fetch("/run/status");
			if (r.ok) {
				const j = await r.json();
				for (const it of j.running || [])
					setRunning(it.task, it.pid, !!it.cancellable);
			}
		} catch {}
	})();

	const tick = () => refreshDashboard(getDir());
	tick();
	setInterval(tick, 2000);
}

init();
