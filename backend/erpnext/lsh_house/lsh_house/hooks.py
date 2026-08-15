app_name = "lsh_house"
app_title = "LSH House"
app_publisher = "L&S Custom Tailors"
app_description = "DocTypes and fixtures for the L&S House operations app"
app_email = "ops@lstailors.com"
app_license = "MIT"

fixtures = [
    {"dt": "Custom Field", "filters": [["module", "=", "LSH House"]]},
    {"dt": "LSH Agent", "filters": []},
    {"dt": "LSH Location", "filters": []},
]

doc_events = {
    "Alteration Ticket": {
        "on_update": "lsh_house.notifications.alteration.on_alteration_update",
    },
    "LSH Delivery": {
        "on_update": "lsh_house.notifications.delivery.on_delivery_update",
        "on_update_after_submit": "lsh_house.notifications.delivery.on_delivery_update",
    },
    "ToDo": {
        "after_insert": "lsh_house.todo_guard.todo_after_insert",
    },
}
