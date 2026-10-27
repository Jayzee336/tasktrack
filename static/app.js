"use strict";

const $ = (selector) => document.querySelector(selector);

let csrf = $('meta[name="csrf-token"]')?.content || "";

const state = {
  user: null,
  tasks: [],
  filter: "all",
  search: "",
  priority: "all",
  editingId: null,
  deletingId: null,
  deleting: false,
  authMode: "login",
  toastTimer: null,
  togglingIds: new Set()
};

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);

const todayISO = () => {
  const date = new Date();

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const prettyDate = (iso) => {
  if (!iso) return "No deadline";

  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: new Date().getFullYear() !== Number(iso.slice(0, 4))
      ? "numeric"
      : undefined
  });
};

const icons = {
  edit: `
    <svg viewBox="0 0 24 24" width="18" height="18"
      fill="none" stroke="currentColor" stroke-width="1.8"
      stroke-linecap="round" stroke-linejoin="round"
      aria-hidden="true">
      <path d="M12 20h9"/>
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"/>
    </svg>
  `,
  delete: `
    <svg viewBox="0 0 24 24" width="18" height="18"
      fill="none" stroke="currentColor" stroke-width="1.8"
      stroke-linecap="round" stroke-linejoin="round"
      aria-hidden="true">
      <path d="M3 6h18"/>
      <path d="M8 6V4h8v2"/>
      <path d="m19 6-1 14H6L5 6"/>
      <path d="M10 11v5M14 11v5"/>
    </svg>
  `
};

// ========================================
// API AND CSRF
// ========================================

async function api(path, options = {}) {
  const headers = {
    Accept: "application/json",
    "X-CSRFToken": csrf,
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {})
  };

  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "same-origin",
    cache: "no-store"
  });

  const refreshedToken = response.headers.get("X-CSRFToken");

  if (refreshedToken) {
    csrf = refreshedToken;

    const meta = $('meta[name="csrf-token"]');

    if (meta) {
      meta.content = refreshedToken;
    }
  }

  const data = response.status === 204
    ? {}
    : await response.json().catch(() => ({}));

  if (!response.ok) {
    if (
      response.status === 401 &&
      !["/api/login", "/api/register"].includes(path)
    ) {
      showAuth();
    }

    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
}

// ========================================
// NOTIFICATIONS
// ========================================

function toast(message, bad = false) {
  const element = $("#toast");

  if (!element) return;

  element.textContent = message;
  element.classList.toggle("bad", bad);
  element.classList.add("show");

  clearTimeout(state.toastTimer);

  state.toastTimer = setTimeout(() => {
    element.classList.remove("show");
  }, 3000);
}

function notice(selector, message) {
  const element = $(selector);

  if (!element) return;

  element.textContent = message;
  element.hidden = false;
}

// ========================================
// AUTHENTICATION
// ========================================

function showAuth(mode = "login") {
  state.authMode = mode;

  $("#auth-view").hidden = false;
  $("#dashboard-view").hidden = true;

  $("#login-tab").classList.toggle("active", mode === "login");
  $("#register-tab").classList.toggle("active", mode === "register");

  $("#auth-title").textContent =
    mode === "login" ? "Welcome back" : "Create your account";

  $("#auth-subtitle").textContent =
    mode === "login"
      ? "Sign in and pick up where you left off."
      : "A private workspace for your next big thing.";

  $("#auth-submit").textContent =
    mode === "login" ? "Sign in ↗" : "Create account ↗";

  $("#password-hint").textContent =
    mode === "login"
      ? "Use your account password to continue."
      : "Use at least 12 characters for a stronger password.";

  $("#password").autocomplete =
    mode === "login" ? "current-password" : "new-password";

  $("#auth-error").hidden = true;
  $("#auth-form").reset();

  closeDeleteModal();
  closeModal();
}

function showDashboard(user) {
  state.user = user;

  $("#auth-view").hidden = true;
  $("#dashboard-view").hidden = false;

  $("#user-email").textContent = user.email;
  $("#avatar").textContent = user.email[0].toUpperCase();

  const now = new Date();
  const hour = now.getHours();

  $("#greeting").textContent =
    hour < 12
      ? "Good morning."
      : hour < 18
        ? "Good afternoon."
        : "Good evening.";

  $("#current-date").textContent = now.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });

  $("#today-label").textContent = now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric"
  }).toUpperCase();

  $("#year").textContent = now.getFullYear();
}

// ========================================
// TASK LOADING AND FILTERING
// ========================================

async function loadTasks() {
  const data = await api("/api/tasks");

  state.tasks = Array.isArray(data.tasks) ? data.tasks : [];

  render();
}

function visibleTasks() {
  const today = todayISO();
  const query = state.search.toLowerCase();

  return state.tasks.filter((task) => {
    const matchesText =
      `${task.title} ${task.description || ""} ${task.category || ""}`
        .toLowerCase()
        .includes(query);

    const matchesPriority =
      state.priority === "all" || task.priority === state.priority;

    const matchesFilter =
      state.filter === "all" ||
      (state.filter === "today" &&
        task.due_date === today &&
        !task.completed) ||
      (state.filter === "upcoming" &&
        task.due_date &&
        task.due_date > today &&
        !task.completed) ||
      (state.filter === "completed" && task.completed);

    return matchesText && matchesPriority && matchesFilter;
  });
}

// ========================================
// TASK RENDERING
// ========================================

function render() {
  const tasks = visibleTasks();
  const total = state.tasks.length;
  const completed = state.tasks.filter((task) => task.completed).length;
  const today = todayISO();

  const dueToday = state.tasks.filter(
    (task) => !task.completed && task.due_date === today
  ).length;

  const rate = total ? Math.round((completed / total) * 100) : 0;

  $("#stat-total").textContent = total;
  $("#stat-completed").textContent = completed;
  $("#stat-today").textContent = dueToday;
  $("#stat-rate").textContent = rate;
  $("#progress-bar").style.width = `${rate}%`;
  $("#nav-total").textContent = total;
  $("#list-count").textContent = tasks.length;

  const titles = {
    all: "All tasks",
    today: "Due today",
    upcoming: "Upcoming",
    completed: "Completed"
  };

  $("#list-title").childNodes[0].textContent =
    `${titles[state.filter]} `;

  $("#task-list").innerHTML = tasks.map((task) => {
    const overdue =
      task.due_date && task.due_date < today && !task.completed;

    const dueTodayClass =
      task.due_date === today && !task.completed;

    const dueClass =
      overdue ? "overdue" : dueTodayClass ? "due-today" : "";

    const dueText = overdue
      ? `Overdue · ${prettyDate(task.due_date)}`
      : dueTodayClass
        ? "Today"
        : prettyDate(task.due_date);

    const priority = ["high", "medium", "low"].includes(task.priority)
      ? task.priority
      : "medium";

    const priorityLabel =
      priority[0].toUpperCase() + priority.slice(1);

    const category = task.category || "General";
    const isToggling = state.togglingIds.has(task.id);

    return `
      <article
        class="task-row ${task.completed ? "is-complete" : ""}"
        data-id="${esc(task.id)}"
      >
        <div class="task-main">
          <input
            class="task-check"
            type="checkbox"
            data-action="toggle"
            aria-label="${task.completed ? "Mark active" : "Mark complete"}: ${esc(task.title)}"
            ${task.completed ? "checked" : ""}
            ${isToggling ? "disabled" : ""}
          >

          <div class="task-copy">
            <div class="task-title">${esc(task.title)}</div>

            ${task.description
              ? `<div class="task-description">${esc(task.description)}</div>`
              : ""}

            <span class="category">${esc(category)}</span>
          </div>
        </div>

        <div class="priority-cell">
          <span class="pill ${priority}">${priorityLabel}</span>
        </div>

        <div class="due ${dueClass}">${esc(dueText)}</div>

        <div class="status-cell">
          <span class="status ${task.completed ? "done" : ""}">
            ${task.completed ? "✓ Done" : "In progress"}
          </span>
        </div>

        <div class="actions task-icon-actions">
          <button
            class="task-icon-btn edit-icon"
            data-action="edit"
            type="button"
            aria-label="Edit ${esc(task.title)}"
            title="Edit task"
          >${icons.edit}</button>

          <button
            class="task-icon-btn delete-icon"
            data-action="delete"
            type="button"
            aria-label="Delete ${esc(task.title)}"
            title="Delete task"
          >${icons.delete}</button>
        </div>
      </article>
    `;
  }).join("");

  const empty = tasks.length === 0;

  $("#empty-state").hidden = !empty;
  $("#task-list").hidden = empty;

  if (empty) {
    const hasTasks = state.tasks.length > 0;

    $("#empty-title").textContent =
      hasTasks ? "No tasks match this view." : "A fresh start.";

    $("#empty-copy").textContent =
      hasTasks
        ? "Try another filter or search term."
        : "Add your first task and turn plans into progress.";

    $("#empty-create").hidden = hasTasks;
  }

  $("#footer-summary").textContent = total
    ? `${completed} of ${total} tasks completed`
    : "Ready when you are.";

  document.querySelectorAll(".nav").forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.filter === state.filter
    );
  });
}

// ========================================
// CREATE / EDIT TASK MODAL
// ========================================

function openModal(task = null) {
  closeDeleteModal();

  state.editingId = task ? task.id : null;

  $("#task-form").reset();
  $("#task-error").hidden = true;

  $("#modal-title").textContent =
    task ? "Edit task" : "Create a task";

  $("#task-title").value = task?.title || "";
  $("#task-description").value = task?.description || "";

  $("#task-category").value =
    task?.category === "General" ? "" : task?.category || "";

  $("#task-priority").value = task?.priority || "medium";
  $("#task-due").value = task?.due_date || "";

  $("#modal").hidden = false;
  document.body.style.overflow = "hidden";

  setTimeout(() => $("#task-title").focus(), 50);
}

function closeModal() {
  const modal = $("#modal");

  if (!modal) return;

  modal.hidden = true;
  state.editingId = null;

  if ($("#deleteModal").hidden) {
    document.body.style.overflow = "";
  }
}

// ========================================
// DELETE CONFIRMATION MODAL
// ========================================

function openDeleteModal(task) {
  if (state.deleting) return;

  closeModal();

  state.deletingId = task.id;

  $("#deleteTaskTitle").textContent = task.title;
  $("#delete-task-error").textContent = "";
  $("#delete-task-error").hidden = true;

  $("#cancelDeleteBtn").disabled = false;
  $("#confirmDeleteBtn").disabled = false;
  $("#confirmDeleteText").textContent = "Delete Task";

  $("#deleteModal").hidden = false;
  document.body.style.overflow = "hidden";

  setTimeout(() => $("#deleteModal .delete-modal").focus(), 50);
}

function closeDeleteModal() {
  const modal = $("#deleteModal");

  if (!modal || state.deleting) return;

  modal.hidden = true;
  state.deletingId = null;

  if ($("#modal").hidden) {
    document.body.style.overflow = "";
  }
}

async function confirmDeleteTask() {
  if (state.deleting || state.deletingId === null) return;

  const taskId = state.deletingId;
  const task = state.tasks.find((item) => item.id === taskId);

  if (!task) {
    closeDeleteModal();
    toast("This task could not be found. Refreshing your task list.", true);

    try {
      await loadTasks();
    } catch (error) {
      toast(error.message, true);
    }

    return;
  }

  state.deleting = true;

  const confirmButton = $("#confirmDeleteBtn");
  const cancelButton = $("#cancelDeleteBtn");
  const confirmText = $("#confirmDeleteText");

  confirmButton.disabled = true;
  cancelButton.disabled = true;
  confirmText.textContent = "Deleting…";

  $("#delete-task-error").hidden = true;

  try {
    await api(`/api/tasks/${taskId}`, { method: "DELETE" });

    state.tasks = state.tasks.filter((item) => item.id !== taskId);

    $("#deleteModal").hidden = true;
    state.deletingId = null;
    document.body.style.overflow = "";

    render();
    toast("Task deleted successfully.");
  } catch (error) {
    $("#delete-task-error").textContent =
      error.message || "Unable to delete this task. Please try again.";

    $("#delete-task-error").hidden = false;
    toast("The task could not be deleted.", true);
  } finally {
    state.deleting = false;
    confirmButton.disabled = false;
    cancelButton.disabled = false;
    confirmText.textContent = "Delete Task";
  }
}

// ========================================
// FORM SUBMISSIONS
// ========================================

async function submitAuth(event) {
  event.preventDefault();

  $("#auth-error").hidden = true;

  const email = $("#email").value.trim();
  const password = $("#password").value;
  const mode = state.authMode;

  $("#auth-submit").disabled = true;

  try {
    const result = await api(
      mode === "login" ? "/api/login" : "/api/register",
      {
        method: "POST",
        body: JSON.stringify({ email, password })
      }
    );

    showDashboard(result.user);

    try {
      await loadTasks();
    } catch (error) {
      toast("Signed in, but tasks could not be loaded. Please retry.", true);
      return;
    }

    toast(mode === "login" ? "Welcome back!" : "Your workspace is ready.");
  } catch (error) {
    notice("#auth-error", error.message);
  } finally {
    $("#auth-submit").disabled = false;
  }
}

async function submitTask(event) {
  event.preventDefault();

  $("#task-error").hidden = true;

  const existing = state.tasks.find(
    (task) => task.id === state.editingId
  );

  const payload = {
    title: $("#task-title").value.trim(),
    description: $("#task-description").value.trim(),
    category: $("#task-category").value.trim() || "General",
    priority: $("#task-priority").value,
    due_date: $("#task-due").value || null,
    completed: existing ? existing.completed : false
  };

  const editing = state.editingId !== null;
  const taskId = state.editingId;

  const saveButton = $("#task-form button[type='submit']");
  saveButton.disabled = true;

  try {
    await api(
      editing ? `/api/tasks/${taskId}` : "/api/tasks",
      {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(payload)
      }
    );

    closeModal();

    try {
      await loadTasks();
    } catch (error) {
      toast("Task saved, but refreshing the task list failed.", true);
      return;
    }

    toast(editing ? "Task updated." : "Task created.");
  } catch (error) {
    notice("#task-error", error.message);
  } finally {
    saveButton.disabled = false;
  }
}

// ========================================
// TASK ACTIONS
// ========================================

async function taskAction(event) {
  const button = event.target.closest("[data-action]");

  if (!button || button.disabled) return;

  const row = button.closest(".task-row");

  if (!row) return;

  const taskId = Number(row.dataset.id);
  const task = state.tasks.find((item) => item.id === taskId);

  if (!task) return;

  const action = button.dataset.action;

  if (action === "edit") {
    openModal(task);
    return;
  }

  if (action === "delete") {
    openDeleteModal(task);
    return;
  }

    if (action !== "toggle") return;

  if (state.togglingIds.has(taskId)) return;

  const completed = button.checked;
  const previousCompleted = Boolean(task.completed);

  const payload = {
    title: task.title,
    description: task.description || "",
    category: task.category || "General",
    priority: task.priority,
    due_date: task.due_date || null,
    completed
  };

  state.togglingIds.add(taskId);
  button.disabled = true;

  // Update the interface immediately.
  task.completed = completed;
  render();

  try {
    await api(`/api/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });

    toast(
      completed
        ? "Nice work—task completed!"
        : "Task moved back to active."
    );
  } catch (error) {
    // Restore the previous state if the server rejects the update.
    task.completed = previousCompleted;
    render();

    toast(error.message || "Could not update the task.", true);
  } finally {
    state.togglingIds.delete(taskId);
  }
}

// ========================================
// INITIALIZATION
// ========================================

async function boot() {
  $("#auth-form").addEventListener("submit", submitAuth);
  $("#task-form").addEventListener("submit", submitTask);

  $("#login-tab").addEventListener("click", () => showAuth("login"));
  $("#register-tab").addEventListener("click", () => showAuth("register"));

  $("#toggle-password").addEventListener("click", () => {
    const password = $("#password");

    password.type =
      password.type === "password" ? "text" : "password";

    $("#toggle-password").textContent =
      password.type === "password" ? "Show" : "Hide";
  });

  $("#new-task").addEventListener("click", () => openModal());
  $("#empty-create").addEventListener("click", () => openModal());

  $("#close-modal").addEventListener("click", closeModal);
  $("#cancel-modal").addEventListener("click", closeModal);

  $("#modal").addEventListener("click", (event) => {
    if (event.target === $("#modal")) closeModal();
  });

  $("#cancelDeleteBtn").addEventListener("click", closeDeleteModal);
  $("#confirmDeleteBtn").addEventListener("click", confirmDeleteTask);

  $("#deleteModal").addEventListener("click", (event) => {
    if (event.target === $("#deleteModal")) closeDeleteModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;

    if (!$("#deleteModal").hidden) {
      closeDeleteModal();
    } else if (!$("#modal").hidden) {
      closeModal();
    }
  });

  $("#task-list").addEventListener("click", taskAction);

  $("#task-list").addEventListener("change", (event) => {
    if (event.target.matches('[data-action="toggle"]')) {
      taskAction(event);
    }
  });

  document.querySelectorAll(".nav").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      render();
    });
  });

  $("#search").addEventListener("input", (event) => {
    state.search = event.target.value;
    render();
  });

  $("#priority-filter").addEventListener("change", (event) => {
    state.priority = event.target.value;
    render();
  });

  $("#logout").addEventListener("click", async () => {
    try {
      await api("/api/logout", { method: "POST" });
    } catch (error) {
      toast(error.message || "Sign-out request failed.", true);
      return;
    }

    state.user = null;
    state.tasks = [];
    state.filter = "all";
    state.search = "";
    state.priority = "all";
    state.togglingIds.clear();

    $("#search").value = "";
    $("#priority-filter").value = "all";

    render();
    showAuth();

    toast("You have signed out.");
  });

  try {
    const result = await api("/api/me");

    if (result.user) {
      showDashboard(result.user);

      try {
        await loadTasks();
      } catch (error) {
        toast("Your session is active, but tasks could not be loaded.", true);
      }
    } else {
      showAuth();
    }
  } catch (error) {
    showAuth();
  }
}

document.addEventListener("DOMContentLoaded", boot);
