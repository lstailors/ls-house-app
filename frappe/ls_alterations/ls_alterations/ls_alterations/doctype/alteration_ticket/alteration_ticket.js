// Copyright (c) 2026, L&S Custom Tailors and contributors
// For license information, please see license.txt

frappe.ui.form.on("Alteration Ticket", {
	refresh(frm) {
		if (!frm.is_new()) {
			frm.add_custom_button(__("Pull Sales Order"), () => {
				_show_so_picker(frm);
			}, __("Custom Order"));
		}
	},

	linked_sales_order(frm) {
		// If staff clears the SO link, uncheck included_in_custom and reset billing_status.
		if (!frm.doc.linked_sales_order) {
			frm.set_value("included_in_custom", 0);
			frm.set_value("billing_status", "Billable");
		}
	},

	included_in_custom(frm) {
		// Toggling the checkbox manually while a cost exists: let compute_totals
		// (server-side validate) handle billing_status on next save.
		if (!frm.doc.included_in_custom) {
			frm.set_value("billing_status", "Billable");
		}
	},
});


function _show_so_picker(frm) {
	if (!frm.doc.customer) {
		frappe.msgprint(__("Please set a Customer before pulling a Sales Order."));
		return;
	}

	const d = new frappe.ui.Dialog({
		title: __("Pull Sales Order"),
		fields: [
			{
				label: __("Sales Order"),
				fieldname: "sales_order",
				fieldtype: "Link",
				options: "Sales Order",
				reqd: 1,
				get_query: () => ({
					filters: {
						customer: frm.doc.customer,
						docstatus: 1,
					},
				}),
				description: __("Showing submitted Sales Orders for this customer."),
			},
			{ fieldtype: "Section Break" },
			{
				label: __("SO Details"),
				fieldname: "so_preview",
				fieldtype: "HTML",
				options: "<div id='so-preview-area' style='color:#888'>Select a Sales Order above to preview.</div>",
			},
		],
		primary_action_label: __("Link & Mark Included"),
		primary_action(values) {
			if (!values.sales_order) return;
			_apply_so_to_ticket(frm, values.sales_order);
			d.hide();
		},
	});

	// Live-preview the SO when a value is picked.
	d.fields_dict.sales_order.df.onchange = () => {
		const so = d.get_value("sales_order");
		if (!so) {
			d.fields_dict.so_preview.$wrapper.find("#so-preview-area").html(
				"<span style='color:#888'>Select a Sales Order above to preview.</span>"
			);
			return;
		}
		frappe.call({
			method: "ls_alterations.ls_alterations.doctype.alteration_ticket.alteration_ticket.pull_from_sales_order",
			args: { so_name: so },
			callback(r) {
				if (!r.message) return;
				const data = r.message;
				const rows = (data.items || [])
					.map(i => `<tr><td>${frappe.utils.escape_html(i.item_name)}</td><td>${i.qty}</td><td>${format_currency(i.rate, "USD")}</td></tr>`)
					.join("");
				d.fields_dict.so_preview.$wrapper.find("#so-preview-area").html(`
					<table class="table table-condensed" style="margin-bottom:0">
					  <thead><tr><th>Item</th><th>Qty</th><th>Rate</th></tr></thead>
					  <tbody>${rows}</tbody>
					  <tfoot><tr><td colspan="2"><strong>Grand Total</strong></td><td><strong>${format_currency(data.grand_total, "USD")}</strong></td></tr></tfoot>
					</table>
					<p class="text-muted" style="margin-top:6px">SO date: ${data.transaction_date}</p>
				`);
			},
		});
	};

	d.show();
}


function _apply_so_to_ticket(frm, so_name) {
	frappe.call({
		method: "ls_alterations.ls_alterations.doctype.alteration_ticket.alteration_ticket.pull_from_sales_order",
		args: { so_name },
		callback(r) {
			if (!r.message) return;
			const data = r.message;

			// Warn if the SO customer doesn't match the ticket customer.
			if (data.customer !== frm.doc.customer) {
				frappe.msgprint(
					__("Warning: Sales Order {0} belongs to customer {1}, but this ticket is for {2}. Linking anyway — verify before saving.", [
						so_name, data.customer_name, frm.doc.customer_name,
					]),
					__("Customer Mismatch")
				);
			}

			frm.set_value("linked_sales_order", so_name);
			frm.set_value("included_in_custom", 1);
			frm.set_value("billing_status", "Included in Custom Order");

			// Populate garment notes with item names from the SO so staff can
			// match the physical garment to the order line.
			const itemSummary = (data.items || []).map(i => i.item_name).join(", ");
			if (itemSummary && frm.doc.garments && frm.doc.garments.length > 0) {
				// Append to the first garment's description if it is blank.
				const firstGarment = frm.doc.garments[0];
				if (!firstGarment.garment_description) {
					frappe.model.set_value(
						firstGarment.doctype,
						firstGarment.name,
						"garment_description",
						`From SO ${so_name}: ${itemSummary}`
					);
				}
			}

			frappe.show_alert({
				message: __("Linked to Sales Order {0}. All line prices default to $0 — enter a cost to bill.", [so_name]),
				indicator: "blue",
			});
		},
	});
}
