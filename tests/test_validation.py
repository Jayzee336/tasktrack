import pytest


def register_and_login(client):
    response = client.post(
        "/api/register",
        json={
            "email": "validation@example.com",
            "password": "SecureTestPass123!",
        },
    )
    assert response.status_code == 201


@pytest.mark.parametrize(
    "title",
    [
        "",
        "   ",
        "x" * 161,
    ],
)
def test_create_task_rejects_invalid_title(client, title):
    register_and_login(client)

    response = client.post(
        "/api/tasks",
        json={"title": title},
    )

    assert response.status_code == 400


def test_create_task_accepts_maximum_title_length(client):
    register_and_login(client)

    response = client.post(
        "/api/tasks",
        json={"title": "x" * 160},
    )

    assert response.status_code == 201


@pytest.mark.parametrize(
    "priority",
    [
        "urgent",
        "",
        123,
    ],
)
def test_create_task_rejects_invalid_priority(client, priority):
    register_and_login(client)

    response = client.post(
        "/api/tasks",
        json={
            "title": "Validation test",
            "priority": priority,
        },
    )

    assert response.status_code == 400


@pytest.mark.parametrize(
    "due_date",
    [
        "not-a-date",
        "2026-02-30",
        123,
        [],
    ],
)
def test_create_task_rejects_invalid_due_date(client, due_date):
    register_and_login(client)

    response = client.post(
        "/api/tasks",
        json={
            "title": "Validation test",
            "due_date": due_date,
        },
    )

    assert response.status_code == 400


@pytest.mark.parametrize(
    "completed",
    [
        "true",
        1,
        None,
    ],
)
def test_create_task_rejects_invalid_completion_value(
    client,
    completed,
):
    register_and_login(client)

    response = client.post(
        "/api/tasks",
        json={
            "title": "Validation test",
            "completed": completed,
        },
    )

    assert response.status_code == 400


def test_create_task_rejects_non_json_request(client):
    register_and_login(client)

    response = client.post(
        "/api/tasks",
        data="this is not JSON",
        content_type="text/plain",
    )

    assert response.status_code == 400


def test_create_task_rejects_missing_json_body(client):
    register_and_login(client)

    response = client.post("/api/tasks")

    assert response.status_code == 400
