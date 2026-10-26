import sqlite3

db = sqlite3.connect("instance/tasktrack.sqlite3")

try:
    rows = db.execute("""
        SELECT id, password_hash
        FROM users
        ORDER BY id
    """).fetchall()

    for user_id, stored_value in rows:
        is_hashed = (
            isinstance(stored_value, str)
            and len(stored_value) >= 30
            and stored_value not in ("",)
        )

        print(
            f"User ID {user_id}: "
            f"stored value present = {bool(stored_value)}, "
            f"appears hash-like = {is_hashed}"
        )
finally:
    db.close()
