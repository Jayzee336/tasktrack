import tempfile
from pathlib import Path

import pytest
import app as tasktrack


@pytest.fixture
def client(monkeypatch):
    """Create a Flask test client with an isolated SQLite database."""
    # Use a unique database file for this test.
    # Leave cleanup until the Python process exits because SQLite
    # connections may remain open on Windows.
    with tempfile.NamedTemporaryFile(
        prefix="tasktrack_test_",
        suffix=".sqlite3",
        delete=False,
    ) as temp_file:
        test_db = Path(temp_file.name)

    monkeypatch.setattr(tasktrack, "DB_PATH", test_db)

    tasktrack.init_db()

    tasktrack.limiter.enabled = False

    tasktrack.app.config.update(
        TESTING=True,
        WTF_CSRF_ENABLED=False,
    )

    with tasktrack.app.test_client() as test_client:
        yield test_client
