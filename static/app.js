"use strict";

const $ = (selector) => document.querySelector(selector);

let csrf = $('meta[name="csrf-token"]')?.content || "";

const state = {
  user: null,
  tasks: [],
  filter: "all",
  search: "",
  priority: "all",
  statusFilter: "all",
  dueDateFilter: "all",
  editingId: null,
  deletingId: null,
  deleting: false,
  authMode: "login",
  toastTimer: null,
  togglingIds: new Set(),
  view: "list",
  movingIds: new Set()
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

  document.dispatchEvent(new Event("tasktrack:tasks-updated"));
}

function visibleTasks() {
  const today = todayISO();
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  const nextWeekISO = `${nextWeek.getFullYear()}-${String(nextWeek.getMonth() + 1).padStart(2, "0")}-${String(nextWeek.getDate()).padStart(2, "0")}`;
  const query = state.search.trim().toLocaleLowerCase();

  return state.tasks.filter((task) => {
    const searchableText = [
      task.title,
      task.category,
      task.description,
      task.notes
    ].filter(Boolean).join(" ").toLocaleLowerCase();

    const matchesText = searchableText.includes(query);
    const matchesPriority =
      state.priority === "all" || task.priority === state.priority;
    const status = normalizedStatus(task);
    const matchesStatus =
      state.statusFilter === "all" || status === state.statusFilter;
    const dueDate = task.due_date || "";
    const matchesDueDate =
      state.dueDateFilter === "all" ||
      (state.dueDateFilter === "today" && dueDate === today) ||
      (state.dueDateFilter === "overdue" && dueDate && dueDate < today && status !== "done") ||
      (state.dueDateFilter === "next7" && dueDate > today && dueDate <= nextWeekISO) ||
      (state.dueDateFilter === "no-date" && !dueDate);

    const matchesNavigation =
      state.filter === "all" ||
      (state.filter === "today" && dueDate === today && status !== "done") ||
      (state.filter === "upcoming" && dueDate && dueDate > today && status !== "done") ||
      (state.filter === "overdue" && dueDate && dueDate < today && status !== "done") ||
      (state.filter === "completed" && status === "done");

    return matchesText && matchesPriority && matchesStatus &&
      matchesDueDate && matchesNavigation;
  });
}
// ========================================
// TASK RENDERING
// ========================================


function normalizedStatus(task) {
  if (task.status === "done" || task.completed) return "done";
  if (task.status === "in_progress") return "in_progress";
  return "todo";
}

function renderKanbanBoard(tasks) {
  const columns = [
    { status: "todo", title: "To Do", hint: "Ready when you are" },
    { status: "in_progress", title: "In Progress", hint: "Work in motion" },
    { status: "done", title: "Done", hint: "Look what you did" }
  ];
  $("#kanban-board").innerHTML = columns.map((column) => {
    const items = tasks.filter((task) => normalizedStatus(task) === column.status);
    return `<section class="kanban-column" data-status="${column.status}">
      <header class="kanban-column-head"><div><h3>${column.title}</h3><p>${column.hint}</p></div><span class="kanban-count">${items.length}</span></header>
      <div class="kanban-dropzone" data-drop-status="${column.status}">
      ${items.map((task) => {
        const priority = ["high", "medium", "low"].includes(task.priority) ? task.priority : "medium";
        const due = task.due_date ? prettyDate(task.due_date) : "No due date";
        const moving = state.movingIds.has(task.id);
        return `<article class="kanban-card task-row ${task.completed ? "is-complete" : ""}" data-id="${esc(task.id)}" draggable="${moving ? "false" : "true"}">
          <div class="kanban-card-top"><span class="pill ${priority}">${priority[0].toUpperCase()+priority.slice(1)}</span><span class="kanban-due">${esc(due)}</span></div>
          <h4>${esc(task.title)}</h4>${task.description ? `<p class="kanban-description">${esc(task.description)}</p>` : ""}
          <span class="category">${esc(task.category || "General")}</span>
          <div class="kanban-card-bottom"><label class="kanban-status-label" for="status-${esc(task.id)}">Status</label>
            <select id="status-${esc(task.id)}" class="kanban-status-select" data-action="status" aria-label="Status for ${esc(task.title)}" ${moving ? "disabled" : ""}>
              <option value="todo" ${column.status === "todo" ? "selected" : ""}>To Do</option><option value="in_progress" ${column.status === "in_progress" ? "selected" : ""}>In Progress</option><option value="done" ${column.status === "done" ? "selected" : ""}>Done</option>
            </select><div class="actions task-icon-actions"><button class="task-icon-btn edit-icon" data-action="edit" type="button" aria-label="Edit ${esc(task.title)}" title="Edit task">${icons.edit}</button><button class="task-icon-btn delete-icon" data-action="delete" type="button" aria-label="Delete ${esc(task.title)}" title="Delete task">${icons.delete}</button></div>
          </div></article>`;
      }).join("") || `<p class="kanban-empty">Drop a task here</p>`}
      </div></section>`;
  }).join("");
}

async function changeTaskStatus(taskId, status) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task || state.movingIds.has(taskId)) return;
  const previous = { status: normalizedStatus(task), completed: Boolean(task.completed) };
  state.movingIds.add(taskId);
  task.status = status;
  task.completed = status === "done";
  render();
  try {
    const data = await api(`/api/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ title: task.title, description: task.description || "", category: task.category || "General", priority: task.priority, due_date: task.due_date || null, status }) });
    if (data.task) Object.assign(task, data.task);

document.dispatchEvent(new Event("tasktrack:tasks-updated"));

toast(
  status === "done"
    ? "Task completed!"
    : status === "in_progress"
      ? "Task moved to In Progress."
      : "Task moved to To Do."
);
  } catch (error) {
    task.status = previous.status;
    task.completed = previous.completed;
    toast(error.message || "Could not update task status.", true);
  } finally {
    state.movingIds.delete(taskId);
    render();
  }
}

function render() {
  const tasks = visibleTasks();
  const total = state.tasks.length;
  const completed = state.tasks.filter((task) => task.completed).length;
  const today = todayISO();

  const activeTasks = state.tasks.filter((task) => !task.completed);
  const overdueTasks = activeTasks
    .filter((task) => task.due_date && task.due_date < today)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  const todayTasks = activeTasks
    .filter((task) => task.due_date === today)
    .sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.priority] ?? 1) - ({ high: 0, medium: 1, low: 2 }[b.priority] ?? 1));
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  const nextWeekISO = `${nextWeek.getFullYear()}-${String(nextWeek.getMonth() + 1).padStart(2, "0")}-${String(nextWeek.getDate()).padStart(2, "0")}`;
  const upcomingTasks = activeTasks.filter(
    (task) => task.due_date && task.due_date > today && task.due_date <= nextWeekISO
  );
  const dueToday = todayTasks.length;

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
    overdue: "Overdue tasks",
    completed: "Completed"
  };

  $("#list-title").childNodes[0].textContent =
    `${titles[state.filter]} `;

  $("#nav-overdue").textContent = overdueTasks.length;
  $("#focus-date").textContent = new Date().toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric"
  });
  $("#focus-overdue-count").textContent = overdueTasks.length;
  $("#focus-overdue-copy").textContent = overdueTasks.length
    ? `${overdueTasks.length === 1 ? "Task is" : "Tasks are"} past the due date.`
    : "No overdue tasks. Nice work.";
  $("#focus-today-count").textContent = todayTasks.length;
  $("#focus-today-copy").textContent = todayTasks.length
    ? `${todayTasks.length} ${todayTasks.length === 1 ? "task needs" : "tasks need"} attention today.`
    : "Nothing due today. Keep your pace.";
  $("#focus-upcoming-count").textContent = upcomingTasks.length;
  $("#focus-upcoming-copy").textContent = upcomingTasks.length
    ? `Due between now and ${prettyDate(nextWeekISO)}.`
    : "Your upcoming week is clear.";

  const queueTasks = [...overdueTasks, ...todayTasks]
    .filter((task, index, items) => items.findIndex((item) => item.id === task.id) === index)
    .slice(0, 3);
  $("#focus-queue-count").textContent = `${queueTasks.length} shown`;
  $("#focus-queue-list").innerHTML = queueTasks.length
    ? queueTasks.map((task) => {
        const isOverdue = task.due_date < today;
        const priority = ["high", "medium", "low"].includes(task.priority) ? task.priority : "medium";
        return `<div class="focus-queue-item">
          <span class="queue-priority ${priority}" aria-hidden="true"></span>
          <div class="queue-task-copy"><strong>${esc(task.title)}</strong><small>${esc(task.category || "General")} · ${isOverdue ? `Overdue ${esc(prettyDate(task.due_date))}` : "Due today"}</small></div>
          <span class="pill ${priority}">${priority[0].toUpperCase() + priority.slice(1)}</span>
        </div>`;
      }).join("")
    : `<div class="focus-queue-empty"><span>✦</span><div><strong>You're clear for today</strong><small>Add a due date to a task to see it in your focus queue.</small></div></div>`;

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
  renderKanbanBoard(tasks);
  const boardView = state.view === "board";
  $("#list-view-btn").classList.toggle("active", !boardView);
  $("#board-view-btn").classList.toggle("active", boardView);
  $("#list-view-btn").setAttribute("aria-pressed", String(!boardView));
  $("#board-view-btn").setAttribute("aria-pressed", String(boardView));
  $(".table-head").hidden = boardView;
  $("#task-list").hidden = boardView || empty;
  $("#kanban-board").hidden = !boardView || empty;
  $("#empty-state").hidden = !empty;

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
document.dispatchEvent(new Event("tasktrack:tasks-updated"));
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

document.dispatchEvent(new Event("tasktrack:tasks-updated"));

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


const commandPaletteState = {
  query: "",
  selectedIndex: 0,
  visibleCommands: []
};

const commandDefinitions = [
  { id: "create-task", label: "Create a task", description: "Open the quick task form", keywords: "new add quick task deadline" },
  { id: "focus-search", label: "Search tasks", description: "Jump to title, category, and notes search", keywords: "find search notes category title" },
  { id: "clear-filters", label: "Clear all filters", description: "Reset search, status, priority, and due date", keywords: "reset clear all filters" },
  { id: "filter-all", label: "Show all tasks", description: "Return to the complete task list", keywords: "overview everything all tasks" },
  { id: "filter-today", label: "Show tasks due today", description: "Focus on today's work", keywords: "today due focus" },
  { id: "filter-overdue", label: "Show overdue tasks", description: "Review past-due work", keywords: "overdue late missed" },
  { id: "filter-upcoming", label: "Show upcoming tasks", description: "Look ahead at upcoming deadlines", keywords: "upcoming future plan" },
  { id: "filter-completed", label: "Show completed tasks", description: "Review finished work", keywords: "completed done finished" },
  { id: "view-list", label: "Switch to list view", description: "Show tasks as rows", keywords: "list rows table" },
  { id: "view-board", label: "Switch to Kanban board", description: "Show To Do, In Progress, and Done columns", keywords: "board kanban columns drag" },
  { id: "calendar-month", label: "Open calendar month view", description: "Plan across a full month", keywords: "calendar month planning" },
  { id: "calendar-week", label: "Open calendar week view", description: "Plan the current selected week", keywords: "calendar week planning" }
];

function clearAllFilters() {
  state.filter = "all";
  state.search = "";
  state.priority = "all";
  state.statusFilter = "all";
  state.dueDateFilter = "all";
  $("#search").value = "";
  $("#priority-filter").value = "all";
  $("#status-filter").value = "all";
  $("#due-date-filter").value = "all";
  render();
}

function setNavigationFilter(filter) {
  state.filter = filter;
  render();
  document.querySelector(".task-panel")?.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function renderCommandPalette() {
  const list = $("#command-list");
  if (!list) return;

  const query = commandPaletteState.query.trim().toLocaleLowerCase();
  commandPaletteState.visibleCommands = commandDefinitions.filter((command) =>
    (command.label + " " + command.description + " " + command.keywords)
      .toLocaleLowerCase().includes(query)
  );

  if (!commandPaletteState.visibleCommands.length) {
    list.innerHTML = '<p class="command-empty">No matching actions. Try another search.</p>';
    commandPaletteState.selectedIndex = 0;
    return;
  }

  commandPaletteState.selectedIndex = Math.min(
    commandPaletteState.selectedIndex,
    commandPaletteState.visibleCommands.length - 1
  );

  list.innerHTML = commandPaletteState.visibleCommands.map((command, index) =>
    '<button type="button" role="option" class="command-option ' +
      (index === commandPaletteState.selectedIndex ? "is-selected" : "") +
      '" data-command-id="' + esc(command.id) + '" aria-selected="' +
      (index === commandPaletteState.selectedIndex ? "true" : "false") + '">' +
      '<span class="command-option-icon" aria-hidden="true">' +
        (command.id === "create-task" ? "+" :
         command.id === "focus-search" ? "⌕" :
         command.id.startsWith("calendar-") ? "▦" :
         command.id.startsWith("view-") ? "▤" : "↗") +
      '</span>' +
      '<span class="command-option-copy"><strong>' + esc(command.label) +
      '</strong><small>' + esc(command.description) + '</small></span>' +
      '<span class="command-option-shortcut">' + esc(command.shortcut || "↵") + '</span>' +
    '</button>'
  ).join("");
}

function openCommandPalette() {
  if (!state.user || !$("#dashboard-view") || $("#dashboard-view").hidden) return;
  if (!$("#modal").hidden || !$("#deleteModal").hidden) return;

  $("#command-palette").hidden = false;
  document.body.style.overflow = "hidden";
  commandPaletteState.query = "";
  commandPaletteState.selectedIndex = 0;
  $("#command-search").value = "";
  renderCommandPalette();
  $("#command-search").focus();
}

function closeCommandPalette() {
  const palette = $("#command-palette");
  if (!palette || palette.hidden) return;
  palette.hidden = true;
  if ($("#modal").hidden && $("#deleteModal").hidden) {
    document.body.style.overflow = "";
  }
}

function runCommand(commandId) {
  closeCommandPalette();

  switch (commandId) {
    case "create-task":
      openModal();
      break;
    case "focus-search":
      $("#search").focus();
      $(".task-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      break;
    case "clear-filters":
      clearAllFilters();
      break;
    case "filter-all":
      setNavigationFilter("all");
      break;
    case "filter-today":
      setNavigationFilter("today");
      break;
    case "filter-overdue":
      setNavigationFilter("overdue");
      break;
    case "filter-upcoming":
      setNavigationFilter("upcoming");
      break;
    case "filter-completed":
      setNavigationFilter("completed");
      break;
    case "view-list":
      state.view = "list";
      render();
      $(".task-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      break;
    case "view-board":
      state.view = "board";
      render();
      $(".task-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      break;
    case "calendar-month":
      $("#calendar-month-view")?.click();
      $("#calendar-planning-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      break;
    case "calendar-week":
      $("#calendar-week-view")?.click();
      $("#calendar-planning-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      break;
    default:
      break;
  }
}

function selectCommandAt(index) {
  const total = commandPaletteState.visibleCommands.length;
  if (!total) return;
  commandPaletteState.selectedIndex = (index + total) % total;
  renderCommandPalette();
  $("#command-list [aria-selected='true']")?.scrollIntoView({ block: "nearest" });
}

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

  document.addEventListener("tasktrack:calendar-task-selected", (event) => {
    const taskId = Number(event.detail?.taskId);
    const task = state.tasks.find((item) => Number(item.id) === taskId);
    if (task) openModal(task);
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

    if (!$("#command-palette").hidden) {
      closeCommandPalette();
    } else if (!$("#deleteModal").hidden) {
      closeDeleteModal();
    } else if (!$("#modal").hidden) {
      closeModal();
    }
  });

  $("#task-list").addEventListener("click", taskAction);
  $("#kanban-board").addEventListener("click", taskAction);
  $("#list-view-btn").addEventListener("click", () => { state.view = "list"; render(); });
  $("#board-view-btn").addEventListener("click", () => { state.view = "board"; render(); });
  $("#kanban-board").addEventListener("change", (event) => {
    if (!event.target.matches('[data-action="status"]')) return;
    const card = event.target.closest(".task-row");
    if (card) changeTaskStatus(Number(card.dataset.id), event.target.value);
  });
  $("#kanban-board").addEventListener("dragstart", (event) => {
    const card = event.target.closest(".kanban-card");
    if (!card || state.movingIds.has(Number(card.dataset.id))) { event.preventDefault(); return; }
    event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", card.dataset.id); card.classList.add("is-dragging");
  });
  $("#kanban-board").addEventListener("dragend", (event) => {
    const card = event.target.closest(".kanban-card"); if (card) card.classList.remove("is-dragging");
    document.querySelectorAll(".kanban-dropzone.is-over").forEach((zone) => zone.classList.remove("is-over"));
  });
  $("#kanban-board").addEventListener("dragover", (event) => {
    const zone = event.target.closest("[data-drop-status]"); if (!zone) return;
    event.preventDefault(); event.dataTransfer.dropEffect = "move"; zone.classList.add("is-over");
  });
  $("#kanban-board").addEventListener("dragleave", (event) => {
    const zone = event.target.closest("[data-drop-status]"); if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove("is-over");
  });
  $("#kanban-board").addEventListener("drop", (event) => {
    const zone = event.target.closest("[data-drop-status]"); if (!zone) return;
    event.preventDefault(); zone.classList.remove("is-over");
    const id = Number(event.dataTransfer.getData("text/plain")); if (Number.isFinite(id)) changeTaskStatus(id, zone.dataset.dropStatus);
  });

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

  document.querySelectorAll("[data-focus-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.focusFilter;
      $("#search").value = "";
      state.search = "";
      render();
      $(".task-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
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

  $("#status-filter").addEventListener("change", (event) => {
    state.statusFilter = event.target.value;
    render();
  });

  $("#due-date-filter").addEventListener("change", (event) => {
    state.dueDateFilter = event.target.value;
    render();
  });

  $("#clear-filters").addEventListener("click", clearAllFilters);

  $("#open-command-palette").addEventListener("click", openCommandPalette);
  $("#close-command-palette").addEventListener("click", closeCommandPalette);
  $("#command-palette").addEventListener("click", (event) => {
    if (event.target === $("#command-palette")) closeCommandPalette();
  });

  $("#command-search").addEventListener("input", (event) => {
    commandPaletteState.query = event.target.value;
    commandPaletteState.selectedIndex = 0;
    renderCommandPalette();
  });

  $("#command-search").addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      selectCommandAt(commandPaletteState.selectedIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      selectCommandAt(commandPaletteState.selectedIndex - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const command = commandPaletteState.visibleCommands[commandPaletteState.selectedIndex];
      if (command) runCommand(command.id);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeCommandPalette();
    }
  });

  $("#command-list").addEventListener("click", (event) => {
    const option = event.target.closest("[data-command-id]");
    if (option) runCommand(option.dataset.commandId);
  });

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if ($("#command-palette").hidden) openCommandPalette();
      else closeCommandPalette();
    }
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
    state.statusFilter = "all";
    state.dueDateFilter = "all";
    state.togglingIds.clear();

    $("#search").value = "";
    $("#priority-filter").value = "all";
    $("#status-filter").value = "all";
    $("#due-date-filter").value = "all";

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
