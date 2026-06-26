/**
 * L&S Unified QR Scanner — Frappe Page
 *
 * Single scanner for every QR code in the L&S ecosystem.
 * Uses frappe.ui.Scanner (Html5QrCode) for camera access.
 * Dispatches on the stable `type` key returned by resolve_qr.
 */

/* global frappe */

frappe.pages["lsh-scanner"].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "L&S Scanner",
		single_column: true,
	});

	new LSHScanner(page);
};

// ── Design tokens ────────────────────────────────────────────────────────────
var COLORS = {
	forestDeep:  "#0d1f1a",
	forestRaised:"#122820",
	brass:       "#b8964e",
	brassLight:  "#d4b06a",
	cream:       "#f5f0e8",
	creamDim:    "#c8bfad",
	red:         "#e05252",
	green:       "#4caf7d",
};

// ── Type config (stable machine keys → display data) ─────────────────────────
var TYPE_CONFIG = {
	sales_invoice: {
		label:   "Sales Invoice",
		icon:    "💳",
		color:   "#7c3aed",
		actions: {
			open:              { label: "Open Invoice",       style: "primary" },
			mark_paid:         { label: "Mark Paid",          style: "success" },
			open_payment_link: { label: "Open Payment Link",  style: "default" },
		},
	},
	alteration_ticket: {
		label:   "Alteration Ticket",
		icon:    "✂️",
		color:   "#b8964e",
		actions: {
			open:              { label: "Open Ticket",        style: "primary" },
			mark_in_progress:  { label: "→ In Progress",      style: "success" },
			mark_ready:        { label: "→ Ready",            style: "success" },
			mark_picked_up:    { label: "→ Picked Up",        style: "success" },
			print_tag:         { label: "Print Tag",          style: "default" },
		},
	},
	lsh_delivery: {
		label:   "Delivery",
		icon:    "🚚",
		color:   "#2563eb",
		actions: {
			open:           { label: "Open Delivery",   style: "primary" },
			mark_delivered: { label: "Mark Delivered",  style: "success" },
			send_sms:       { label: "Send SMS",        style: "default" },
		},
	},
	custom_order: {
		label:   "Custom Order",
		icon:    "👔",
		color:   "#4caf7d",
		actions: {
			open:       { label: "Open Order",   style: "primary" },
			print_tags: { label: "Print Tags",   style: "default" },
		},
	},
	tailor_transfer: {
		label:   "Tailor Transfer",
		icon:    "🔄",
		color:   "#ea580c",
		actions: {
			open:            { label: "Open Transfer",    style: "primary" },
			confirm_receipt: { label: "Confirm Receipt",  style: "success" },
		},
	},
	payment_link: {
		label:   "Payment Link",
		icon:    "💰",
		color:   "#0891b2",
		actions: {
			open:              { label: "Open Invoice",      style: "primary" },
			mark_paid:         { label: "Mark Paid",         style: "success" },
			open_payment_link: { label: "Open Pay Link",     style: "default" },
		},
	},
	garment_tag: {
		label:   "Garment Tag",
		icon:    "🏷️",
		color:   "#d4b06a",
		actions: {
			open: { label: "Open", style: "primary" },
		},
	},
};

// ── Utilities ─────────────────────────────────────────────────────────────────

function haptic() {
	try { if (navigator.vibrate) { navigator.vibrate([40]); } } catch (_) {}
}

function toast(msg, type) {
	var bg  = type === "success" ? COLORS.green
	        : type === "error"   ? COLORS.red
	        : COLORS.brass;
	var el = $("<div>")
		.css({
			position: "fixed", top: "72px", left: "50%",
			transform: "translateX(-50%)",
			background: bg, color: "#fff",
			padding: "10px 18px", borderRadius: "12px",
			fontSize: "14px", fontWeight: "600",
			zIndex: 9999, whiteSpace: "nowrap",
			boxShadow: "0 4px 24px rgba(0,0,0,0.35)",
			maxWidth: "90vw", textAlign: "center",
		})
		.text(msg)
		.appendTo("body");
	setTimeout(function() { el.fadeOut(300, function() { el.remove(); }); }, 2800);
}

// ── Main class ────────────────────────────────────────────────────────────────

function LSHScanner(page) {
	this.page    = page;
	this.scanner = null;
	this.lastScan = "";
	this.debounceTimer = null;
	this.scanning = false;

	this._buildUI();
	this._startScanner();
}

LSHScanner.prototype._buildUI = function() {
	var self = this;

	$(this.page.body).css({
		background: COLORS.forestDeep,
		minHeight: "100vh",
		padding: "0",
		overflow: "hidden",
	});

	this.$wrap = $("<div id=\"lsh-scanner-wrap\">").css({
		display: "flex",
		flexDirection: "column",
		alignItems: "center",
		padding: "16px",
		maxWidth: "520px",
		margin: "0 auto",
	}).appendTo(this.page.body);

	// Camera viewfinder
	this.$viewfinder = $("<div id=\"lsh-qr-reader\">").css({
		width: "100%",
		borderRadius: "20px",
		overflow: "hidden",
		border: "2px solid " + COLORS.brass + "40",
		background: "#000",
		aspectRatio: "1",
		position: "relative",
	}).appendTo(this.$wrap);

	// Aim overlay
	$("<div>").css({
		position: "absolute",
		top: "50%", left: "50%",
		transform: "translate(-50%,-50%)",
		width: "56%", height: "56%",
		border: "2.5px solid " + COLORS.brass,
		borderRadius: "12px",
		boxShadow: "0 0 0 9999px rgba(0,0,0,0.35)",
		pointerEvents: "none",
		zIndex: 10,
	}).appendTo(this.$viewfinder);

	this.$hint = $("<p>").css({
		color: COLORS.creamDim,
		fontSize: "13px",
		textAlign: "center",
		margin: "14px 0 8px",
	}).text("Align any L&S code within the frame").appendTo(this.$wrap);

	// Manual entry toggle
	$("<button>")
		.css(this._btnStyle("ghost"))
		.html("⌨&nbsp; Enter code manually")
		.on("click", function() { self._toggleManual(); })
		.appendTo(this.$wrap);

	// Manual entry panel (hidden)
	this.$manualPanel = $("<div>").css({
		display: "none",
		width: "100%",
		background: COLORS.forestRaised,
		borderRadius: "16px",
		padding: "16px",
		marginTop: "8px",
		border: "1px solid " + COLORS.brass + "30",
	}).appendTo(this.$wrap);

	var $row = $("<div>").css({ display: "flex", gap: "8px" }).appendTo(this.$manualPanel);
	this.$manualInput = $("<input type=\"text\">")
		.attr("placeholder", "DN-NYC-2026-00082 or ALT-NYC-…")
		.css({
			flex: 1,
			background: COLORS.forestDeep,
			border: "1px solid " + COLORS.brass + "30",
			borderRadius: "10px",
			padding: "10px 14px",
			color: COLORS.cream,
			fontSize: "14px",
			outline: "none",
		})
		.on("keydown", function(e) { if (e.key === "Enter") { self._submitManual(); } })
		.appendTo($row);

	$("<button>").css(this._btnStyle("primary", true))
		.text("Go")
		.on("click", function() { self._submitManual(); })
		.appendTo($row);

	// Camera error card (hidden)
	this.$camError = $("<div>").css({
		display: "none",
		width: "100%",
		background: COLORS.forestRaised,
		border: "1px solid " + COLORS.red + "40",
		borderRadius: "16px",
		padding: "20px",
		marginTop: "12px",
		color: COLORS.cream,
		fontSize: "14px",
	}).appendTo(this.$wrap);

	// Result overlay
	this.$overlay = $("<div id=\"lsh-result-overlay\">").css({
		display: "none",
		position: "fixed",
		inset: 0,
		background: "rgba(0,0,0,0.75)",
		zIndex: 5000,
		alignItems: "flex-end",
		justifyContent: "center",
		backdropFilter: "blur(6px)",
		WebkitBackdropFilter: "blur(6px)",
	}).appendTo("body");

	this.$dialog = $("<div id=\"lsh-result-dialog\">").css({
		background: COLORS.forestRaised,
		borderRadius: "24px 24px 0 0",
		padding: "24px 20px 32px",
		width: "100%",
		maxWidth: "520px",
		border: "1px solid " + COLORS.brass + "25",
		borderBottom: "none",
		boxShadow: "0 -8px 40px rgba(0,0,0,0.6)",
	}).appendTo(this.$overlay);
};

LSHScanner.prototype._btnStyle = function(variant, small) {
	var base = {
		display: "inline-flex",
		alignItems: "center",
		justifyContent: "center",
		borderRadius: "12px",
		fontWeight: "600",
		cursor: "pointer",
		border: "none",
		transition: "opacity 0.15s",
		fontSize: small ? "14px" : "15px",
		padding: small ? "9px 18px" : "12px 22px",
	};
	if (variant === "primary") {
		return $.extend({}, base, { background: COLORS.brass, color: "#fff" });
	}
	if (variant === "success") {
		return $.extend({}, base, { background: COLORS.green, color: "#fff" });
	}
	if (variant === "ghost") {
		return $.extend({}, base, {
			background: "transparent", color: COLORS.creamDim,
			border: "1px solid " + COLORS.brass + "30",
			marginTop: "10px", width: "100%", fontSize: "13px",
		});
	}
	return $.extend({}, base, {
		background: COLORS.forestDeep, color: COLORS.cream,
		border: "1px solid " + COLORS.brass + "25",
	});
};

// ── Camera ───────────────────────────────────────────────────────────────────

LSHScanner.prototype._startScanner = function() {
	var self = this;
	this.scanning = true;

	try {
		this.scanner = new frappe.ui.Scanner({
			container: this.$viewfinder[0],
			on_scan: function(decoded) { self._onScan(decoded); },
		});
	} catch(err) {
		this._showCameraError(err && err.message ? err.message : String(err));
	}
};

LSHScanner.prototype._stopScanner = function() {
	if (this.scanner) {
		try { this.scanner.stop(); } catch(_) {}
		this.scanner = null;
	}
	this.scanning = false;
};

LSHScanner.prototype._showCameraError = function(msg) {
	var self = this;
	this.$viewfinder.hide();
	this.$hint.hide();

	var isPermission = msg && (
		msg.toLowerCase().indexOf("permission") !== -1 ||
		msg.toLowerCase().indexOf("denied") !== -1 ||
		msg.toLowerCase().indexOf("notallowed") !== -1
	);

	this.$camError.empty().show().append(
		$("<div>").css({ fontSize: "28px", marginBottom: "10px" }).text("📷"),
		$("<p>").css({ fontWeight: "700", color: COLORS.cream, marginBottom: "8px" })
			.text(isPermission ? "Camera Access Required" : "Camera Unavailable"),
		$("<p>").css({ color: COLORS.creamDim, lineHeight: "1.6", marginBottom: "16px" })
			.html(isPermission
				? "This scanner needs camera permission to read QR codes.<br><br>"
				  + "<strong>iPhone/Safari:</strong> Settings → Safari → Camera → Allow<br>"
				  + "<strong>Android/Chrome:</strong> Tap the 🔒 in the address bar → Camera → Allow<br><br>"
				  + "After allowing, refresh this page."
				: "Could not start the camera. Try refreshing, or use manual entry below."
			),
		$("<button>").css(self._btnStyle("primary"))
			.text("Refresh page")
			.on("click", function() { location.reload(); })
	);

	this.$manualPanel.show();
};

// ── Scan logic ───────────────────────────────────────────────────────────────

LSHScanner.prototype._onScan = function(decoded) {
	if (!decoded) return;
	var tok = decoded.trim();
	if (!tok) return;

	// 2-second debounce
	if (tok === this.lastScan && this.debounceTimer) return;
	this.lastScan = tok;
	var self = this;
	clearTimeout(this.debounceTimer);
	this.debounceTimer = setTimeout(function() { self.debounceTimer = null; }, 2000);

	haptic();
	this._stopScanner();
	this._resolve(tok);
};

LSHScanner.prototype._toggleManual = function() {
	var visible = this.$manualPanel.is(":visible");
	this.$manualPanel.toggle(!visible);
	if (!visible) { this.$manualInput.focus(); }
};

LSHScanner.prototype._submitManual = function() {
	var val = (this.$manualInput.val() || "").trim();
	if (!val) return;
	this.$manualPanel.hide();
	this._stopScanner();
	this._resolve(val);
};

// ── Resolver call ─────────────────────────────────────────────────────────────

LSHScanner.prototype._resolve = function(raw) {
	var self = this;
	this.$hint.text("Looking up…").css({ color: COLORS.brassLight });

	frappe.call({
		method: "ls_alterations.api.scanner.resolve_qr",
		args: { token: raw },
		callback: function(r) {
			var result = r.message || {};
			if (result.ok) {
				haptic();
				toast(result.title || "Found", "success");
				setTimeout(function() { self._showResult(result); }, 400);
			} else {
				self._showError(result.reason || "Unknown QR code.", raw);
			}
		},
		error: function(xhr) {
			var status = xhr && xhr.status;
			if (status === 403 || status === 401) {
				self._showAuthError();
			} else if (!status || status === 0) {
				self._showNetworkError(raw);
			} else {
				self._showServerError(raw, status);
			}
		},
	});
};

// ── Error states ──────────────────────────────────────────────────────────────

LSHScanner.prototype._showError = function(msg, raw) {
	var self = this;
	this.$hint.text("Scan again").css({ color: COLORS.creamDim });
	this._openOverlay(
		$("<div>").css({ textAlign: "center" }).append(
			$("<div>").css({ fontSize: "40px", marginBottom: "8px" }).text("❓"),
			$("<p>").css({ color: COLORS.cream, fontWeight: "700", fontSize: "17px", marginBottom: "8px" })
				.text("Unrecognized Code"),
			$("<p>").css({ color: COLORS.creamDim, fontSize: "14px", lineHeight: "1.6", marginBottom: "20px" })
				.text(msg || "Not an L&S code, or no longer active."),
			$("<p>").css({ color: COLORS.brass + "80", fontSize: "11px", marginBottom: "16px",
			               fontFamily: "monospace", wordBreak: "break-all" })
				.text(raw || ""),
			self._scanAgainBtn()
		)
	);
};

LSHScanner.prototype._showNetworkError = function(raw) {
	var self = this;
	this._openOverlay(
		$("<div>").css({ textAlign: "center" }).append(
			$("<div>").css({ fontSize: "40px", marginBottom: "8px" }).text("📡"),
			$("<p>").css({ color: COLORS.cream, fontWeight: "700", fontSize: "17px", marginBottom: "8px" })
				.text("No Connection"),
			$("<p>").css({ color: COLORS.creamDim, fontSize: "14px", lineHeight: "1.6", marginBottom: "20px" })
				.text("Can't reach the server. Check your Wi-Fi or cellular connection and try again."),
			$("<button>").css($.extend({}, self._btnStyle("primary"), { width: "100%", marginBottom: "10px" }))
				.text("Retry")
				.on("click", function() { self._closeOverlay(); self._resolve(raw); }),
			self._scanAgainBtn()
		)
	);
};

LSHScanner.prototype._showServerError = function(raw, status) {
	var self = this;
	this._openOverlay(
		$("<div>").css({ textAlign: "center" }).append(
			$("<div>").css({ fontSize: "40px", marginBottom: "8px" }).text("⚠️"),
			$("<p>").css({ color: COLORS.cream, fontWeight: "700", fontSize: "17px", marginBottom: "8px" })
				.text("Server Error"),
			$("<p>").css({ color: COLORS.creamDim, fontSize: "14px", lineHeight: "1.6", marginBottom: "20px" })
				.text("The server returned an error (HTTP " + status + "). The tech team has been notified. Try again."),
			self._scanAgainBtn()
		)
	);
};

LSHScanner.prototype._showAuthError = function() {
	this._openOverlay(
		$("<div>").css({ textAlign: "center" }).append(
			$("<div>").css({ fontSize: "40px", marginBottom: "8px" }).text("🔒"),
			$("<p>").css({ color: COLORS.cream, fontWeight: "700", fontSize: "17px", marginBottom: "8px" })
				.text("Session Expired"),
			$("<p>").css({ color: COLORS.creamDim, fontSize: "14px", lineHeight: "1.6", marginBottom: "20px" })
				.text("Your ERPNext session has expired. Sign in again to continue."),
			$("<button>").css($.extend({}, this._btnStyle("primary"), { width: "100%" }))
				.text("Sign In")
				.on("click", function() {
					var redirect = encodeURIComponent(window.location.href);
					window.location.href = "/login?redirect-to=" + redirect;
				})
		)
	);
};

// ── Result dialog ─────────────────────────────────────────────────────────────

LSHScanner.prototype._showResult = function(result) {
	var self = this;
	var cfg = TYPE_CONFIG[result.type] || {
		label: result.type, icon: "📋", color: COLORS.brass,
		actions: { open: { label: "Open", style: "primary" } },
	};

	var $content = $("<div>");

	// Header
	$("<div>").css({ display: "flex", alignItems: "center", gap: "14px", marginBottom: "16px" })
		.append(
			$("<div>").css({
				width: "52px", height: "52px",
				borderRadius: "14px",
				background: cfg.color + "20",
				border: "1px solid " + cfg.color + "50",
				display: "flex", alignItems: "center", justifyContent: "center",
				fontSize: "24px", flexShrink: 0,
			}).text(cfg.icon),
			$("<div>").append(
				$("<p>").css({ color: COLORS.cream, fontWeight: "700", fontSize: "17px", margin: 0 })
					.text(result.title || result.name),
				$("<p>").css({ color: COLORS.creamDim, fontSize: "13px", margin: "3px 0 0" })
					.text(result.subtitle || cfg.label)
			)
		)
		.appendTo($content);

	// State pill
	if (result.state) {
		$("<span>").css({
			display: "inline-block",
			background: cfg.color + "20",
			color: cfg.color,
			border: "1px solid " + cfg.color + "40",
			borderRadius: "999px",
			padding: "3px 12px",
			fontSize: "12px",
			fontWeight: "600",
			marginBottom: "18px",
		}).text(result.state).appendTo($content);
	}

	// Meta
	var metaHtml = this._buildMeta(result);
	if (metaHtml) {
		$("<div>").css({
			background: COLORS.forestDeep + "cc",
			borderRadius: "12px",
			padding: "12px 14px",
			marginBottom: "18px",
			fontSize: "13px",
			color: COLORS.creamDim,
			lineHeight: "1.8",
		}).html(metaHtml).appendTo($content);
	}

	// Action buttons
	var $actions = $("<div>").css({ display: "flex", flexDirection: "column", gap: "10px" })
		.appendTo($content);

	(result.actions || []).forEach(function(actionKey) {
		var actionDef = (cfg.actions || {})[actionKey];
		if (!actionDef) return;
		$("<button>")
			.css($.extend({}, self._btnStyle(actionDef.style || "default"), { width: "100%" }))
			.text(actionDef.label)
			.on("click", function() { self._handleAction(actionKey, result); })
			.appendTo($actions);
	});

	$actions.append(self._scanAgainBtn());
	this._openOverlay($content);
};

LSHScanner.prototype._buildMeta = function(result) {
	var m = result.meta || {};
	var lines = [];
	if (m.customer_name)  lines.push("<b>Customer:</b> " + frappe.utils.escape_html(m.customer_name));
	if (m.address)        lines.push("<b>Address:</b> " + frappe.utils.escape_html(m.address));
	if (m.garment_summary) lines.push("<b>Garments:</b> " + frappe.utils.escape_html(m.garment_summary));
	if (m.due_date)       lines.push("<b>Due:</b> " + frappe.utils.escape_html(m.due_date));
	if (m.outstanding_amount !== undefined && m.outstanding_amount !== null) {
		lines.push("<b>Outstanding:</b> $" + parseFloat(m.outstanding_amount || 0).toFixed(2));
	}
	if (m.grand_total)    lines.push("<b>Total:</b> $" + parseFloat(m.grand_total || 0).toFixed(2));
	if (m.transfer_date)  lines.push("<b>Transfer Date:</b> " + frappe.utils.escape_html(m.transfer_date));
	if (m.tailor_name)    lines.push("<b>Tailor:</b> " + frappe.utils.escape_html(m.tailor_name));
	if (m.direction)      lines.push("<b>Direction:</b> " + frappe.utils.escape_html(m.direction));
	return lines.join("<br>");
};

// ── Action handlers ───────────────────────────────────────────────────────────

LSHScanner.prototype._handleAction = function(actionKey, result) {
	var self = this;
	switch (actionKey) {
		case "open":
			this._closeOverlay();
			frappe.set_route("Form", result.doctype, result.name);
			break;

		case "mark_paid":
			this._callAction(
				"ls_alterations.api.scanner.mark_paid",
				{ invoice_name: result.name },
				"Marking paid…",
				function(msg) { toast(msg, "success"); self._closeOverlay(); self._scanAgain(); }
			);
			break;

		case "open_payment_link": {
			var url = (result.meta || {}).square_payment_link;
			if (url) {
				window.open(url, "_blank", "noopener");
			} else {
				toast("No payment link on record for this invoice.", "error");
			}
			break;
		}

		case "mark_in_progress":
		case "mark_ready":
		case "mark_picked_up": {
			var stateMap = {
				mark_in_progress: "In Progress",
				mark_ready:        "Ready",
				mark_picked_up:    "Picked Up",
			};
			this._callAction(
				"ls_alterations.api.scanner.advance_alteration_status",
				{ ticket_name: result.name, to_state: stateMap[actionKey] },
				"Updating status…",
				function(msg) { toast(msg, "success"); self._closeOverlay(); self._scanAgain(); }
			);
			break;
		}

		case "print_tag":
		case "print_tags":
			this._closeOverlay();
			frappe.open_in_new_tab(
				"/printview?doctype=" + encodeURIComponent(result.doctype)
				+ "&name=" + encodeURIComponent(result.name)
				+ "&format=Garment+Tag"
			);
			break;

		case "mark_delivered":
			this._callAction(
				"ls_alterations.api.scanner.mark_delivered",
				{ delivery_name: result.name },
				"Marking delivered…",
				function(msg) { toast(msg, "success"); self._closeOverlay(); self._scanAgain(); }
			);
			break;

		case "send_sms": {
			var phone = (result.meta || {}).customer_phone;
			if (!phone) { toast("No phone number on record.", "error"); return; }
			frappe.prompt(
				[{ fieldtype: "Small Text", fieldname: "message", label: "SMS Message",
				   "default": "Your order is on its way! — L&S Tailors" }],
				function(vals) {
					frappe.call({
						method: "lsh_house.notifications.delivery.send_delivery_sms",
						args: { delivery_name: result.name, message: vals.message },
						callback: function(r) {
							var ok = r.message && r.message.ok;
							toast(ok ? "SMS sent." : "SMS failed.", ok ? "success" : "error");
						},
						error: function() { toast("Failed to send SMS.", "error"); },
					});
				},
				"Send Delivery SMS", "Send"
			);
			break;
		}

		case "confirm_receipt":
			this._callAction(
				"ls_alterations.api.scanner.confirm_transfer",
				{ transfer_name: result.name },
				"Confirming receipt…",
				function(msg) { toast(msg, "success"); self._closeOverlay(); self._scanAgain(); }
			);
			break;

		default:
			this._closeOverlay();
			frappe.set_route("Form", result.doctype, result.name);
			break;
	}
};

LSHScanner.prototype._callAction = function(method, args, loadingMsg, onSuccess) {
	toast(loadingMsg, "info");
	frappe.call({
		method: method,
		args: args,
		callback: function(r) {
			var res = r.message || {};
			if (res.ok) { onSuccess(res.message || "Done."); }
			else { toast(res.message || "Action failed.", "error"); }
		},
		error: function() { toast("Server error. Please try again.", "error"); },
	});
};

// ── Overlay helpers ───────────────────────────────────────────────────────────

LSHScanner.prototype._openOverlay = function($content) {
	var self = this;
	this.$dialog.empty().append($content);
	this.$overlay.css({ display: "flex" });
	this.$overlay.off("click.backdrop").on("click.backdrop", function(e) {
		if ($(e.target).is(self.$overlay)) { self._closeOverlay(); }
	});
};

LSHScanner.prototype._closeOverlay = function() {
	this.$overlay.hide();
	this.$dialog.empty();
};

LSHScanner.prototype._scanAgainBtn = function() {
	var self = this;
	return $("<button>")
		.css($.extend({}, this._btnStyle("ghost"), { marginTop: "0" }))
		.text("↩ Scan again")
		.on("click", function() { self._closeOverlay(); self._scanAgain(); });
};

LSHScanner.prototype._scanAgain = function() {
	this.lastScan = "";
	this.$hint.text("Align any L&S code within the frame").css({ color: COLORS.creamDim });
	this._startScanner();
};
