import app
from flask_wtf.csrf import generate_csrf

app.app.config["WTF_CSRF_ENABLED"] = True

client = app.app.test_client()

# Establish a session and generate a real CSRF token.
with client.session_transaction() as session:
    session["user_id"] = 1

with app.app.test_request_context():
    valid_token = generate_csrf()

    with client.session_transaction() as session:
        session["csrf_token"] = valid_token

payload = {
    "title": "CSRF security test",
    "description": "",
    "category": "General",
    "priority": "medium",
    "due_date": None,
    "completed": False,
}

# Test 1: Missing request token.
response = client.post("/api/tasks", json=payload)
print("Missing request token:", response.status_code)
print("Response:", response.get_json(silent=True))

# Test 2: Invalid request token, but a CSRF session token exists.
response = client.post(
    "/api/tasks",
    json=payload,
    headers={"X-CSRFToken": "deliberately-invalid-token"},
)
print("\nInvalid request token:", response.status_code)
print("Response:", response.get_json(silent=True))

print("\nExpected: both requests return HTTP 400.")
