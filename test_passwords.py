import app
from werkzeug.security import check_password_hash

with app.app.app_context():
    with app.connect_db() as db:
        users = db.execute(
            "SELECT id, email, password_hash FROM users ORDER BY id"
        ).fetchall()

if not users:
    print("No registered users found.")
    raise SystemExit(1)

all_hashes_valid = True

for user in users:
    stored_hash = user["password_hash"]

    # Verify the stored value has the expected hash format.
    looks_like_hash = (
        isinstance(stored_hash, str)
        and (
            stored_hash.startswith("scrypt:")
            or stored_hash.startswith("pbkdf2:")
        )
    )

    # Confirm the hash is recognized by Werkzeug.
    try:
        check_password_hash(stored_hash, "test-only-wrong-password")
        recognized_hash = True
    except (ValueError, TypeError):
        recognized_hash = False

    print(f"User ID: {user['id']}")
    print(f"Password hash format recognized: {looks_like_hash}")
    print(f"Werkzeug can verify hash format: {recognized_hash}")
    print()

    if not looks_like_hash or not recognized_hash:
        all_hashes_valid = False

print("Overall result:", "PASS" if all_hashes_valid else "CHECK REQUIRED")
