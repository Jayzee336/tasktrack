"use strict";

(() => {
  const $ = (selector) => document.querySelector(selector);

  const calendarState = {
    tasks: [],
    month: new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1
    ),
    selectedDate: null
  };

  // ========================================
  // DATE HELPERS
  // ========================================

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

    return new Date(year, month - 1, day).toLocaleDateString(
      undefined,
      {
        month: "short",
        day: "numeric",
        year: year !== new Date().getFullYear()
          ? "numeric"
          : undefined
      }
    );
  };

  const monthLabel = (date) =>
    date.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric"
    });

  // ========================================
  // LOAD TASKS
  // ========================================

  async function loadCalendarTasks() {
    const response = await fetch("/api/tasks", {
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(
        `Unable to load calendar tasks (${response.status}).`
      );
    }

    const data = await response.json();
    const tasks = Array.isArray(data) ? data : data?.tasks;

    calendarState.tasks = Array.isArray(tasks) ? tasks : [];

    renderCalendar();
  }

  // ========================================
  // UPCOMING DEADLINES
  // ========================================

  function renderDeadlines() {
    const container = $("#calendar-deadlines");

    if (!container) return;

    const today = todayISO();

    const deadlines = calendarState.tasks
      .filter((task) => task.due_date && !task.completed)
      .sort((a, b) => a.due_date.localeCompare(b.due_date));

    const overdue = deadlines.filter(
      (task) => task.due_date < today
    );

    const upcoming = deadlines.filter(
      (task) => task.due_date >= today
    );

    // Show overdue tasks first, followed by upcoming tasks.
    const visible = [...overdue, ...upcoming].slice(0, 8);

    if (!visible.length) {
      container.innerHTML = `
        <div class="calendar-empty">
          <strong>You're all caught up.</strong>
          <span>Tasks with deadlines will appear here.</span>
        </div>
      `;
      return;
    }

    container.innerHTML = visible.map((task) => {
      const isOverdue = task.due_date < today;

      const priority = ["high", "medium", "low"].includes(task.priority)
        ? task.priority
        : "medium";

      return `
        <article class="calendar-deadline ${
          isOverdue ? "is-overdue" : ""
        }">
          <span
            class="calendar-priority ${priority}"
            aria-hidden="true"
          ></span>

          <div class="calendar-deadline-copy">
            <strong>${escapeHTML(task.title)}</strong>
            <span>
              ${isOverdue ? "Overdue" : "Due"} -
              ${escapeHTML(formatDate(task.due_date))}
            </span>
          </div>

          <span class="calendar-priority-label ${priority}">
            ${escapeHTML(priority)}
          </span>
        </article>
      `;
    }).join("");
  }

  // ========================================
  // MONTH CALENDAR
  // ========================================

  function renderMonth() {
    const heading = $("#calendar-month-label");
    const grid = $("#calendar-grid");

    if (!heading || !grid) return;

    const month = calendarState.month;
    const year = month.getFullYear();
    const monthIndex = month.getMonth();

    const firstWeekday = new Date(
      year,
      monthIndex,
      1
    ).getDay();

    const daysInMonth = new Date(
      year,
      monthIndex + 1,
      0
    ).getDate();

    const today = todayISO();

    heading.textContent = monthLabel(month);

    // Group tasks by their due date.
    const tasksByDate = new Map();

    calendarState.tasks.forEach((task) => {
      if (!task.due_date) return;

      if (!tasksByDate.has(task.due_date)) {
        tasksByDate.set(task.due_date, []);
      }

      tasksByDate.get(task.due_date).push(task);
    });

    const cells = [];

    // Empty cells before the first day of the month.
    for (let i = 0; i < firstWeekday; i += 1) {
      cells.push(`
        <div
          class="calendar-day is-empty"
          aria-hidden="true"
        ></div>
      `);
    }

    // Render each date as one clickable button.
    for (let day = 1; day <= daysInMonth; day += 1) {
      const iso = [
        year,
        String(monthIndex + 1).padStart(2, "0"),
        String(day).padStart(2, "0")
      ].join("-");

      const tasks = tasksByDate.get(iso) || [];

      const activeTasks = tasks.filter(
        (task) => !task.completed
      );

      const isOverdue = iso < today && activeTasks.length > 0;
      const isSelected = iso === calendarState.selectedDate;
      const isToday = iso === today;

      // Show up to two task titles per date.
      const taskMarkup = tasks
        .slice(0, 2)
        .map((task) => `
          <span class="calendar-day-task ${
            task.completed ? "is-complete" : ""
          }">
            ${escapeHTML(task.title)}
          </span>
        `)
        .join("");

      const extra = tasks.length > 2
        ? `<span class="calendar-day-more">+${tasks.length - 2} more</span>`
        : "";

      cells.push(`
        <button
          type="button"
          class="calendar-day ${isToday ? "is-today" : ""} ${
            isOverdue ? "has-overdue" : ""
          } ${isSelected ? "is-selected" : ""}"
          data-calendar-date="${iso}"
          aria-label="Select ${escapeHTML(formatDate(iso))}; ${tasks.length} tasks"
          aria-pressed="${isSelected}"
          title="Create a task due ${escapeHTML(formatDate(iso))}"
        >
          <span class="calendar-day-number">${day}</span>
          <span class="calendar-day-tasks">${taskMarkup}${extra}</span>
        </button>
      `);
    }

    // Complete the final week with empty cells.
    const remainder = cells.length % 7;

    if (remainder) {
      for (let i = remainder; i < 7; i += 1) {
        cells.push(`
          <div
            class="calendar-day is-empty"
            aria-hidden="true"
          ></div>
        `);
      }
    }

    const weekdays = [
      "Sun",
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat"
    ]
      .map((day) => `
        <div class="calendar-weekday">${day}</div>
      `)
      .join("");

    grid.innerHTML = `${weekdays}${cells.join("")}`;
  }

  // ========================================
  // CALENDAR RENDERING AND NAVIGATION
  // ========================================

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

  // ========================================
  // INITIALIZATION AND EVENTS
  // ========================================

  function initCalendar() {
    const grid = $("#calendar-grid");

    if (!grid) return;

    // Handle clicks anywhere inside a date cell.
    // Event delegation remains active when the grid rerenders.
    grid.addEventListener("click", (event) => {
      const target = event.target;

      if (!(target instanceof Element)) return;

      const dateButton = target.closest("[data-calendar-date]");

      if (!dateButton || !grid.contains(dateButton)) return;

      const date = dateButton.dataset.calendarDate;

      if (!date) return;

      // Store the date and visually highlight its cell.
      calendarState.selectedDate = date;

      renderMonth();

      // Notify app.js to open the existing task form.
      document.dispatchEvent(
        new CustomEvent("tasktrack:calendar-date-selected", {
          detail: { date }
        })
      );
    });

    // Previous month.
    $("#calendar-prev")?.addEventListener("click", () => {
      changeMonth(-1);
    });

    // Next month.
    $("#calendar-next")?.addEventListener("click", () => {
      changeMonth(1);
    });

    // Return to the current month.
    $("#calendar-today")?.addEventListener("click", () => {
      const now = new Date();

      calendarState.month = new Date(
        now.getFullYear(),
        now.getMonth(),
        1
      );

      calendarState.selectedDate = todayISO();

      renderMonth();
    });

    // Refresh calendar data when TaskTrack updates its tasks.
    document.addEventListener("tasktrack:tasks-updated", () => {
      loadCalendarTasks().catch((error) => {
        console.error("Calendar refresh failed:", error);
      });
    });

    // Load the calendar initially.
    loadCalendarTasks().catch((error) => {
      const deadlines = $("#calendar-deadlines");

      grid.innerHTML = `
        <div class="calendar-empty calendar-grid-message">
          <strong>Calendar couldn't load.</strong>
          <span>Refresh the page and try again.</span>
        </div>
      `;

      if (deadlines) {
        deadlines.innerHTML = `
          <div class="calendar-empty">
            <strong>Deadlines couldn't load.</strong>
            <span>Refresh the page and try again.</span>
          </div>
        `;
      }

      console.error("Calendar load failed:", error);
    });
  }

  document.addEventListener("DOMContentLoaded", initCalendar);
})();