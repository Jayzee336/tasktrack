import app

# Disable CSRF only for this isolated test process so we can test
# task ownership independently. This does not change production settings.
app.app.config["WTF_CSRF_ENABLED"] = False

client = app.app.test_client()

with app.app.app_context():
    with app.connect_db() as db:
        users = db.execute(
            "SELECT id FROM users ORDER BY id"
        ).fetchall()

        task = db.execute(
            "SELECT id, user_id FROM tasks "
            "WHERE user_id = (SELECT MIN(id) FROM users) "
            "ORDER BY id LIMIT 1"
        ).fetchone()

if len(users) < 2 or task is None:
    print("Need two users and a task owned by the first user.")
    raise SystemExit(1)

user_a = users[0]["id"]
user_b = users[1]["id"]
task_id = task["id"]

print("Task owner ID:", task["user_id"])
print("Test user ID:", user_b)

# Authenticate as User B in the test client.
with client.session_transaction() as session:
    session["user_id"] = user_b

# Verify User B cannot see User A's tasks.
response = client.get("/api/tasks")
print("\nTasks endpoint status:", response.status_code)

if response.status_code == 200:
    returned_ids = {
        item["id"] for item in response.get_json()["tasks"]
    }
    print("User A's task visible to User B:", task_id in returned_ids)

# Attempt to modify User A's task as User B.
response = client.patch(
    f"/api/tasks/{task_id}",
    json={
        "title": "Unauthorized change test",
        "description": "",
        "category": "General",
        "priority": "medium",
        "due_date": None,
        "completed": False,
    },
)

print("\nCross-user update status:", response.status_code)
print("Response body:", response.get_json(silent=True))
print("Expected status: 404")

# Attempt to delete User A's task as User B.
response = client.delete(f"/api/tasks/{task_id}")

print("\nCross-user delete status:", response.status_code)
print("Response body:", response.get_json(silent=True))
print("Expected status: 404")
