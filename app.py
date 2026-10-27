import os
import re
import sqlite3
from contextlib import contextmanager
from datetime import date
from functools import wraps
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, g, jsonify, render_template, request, session
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_wtf.csrf import CSRFProtect, generate_csrf
from werkzeug.security import check_password_hash, generate_password_hash


# --------------------------------------------------
# Configuration
# --------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

app = Flask(__name__)

app.config.update(
    SECRET_KEY=os.environ.get("SECRET_KEY", ""),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("COOKIE_SECURE", "0") == "1",
    PERMANENT_SESSION_LIFETIME=60 * 60 * 8,
    MAX_CONTENT_LENGTH=32 * 1024,
    WTF_CSRF_TIME_LIMIT=7200,
)

if (
    len(app.config["SECRET_KEY"]) < 32
    or app.config["SECRET_KEY"] == "REPLACE_THIS_WITH_A_RANDOM_SECRET"
):
    raise RuntimeError(
        "Set a random SECRET_KEY of at least 32 characters in your .env file."
    )

DATA_DIR = Path(
    os.environ.get("TASKTRACK_DATA_DIR", str(BASE_DIR / "instance"))
)
DATA_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = DATA_DIR / "tasktrack.sqlite3"

csrf = CSRFProtect(app)

limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=[],
    storage_uri=os.environ.get("RATELIMIT_STORAGE_URI", "memory://"),
)


# --------------------------------------------------
# Database
# --------------------------------------------------

def connect_db():
    db = sqlite3.connect(DB_PATH, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    db.execute("PRAGMA busy_timeout = 10000")
    return db

@contextmanager
def database_connection():
    """Manage a SQLite connection and always close it."""
    db = connect_db()

    try:
        with db:
            yield db
    finally:
        db.close()


def init_db():
    with database_connection() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL COLLATE NOCASE UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL
                    REFERENCES users(id) ON DELETE CASCADE,
                title TEXT NOT NULL
                    CHECK(length(title) BETWEEN 1 AND 160),
                description TEXT NOT NULL DEFAULT '',
                category TEXT NOT NULL DEFAULT 'General',
                priority TEXT NOT NULL DEFAULT 'medium'
                    CHECK(priority IN ('low', 'medium', 'high')),
                due_date TEXT,
                completed INTEGER NOT NULL DEFAULT 0
                    CHECK(completed IN (0, 1)),
                completed_at TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_tasks_user
            ON tasks(user_id, created_at DESC);

            CREATE TABLE IF NOT EXISTS focus_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,
    task_id INTEGER
        REFERENCES tasks(id) ON DELETE SET NULL,
    session_type TEXT NOT NULL
        CHECK(session_type IN ('focus', 'short_break', 'long_break')),
    duration_minutes INTEGER NOT NULL
        CHECK(duration_minutes BETWEEN 1 AND 180),
    completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_focus_sessions_user
ON focus_sessions(user_id, completed_at DESC);
            """
        )

        columns = {
            row["name"]
            for row in db.execute("PRAGMA table_info(tasks)").fetchall()
        }
        if "status" not in columns:
            db.execute(
                "ALTER TABLE tasks ADD COLUMN status TEXT NOT NULL DEFAULT 'todo'"
            )
        if "completed_at" not in columns:
            # Older databases have no reliable completion event history. Leave historical
            # timestamps unknown rather than inventing dates from unrelated task edits.
            db.execute("ALTER TABLE tasks ADD COLUMN completed_at TEXT")
        # One-time-safe synchronization: preserve completed tasks from older versions.
        db.execute(
            """
            UPDATE tasks
            SET status = CASE WHEN completed = 1 THEN 'done' ELSE 'todo' END
            WHERE status IS NULL OR status NOT IN ('todo', 'in_progress', 'done')
            """
        )
        db.execute(
            "UPDATE tasks SET completed = CASE WHEN status = 'done' THEN 1 ELSE 0 END"
        )


# --------------------------------------------------
# Session and CSRF helpers
# --------------------------------------------------

def reset_auth_session(user_id=None):
    """
    Reset authentication-related session data while preserving the
    existing Flask-WTF CSRF session token.

    Flask uses signed client-side sessions. Preserving csrf_token allows
    the current page's CSRF token to remain valid after login/logout.
    """
    csrf_session_token = session.get("csrf_token")

    session.clear()

    if csrf_session_token:
        session["csrf_token"] = csrf_session_token

    if user_id is not None:
        session["user_id"] = user_id
        session.permanent = True


def auth_response(payload, status=200):
    response = jsonify(payload)
    response.status_code = status
    response.headers["Cache-Control"] = "no-store"

    # Do not rotate the CSRF token here. The current page already has
    # a valid token, and reset_auth_session preserves its session state.
    return response


def error(message, status=400):
    response = jsonify(error=message)
    response.status_code = status
    response.headers["Cache-Control"] = "no-store"
    return response


@app.errorhandler(400)
def handle_bad_request(exc):
    """
    Return JSON for CSRF validation failures and other HTTP 400 errors.
    """
    description = getattr(exc, "description", "Bad request.")
    return error(str(description), 400)


@app.errorhandler(413)
def handle_too_large(exc):
    return error("Request is too large.", 413)


@app.before_request
def load_user():
    g.user = None
    user_id = session.get("user_id")

    if user_id is not None:
        with database_connection() as db:
            g.user = db.execute(
                "SELECT id, email FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()

        if g.user is None:
            session.pop("user_id", None)


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.user is None:
            return error("Authentication required.", 401)
        return view(*args, **kwargs)

    return wrapped


# --------------------------------------------------
# Security headers
# --------------------------------------------------

@app.after_request
def security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = (
        "camera=(), microphone=(), geolocation=()"
    )
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com; "
        "img-src 'self' data:; "
        "connect-src 'self'; "
        "object-src 'none'; "
        "base-uri 'self'; "
        "frame-ancestors 'none'; "
        "form-action 'self'"
    )
    response.headers["Cache-Control"] = "no-store"

    if request.is_secure or request.headers.get("X-Forwarded-Proto") == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000"

    return response


# --------------------------------------------------
# Task validation
# --------------------------------------------------

def parse_task(data):
    if not isinstance(data, dict):
        raise ValueError("Invalid task data.")

    title = data.get("title", "")
    description = data.get("description", "")
    category = data.get("category", "General")
    priority = data.get("priority", "medium")
    due_date = data.get("due_date")
    completed = data.get("completed", False)
    status = data.get("status")

    if not isinstance(title, str):
        raise ValueError("Task title must be 1–160 characters.")
    if not isinstance(description, str):
        raise ValueError("Notes must be text.")
    if not isinstance(category, str):
        raise ValueError("Category must be text.")
    if not isinstance(priority, str):
        raise ValueError("Choose a valid priority.")

    if due_date == "":
        due_date = None
    if due_date is not None:
        if not isinstance(due_date, str):
            raise ValueError("Due date must be a valid date.")
        try:
            date.fromisoformat(due_date)
        except ValueError:
            raise ValueError("Due date must be a valid date.")

    title = title.strip()
    description = description.strip()
    category = category.strip() or "General"
    priority = priority.lower()

    if not title or len(title) > 160:
        raise ValueError("Task title must be 1–160 characters.")
    if len(description) > 2000:
        raise ValueError("Notes must be 2,000 characters or fewer.")
    if len(category) > 40:
        raise ValueError("Category must be 40 characters or fewer.")
    if priority not in {"low", "medium", "high"}:
        raise ValueError("Choose a valid priority.")

    # Backward compatibility: older clients send only the completed boolean.
    if status is None:
        if not isinstance(completed, bool):
            raise ValueError("Invalid completion status.")
        status = "done" if completed else "todo"
    elif not isinstance(status, str) or status not in {"todo", "in_progress", "done"}:
        raise ValueError("Choose a valid task status.")

    completed_value = int(status == "done")
    return (title, description, category, priority, due_date, status, completed_value)


def task_dict(row):
    result = dict(row)
    result["completed"] = bool(result["completed"])
    result.setdefault("status", "done" if result["completed"] else "todo")
    return result


# --------------------------------------------------
# Pages
# --------------------------------------------------

@app.get("/")
def index():
    return render_template(
        "index.html",
        csrf_token=generate_csrf(),
    )


@app.get("/health")
def health():
    return jsonify(status="ok", app="TaskTrack")


# --------------------------------------------------
# Account API
# --------------------------------------------------

@app.get("/api/me")
def me():
    if g.user is None:
        return jsonify(user=None)

    return jsonify(
        user={
            "id": g.user["id"],
            "email": g.user["email"],
        }
    )


@app.post("/api/register")
@limiter.limit("5 per hour")
def register():
    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return error("Invalid request.")

    email = data.get("email", "")
    password = data.get("password", "")

    if not isinstance(email, str) or not isinstance(password, str):
        return error("Invalid email or password.")

    email = email.strip().lower()

    if (
        len(email) > 254
        or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email)
    ):
        return error("Enter a valid email address.")

    if not 12 <= len(password) <= 128 or not password.strip():
        return error("Password must be 12–128 characters long.")

    password_hash = generate_password_hash(password, method="scrypt")

    try:
        with database_connection() as db:
            cursor = db.execute(
                """
                INSERT INTO users (email, password_hash)
                VALUES (?, ?)
                """,
                (email, password_hash),
            )
            user_id = cursor.lastrowid

    except sqlite3.IntegrityError:
        return error("An account with that email already exists.", 409)

    # Preserve the CSRF token when changing authentication state.
    reset_auth_session(user_id)

    return auth_response(
        {"user": {"id": user_id, "email": email}},
        201,
    )


@app.post("/api/login")
@limiter.limit("10 per 15 minutes")
def login():
    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return error("Invalid request.")

    email = data.get("email", "")
    password = data.get("password", "")

    if not isinstance(email, str) or not isinstance(password, str):
        return error("Incorrect email or password.", 401)

    email = email.strip().lower()

    if len(email) > 254 or len(password) > 128:
        return error("Incorrect email or password.", 401)

    with database_connection() as db:
        user = db.execute(
            """
            SELECT id, email, password_hash
            FROM users
            WHERE email = ?
            """,
            (email,),
        ).fetchone()

    if user is None or not check_password_hash(
        user["password_hash"], password
    ):
        return error("Incorrect email or password.", 401)

    # Preserve the CSRF token while setting the authenticated user.
    reset_auth_session(user["id"])

    return auth_response(
        {
            "user": {
                "id": user["id"],
                "email": user["email"],
            }
        }
    )


@app.post("/api/logout")
@login_required
def logout():
    # Remove authentication but preserve the CSRF token for the page.
    reset_auth_session()

    return auth_response({"ok": True})


# --------------------------------------------------
# Task API
# All queries enforce ownership using the authenticated user ID.
# --------------------------------------------------

@app.get("/api/tasks")
@login_required
def list_tasks():
    with database_connection() as db:
        rows = db.execute(
            """
            SELECT id, title, description, category, priority,
                   due_date, completed, status, created_at, updated_at
            FROM tasks
            WHERE user_id = ?
            ORDER BY
                completed ASC,
                CASE priority
                    WHEN 'high' THEN 1
                    WHEN 'medium' THEN 2
                    ELSE 3
                END,
                CASE WHEN due_date IS NULL THEN 1 ELSE 0 END,
                due_date ASC,
                id DESC
            """,
            (g.user["id"],),
        ).fetchall()

    return jsonify(tasks=[task_dict(row) for row in rows])


@app.post("/api/tasks")
@login_required
def create_task():
    try:
        values = parse_task(request.get_json(silent=True))
    except ValueError as exc:
        return error(str(exc))

    with database_connection() as db:
        cursor = db.execute(
            """
            INSERT INTO tasks
                (user_id, title, description, category,
                 priority, due_date, status, completed, completed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?,
                    CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END)
            """,
            (g.user["id"], *values, values[-1]),
        )

        row = db.execute(
            """
            SELECT *
            FROM tasks
            WHERE id = ? AND user_id = ?
            """,
            (cursor.lastrowid, g.user["id"]),
        ).fetchone()

    return jsonify(task=task_dict(row)), 201


@app.patch("/api/tasks/<int:task_id>")
@login_required
def update_task(task_id):
    try:
        values = parse_task(request.get_json(silent=True))
    except ValueError as exc:
        return error(str(exc))

    with database_connection() as db:
        result = db.execute(
            """
            UPDATE tasks
            SET title = ?,
                description = ?,
                category = ?,
                priority = ?,
                due_date = ?,
                status = ?,
                completed = ?,
                completed_at = CASE
                    WHEN ? = 1 AND completed = 0 THEN CURRENT_TIMESTAMP
                    WHEN ? = 0 THEN NULL
                    ELSE completed_at
                END,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND user_id = ?
            """,
            (*values, values[-1], values[-1], task_id, g.user["id"]),
        )

        if result.rowcount != 1:
            return error("Task not found.", 404)

        row = db.execute(
            """
            SELECT *
            FROM tasks
            WHERE id = ? AND user_id = ?
            """,
            (task_id, g.user["id"]),
        ).fetchone()

    return jsonify(task=task_dict(row))


@app.delete("/api/tasks/<int:task_id>")
@login_required
def delete_task(task_id):
    with database_connection() as db:
        result = db.execute(
            """
            DELETE FROM tasks
            WHERE id = ? AND user_id = ?
            """,
            (task_id, g.user["id"]),
        )

    if result.rowcount != 1:
        return error("Task not found.", 404)

    return jsonify(ok=True)




# --------------------------------------------------
# Productivity Insights API
# --------------------------------------------------

@app.get("/api/insights")
@login_required
def productivity_insights():
    """Return per-user productivity aggregates for the dashboard."""
    today = date.today()
    today_iso = today.isoformat()
    week_start = today - __import__("datetime").timedelta(days=6)
    week_start_iso = week_start.isoformat()
    month_start_iso = today.replace(day=1).isoformat()

    # Six calendar months, including this month.
    month_starts = []
    year, month = today.year, today.month
    for _ in range(6):
        month_starts.append(date(year, month, 1))
        month -= 1
        if month == 0:
            month = 12
            year -= 1
    month_starts.reverse()
    first_month_iso = month_starts[0].isoformat()

    with database_connection() as db:
        task_rows = db.execute(
            """
            SELECT id, category, priority, completed, status, completed_at
            FROM tasks
            WHERE user_id = ?
            """,
            (g.user["id"],),
        ).fetchall()

        sessions = db.execute(
            """
            SELECT duration_minutes, session_type, completed_at
            FROM focus_sessions
            WHERE user_id = ?
            """,
            (g.user["id"],),
        ).fetchall()

    total_tasks = len(task_rows)
    completed_tasks = sum(
        1 for task in task_rows
        if task["status"] == "done" or task["completed"]
    )
    active_tasks = total_tasks - completed_tasks
    completion_rate = round(completed_tasks / total_tasks * 100) if total_tasks else 0

    daily_counts = {}
    completion_dates = set()
    for task in task_rows:
        completed_at = task["completed_at"]
        if not completed_at:
            continue
        completed_day = completed_at[:10]
        try:
            date.fromisoformat(completed_day)
        except ValueError:
            continue
        completion_dates.add(completed_day)
        if week_start_iso <= completed_day <= today_iso:
            daily_counts[completed_day] = daily_counts.get(completed_day, 0) + 1

    weekly_completions = []
    for offset in range(7):
        day = week_start + __import__("datetime").timedelta(days=offset)
        weekly_completions.append({
            "date": day.isoformat(),
            "label": day.strftime("%a"),
            "completed": daily_counts.get(day.isoformat(), 0),
        })

    monthly_counts = {}
    for task in task_rows:
        completed_at = task["completed_at"]
        if not completed_at:
            continue
        month_key = completed_at[:7]
        if month_key >= first_month_iso[:7]:
            monthly_counts[month_key] = monthly_counts.get(month_key, 0) + 1

    monthly_completions = [{
        "month": month_start.strftime("%Y-%m"),
        "label": month_start.strftime("%b"),
        "completed": monthly_counts.get(month_start.strftime("%Y-%m"), 0),
    } for month_start in month_starts]

    category_map = {}
    priority_map = {}
    for task in task_rows:
        category = (task["category"] or "General").strip() or "General"
        category_item = category_map.setdefault(category, {"category": category, "total": 0, "completed": 0})
        category_item["total"] += 1
        is_done = task["status"] == "done" or task["completed"]
        if is_done:
            category_item["completed"] += 1

        priority = task["priority"] if task["priority"] in {"low", "medium", "high"} else "medium"
        priority_item = priority_map.setdefault(priority, {"priority": priority, "total": 0, "completed": 0})
        priority_item["total"] += 1
        if is_done:
            priority_item["completed"] += 1

    categories = sorted(category_map.values(), key=lambda item: (-item["total"], item["category"].lower()))[:6]
    priorities = [
        priority_map.get(level, {"priority": level, "total": 0, "completed": 0})
        for level in ("high", "medium", "low")
    ]

    # Current streak continues if the latest completion was today or yesterday.
    streak_anchor = today_iso if today_iso in completion_dates else (today - __import__("datetime").timedelta(days=1)).isoformat()
    current_streak = 0
    cursor_day = date.fromisoformat(streak_anchor)
    while cursor_day.isoformat() in completion_dates:
        current_streak += 1
        cursor_day -= __import__("datetime").timedelta(days=1)

    longest_streak = 0
    running_streak = 0
    previous_day = None
    for day_text in sorted(completion_dates):
        this_day = date.fromisoformat(day_text)
        if previous_day is not None and this_day == previous_day + __import__("datetime").timedelta(days=1):
            running_streak += 1
        else:
            running_streak = 1
        longest_streak = max(longest_streak, running_streak)
        previous_day = this_day

    focus_week_minutes = 0
    focus_month_minutes = 0
    for session in sessions:
        if session["session_type"] != "focus" or not session["completed_at"]:
            continue
        session_day = session["completed_at"][:10]
        if week_start_iso <= session_day <= today_iso:
            focus_week_minutes += session["duration_minutes"]
        if session_day >= month_start_iso and session_day <= today_iso:
            focus_month_minutes += session["duration_minutes"]

    return jsonify({
        "summary": {
            "total_tasks": total_tasks,
            "completed_tasks": completed_tasks,
            "active_tasks": active_tasks,
            "completion_rate": completion_rate,
            "current_streak": current_streak,
            "longest_streak": longest_streak,
            "focus_minutes_week": focus_week_minutes,
            "focus_minutes_month": focus_month_minutes,
            "tracked_completion_days": len(completion_dates),
        },
        "weekly_completions": weekly_completions,
        "monthly_completions": monthly_completions,
        "categories": categories,
        "priorities": priorities,
        "tracking_note": "Completion history starts with this update. Older completed tasks remain included in totals, but their completion dates are unknown.",
    })


# --------------------------------------------------
# Focus Session API
# All queries enforce ownership using the authenticated user ID.
# --------------------------------------------------

@app.get("/api/focus-sessions")
@login_required
def list_focus_sessions():
    with database_connection() as db:
        rows = db.execute(
            """
            SELECT fs.id, fs.task_id, fs.session_type,
                   fs.duration_minutes, fs.completed_at,
                   t.title AS task_title
            FROM focus_sessions AS fs
            LEFT JOIN tasks AS t
                ON t.id = fs.task_id
                AND t.user_id = fs.user_id
            WHERE fs.user_id = ?
            ORDER BY fs.completed_at DESC, fs.id DESC
            LIMIT 100
            """,
            (g.user["id"],),
        ).fetchall()

    return jsonify(
        sessions=[dict(row) for row in rows]
    )


@app.post("/api/focus-sessions")
@login_required
def create_focus_session():
    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return error("Invalid focus session data.")

    session_type = data.get("session_type")
    duration = data.get("duration_minutes")
    task_id = data.get("task_id")

    if session_type not in ("focus", "short_break", "long_break"):
        return error("Invalid session type.")

    # Reject booleans and non-integer values.
    if isinstance(duration, bool) or not isinstance(duration, int):
        return error("Duration must be a whole number between 1 and 180 minutes.")

    if not 1 <= duration <= 180:
        return error("Duration must be a whole number between 1 and 180 minutes.")

    if task_id is not None:
        if isinstance(task_id, bool) or not isinstance(task_id, int) or task_id < 1:
            return error("Invalid task ID.")

        with database_connection() as db:
            task = db.execute(
                """
                SELECT id
                FROM tasks
                WHERE id = ? AND user_id = ?
                """,
                (task_id, g.user["id"]),
            ).fetchone()

            if task is None:
                return error("Task not found.", 404)

    with database_connection() as db:
        cursor = db.execute(
            """
            INSERT INTO focus_sessions
                (user_id, task_id, session_type, duration_minutes)
            VALUES (?, ?, ?, ?)
            """,
            (g.user["id"], task_id, session_type, duration),
        )

        row = db.execute(
            """
            SELECT fs.id, fs.task_id, fs.session_type,
                   fs.duration_minutes, fs.completed_at,
                   t.title AS task_title
            FROM focus_sessions AS fs
            LEFT JOIN tasks AS t
                ON t.id = fs.task_id
                AND t.user_id = fs.user_id
            WHERE fs.id = ? AND fs.user_id = ?
            """,
            (cursor.lastrowid, g.user["id"]),
        ).fetchone()

    return jsonify(session=dict(row)), 201


# --------------------------------------------------
# Initialize and run
# --------------------------------------------------

with app.app_context():
    init_db()


if __name__ == "__main__":
    app.run(
        host="127.0.0.1",
        port=5000,
        debug=False,
    )