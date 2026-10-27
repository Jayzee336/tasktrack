# TaskTrack

A Flask-based task management web application using SQLite, with user authentication, task CRUD operations, CSRF protection, password hashing, and per-user task ownership.

## 1. Project Overview

TaskTrack is developed locally on Windows and is intended to be deployed to an Ubuntu Server running inside VirtualBox on another device.

### Technology Stack

- **Backend:** Python, Flask
- **Database:** SQLite
- **Frontend:** HTML, CSS, JavaScript
- **Authentication:** Flask sessions and Werkzeug password hashing
- **Security:** CSRF protection, request rate limiting, and per-user task access controls
- **Production server:** Gunicorn
- **Web server / reverse proxy:** Nginx
- **Service management:** systemd

## 2. Project Structure

```text
tasktrack/
├── app.py
├── README.md
├── requirements.txt
├── pytest.ini
├── conftest.py
├── .gitignore
├── templates/
│   └── index.html
├── static/
│   ├── app.js
│   ├── calendar.js
│   ├── focus.js
│   └── style.css
├── tests/
│   ├── test_auth.py
│   ├── test_csrf.py
│   ├── test_focus_sessions.py
│   ├── test_health.py
│   ├── test_ownership.py
│   └── test_validation.py
└── deploy/
    ├── tasktrack.service
    └── tasktrack.nginx
```

- `app.py` provides the Flask API, authentication, persistence, validation, and security controls.
- `static/app.js` implements task management and the Kanban/list views.
- `static/focus.js` provides Focus Mode and session history.
- `static/calendar.js` provides month/week planning, deadline summaries, and drag-and-drop rescheduling.
- `tests/` contains the automated pytest suite. Local database inspection scripts are intentionally not tracked.
- `deploy/` contains deployment examples that must be reviewed before use.

## 3. Which Files Should Be Transferred to Ubuntu?

### Required application files

Transfer these files and folders while preserving their directory structure:

- `app.py`
- `requirements.txt`
- `templates/`
- `static/`

Transfer `README.md` if you want the deployment instructions available on the server.

The `deploy/` directory contains deployment configuration examples. Review and adapt these files before installing them.

### Files that must be recreated or handled separately

| File or folder | Action on Ubuntu |
|---|---|
| `.env` | Create a new production configuration with a new, strong secret key. Never copy secrets into GitHub. |
| `.venv/` | Recreate the Python virtual environment on Ubuntu. Never transfer the Windows environment. |
| `instance/tasktrack.sqlite3` | Create a new database or transfer it separately if existing data must be preserved. |
| `deploy/tasktrack.service` | Review paths, user, environment file, and Gunicorn command before installation. |
| `deploy/tasktrack.nginx` | Review and adapt the configuration to the existing Nginx setup. |
| `tests/`, `conftest.py`, and `pytest.ini` | Keep for local regression testing; install the requirements and run `python -m pytest -q`. |

**Important:** The current SQLite database contains development/test data. Do not transfer it unless you intentionally want to preserve that data. If you need to keep existing records, make a separate backup first.

## 4. Before Deployment

On Ubuntu, inspect the existing environment before changing anything.

```bash
lsb_release -a
hostname -I
python3 --version
sudo systemctl status nginx --no-pager
sudo ss -tulpn
ls -l /etc/nginx/sites-enabled/
sudo ufw status verbose
sudo systemctl status fail2ban --no-pager
```

Inspect the complete Nginx configuration:

```bash
sudo nginx -T
```

Review the output privately before sharing it because configuration files can contain sensitive information.

### Preserve existing websites

This Ubuntu Server already hosts five independent tools:

- `agecalc.com`
- `bmitool.com`
- `wordcounter.com`
- `pomodoro.com`
- `diceroller.com`

Their existing Nginx configuration includes `/etc/nginx/sites-available/Pconfig`.

**Do not replace `Pconfig`, remove existing enabled sites, or overwrite the `/var/www/five-tools` directory.** TaskTrack should be configured as an additional application without disrupting these sites.

## 5. Recommended Ubuntu Directory Layout

Use a dedicated application directory and a separate writable database directory.

```text
/opt/tasktrack/
├── app.py
├── requirements.txt
├── .env
├── .venv/
├── templates/
└── static/

/var/lib/tasktrack/
└── tasktrack.sqlite3

/etc/systemd/system/
└── tasktrack.service

/etc/nginx/sites-available/
└── tasktrack
```

The final directory layout and ownership must match the actual systemd service and Nginx configuration.

The application service account needs permission to access the application and write to the database directory. Keep the database and secret configuration out of public web directories.

## 6. Create the Application Environment

After transferring the application files, install Python tooling if needed:

```bash
sudo apt update
sudo apt install python3 python3-venv python3-pip
```

Create the application directory and transfer the required files into it. Then create the virtual environment:

```bash
cd /opt/tasktrack
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Use the Python version supported by the application's dependencies and available on the target Ubuntu release.

## 7. Configure Production Secrets

Create a new `.env` file on Ubuntu. Do not commit it to GitHub.

Generate a strong random secret key using:

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

Use the generated value in the application's supported configuration format. Confirm the environment-variable names by inspecting `app.py` before creating the production `.env` file.

Set restrictive permissions on the secret file:

```bash
chmod 600 /opt/tasktrack/.env
```

The application must load the environment configuration correctly. Confirm this in `app.py` and the systemd service before starting the application.

## 8. Database Setup

TaskTrack uses SQLite. The database should be stored in a persistent directory outside the public web root.

Recommended location:

```text
/var/lib/tasktrack/tasktrack.sqlite3
```

Create the directory:

```bash
sudo mkdir -p /var/lib/tasktrack
```

Assign ownership to the dedicated service account selected for deployment. The service account needs write permission to the directory, not merely to an existing database file, because SQLite may create journal or other supporting files.

Confirm how `app.py` chooses its database path. Configure the production database path using the application's existing configuration mechanism, or update the application deliberately before deployment.

Do not initialize a production database until you understand how the application creates its tables and handles existing database files.

## 9. Run TaskTrack in Production

Use Gunicorn behind Nginx instead of exposing Flask's development server to the network.

The intended request flow is:

```text
Browser
   |
   v
Nginx
   |
   v
Gunicorn at 127.0.0.1:5000
   |
   v
Flask application
   |
   v
SQLite database
```

Before enabling the service, verify that the Gunicorn command, Python environment, application import path, environment file, database path, and service-account permissions are correct.

The provided files in `deploy/` are starting points, not guaranteed drop-in configurations.

After configuring systemd and Nginx:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now tasktrack
sudo systemctl status tasktrack --no-pager
```

Check application logs if the service fails:

```bash
sudo journalctl -u tasktrack -n 100 --no-pager
```

Validate Nginx before reloading it:

```bash
sudo nginx -t
```

Only reload Nginx if the configuration test succeeds:

```bash
sudo systemctl reload nginx
```

Do not enable the new Nginx site until its configuration has been reviewed against the existing sites and intended hostname or URL path.

## 10. Security Checklist

- [ ] `.env` is not tracked by Git.
- [ ] The production secret key is randomly generated and kept private.
- [ ] The Windows `.venv/` directory is not transferred.
- [ ] The production database is stored outside the public web root.
- [ ] The database directory is writable by the application service account.
- [ ] Gunicorn listens on localhost rather than being exposed directly to the network.
- [ ] Existing Nginx sites remain enabled and functional.
- [ ] Nginx configuration passes `sudo nginx -t`.
- [ ] Authentication, CSRF protection, task ownership, and CRUD operations are tested after deployment.
- [ ] Database backups are stored securely.
- [ ] HTTPS is configured if the application will be accessed beyond a trusted local network.

## 11. GitHub Repository

Source code repository:

https://github.com/Jayzee336/tasktrack

Keep secrets, local virtual environments, development databases, and other private configuration out of the repository.

## 12. Deployment Status

Deployment is not complete until the application starts successfully on Ubuntu, its database persists across service restarts, and the existing five websites continue working.

Use this README as the deployment checklist and update it when the final Ubuntu configuration is confirmed.
