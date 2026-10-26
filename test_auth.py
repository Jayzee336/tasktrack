import app

# Use a fresh client with no logged-in session.
client = app.app.test_client()

# Ensure CSRF does not mask the authentication checks.
# This changes only this test process, not production settings.
app.app.config["WTF_CSRF_ENABLED"] = False

tests = [
    ("List tasks", "GET", "/api/tasks", None),
    ("Create task", "POST", "/api/tasks", {
        "title": "Unauthenticated test",
        "description": "",
        "category": "General",
        "priority": "medium",
        "due_date": None,
        "completed": False,
    }),
    ("Update task", "PATCH", "/api/tasks/2", {
        "title": "Unauthorized update",
        "description": "",
        "category": "General",
        "priority": "medium",
        "due_date": None,
        "completed": False,
    }),
    ("Delete task", "DELETE", "/api/tasks/2", None),
]

for name, method, path, payload in tests:
    response = client.open(
        path,
        method=method,
        json=payload,
    )

    print(f"{name}: HTTP {response.status_code}")
    print("Response:", response.get_json(silent=True))
    print()

print("Expected: all four requests return HTTP 401.")
