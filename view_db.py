import sqlite3

DB_PATH = "instance/tasktrack.sqlite3"

connection = sqlite3.connect(DB_PATH)
connection.row_factory = sqlite3.Row

try:
    print("\n=== USERS ===")

    users = connection.execute("""
        SELECT id, email, created_at
        FROM users
        ORDER BY id
    """).fetchall()

    for user in users:
        print(dict(user))

    print("\n=== TASKS ===")

    tasks = connection.execute("""
        SELECT
            id,
            user_id,
            title,
            category,
            priority,
            completed,
            due_date
        FROM tasks
        ORDER BY user_id, id
    """).fetchall()

    for task in tasks:
        print(dict(task))

    print("\n=== TASK COUNT PER USER ===")

    counts = connection.execute("""
        SELECT
            u.id AS user_id,
            u.email,
            COUNT(t.id) AS task_count
        FROM users AS u
        LEFT JOIN tasks AS t ON t.user_id = u.id
        GROUP BY u.id, u.email
        ORDER BY u.id
    """).fetchall()

    for row in counts:
        print(dict(row))

finally:
    connection.close()
