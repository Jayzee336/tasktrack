"use strict";

(() => {
  const $ = (selector) => document.querySelector(selector);

  const calendarState = {
    tasks: [],
    month: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  };

  const todayISO = () => {
    const now = new Date();
    return [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0")
    ].join("-");
  };

  const escapeHTML = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]);

  const formatDate = (iso) => {
    if (!iso) return "No deadline";

    const [year, month, day] = iso.split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: year !== new Date().getFullYear() ? "numeric" : undefined
    });
  };

  const monthLabel = (date) =>
    date.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric"
    });

  async function loadCalendarTasks() {
    const response = await fetch("/api/tasks", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" }
    });

    if (!response.ok) {
      throw new Error("Unable to load calendar tasks.");
    }

    const data = await response.json();
    calendarState.tasks = Array.isArray(data) ? data : data.tasks || [];
    renderCalendar();
  }

  function renderDeadlines() {
    const container = $("#calendar-deadlines");
    if (!container) return;

    const today = todayISO();

    const deadlines = calendarState.tasks
      .filter((task) => task.due_date && !task.completed)
      .sort((a, b) => a.due_date.localeCompare(b.due_date));

    const overdue = deadlines.filter((task) => task.due_date < today);
    const upcoming = deadlines.filter((task) => task.due_date >= today);

    const visible = [...overdue, ...upcoming].slice(0, 8);

    if (!visible.length) {
      container.innerHTML = `
        <div class="calendar-empty">
          <strong>You're all caught up.</strong>
          <span>Tasks with deadlines will appear here.</span>
        </div>`;
      return;
    }

    container.innerHTML = visible.map((task) => {
      const isOverdue = task.due_date < today;
      const priority = ["high", "medium", "low"].includes(task.priority)
        ? task.priority
        : "medium";

      return `
        <article class="calendar-deadline ${isOverdue ? "is-overdue" : ""}">
          <span class="calendar-priority ${priority}" aria-hidden="true"></span>
          <div class="calendar-deadline-copy">
            <strong>${escapeHTML(task.title)}</strong>
            <span>${isOverdue ? "Overdue" : "Due"} · ${escapeHTML(formatDate(task.due_date))}</span>
          </div>
          <span class="calendar-priority-label ${priority}">
            ${escapeHTML(priority)}
          </span>
        </article>`;
    }).join("");
  }

  function renderMonth() {
    const heading = $("#calendar-month-label");
    const grid = $("#calendar-grid");

    if (!heading || !grid) return;

    const month = calendarState.month;
    const year = month.getFullYear();
    const monthIndex = month.getMonth();
    const firstWeekday = new Date(year, monthIndex, 1).getDay();
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const today = todayISO();

    heading.textContent = monthLabel(month);

    const tasksByDate = new Map();

    calendarState.tasks.forEach((task) => {
      if (!task.due_date) return;

      if (!tasksByDate.has(task.due_date)) {
        tasksByDate.set(task.due_date, []);
      }

      tasksByDate.get(task.due_date).push(task);
    });

    const cells = [];

    for (let i = 0; i < firstWeekday; i += 1) {
      cells.push('<div class="calendar-day is-empty" aria-hidden="true"></div>');
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const iso = [
        year,
        String(monthIndex + 1).padStart(2, "0"),
        String(day).padStart(2, "0")
      ].join("-");

      const tasks = tasksByDate.get(iso) || [];
      const activeTasks = tasks.filter((task) => !task.completed);
      const isOverdue = iso < today && activeTasks.length > 0;

      const taskMarkup = tasks.slice(0, 2).map((task) => `
        <span class="calendar-day-task ${task.completed ? "is-complete" : ""}">
          ${escapeHTML(task.title)}
        </span>
      `).join("");

      const extra = tasks.length > 2
        ? `<span class="calendar-day-more">+${tasks.length - 2} more</span>`
        : "";

      cells.push(`
        <div class="calendar-day ${iso === today ? "is-today" : ""} ${isOverdue ? "has-overdue" : ""}"
             aria-label="${escapeHTML(formatDate(iso))}, ${tasks.length} tasks">
          <span class="calendar-day-number">${day}</span>
          <div class="calendar-day-tasks">${taskMarkup}${extra}</div>
        </div>`);
    }

    const remainder = cells.length % 7;
    if (remainder) {
      for (let i = remainder; i < 7; i += 1) {
        cells.push('<div class="calendar-day is-empty" aria-hidden="true"></div>');
      }
    }

    grid.innerHTML = `
      ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
        .map((day) => `<div class="calendar-weekday">${day}</div>`)
        .join("")}
      ${cells.join("")}`;
  }

  function renderCalendar() {
    renderMonth();
    renderDeadlines();
  }

  function changeMonth(offset) {
    calendarState.month = new Date(
      calendarState.month.getFullYear(),
      calendarState.month.getMonth() + offset,
      1
    );
    renderMonth();
  }

  function initCalendar() {
    if (!$("#calendar-grid")) return;

    $("#calendar-prev").addEventListener("click", () => changeMonth(-1));
    $("#calendar-next").addEventListener("click", () => changeMonth(1));
    $("#calendar-today").addEventListener("click", () => {
      const now = new Date();
      calendarState.month = new Date(now.getFullYear(), now.getMonth(), 1);
      renderMonth();
    });

    document.addEventListener("tasktrack:tasks-updated", () => {
      loadCalendarTasks().catch(console.error);
    });

    loadCalendarTasks().catch((error) => {
      const grid = $("#calendar-grid");
      if (grid) {
        grid.innerHTML = `
          <div class="calendar-empty">
            <strong>Calendar couldn't load.</strong>
            <span>Refresh the page and try again.</span>
          </div>`;
      }
      console.error(error);
    });
  }

  document.addEventListener("DOMContentLoaded", initCalendar);
})();
