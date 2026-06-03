app_name = "square_integration"
app_title = "Square Integration"
app_publisher = "L&S Custom Tailors"
app_description = "Square payment capture and payment request emails for ERPNext Sales Invoices"
app_version = "1.1.0"
app_email = "carl@lstailors.com"
app_license = "MIT"

# Load fixtures on bench migrate (imports the Payment Request notification)
fixtures = [
    {"dt": "Notification", "filters": [["name", "=", "Payment Request - Sales Invoice"]]},
]
