"use strict";

(() => {
  const $ = (selector) => document.querySelector(selector);
  const calendarState = {
    tasks: [],
    month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    selectedDate: null,
    view: "month",
    draggingTaskId: null,
    rescheduling: false
  };

  const todayISO = () => {
    const now = new Date();
    return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
  };

  const dateToISO = (date) => [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");

  const parseISO = (iso) => {
    const [year, month, day] = String(iso).split("-").map(Number);
    return new Date(year, month - 1, day);
  };

  const escapeHTML = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);

  const formatDate = (iso) => {
    if (!iso) return "No deadline";
    const [year, month, day] = iso.split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString(undefined, {
      month: "short", day: "numeric",
      year: year !== new Date().getFullYear() ? "numeric" : undefined
    });
  };

  const monthLabel = (date) => date.toLocaleDateString(undefined, {
    month: "long", year: "numeric"
  });

  const formatWeekLabel = (start, end) => {
    const sameYear = start.getFullYear() === end.getFullYear();
    const sameMonth = sameYear && start.getMonth() === end.getMonth();
    const startText = start.toLocaleDateString(undefined, {
      month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" })
    });
    const endText = end.toLocaleDateString(undefined, {
      ...(sameMonth ? {} : { month: "short" }), day: "numeric", year: "numeric"
    });
    if (sameMonth) {
      return start.toLocaleDateString(undefined, { month: "short" }) +
        " " + start.getDate() + "–" + end.getDate() + ", " + end.getFullYear();
    }
    return startText + " – " + endText;
  };

  function showFeedback(message, isError = false) {
    const feedback = $("#calendar-feedback");
    if (!feedback) return;
    feedback.textContent = message;
    feedback.classList.toggle("is-error", isError);
  }

  async function loadCalendarTasks() {
    const response = await fetch("/api/tasks", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error("Unable to load calendar tasks (" + response.status + ").");
    const data = await response.json();
    const tasks = Array.isArray(data) ? data : data?.tasks;
    calendarState.tasks = Array.isArray(tasks) ? tasks : [];
    renderCalendar();
  }

  function renderDeadlines() {
    const container = $("#calendar-deadlines");
    if (!container) return;
    const today = todayISO();
    const deadlines = calendarState.tasks
      .filter((task) => task.due_date && !(task.completed || task.status === "done"))
      .sort((a, b) => a.due_date.localeCompare(b.due_date));
    const overdue = deadlines.filter((task) => task.due_date < today);
    const upcoming = deadlines.filter((task) => task.due_date >= today);
    const visible = [...overdue, ...upcoming].slice(0, 8);

    if (!visible.length) {
      container.innerHTML = "<div class=\"calendar-empty\"><strong>You're all caught up.</strong><span>Tasks with deadlines will appear here.</span></div>";
      return;
    }

    container.innerHTML = visible.map((task) => {
      const isOverdue = task.due_date < today;
      const priority = ["high", "medium", "low"].includes(task.priority) ? task.priority : "medium";
      return `
        <article class="calendar-deadline ${isOverdue ? "is-overdue" : ""}">
          <span class="calendar-priority ${priority}" aria-hidden="true"></span>
          <div class="calendar-deadline-copy">
            <strong>${escapeHTML(task.title)}</strong>
            <span>${isOverdue ? "Overdue" : "Due"} - ${escapeHTML(formatDate(task.due_date))}</span>
          </div>
          <span class="calendar-priority-label ${priority}">${escapeHTML(priority)}</span>
        </article>
      `;
    }).join("");
  }

  function tasksGroupedByDate() {
    const tasksByDate = new Map();
    calendarState.tasks.forEach((task) => {
      if (!task.due_date) return;
      if (!tasksByDate.has(task.due_date)) tasksByDate.set(task.due_date, []);
      tasksByDate.get(task.due_date).push(task);
    });
    return tasksByDate;
  }

  function renderDateCell(iso, tasksByDate) {
    const tasks = tasksByDate.get(iso) || [];
    const activeTasks = tasks.filter((task) => !(task.completed || task.status === "done"));
    const isOverdue = iso < todayISO() && activeTasks.length > 0;
    const isSelected = iso === calendarState.selectedDate;
    const isToday = iso === todayISO();
    const taskMarkup = tasks.slice(0, 2).map((task) => {
      const completed = task.completed || task.status === "done";
      const draggable = !completed;
      return `
        <span class="calendar-day-task ${completed ? "is-complete" : ""}"
          data-calendar-task-id="${escapeHTML(task.id)}"
          draggable="${draggable ? "true" : "false"}"
          title="${draggable ? "Drag to another date to reschedule" : "Completed task"}; click to edit">
          ${escapeHTML(task.title)}
        </span>
      `;
    }).join("");
    const extra = tasks.length > 2
      ? `<span class="calendar-day-more">+${tasks.length - 2} more</span>`
      : "";
    const dateLabel = formatDate(iso);

    return `
      <button type="button"
        class="calendar-day ${isToday ? "is-today" : ""} ${isOverdue ? "has-overdue" : ""} ${isSelected ? "is-selected" : ""}"
        data-calendar-date="${iso}"
        aria-label="Select ${escapeHTML(dateLabel)}; ${tasks.length} tasks"
        aria-pressed="${isSelected}"
        title="Create a task due ${escapeHTML(dateLabel)}">
        <span class="calendar-day-number">${parseISO(iso).getDate()}</span>
        <span class="calendar-day-tasks">${taskMarkup}${extra}</span>
      </button>
    `;
  }

  function renderGrid(dates, leadingCells = 0, padTrailing = true) {
    const grid = $("#calendar-grid");
    if (!grid) return;
    grid.classList.toggle("is-week-view", calendarState.view === "week");
    const tasksByDate = tasksGroupedByDate();
    const cells = [];

    for (let i = 0; i < leadingCells; i += 1) {
      cells.push('<div class="calendar-day is-empty" aria-hidden="true"></div>');
    }
    dates.forEach((date) => cells.push(renderDateCell(dateToISO(date), tasksByDate)));

    if (padTrailing) {
      while (cells.length % 7 !== 0) {
        cells.push('<div class="calendar-day is-empty" aria-hidden="true"></div>');
      }
    }

    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
      .map((day) => '<div class="calendar-weekday">' + day + '</div>')
      .join("");
    grid.innerHTML = weekdays + cells.join("");
  }

  function renderMonth() {
    const heading = $("#calendar-month-label");
    if (!heading) return;
    const month = calendarState.month;
    const year = month.getFullYear();
    const monthIndex = month.getMonth();
    const firstWeekday = new Date(year, monthIndex, 1).getDay();
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const dates = Array.from({ length: daysInMonth }, (_, index) =>
      new Date(year, monthIndex, index + 1)
    );
    heading.textContent = monthLabel(month);
    renderGrid(dates, firstWeekday, true);
  }

  function renderWeek() {
    const heading = $("#calendar-month-label");
    if (!heading) return;
    const now = new Date();
    const referenceISO = calendarState.selectedDate ||
      (calendarState.month.getFullYear() === now.getFullYear() &&
       calendarState.month.getMonth() === now.getMonth()
        ? todayISO()
        : dateToISO(calendarState.month));
    const start = parseISO(referenceISO);
    start.setDate(start.getDate() - start.getDay());
    const dates = Array.from({ length: 7 }, (_, index) =>
      new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)
    );
    const end = dates[dates.length - 1];
    heading.textContent = formatWeekLabel(dates[0], end);
    renderGrid(dates, 0, false);
  }

  function updateViewControls() {
    const monthButton = $("#calendar-month-view");
    const weekButton = $("#calendar-week-view");
    if (monthButton) {
      monthButton.classList.toggle("is-active", calendarState.view === "month");
      monthButton.setAttribute("aria-pressed", String(calendarState.view === "month"));
    }
    if (weekButton) {
      weekButton.classList.toggle("is-active", calendarState.view === "week");
      weekButton.setAttribute("aria-pressed", String(calendarState.view === "week"));
    }
  }

  function renderCalendar() {
    if (calendarState.view === "week") renderWeek();
    else renderMonth();
    updateViewControls();
    renderDeadlines();
  }

  function changePeriod(direction) {
    if (calendarState.view === "month") {
      calendarState.month = new Date(
        calendarState.month.getFullYear(),
        calendarState.month.getMonth() + direction,
        1
      );
    } else {
      const current = parseISO(calendarState.selectedDate || todayISO());
      current.setDate(current.getDate() + direction * 7);
      calendarState.selectedDate = dateToISO(current);
      calendarState.month = new Date(current.getFullYear(), current.getMonth(), 1);
    }
    renderCalendar();
  }

  function switchView(view) {
    if (!["month", "week"].includes(view)) return;
    if (view === "week" && !calendarState.selectedDate) {
      const now = new Date();
      const visibleMonthIsCurrent =
        calendarState.month.getFullYear() === now.getFullYear() &&
        calendarState.month.getMonth() === now.getMonth();
      calendarState.selectedDate = visibleMonthIsCurrent
        ? todayISO()
        : dateToISO(calendarState.month);
    }
    if (view === "month" && calendarState.selectedDate) {
      const selected = parseISO(calendarState.selectedDate);
      calendarState.month = new Date(selected.getFullYear(), selected.getMonth(), 1);
    }
    calendarState.view = view;
    renderCalendar();
  }

  async function rescheduleTask(taskId, dueDate) {
    if (calendarState.rescheduling) return;
    const task = calendarState.tasks.find((item) => String(item.id) === String(taskId));
    if (!task || !dueDate || task.due_date === dueDate || task.completed || task.status === "done") return;

    calendarState.rescheduling = true;
    showFeedback("Rescheduling task…");
    try {
      const token = $('meta[name="csrf-token"]')?.content || "";
      const payload = {
        title: task.title,
        description: task.description || "",
        category: task.category || "General",
        priority: task.priority || "medium",
        due_date: dueDate,
        completed: Boolean(task.completed),
        status: task.status || (task.completed ? "done" : "todo")
      };
      const response = await fetch("/api/tasks/" + encodeURIComponent(task.id), {
        method: "PATCH",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-CSRFToken": token
        },
        body: JSON.stringify(payload)
      });
      const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not reschedule this task.");

      const updated = data.task || { ...task, due_date: dueDate };
      calendarState.tasks = calendarState.tasks.map((item) =>
        String(item.id) === String(taskId) ? updated : item
      );
      renderCalendar();
      showFeedback('Moved "' + task.title + '" to ' + formatDate(dueDate) + ".");
      document.dispatchEvent(new Event("tasktrack:tasks-updated"));
    } catch (error) {
      showFeedback(error.message || "Unable to reschedule this task.", true);
    } finally {
      calendarState.rescheduling = false;
    }
  }

  function initCalendar() {
    const grid = $("#calendar-grid");
    if (!grid) return;

    grid.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const taskChip = target.closest("[data-calendar-task-id]");
      if (taskChip && grid.contains(taskChip)) {
        document.dispatchEvent(new CustomEvent("tasktrack:calendar-task-selected", {
          detail: { taskId: taskChip.dataset.calendarTaskId }
        }));
        return;
      }

      const dateButton = target.closest("[data-calendar-date]");
      if (!dateButton || !grid.contains(dateButton)) return;
      const date = dateButton.dataset.calendarDate;
      if (!date) return;

      calendarState.selectedDate = date;
      const selected = parseISO(date);
      calendarState.month = new Date(selected.getFullYear(), selected.getMonth(), 1);
      renderCalendar();
      showFeedback("Selected " + formatDate(date) + ". Create a task or drop an active task here to reschedule it.");
      document.dispatchEvent(new CustomEvent("tasktrack:calendar-date-selected", {
        detail: { date }
      }));
    });

    grid.addEventListener("dragstart", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const taskChip = target.closest('[data-calendar-task-id][draggable="true"]');
      if (!taskChip || !grid.contains(taskChip)) {
        event.preventDefault();
        return;
      }
      calendarState.draggingTaskId = taskChip.dataset.calendarTaskId;
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", calendarState.draggingTaskId);
      }
      taskChip.classList.add("is-dragging");
    });

    grid.addEventListener("dragover", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const dateButton = target.closest("[data-calendar-date]");
      if (!dateButton || !calendarState.draggingTaskId) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      dateButton.classList.add("is-drop-target");
    });

    grid.addEventListener("dragleave", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const dateButton = target.closest("[data-calendar-date]");
      if (dateButton && !dateButton.contains(event.relatedTarget)) {
        dateButton.classList.remove("is-drop-target");
      }
    });

    grid.addEventListener("drop", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const dateButton = target.closest("[data-calendar-date]");
      if (!dateButton || !calendarState.draggingTaskId) return;
      event.preventDefault();
      const taskId = calendarState.draggingTaskId;
      const date = dateButton.dataset.calendarDate;
      calendarState.draggingTaskId = null;
      grid.querySelectorAll(".is-drop-target").forEach((cell) => cell.classList.remove("is-drop-target"));
      grid.querySelectorAll(".is-dragging").forEach((chip) => chip.classList.remove("is-dragging"));
      if (date) rescheduleTask(taskId, date);
    });

    grid.addEventListener("dragend", () => {
      calendarState.draggingTaskId = null;
      grid.querySelectorAll(".is-drop-target").forEach((cell) => cell.classList.remove("is-drop-target"));
      grid.querySelectorAll(".is-dragging").forEach((chip) => chip.classList.remove("is-dragging"));
    });

    $("#calendar-prev")?.addEventListener("click", () => changePeriod(-1));
    $("#calendar-next")?.addEventListener("click", () => changePeriod(1));
    $("#calendar-today")?.addEventListener("click", () => {
      const today = todayISO();
      calendarState.selectedDate = today;
      const date = parseISO(today);
      calendarState.month = new Date(date.getFullYear(), date.getMonth(), 1);
      renderCalendar();
      showFeedback("Showing today, " + formatDate(today) + ".");
    });
    $("#calendar-month-view")?.addEventListener("click", () => switchView("month"));
    $("#calendar-week-view")?.addEventListener("click", () => switchView("week"));

    document.addEventListener("tasktrack:tasks-updated", () => {
      loadCalendarTasks().catch((error) => {
        console.error("Calendar refresh failed:", error);
        showFeedback("Calendar could not refresh. Please reload the page.", true);
      });
    });

    loadCalendarTasks().catch((error) => {
      const deadlines = $("#calendar-deadlines");
      grid.innerHTML = '<div class="calendar-empty calendar-grid-message"><strong>Calendar couldn\'t load.</strong><span>Refresh the page and try again.</span></div>';
      if (deadlines) {
        deadlines.innerHTML = '<div class="calendar-empty"><strong>Deadlines couldn\'t load.</strong><span>Refresh the page and try again.</span></div>';
      }
      showFeedback("Calendar could not load. Please reload the page.", true);
      console.error("Calendar load failed:", error);
    });
  }

  document.addEventListener("DOMContentLoaded", initCalendar);
})();
