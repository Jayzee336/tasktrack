"use strict";

(() => {
  const $ = (selector) => document.querySelector(selector);

  const kind = $("#focus-session-kind");
  const duration = $("#focus-session-duration");
  const taskSelect = $("#focus-session-task");
  const startButton = $("#focus-session-start");
  const resetButton = $("#focus-session-reset");
  const timeDisplay = $("#focus-session-time");
  const typeLabel = $("#focus-session-type-label");
  const statusDisplay = $("#focus-session-status");
  const messageDisplay = $("#focus-session-message");
  const historyDisplay = $("#focus-session-history");
  const historyCount = $("#focus-history-count");

  if (!kind || !duration || !taskSelect || !startButton) return;

  const labels = {
    focus: "FOCUS TIME",
    short_break: "SHORT BREAK",
    long_break: "LONG BREAK"
  };

  const durations = {
    focus: [25, 45, 60],
    short_break: [5],
    long_break: [15]
  };

  let remainingSeconds = Number(duration.value) * 60 || 1500;
  let deadline = null;
  let intervalId = null;
  let running = false;
  let saving = false;
  let completedPendingSave = null;

  function formatTime(seconds) {
    const safe = Math.max(0, Math.ceil(seconds));
    const minutes = Math.floor(safe / 60);
    const remainder = safe % 60;

    return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }

  function setStatus(text) {
    statusDisplay.textContent = text;
  }

  function updateClock() {
    timeDisplay.textContent = formatTime(remainingSeconds);
  }

  function setControlsDisabled(disabled) {
    kind.disabled = disabled;
    duration.disabled = disabled;
    taskSelect.disabled = disabled;
  }

  function updateDurationOptions(preferred) {
    const allowed = durations[kind.value] || durations.focus;

    duration.replaceChildren();

    allowed.forEach((minutes) => {
      const option = document.createElement("option");
      option.value = String(minutes);
      option.textContent = `${minutes} minute${minutes === 1 ? "" : "s"}`;
      duration.appendChild(option);
    });

    duration.value = String(
      allowed.includes(preferred) ? preferred : allowed[0]
    );
  }

  function resetTimer(showMessage = true) {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }

    running = false;
    deadline = null;
    remainingSeconds = Number(duration.value) * 60;
    startButton.textContent = "Start focus";
    setControlsDisabled(saving);
    updateClock();

    if (showMessage) {
      setStatus("Ready to focus");
      messageDisplay.textContent =
        "Choose a task, then start your session.";
    }
  }

  function renderTaskOptions(tasks) {
    const previousValue = taskSelect.value;

    taskSelect.replaceChildren();

    const noTask = document.createElement("option");
    noTask.value = "";
    noTask.textContent = "No linked task";
    taskSelect.appendChild(noTask);

    tasks
      .filter((task) => !task.completed)
      .forEach((task) => {
        const option = document.createElement("option");
        option.value = String(task.id);
        option.textContent = task.title;
        taskSelect.appendChild(option);
      });

    if ([...taskSelect.options].some(
      (option) => option.value === previousValue
    )) {
      taskSelect.value = previousValue;
    }
  }

  async function loadTasks() {
    const response = await fetch("/api/tasks", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" }
    });

    if (!response.ok) {
      throw new Error("Could not load your tasks.");
    }

    const data = await response.json();
    renderTaskOptions(Array.isArray(data.tasks) ? data.tasks : []);
  }

  function sessionTypeName(value) {
    return ({
      focus: "Focus",
      short_break: "Short break",
      long_break: "Long break"
    })[value] || "Session";
  }

  function renderHistory(sessions) {
    historyCount.textContent =
      `${sessions.length} session${sessions.length === 1 ? "" : "s"}`;

    historyDisplay.replaceChildren();

    if (!sessions.length) {
      const empty = document.createElement("p");
      empty.className = "focus-history-empty";
      empty.textContent = "Your completed sessions will appear here.";
      historyDisplay.appendChild(empty);
      return;
    }

    sessions.forEach((session) => {
      const item = document.createElement("div");
      item.className = "focus-session-history-item";

      const details = document.createElement("div");
      const title = document.createElement("strong");
      const subtitle = document.createElement("small");
      const length = document.createElement("span");

      title.textContent =
        session.task_title || sessionTypeName(session.session_type);

      subtitle.textContent =
        `${sessionTypeName(session.session_type)} · ${formatDate(session.completed_at)}`;

      length.className = "focus-history-duration";
      length.textContent = `${session.duration_minutes} min`;

      details.append(title, subtitle);
      item.append(details, length);
      historyDisplay.appendChild(item);
    });
  }

  function formatDate(value) {
    if (!value) return "Completed";

    const date = new Date(
      value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`
    );

    if (Number.isNaN(date.getTime())) return "Completed";

    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  async function loadHistory() {
    const response = await fetch("/api/focus-sessions", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" }
    });

    if (!response.ok) {
      throw new Error("Could not load session history.");
    }

    const data = await response.json();
    renderHistory(Array.isArray(data.sessions) ? data.sessions : []);
  }

  async function saveCompletedSession(session) {
    saving = true;
    setControlsDisabled(true);
    startButton.disabled = true;
    resetButton.disabled = true;
    setStatus("Saving session…");
    messageDisplay.textContent = "Your completed session is being saved.";

    try {
      const meta = $('meta[name="csrf-token"]');
      const csrf = meta?.content || "";

      const response = await fetch("/api/focus-sessions", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-CSRFToken": csrf
        },
        body: JSON.stringify(session)
      });

      const refreshedToken = response.headers.get("X-CSRFToken");
      if (refreshedToken && meta) meta.content = refreshedToken;

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Could not save the completed session.");
      }

      completedPendingSave = null;
      setStatus("Session completed");
      messageDisplay.textContent = "Well done! Your session was saved.";
      await loadHistory();
      document.dispatchEvent(new Event("tasktrack:focus-session-added"));
    } catch (error) {
      completedPendingSave = session;
      setStatus("Save failed");
      messageDisplay.textContent =
        `${error.message} Press the button below to retry saving.`;
      startButton.textContent = "Retry save";
      startButton.disabled = false;
    } finally {
      saving = false;
      setControlsDisabled(false);
      resetButton.disabled = false;

      if (!completedPendingSave) {
        startButton.disabled = false;
      }
    }
  }

  async function finishSession() {
    if (!running) return;

    running = false;

    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }

    remainingSeconds = 0;
    updateClock();
    startButton.disabled = true;

    const selectedTask = taskSelect.value;

    const session = {
      session_type: kind.value,
      duration_minutes: Number(duration.value),
      task_id: selectedTask ? Number(selectedTask) : null
    };

    await saveCompletedSession(session);
  }

  function tick() {
    if (!running || deadline === null) return;

    remainingSeconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    updateClock();

    if (remainingSeconds <= 0) {
      void finishSession();
    }
  }

  function startTimer() {
    if (running || saving) return;

    if (completedPendingSave) {
      void saveCompletedSession(completedPendingSave);
      return;
    }

    if (remainingSeconds <= 0) {
      remainingSeconds = Number(duration.value) * 60;
    }

    running = true;
    deadline = Date.now() + remainingSeconds * 1000;

    startButton.textContent = "Pause";
    setStatus("Session in progress");
    messageDisplay.textContent =
      kind.value === "focus"
        ? "Stay with one task. You've got this."
        : "Take a breath. This time is yours.";

    setControlsDisabled(true);

    intervalId = setInterval(tick, 250);
    tick();
  }

  function pauseTimer() {
    if (!running) return;

    remainingSeconds = Math.max(
      0,
      Math.ceil((deadline - Date.now()) / 1000)
    );

    running = false;
    deadline = null;

    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }

    updateClock();
    startButton.textContent = "Resume";
    setStatus("Paused");
    messageDisplay.textContent = "Resume whenever you're ready.";
    setControlsDisabled(false);
  }

  startButton.addEventListener("click", () => {
    if (running) {
      pauseTimer();
    } else {
      startTimer();
    }
  });

  resetButton.addEventListener("click", () => {
    if (saving) return;

    completedPendingSave = null;
    resetTimer();
  });

  kind.addEventListener("change", () => {
    if (running || saving) return;

    updateDurationOptions();
    typeLabel.textContent = labels[kind.value] || labels.focus;
    resetTimer();
  });

  duration.addEventListener("change", () => {
    if (running || saving) return;
    resetTimer();
  });

  async function initialize() {
    updateDurationOptions(Number(duration.value));
    typeLabel.textContent = labels[kind.value] || labels.focus;
    resetTimer(false);

    try {
      await Promise.all([loadTasks(), loadHistory()]);
    } catch (error) {
      messageDisplay.textContent = error.message;
    }
  }

  // Refresh tasks and history whenever the dashboard becomes visible.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      if (!running && !saving) {
        void loadTasks().catch(() => {});
        void loadHistory().catch(() => {});
      } else {
        tick();
      }
    }
  });

  initialize();
})();
