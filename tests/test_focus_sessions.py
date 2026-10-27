def register_user(client, email):
    response = client.post(
        "/api/register",
        json={
            "email": email,
            "password": "SecureTestPass123!",
        },
    )
    assert response.status_code == 201
    return response.get_json()["user"]["id"]


def login_as(client, user_id):
    with client.session_transaction() as session:
        session["user_id"] = user_id


def create_task(client, title):
    response = client.post("/api/tasks", json={"title": title})
    assert response.status_code == 201
    return response.get_json()["task"]["id"]


def test_focus_sessions_require_authentication(client):
    response = client.get("/api/focus-sessions")
    assert response.status_code == 401

    response = client.post(
        "/api/focus-sessions",
        json={
            "session_type": "focus",
            "duration_minutes": 25,
        },
    )
    assert response.status_code == 401


def test_create_focus_session_without_task(client):
    register_user(client, "focus@example.com")

    response = client.post(
        "/api/focus-sessions",
        json={
            "session_type": "focus",
            "duration_minutes": 25,
        },
    )

    assert response.status_code == 201
    result = response.get_json()["session"]
    assert result["session_type"] == "focus"
    assert result["duration_minutes"] == 25
    assert result["task_id"] is None
    assert result["task_title"] is None


def test_create_focus_session_linked_to_owned_task(client):
    register_user(client, "owner@example.com")
    task_id = create_task(client, "Study Flask")

    response = client.post(
        "/api/focus-sessions",
        json={
            "session_type": "focus",
            "duration_minutes": 45,
            "task_id": task_id,
        },
    )

    assert response.status_code == 201
    result = response.get_json()["session"]
    assert result["task_id"] == task_id
    assert result["task_title"] == "Study Flask"
    assert result["duration_minutes"] == 45


def test_reject_invalid_focus_session_type(client):
    register_user(client, "focus@example.com")

    response = client.post(
        "/api/focus-sessions",
        json={
            "session_type": "invalid",
            "duration_minutes": 25,
        },
    )

    assert response.status_code == 400


def test_reject_invalid_focus_session_duration(client):
    register_user(client, "focus@example.com")

    for duration in (0, 181, True, 25.5, "25"):
        response = client.post(
            "/api/focus-sessions",
            json={
                "session_type": "focus",
                "duration_minutes": duration,
            },
        )
        assert response.status_code == 400, f"Unexpected duration accepted: {duration!r}"


def test_user_cannot_link_another_users_task(client):
    register_user(client, "owner@example.com")
    task_id = create_task(client, "Private task")

    other_user_id = register_user(client, "other@example.com")
    login_as(client, other_user_id)

    response = client.post(
        "/api/focus-sessions",
        json={
            "session_type": "focus",
            "duration_minutes": 25,
            "task_id": task_id,
        },
    )

    assert response.status_code == 404


def test_users_only_see_their_own_focus_sessions(client):
    register_user(client, "owner@example.com")

    client.post(
        "/api/focus-sessions",
        json={
            "session_type": "focus",
            "duration_minutes": 25,
        },
    )

    other_user_id = register_user(client, "other@example.com")
    login_as(client, other_user_id)

    response = client.get("/api/focus-sessions")

    assert response.status_code == 200
    assert response.get_json()["sessions"] == []
