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


def create_task(client, title):
    response = client.post(
        "/api/tasks",
        json={"title": title},
    )
    assert response.status_code == 201
    return response.get_json()["task"]["id"]


def login_as(client, user_id):
    with client.session_transaction() as session:
        session["user_id"] = user_id


def test_user_cannot_see_another_users_tasks(client):
    register_user(client, "owner@example.com")
    task_id = create_task(client, "Private task")

    # Registering a second user changes the current session.
    other_user_id = register_user(client, "other@example.com")
    login_as(client, other_user_id)

    response = client.get("/api/tasks")

    assert response.status_code == 200
    returned_ids = {
        task["id"] for task in response.get_json()["tasks"]
    }
    assert task_id not in returned_ids


def test_user_cannot_update_another_users_task(client):
    register_user(client, "owner@example.com")
    task_id = create_task(client, "Original title")

    other_user_id = register_user(client, "other@example.com")
    login_as(client, other_user_id)

    response = client.patch(
        f"/api/tasks/{task_id}",
        json={"title": "Unauthorized change"},
    )

    assert response.status_code == 404


def test_user_cannot_delete_another_users_task(client):
    register_user(client, "owner@example.com")
    task_id = create_task(client, "Protected task")

    other_user_id = register_user(client, "other@example.com")
    login_as(client, other_user_id)

    response = client.delete(f"/api/tasks/{task_id}")

    assert response.status_code == 404
