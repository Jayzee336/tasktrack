def test_tasks_require_authentication(client):
    response = client.get("/api/tasks")
    assert response.status_code == 401


def test_create_task_requires_authentication(client):
    response = client.post(
        "/api/tasks",
        json={"title": "Unauthorized test task"},
    )
    assert response.status_code == 401


def test_update_task_requires_authentication(client):
    response = client.patch(
        "/api/tasks/1",
        json={"title": "Unauthorized update"},
    )
    assert response.status_code == 401


def test_delete_task_requires_authentication(client):
    response = client.delete("/api/tasks/1")
    assert response.status_code == 401


def test_register_creates_account(client):
    response = client.post(
        "/api/register",
        json={
            "email": "student@example.com",
            "password": "SecureTestPass123!",
        },
    )

    assert response.status_code == 201
    assert response.get_json()["user"]["email"] == "student@example.com"


def test_register_rejects_short_password(client):
    response = client.post(
        "/api/register",
        json={
            "email": "shortpass@example.com",
            "password": "short",
        },
    )

    assert response.status_code == 400


def test_login_with_valid_credentials(client):
    client.post(
        "/api/register",
        json={
            "email": "login@example.com",
            "password": "SecureTestPass123!",
        },
    )

    response = client.post(
        "/api/login",
        json={
            "email": "login@example.com",
            "password": "SecureTestPass123!",
        },
    )

    assert response.status_code == 200
    assert response.get_json()["user"]["email"] == "login@example.com"


def test_login_rejects_wrong_password(client):
    client.post(
        "/api/register",
        json={
            "email": "wrongpass@example.com",
            "password": "SecureTestPass123!",
        },
    )

    response = client.post(
        "/api/login",
        json={
            "email": "wrongpass@example.com",
            "password": "IncorrectPassword123!",
        },
    )

    assert response.status_code == 401

def test_register_rejects_duplicate_email(client):
    payload = {
        "email": "duplicate@example.com",
        "password": "SecureTestPass123!",
    }

    first = client.post("/api/register", json=payload)
    second = client.post("/api/register", json=payload)

    assert first.status_code == 201
    assert second.status_code == 409


def test_logout_requires_authentication(client):
    response = client.post("/api/logout")
    assert response.status_code == 401
