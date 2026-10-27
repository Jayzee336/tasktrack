from datetime import date, timedelta


def register_user(client, email):
    response = client.post(
        "/api/register",
        json={"email": email, "password": "SecureTestPass123!"},
    )
    assert response.status_code == 201
    return response.get_json()["user"]["id"]


def create_task(client, title, category="General", priority="medium", status="todo"):
    response = client.post(
        "/api/tasks",
        json={
            "title": title,
            "category": category,
            "priority": priority,
            "status": status,
            "completed": status == "done",
        },
    )
    assert response.status_code == 201
    return response.get_json()["task"]["id"]


def test_insights_require_authentication(client):
    response = client.get("/api/insights")
    assert response.status_code == 401


def test_insights_return_empty_user_safe_defaults(client):
    register_user(client, "insights-empty@example.com")
    response = client.get("/api/insights")

    assert response.status_code == 200
    data = response.get_json()
    assert data["summary"]["total_tasks"] == 0
    assert data["summary"]["completion_rate"] == 0
    assert data["summary"]["current_streak"] == 0
    assert len(data["weekly_completions"]) == 7
    assert len(data["monthly_completions"]) == 6
    assert [item["priority"] for item in data["priorities"]] == ["high", "medium", "low"]


def test_insights_aggregate_tasks_and_focus_minutes(client):
    register_user(client, "insights-data@example.com")
    create_task(client, "Finished lab", "School", "high", "done")
    create_task(client, "Pending report", "School", "medium", "todo")
    create_task(client, "Read chapter", "Personal", "low", "todo")

    focus = client.post(
        "/api/focus-sessions",
        json={"session_type": "focus", "duration_minutes": 25},
    )
    assert focus.status_code == 201
    short_break = client.post(
        "/api/focus-sessions",
        json={"session_type": "short_break", "duration_minutes": 5},
    )
    assert short_break.status_code == 201

    data = client.get("/api/insights").get_json()
    summary = data["summary"]

    assert summary["total_tasks"] == 3
    assert summary["completed_tasks"] == 1
    assert summary["active_tasks"] == 2
    assert summary["completion_rate"] == 33
    assert summary["focus_minutes_week"] == 25
    assert summary["focus_minutes_month"] == 25
    assert len(data["weekly_completions"]) == 7
    assert sum(item["completed"] for item in data["weekly_completions"]) == 1
    assert len(data["monthly_completions"]) == 6
    assert {item["category"] for item in data["categories"]} == {"School", "Personal"}
    high = next(item for item in data["priorities"] if item["priority"] == "high")
    assert high == {"priority": "high", "total": 1, "completed": 1}


def test_completion_timestamp_is_set_and_cleared_when_reopened(client):
    register_user(client, "insights-transition@example.com")
    task_id = create_task(client, "Track the transition")

    marked_done = client.patch(
        f"/api/tasks/{task_id}",
        json={
            "title": "Track the transition",
            "description": "",
            "category": "General",
            "priority": "medium",
            "due_date": None,
            "status": "done",
            "completed": True,
        },
    )
    assert marked_done.status_code == 200
    data = client.get("/api/insights").get_json()
    assert sum(item["completed"] for item in data["weekly_completions"]) == 1

    reopened = client.patch(
        f"/api/tasks/{task_id}",
        json={
            "title": "Track the transition",
            "description": "",
            "category": "General",
            "priority": "medium",
            "due_date": None,
            "status": "todo",
            "completed": False,
        },
    )
    assert reopened.status_code == 200
    data = client.get("/api/insights").get_json()
    assert sum(item["completed"] for item in data["weekly_completions"]) == 0


def test_insights_are_scoped_to_signed_in_user(client):
    register_user(client, "insights-owner@example.com")
    create_task(client, "Private finished task", "Private", "high", "done")

    register_user(client, "insights-other@example.com")
    data = client.get("/api/insights").get_json()

    assert data["summary"]["total_tasks"] == 0
    assert data["summary"]["completed_tasks"] == 0
    assert data["categories"] == []
    assert sum(item["completed"] for item in data["weekly_completions"]) == 0
