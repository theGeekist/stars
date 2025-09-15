import { $ } from "./dom.js";
import { fetchJSON, updateCardValue, updateNumberEl, fmt } from "./util.js";

export async function refreshDashboard(dir) {
	try {
		const d = await fetchJSON(`/dashboard?dir=${encodeURIComponent(dir)}`);
		updateCardValue("jsonLists", d.json.lists);
		updateCardValue("jsonRepos", d.json.repos);
		updateCardValue("jsonUnlisted", d.json.unlisted);
		updateCardValue("dbLists", d.db.lists);
		updateCardValue("dbRepos", d.db.repos);
		updateCardValue("dbSumm", d.db.summarised);
		updateCardValue("dbScored", d.db.scored);
		const pills = $("perListPills");
		const existing = new Map(
			Array.from(pills.children).map((el) => [el.dataset.slug, el]),
		);
		const seen = new Set();
		for (const row of d.db.perList) {
			seen.add(row.slug);
			let pill = existing.get(row.slug);
			if (!pill) {
				pill = document.createElement("span");
				pill.className =
					"inline-block border border-slate-400/30 rounded px-2 py-1 text-sm bg-black/5 dark:bg-white/5 mr-1 mb-1";
				pill.title = row.slug;
				pill.dataset.slug = row.slug;
				pill.setAttribute("data-flash-container", "");
				const name = document.createElement("span");
				name.className = "opacity-85";
				name.textContent = row.name + " ";
				const open = document.createElement("span");
				open.className = "opacity-85 tabular-nums";
				open.textContent = "(";
				const count = document.createElement("span");
				count.className = "opacity-85 tabular-nums";
				count.setAttribute("data-count", "");
				count.dataset.value = String(row.repos);
				count.textContent = fmt(row.repos);
				const close = document.createElement("span");
				close.className = "opacity-85 tabular-nums";
				close.textContent = ")";
				pill.append(name, open, count, close);
				pills.append(pill);
			} else {
				const count = pill.querySelector("[data-count]");
				updateNumberEl(count, row.repos);
			}
		}
		// Remove pills that no longer exist
		for (const [slug, el] of existing) {
			if (!seen.has(slug)) el.remove();
		}
	} catch (e) {
		console.error(e);
	}
}
