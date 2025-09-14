const $ = (id) => document.getElementById(id);

const DIR_KEY = "exportsDir";
function getDir() {
	return $("dir").value.trim() || "./exports";
}
function setDir(v) {
	$("dir").value = v;
}

const numberFmt = new Intl.NumberFormat();
function fmt(n) {
	return numberFmt.format(n ?? 0);
}

const anims = new Map();
function animateNumber(el, from, to, duration = 500) {
	if (!Number.isFinite(from)) from = to;
	if (from === to) {
		el.textContent = fmt(to);
		el.dataset.value = String(to);
		return;
	}
	const key = el.id || Math.random().toString(36);
	if (anims.has(key)) cancelAnimationFrame(anims.get(key));
	const start = performance.now();
	const diff = to - from;
	const flashClass = diff > 0 ? "flash-up" : "flash-down";
	el.classList.add(flashClass);
	function step(now) {
		const t = Math.min(1, (now - start) / duration);
		const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // easeInOutQuad
		const val = Math.round(from + diff * eased);
		el.textContent = fmt(val);
		if (t < 1) {
			const id = requestAnimationFrame(step);
			anims.set(key, id);
		} else {
			el.textContent = fmt(to);
			el.dataset.value = String(to);
			setTimeout(() => el.classList.remove(flashClass), 350);
			anims.delete(key);
		}
	}
	const id = requestAnimationFrame(step);
	anims.set(key, id);
}

function updateCardValue(id, newVal) {
	const el = $(id);
	const prev = Number(el?.dataset?.value || NaN);
	if (!el) return;
	if (Number.isNaN(prev)) {
		el.textContent = fmt(newVal);
		el.dataset.value = String(newVal);
	} else {
		animateNumber(el, prev, newVal);
	}
}

async function fetchJSON(url) {
	const r = await fetch(url);
	if (!r.ok) throw new Error(await r.text());
	return r.json();
}

async function refresh() {
	const dir = encodeURIComponent(getDir());
	try {
		const d = await fetchJSON(`/dashboard?dir=${dir}`);
		updateCardValue("jsonLists", d.json.lists);
		updateCardValue("jsonRepos", d.json.repos);
		updateCardValue("jsonUnlisted", d.json.unlisted);
		updateCardValue("dbLists", d.db.lists);
		updateCardValue("dbRepos", d.db.repos);
		updateCardValue("dbSumm", d.db.summarised);
		updateCardValue("dbScored", d.db.scored);
		const pills = $("perListPills");
		pills.innerHTML = "";
		for (const row of d.db.perList) {
			const span = document.createElement("span");
			span.className = "pill";
			span.title = row.slug;
			span.dataset.slug = row.slug;
			span.innerHTML = `<span class="pill-name">${row.name}</span> <span class="pill-count">(${fmt(row.repos)})</span>`;
			pills.append(span);
		}
	} catch (e) {
		console.error(e);
	}
}

async function runTask(task) {
	const dir = encodeURIComponent(getDir());
	const withDir = ["unlisted", "lists", "ingest"].includes(task);
	const url = withDir ? `/run/${task}?dir=${dir}` : `/run/${task}`;
	$("status").textContent = `Starting ${task}...`;
	try {
		const r = await fetch(url, { method: "POST" });
		const j = await r.json();
		if (!r.ok || !j.ok) throw new Error(j.error || r.statusText);
		$("status").textContent = `Started ${task} (pid ${j.pid})`;
	} catch (e) {
		$("status").textContent = `Error: ${e.message}`;
	}
}

function init() {
	const saved = localStorage.getItem(DIR_KEY) || "./exports";
	setDir(saved);
	// Logs SSE setup
	const logEl = $("log");
	const MAX = 1000;
	const state = { lines: [] };
	try {
		const es = new EventSource("/logs");
		es.onmessage = (ev) => {
			const text = ev.data || "";
			state.lines.push(text);
			if (state.lines.length > MAX)
				state.lines.splice(0, state.lines.length - MAX);
			logEl.textContent = state.lines.join("\n");
			logEl.scrollTop = logEl.scrollHeight;
		};
	} catch (e) {
		console.error("SSE not available", e);
	}
	const clearBtn = $("clearLog");
	if (clearBtn) {
		clearBtn.addEventListener("click", () => {
			state.lines = [];
			logEl.textContent = "";
		});
	}
	$("saveDir").addEventListener("click", () => {
		localStorage.setItem(DIR_KEY, getDir());
		refresh();
	});
	document.querySelectorAll("[data-task]").forEach((btn) => {
		btn.addEventListener("click", () => {
			const task = btn.dataset.task;
			state.lines.push(`--- run ${task} @ ${new Date().toISOString()} ---`);
			if (state.lines.length > MAX)
				state.lines.splice(0, state.lines.length - MAX);
			logEl.textContent = state.lines.join("\n");
			logEl.scrollTop = logEl.scrollHeight;
			runTask(task);
		});
	});
	refresh();
	setInterval(refresh, 2000);
}

init();
