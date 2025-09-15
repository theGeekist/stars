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
	const flashClass = diff > 0 ? "text-green-600" : "text-amber-500";
	el.classList.add(flashClass);
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
			setTimeout(() => el.classList.remove(flashClass), 350);
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

export async function fetchJSON(url) {
	const r = await fetch(url);
	if (!r.ok) throw new Error(await r.text());
	return r.json();
}
