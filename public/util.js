const numberFmt = new Intl.NumberFormat();
export function fmt(n) {
	return numberFmt.format(n ?? 0);
}

const anims = new Map();
export function animateNumber(el, from, to, duration = 500) {
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
	const container = el.closest("[data-flash-container]") || el;
	const bgFlashClass = diff > 0 ? "flash-bg-inc" : "flash-bg-dec";
	// Trigger a subtle background flash on the container
	container.classList.remove("flash-bg-inc", "flash-bg-dec");
	// Force reflow to restart animation if same class is applied quickly
	void container.offsetWidth;
	container.classList.add(bgFlashClass);
	function step(now) {
		const t = Math.min(1, (now - start) / duration);
		const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
		const val = Math.round(from + diff * eased);
		el.textContent = fmt(val);
		if (t < 1) {
			const id = requestAnimationFrame(step);
			anims.set(key, id);
		} else {
			el.textContent = fmt(to);
			el.dataset.value = String(to);
			setTimeout(() => container.classList.remove(bgFlashClass), 350);
			anims.delete(key);
		}
	}
	const id = requestAnimationFrame(step);
	anims.set(key, id);
}

export function updateCardValue(id, newVal) {
	const el = document.getElementById(id);
	const prev = Number(el?.dataset?.value || NaN);
	if (!el) return;
	if (Number.isNaN(prev)) {
		el.textContent = fmt(newVal);
		el.dataset.value = String(newVal);
	} else {
		animateNumber(el, prev, newVal);
	}
}

// Update a provided element that holds only a number string, with subtle flash
export function updateNumberEl(el, newVal) {
	if (!el) return;
	const prev = Number(el?.dataset?.value || NaN);
	if (Number.isNaN(prev)) {
		el.textContent = fmt(newVal);
		el.dataset.value = String(newVal);
	} else {
		animateNumber(el, prev, newVal);
	}
}

export async function fetchJSON(url) {
	const r = await fetch(url);
	if (!r.ok) throw new Error(await r.text());
	return r.json();
}
