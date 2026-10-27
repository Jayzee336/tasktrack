def register_user(client):
    response = client.post(
        "/api/register",
        json={
            "email": "csrf@example.com",
            "password": "SecureTestPass123!",
        },
    )
    assert response.status_code == 201
    return response


def enable_csrf_for_authenticated_session(client):
    # Registration is completed before CSRF is enabled in this isolated test.
    client.application.config["WTF_CSRF_ENABLED"] = True
    page = client.get("/")
    assert page.status_code == 200


def test_task_create_rejects_missing_csrf_token(client):
    register_user(client)
    enable_csrf_for_authenticated_session(client)

    response = client.post(
        "/api/tasks",
        json={"title": "Missing CSRF token"},
    )

    assert response.status_code == 400


def test_task_create_rejects_invalid_csrf_token(client):
    register_user(client)
    enable_csrf_for_authenticated_session(client)

    response = client.post(
        "/api/tasks",
        json={"title": "Invalid CSRF token"},
        headers={"X-CSRFToken": "deliberately-invalid-token"},
    )

    assert response.status_code == 400
