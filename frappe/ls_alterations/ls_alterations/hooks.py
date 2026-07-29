app_name = "ls_alterations"
app_title = "LS Alterations"
app_publisher = "L&S Custom Tailors"
app_description = "Alteration ticket intake for L&S Custom Tailors, replaces Geelus"
app_email = "dev@lstailors.com"
app_license = "mit"

# Apps
# ------------------

# required_apps = []

# Each item in the list will be shown as an app in the apps page
# add_to_apps_screen = [
# 	{
# 		"name": "ls_alterations",
# 		"logo": "/assets/ls_alterations/logo.png",
# 		"title": "LS Alterations",
# 		"route": "/ls_alterations",
# 		"has_permission": "ls_alterations.api.permission.has_app_permission"
# 	}
# ]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/ls_alterations/css/ls_alterations.css"
# app_include_js = "/assets/ls_alterations/js/ls_alterations.js"

# include js, css files in header of web template
# web_include_css = "/assets/ls_alterations/css/ls_alterations.css"
# web_include_js = "/assets/ls_alterations/js/ls_alterations.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "ls_alterations/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
# doctype_js = {"doctype" : "public/js/doctype.js"}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "ls_alterations/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# automatically load and sync documents of this doctype from downstream apps
# importable_doctypes = [doctype_1]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "ls_alterations.utils.jinja_methods",
# 	"filters": "ls_alterations.utils.jinja_filters"
# }

# Installation
# ------------

# before_install = "ls_alterations.install.before_install"
# after_install = "ls_alterations.install.after_install"

# Uninstallation
# ------------

# before_uninstall = "ls_alterations.uninstall.before_uninstall"
# after_uninstall = "ls_alterations.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "ls_alterations.utils.before_app_install"
# after_app_install = "ls_alterations.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "ls_alterations.utils.before_app_uninstall"
# after_app_uninstall = "ls_alterations.utils.after_app_uninstall"

# Build
# ------------------
# To hook into the build process

# after_build = "ls_alterations.build.after_build"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "ls_alterations.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# Document Events
# ---------------
# Hook on document methods and events

doc_events = {
	"Alteration Ticket": {
		"before_insert": "ls_alterations.ls_alterations.doctype.alteration_ticket.alteration_ticket.set_naming_series",
		"validate": [
			# HER-63 P2: ensure_rush_surcharge removed — auto-appending an unquoted $25
			# surcharge is a client-trust hazard. Rush lines must be added explicitly.
			"ls_alterations.ls_alterations.doctype.alteration_ticket.alteration_ticket.compute_totals",
			"ls_alterations.ls_alterations.doctype.alteration_ticket.alteration_ticket.rollup_line_to_garment",
			"ls_alterations.ls_alterations.doctype.alteration_ticket.alteration_ticket.set_payment_status_na",
		],
		"after_insert": [
			"ls_alterations.ls_alterations.doctype.alteration_ticket.alteration_ticket.create_sales_invoice",
			"ls_alterations.ls_alterations.doctype.alteration_ticket.alteration_ticket.notify_n8n",
		],
		"on_update": [
			"ls_alterations.ls_alterations.doctype.alteration_ticket.alteration_ticket.auto_notify_when_all_ready",
			"ls_alterations.ls_alterations.doctype.alteration_ticket.alteration_ticket.notify_n8n_on_state_change",
		],
	},
	"Alteration Preset": {
		"after_insert": "ls_alterations.ls_alterations.doctype.alteration_preset.alteration_preset.create_matching_service_item",
	},
	"Payment Entry": {
		"on_submit": "ls_alterations.api.sync_payment_to_ticket",
	},
}

fixtures = [
	{"dt": "Alteration Preset"},
	{"dt": "Workflow", "filters": [["name", "=", "Alteration Ticket Workflow"]]},
	{
		"dt": "Workflow State",
		"filters": [
			[
				"name",
				"in",
				["Received", "In Progress", "Ready", "Picked Up", "Cancelled"],
			]
		],
	},
	{
		"dt": "Workflow Action Master",
		"filters": [
			[
				"name",
				"in",
				["Start Work", "Mark Ready", "Mark Picked Up", "Cancel", "Reopen"],
			]
		],
	},
	{
		"dt": "Custom Field",
		"filters": [["name", "=", "Sales Invoice-alteration_ticket_ref"]],
	},
]

# Scheduled Tasks
# ---------------

# scheduler_events = {
# 	"all": [
# 		"ls_alterations.tasks.all"
# 	],
# 	"daily": [
# 		"ls_alterations.tasks.daily"
# 	],
# 	"hourly": [
# 		"ls_alterations.tasks.hourly"
# 	],
# 	"weekly": [
# 		"ls_alterations.tasks.weekly"
# 	],
# 	"monthly": [
# 		"ls_alterations.tasks.monthly"
# 	],
# }

# Testing
# -------

# before_tests = "ls_alterations.install.before_tests"

# Extend DocType Class
# ------------------------------
#
# Specify custom mixins to extend the standard doctype controller.
# extend_doctype_class = {
# 	"Task": "ls_alterations.custom.task.CustomTaskMixin"
# }

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "ls_alterations.event.get_events"
# }
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
override_doctype_dashboards = {
	"Sales Order": "ls_alterations.ls_alterations.doctype.alteration_ticket.alteration_ticket.get_so_dashboard_data"
}

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["ls_alterations.utils.before_request"]
# after_request = ["ls_alterations.utils.after_request"]

# Job Events
# ----------
# before_job = ["ls_alterations.utils.before_job"]
# after_job = ["ls_alterations.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"ls_alterations.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

# Translation
# ------------
# List of apps whose translatable strings should be excluded from this app's translations.
# ignore_translatable_strings_from = []

