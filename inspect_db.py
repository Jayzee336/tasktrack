import sqlite3

DB_PATH = "instance/tasktrack.sqlite3"

connection = sqlite3.connect(DB_PATH)

try:
    tables = connection.execute("""
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name
    """).fetchall()

    for (table_name,) in tables:
        print(f"\n{'=' * 40}")
        print(f"TABLE: {table_name}")
        print("=" * 40)

        columns = connection.execute(
            f'PRAGMA table_info("{table_name}")'
        ).fetchall()

        for column in columns:
            print(
                f"Column: {column[1]:20} "
                f"Type: {column[2]:12} "
                f"Primary key: {bool(column[5])}"
            )

        count = connection.execute(
            f'SELECT COUNT(*) FROM "{table_name}"'
        ).fetchone()[0]

        print(f"Total records: {count}")

finally:
    connection.close()
