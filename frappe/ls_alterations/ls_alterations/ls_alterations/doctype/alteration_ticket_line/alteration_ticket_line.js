// Copyright (c) 2026, L&S Custom Tailors and contributors
// For license information, please see license.txt

frappe.ui.form.on("Alteration Ticket Line", {
	preset: function (frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (!row.preset) return;
		frappe.db.get_doc("Alteration Preset", row.preset).then((preset) => {
			const origin = frm.doc.origin_location;
			let price = preset.default_price;
			if (origin === "HOU" && preset.default_price_hou) {
				price = preset.default_price_hou;
			}
			frappe.model.set_value(cdt, cdn, "description", preset.preset_name);
			frappe.model.set_value(cdt, cdn, "price", price);
		});
	},
});
