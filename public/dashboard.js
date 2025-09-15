import { $ } from "./dom.js";
import { fetchJSON, updateCardValue, fmt } from "./util.js";

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
		pills.innerHTML = "";
		for (const row of d.db.perList) {
			const span = document.createElement("span");
			span.className =
				"inline-block border border-slate-400/30 rounded px-2 py-1 text-sm bg-black/5 dark:bg-white/5 mr-1 mb-1";
			span.title = row.slug;
			span.dataset.slug = row.slug;
			span.innerHTML = `<span class="opacity-85">${row.name}</span> <span class="opacity-85 tabular-nums">(${fmt(row.repos)})</span>`;
			pills.append(span);
		}
	} catch (e) {
		console.error(e);
	}
}
