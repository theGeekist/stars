export function $(id) {
	return document.getElementById(id);
}

export function ensureCancelButton(btn) {
	if (
		btn.nextElementSibling &&
		btn.nextElementSibling.classList.contains("cancel-btn")
	) {
		return btn.nextElementSibling;
	}
	const cancel = document.createElement("button");
	cancel.textContent = "Cancel";
	cancel.className = "cancel-btn";
	cancel.style.display = "none";
	btn.insertAdjacentElement("afterend", cancel);
	return cancel;
}
