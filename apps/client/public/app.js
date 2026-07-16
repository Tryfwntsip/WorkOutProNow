import {
  LocalStorageQueueStorage,
  MyoAdaptApi,
  OfflineSetQueue,
  adjustPlannedSet,
  createSessionDraft,
  explainExercise,
  removePlannedSet,
  stableClientSetId,
  swapExercise
} from "/client/index.js";

const app = document.querySelector("#app");
const tabs = document.querySelector("#tabbar");
const syncStatus = document.querySelector("#sync-status");
const dialog = document.querySelector("#why-dialog");
const whyContent = document.querySelector("#why-content");
const state = {
  token: localStorage.getItem("myoadapt.token") || "",
  refresh: localStorage.getItem("myoadapt.refresh") || "",
  profile: read("myoadapt.profile"),
  draft: read("myoadapt.draft"),
  logged: read("myoadapt.logged") || {},
  analytics: null,
  program: read("myoadapt.program") || null,
  programDraft: null,
  dayEdit: null,
  week: null
};
let api = createApi();
const queue = new OfflineSetQueue(new LocalStorageQueueStorage(localStorage), (sessionId, input) =>
  api.logSet(sessionId, input)
);

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
window.addEventListener("hashchange", render);
window.addEventListener("online", sync);
window.addEventListener("offline", updateSyncStatus);
document.addEventListener("click", onClick);
document.addEventListener("submit", onSubmit);
dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());

function createApi() {
  return new MyoAdaptApi({
    baseUrl: localStorage.getItem("myoadapt.apiBase") || "/api",
    accessToken: () => state.token,
    refreshToken: () => state.refresh,
    onTokens: (tokens) => {
      state.token = tokens.accessToken;
      state.refresh = tokens.refreshToken;
      persist();
    },
    fetcher: window.fetch.bind(window)
  });
}

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function persist() {
  localStorage.setItem("myoadapt.token", state.token);
  localStorage.setItem("myoadapt.refresh", state.refresh || "");
  localStorage.setItem("myoadapt.profile", JSON.stringify(state.profile));
  localStorage.setItem("myoadapt.draft", JSON.stringify(state.draft));
  localStorage.setItem("myoadapt.logged", JSON.stringify(state.logged));
  localStorage.setItem("myoadapt.program", JSON.stringify(state.program));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toast(message) {
  const node = document.querySelector("#toast");
  node.textContent = message;
  node.classList.add("show");
  setTimeout(() => node.classList.remove("show"), 2400);
}

async function updateSyncStatus() {
  const pending = await queue.pending();
  syncStatus.textContent = navigator.onLine
    ? `${pending.length} pending`
    : `Offline · ${pending.length} queued`;
}

async function sync() {
  if (!navigator.onLine || !state.token) return updateSyncStatus();
  const result = await queue.flush();
  for (const { queued, response } of result.synced) {
    state.logged[queued.input.clientSetId] = {
      ...state.logged[queued.input.clientSetId],
      input: queued.input,
      response,
      synced: true
    };
  }
  persist();
  await updateSyncStatus();
  if (result.synced.length) {
    toast(`${result.synced.length} set${result.synced.length === 1 ? "" : "s"} synced`);
    render();
  }
}

function route() {
  return location.hash.slice(1) || (state.token ? "plan" : "login");
}

function render() {
  const current = route();
  tabs.hidden = !state.token;
  tabs
    .querySelectorAll("a")
    .forEach((link) => link.classList.toggle("active", link.hash === `#${current}`));
  const screens = {
    login: renderLogin,
    profile: renderProfile,
    program: renderProgram,
    plan: renderPlan,
    perform: renderPerform,
    analytics: renderAnalytics,
    tools: renderTools
  };
  (screens[current] || renderPlan)();
  updateSyncStatus();
}

function hero(eyebrow, title, lede, action = "") {
  return `<section class="hero"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p class="lede">${lede}</p></div>${action}</section>`;
}

function renderLogin() {
  tabs.hidden = true;
  app.innerHTML =
    hero(
      "Adaptive coaching",
      "Training that listens.",
      "Plan with evidence. Perform with confidence. Adapt after every set."
    ) +
    `<section class="grid"><form class="card full stack" data-form="login">
      <h2>Continue with your profile</h2>
      <p class="muted">Your email identifies your personal local account and keeps your profile, program and progress separate.</p>
      <label>Your email<input required type="email" name="email" autocomplete="email" placeholder="you@example.com" value="${escapeHtml(localStorage.getItem("myoadapt.email") || "")}"></label>
      <details><summary class="muted">Developer settings</summary><label>API gateway<input name="apiBase" value="${escapeHtml(localStorage.getItem("myoadapt.apiBase") || "/api")}"></label></details>
      <button class="primary">Continue</button>
    </form></section>`;
}

function renderProfile() {
  const profile = state.profile || {};
  const environment = profile.environments?.[0] || {};
  const prefs = profile.prefs || {};
  const selectedDays = profile.weeklySchedule?.days || [1, 3, 5];
  const selectedEquipment = new Set(
    environment.equipment || [
      "barbell",
      "dumbbell",
      "bench",
      "cable",
      "machine",
      "pullup_bar",
      "bodyweight",
      "ez_bar"
    ]
  );
  const injuries = new Map((profile.injuries || []).map((item) => [item.jointOrMuscle, item]));
  const equipment = [
    ["barbell", "Barbell"],
    ["dumbbell", "Dumbbells"],
    ["ez_bar", "EZ curl bar"],
    ["kettlebell", "Kettlebells"],
    ["machine", "Machines"],
    ["leg_press", "Leg press"],
    ["hack_squat", "Hack squat"],
    ["smith_machine", "Smith machine"],
    ["cable", "Cable station"],
    ["bench", "Adjustable bench"],
    ["preacher_bench", "Preacher bench"],
    ["pullup_bar", "Pull-up bar"],
    ["dip_bars", "Dip bars"],
    ["bodyweight", "Bodyweight space"]
  ];
  const joints = [
    ["shoulder", "Shoulder"],
    ["elbow", "Elbow"],
    ["wrist", "Wrist"],
    ["hip", "Hip"],
    ["knee", "Knee"],
    ["ankle", "Ankle"],
    ["spine", "Spine"],
    ["lower_back", "Lower back"]
  ];
  const priorityMuscles = [
    ["chest", "Chest"],
    ["lats", "Lats"],
    ["upper_back", "Upper back"],
    ["side_delts", "Shoulders"],
    ["biceps", "Biceps"],
    ["triceps", "Triceps"],
    ["quads", "Quads"],
    ["hamstrings", "Hamstrings"],
    ["glutes", "Glutes"]
  ];
  app.innerHTML =
    hero(
      "Your profile",
      "Make the coaching yours.",
      "These details directly shape your weekly split, exercise choices, volume and recovery.",
      '<button class="ghost" data-action="switch-account">Switch account</button>'
    ) +
    `<form class="grid" data-form="profile">
      <section class="card full">
        <h2>About you</h2>
        <p class="muted">Only enter what you are comfortable using for your coaching recommendations.</p>
        <div class="fields three">
          <label>Your name<input name="displayName" autocomplete="name" placeholder="e.g. Christos" value="${escapeHtml(prefs.displayName || "")}"></label>
          <label>Primary goal<select name="trainingGoal">${optionLabels(
            [
              ["hypertrophy", "Build muscle"],
              ["strength", "Get stronger"],
              ["general_fitness", "General fitness"],
              ["fat_loss", "Fat loss"]
            ],
            prefs.trainingGoal || "hypertrophy"
          )}</select></label>
          <label>Sex<select name="sex">${optionLabels(
            [
              ["male", "Male"],
              ["female", "Female"],
              ["other", "Other"],
              ["unspecified", "Prefer not to say"]
            ],
            profile.sex || "unspecified"
          )}</select></label>
          <label>Year of birth<input name="birthYear" type="number" min="1900" max="2010" placeholder="e.g. 1995" value="${profile.birthYear ?? ""}">${profile.age ? `<small class="muted">${profile.age} years old</small>` : ""}</label>
          <label>Height (cm)<input name="heightCm" type="number" min="100" max="260" placeholder="e.g. 178" value="${profile.heightCm ?? ""}"></label>
          <label>Body weight (kg)<input name="weightKg" type="number" min="30" max="400" step=".5" placeholder="e.g. 80" value="${profile.weightKg ?? ""}"></label>
        </div>
      </section>
      <section class="card">
        <h2>Training experience</h2>
        <div class="fields">
          <label>Experience level<select name="trainingAge">${optionLabels(
            [
              ["beginner", "Beginner · under 1 year"],
              ["intermediate", "Intermediate · 1–4 years"],
              ["advanced", "Advanced · 4+ years"]
            ],
            profile.trainingAge || "intermediate"
          )}</select></label>
          <label>Typical recovery<select name="recoveryProfile">${optionLabels(
            [
              ["0.5", "Slower · stress or poor sleep"],
              ["0.7", "Normal · generally recover well"],
              ["0.9", "Excellent · sleep and nutrition consistent"]
            ],
            String(profile.recoveryProfile ?? 0.7)
          )}</select></label>
          <label>Minutes per session<input name="minutes" type="number" min="15" max="180" step="5" value="${profile.weeklySchedule?.minutesPerDay || 45}"></label>
          <label>Preferred session size<select name="exercisesPerSession">${optionLabels(
            [
              ["3", "3 exercises · short"],
              ["5", "5 exercises · recommended"],
              ["6", "6 exercises · more variety"],
              ["7", "7 exercises · high volume"]
            ],
            String(prefs.sessionPreferences?.exercisesPerSession || 5)
          )}</select></label>
        </div>
      </section>
      <section class="card">
        <h2>Available days</h2>
        <p class="muted">Select every day you can normally train. Your split will adapt around the breaks.</p>
        <div class="check-grid days">
          ${[
            [1, "Mon"],
            [2, "Tue"],
            [3, "Wed"],
            [4, "Thu"],
            [5, "Fri"],
            [6, "Sat"],
            [0, "Sun"]
          ]
            .map(
              ([day, label]) =>
                `<label class="check-card"><input type="checkbox" name="trainingDay" value="${day}" ${selectedDays.includes(day) ? "checked" : ""}><span>${label}</span></label>`
            )
            .join("")}
        </div>
      </section>
      <section class="card full">
        <div class="row between"><div><h2>Your equipment</h2><p class="muted">Only exercises you can actually perform will be selected.</p></div><label class="compact-label">Training location<input name="environmentName" value="${escapeHtml(environment.name || "My gym")}"></label></div>
        <div class="check-grid">
          ${equipment.map(([id, label]) => `<label class="check-card"><input type="checkbox" name="equipment" value="${id}" ${selectedEquipment.has(id) ? "checked" : ""}><span>${label}</span></label>`).join("")}
        </div>
      </section>
      <section class="card full">
        <h2>Injuries or sensitive areas</h2>
        <p class="muted">Select affected areas and severity so unsafe exercises can be excluded.</p>
        <div class="injury-grid">
          ${joints
            .map(
              ([id, label]) =>
                `<div class="injury-card"><label class="check-card"><input type="checkbox" name="injury" value="${id}" ${injuries.has(id) ? "checked" : ""}><span>${label}</span></label><select name="injurySeverity-${id}" aria-label="${label} severity">${optionLabels(
                  [
                    ["mild", "Mild"],
                    ["moderate", "Moderate"],
                    ["severe", "Severe"]
                  ],
                  injuries.get(id)?.severity || "mild"
                )}</select></div>`
            )
            .join("")}
        </div>
      </section>
      <section class="card full">
        <h2>Muscle priorities</h2>
        <p class="muted">Choose a few areas to emphasize. Leave most at Balanced for a well-rounded program.</p>
        <div class="priority-grid">
          ${priorityMuscles
            .map(
              ([id, label]) =>
                `<label>${label}<select name="priority-${id}">${optionLabels(
                  [
                    ["0.75", "Less focus"],
                    ["1", "Balanced"],
                    ["1.35", "Extra focus"],
                    ["1.6", "Top priority"]
                  ],
                  String(prefs.musclePriorities?.[id] || 1)
                )}</select></label>`
            )
            .join("")}
        </div>
        <div class="profile-save"><button class="primary">Save my profile</button></div>
      </section>
    </form>`;
}

function renderProgram() {
  const chosenDays = state.programDraft?.daysPerWeek ?? state.program?.daysPerWeek ?? null;
  const exerciseCount = state.profile?.prefs?.sessionPreferences?.exercisesPerSession ?? 5;
  const dayButtons = [2, 3, 4, 5, 6]
    .map(
      (n) =>
        `<button class="chip ${chosenDays === n ? "active" : ""}" data-action="choose-days" data-days="${n}">${n} days</button>`
    )
    .join("");
  const templates = state.programDraft?.options || [];
  const splitCards = templates.length
    ? `<section class="card full"><h2>Choose your split</h2><div class="grid">${templates
        .map(
          (
            t
          ) => `<article class="card third split-card ${state.program?.splitId === t.id ? "selected" : ""}">
            <div class="badge">${escapeHtml(t.name)}</div>
            <p class="muted">${escapeHtml(t.description)}</p>
            <p class="rotation">${t.routines.map((r) => `<span class="pill">${r.replaceAll("_", " ")}</span>`).join("")}</p>
            <button class="primary" data-action="choose-split" data-split="${t.id}" data-days="${t.daysPerWeek}">Use ${escapeHtml(t.name)}</button>
          </article>`
        )
        .join("")}</div></section>`
    : "";
  let current = "";
  if (state.program) {
    const dayLbl = { 0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat" };
    const selected = state.dayEdit ?? state.program.trainingDays;
    const atCap = selected.length >= state.program.daysPerWeek;
    const dayToggles = [1, 2, 3, 4, 5, 6, 0]
      .map((d) => {
        const isOn = selected.includes(d);
        const locked = atCap && !isOn; // can't add beyond the chosen frequency
        return `<button class="chip small ${isOn ? "active" : ""} ${locked ? "locked" : ""}" data-action="toggle-day" data-day="${d}"${locked ? " disabled" : ""}>${dayLbl[d]}</button>`;
      })
      .join("");
    const dayCount = `<span class="muted">${selected.length}/${state.program.daysPerWeek} selected</span>`;
    current = `<section class="card full">
      <div class="row between">
        <div><div class="badge">${escapeHtml(state.program.splitName)}</div><h2>${state.program.daysPerWeek} days / week</h2><p class="muted">${state.program.weeklyRoutines.map((r) => r.replaceAll("_", " ")).join(" · ")}</p></div>
        <button class="ghost danger" data-action="delete-program">Remove program</button>
      </div>
      <div class="day-editor">
        <div class="row between wrap"><h3>Which days do you train?</h3>${dayCount}</div>
        ${state.program.splitId === "ppl_upper_lower" ? '<p class="muted">The 5-day hybrid automatically places Upper/Lower on a 2-day block and Push/Pull/Legs on a 3-day block after you apply your days.</p>' : ""}
        <div class="day-grid">${dayToggles}</div>
        <div class="actions">
          <button class="secondary" data-action="apply-days">Apply days</button>
          <button class="primary" data-action="manage-week">Manage my week</button>
        </div>
      </div>
    </section>`;
  }
  app.innerHTML =
    hero(
      "Guided setup",
      "Pick how you want to train.",
      "Tell us how many days a week you can train, then choose a science-based split. We build the rest."
    ) +
    `<section class="grid">
      <section class="card full"><h2>How many days per week can you train?</h2><div class="row wrap">${dayButtons}</div></section>
      <section class="card full">
        <h2>How many exercises per session?</h2>
        <p class="muted">Choose a simple starting point. You can change it whenever your time or recovery changes.</p>
        <div class="exercise-count-grid">
          ${[
            {
              count: 3,
              label: "Short",
              description:
                "Minimum effective dose. Best for busy days, beginners or easier recovery weeks."
            },
            {
              count: 5,
              label: "Recommended",
              description:
                "Best for most people. Balances effective volume, exercise variety and recovery."
            },
            {
              count: 6,
              label: "More",
              description:
                "Best for experienced trainees with more time and consistently good recovery."
            }
          ]
            .map(
              ({ count, label, description }) =>
                `<button class="exercise-count-option ${exerciseCount === count ? "active" : ""}" data-action="choose-exercise-count" data-count="${count}">
                  <span class="exercise-count-number">${count}</span>
                  <strong>${label}</strong>
                  <small>${description}</small>
                </button>`
            )
            .join("")}
        </div>
      </section>
      ${splitCards}
      ${current}
      ${state.week ? weekPreviewView(state.week) : ""}
    </section>`;
}

function weekPreviewView(week) {
  return `<section class="card full"><h2>Your training week</h2><p class="muted">A complete program — ${week.days.length} sessions. Open Manage to start any day.</p>
    ${week.days
      .map(
        (
          day
        ) => `<article class="exercise"><div class="row between"><div><div class="badge">${day.routine.replaceAll("_", " ")}</div><h3>${dayName(day.weekday)} · ${day.date}</h3><small>${day.estimatedDurationMinutes} min · ${day.plan.exercises.length} exercises</small></div></div>
        <div class="muted">${day.plan.exercises.map((e) => escapeHtml(e.exerciseName)).join(" · ")}</div></article>`
      )
      .join("")}
  </section>`;
}

function dayName(weekday) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekday] || `Day ${weekday}`;
}

function renderPlan() {
  const draft = state.draft;
  const minutes = Math.max(state.profile?.weeklySchedule?.minutesPerDay || 45, 45);

  // Program-aware: pick a day from your week instead of a raw "generate today".
  let weekSection = "";
  if (state.program) {
    if (state.week && state.week.days.length) {
      weekSection = `<section class="card full"><h2>This week</h2><p class="muted">Tap a day to load that session.</p>
        <div class="grid">${state.week.days
          .map((d) => {
            const active = draft && draft.plan.plannedFor === d.date;
            return `<article class="card third day-card ${active ? "selected" : ""}">
              <div class="badge">${d.routine.replaceAll("_", " ")}</div>
              <h3>${dayName(d.weekday)} · ${d.date.slice(5)}</h3>
              <small class="muted">${d.estimatedDurationMinutes} min · ${d.plan.exercises.length} exercises</small>
              <button class="${active ? "secondary" : "primary"}" data-action="generate-day" data-date="${d.date}">${active ? "Loaded" : "Open"}</button>
            </article>`;
          })
          .join("")}</div></section>`;
    } else {
      weekSection = `<section class="card full"><h2>This week</h2><p class="muted">Loading your week…</p></section>`;
    }
  }

  const draftSection = draft
    ? preview(draft)
    : `<section class="card full"><h2>No active session</h2><p class="muted">${state.program ? "Pick a day above" : "Generate a custom session below"} to preview exercises, targets and rationale.</p></section>`;

  app.innerHTML =
    hero(
      "E4.3 · Manage your week",
      "Your week, ready to adjust.",
      "Pick a day, review the session and make any changes before you start."
    ) +
    `<section class="grid">
      ${weekSection}
      ${draftSection}
      <details class="card full"><summary>Custom session</summary>
        <form class="fields three" data-form="plan">
          <label>Date<input name="date" type="date" value="${new Date().toISOString().slice(0, 10)}"></label>
          <label>Minutes<input name="minutes" type="number" min="15" value="${minutes}"></label>
          <label>Environment<select name="environmentId"><option value="">Default</option>${(state.profile?.environments || []).map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("")}</select></label>
          <button class="primary">Generate custom</button>
        </form>
      </details>
    </section>`;

  // Lazy-load the week preview when a program exists but we don't have it yet.
  if (state.program && !state.week) {
    api
      .weekPreview()
      .then((week) => {
        state.week = week;
        persist();
        if (route() === "plan") render();
      })
      .catch(() => {});
  }
}

function preview(draft) {
  if (!draft.plan.exercises.length) {
    return `<section class="card full"><h2>No exercises matched</h2><p class="muted">Add equipment to your environment in <a href="#profile">Profile</a> (or pick a different day), then generate again.</p></section>`;
  }
  return `<section class="card full">
    <div class="row between"><div><div class="badge">${draft.plan.routine.replaceAll("_", " ")}</div><h2>${draft.plan.estimatedDurationMinutes} minute session</h2></div>
      <div class="row"><button class="secondary" data-action="add-exercise">+1 exercise</button><button class="ghost danger" data-action="discard-plan">Delete</button><a class="primary" href="#perform">Start session</a></div></div>
    <p class="muted">Rule set ${draft.plan.ruleSetVersion} · ${draft.adjustments.length} local adjustment(s)</p>
    ${draft.plan.exercises
      .map(
        (exercise) => `<article class="exercise">
      <div class="row between"><div><h3>${escapeHtml(exercise.exerciseName)}</h3><small>${exercise.primaryMuscle} · ${exercise.sets.length} sets · ${exercise.restSeconds}s rest</small></div>
      <div class="row"><button class="ghost" data-action="why" data-slug="${exercise.exerciseSlug}">Why?</button><button class="secondary" data-action="swap" data-slug="${exercise.exerciseSlug}">Swap</button></div></div>
      ${exercise.sets.map((set) => `<div class="set-row"><span class="set-index">${set.index}</span><span>${set.targetReps.min}–${set.targetReps.max} reps</span><span>${set.targetLoad ?? "Choose"} kg</span><span>${set.targetRir} RIR</span><div class="row"><button class="ghost" data-action="adjust" data-slug="${exercise.exerciseSlug}" data-set="${set.index}">Adjust</button><button class="ghost danger" data-action="remove-set" data-slug="${exercise.exerciseSlug}" data-set="${set.index}">Remove</button></div></div>`).join("")}
    </article>`
      )
      .join("")}
  </section>`;
}

function renderPerform() {
  if (!state.draft || !state.draft.plan.exercises.length) {
    app.innerHTML =
      hero(
        "E4.4 · Offline-first execution",
        "Nothing to perform yet.",
        "Open a session from Manage first — then come here to log your sets."
      ) +
      `<section class="grid"><section class="card full"><h2>No active session</h2><p class="muted">Head to Manage and open a training day.</p><a class="primary" href="#plan">Go to Manage</a></section></section>`;
    return;
  }
  const draft = state.draft;
  app.innerHTML =
    hero(
      "E4.4 · Offline-first execution",
      "Perform now. Sync whenever.",
      "Every set is saved locally first. Negative weight records assistance, not an error."
    ) +
    `<section class="grid"><section class="card full">
      <div class="row between"><h2>${draft.plan.routine.replaceAll("_", " ")}</h2><div class="row"><button class="danger-button" data-action="skip">Skip</button><button class="primary" data-action="complete">Complete</button></div></div>
      ${draft.plan.exercises
        .map(
          (
            exercise
          ) => `<article class="exercise"><div class="row between"><div><h3>${escapeHtml(exercise.exerciseName)}</h3><small>${exercise.primaryMuscle} · rest ${exercise.restSeconds}s</small></div><button class="ghost" data-action="why" data-slug="${exercise.exerciseSlug}">Why?</button></div>
      ${exercise.sets.map((set) => performSet(exercise, set)).join("")}</article>`
        )
        .join("")}
    </section></section>`;
}

function performSet(exercise, set) {
  const key = `${exercise.exerciseSlug}:${set.index}`;
  const logged = Object.values(state.logged).find(
    (item) => item.key === key && item.sessionId === state.draft.sessionId
  );
  return `<form class="set-row" data-form="set" data-slug="${exercise.exerciseSlug}" data-set="${set.index}" data-key="${key}">
    <span class="set-index">${logged ? "✓" : set.index}</span>
    <label>kg<input name="weight" type="number" step=".5" value="${set.targetLoad ?? ""}" required></label>
    <label>reps<input name="reps" type="number" min="0" value="${set.targetReps.min}" required></label>
    <label>RIR<input name="rir" type="number" min="0" step=".5" value="${set.targetRir}" required></label>
    <button class="${logged ? "ghost" : "primary"}" ${logged ? "disabled" : ""}>${logged ? (logged.synced ? "Synced" : "Queued") : "Log set"}</button>
  </form>`;
}

async function renderAnalytics() {
  app.innerHTML =
    hero(
      "E4.7 · Performance",
      "Strength trend, without noise.",
      "Track estimated 1RM movement over time for each exercise."
    ) + `<section class="grid"><section class="card full">Loading performance…</section></section>`;
  try {
    state.analytics = await api.performance();
    app.innerHTML =
      hero(
        "E4.7 · Performance",
        "Strength trend, without noise.",
        "Estimated 1RM movement from your completed sets."
      ) +
      `<section class="grid">${state.analytics.exercises.length ? state.analytics.exercises.map(analyticsCard).join("") : `<section class="card full"><h2>No performance history yet</h2><p class="muted">Complete logged sets to build your trend.</p></section>`}</section>`;
  } catch (error) {
    showError(error);
  }
}

function analyticsCard(item) {
  const values = item.points.map((point) => point.e1RM);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const points = values
    .map(
      (value, index) =>
        `${(index / Math.max(values.length - 1, 1)) * 100},${65 - ((value - min) / Math.max(max - min, 1)) * 55}`
    )
    .join(" ");
  return `<section class="card third"><div class="badge">${escapeHtml(item.exerciseSlug.replaceAll("_", " "))}</div><div class="metric ${item.delta >= 0 ? "positive" : "danger"}">${item.delta >= 0 ? "+" : ""}${item.deltaPct}%</div><p class="muted">${item.firstE1RM} → ${item.latestE1RM} estimated 1RM</p><svg class="spark" viewBox="0 0 100 70" preserveAspectRatio="none"><polyline points="${points}" fill="none" stroke="#9bf24a" stroke-width="3" vector-effect="non-scaling-stroke"/></svg></section>`;
}

function renderTools() {
  app.innerHTML =
    hero(
      "E4.6 · Recovery tools",
      "Adjust without abandoning the plan.",
      "Use recovery week controls when life or fatigue changes faster than the schedule."
    ) +
    `<section class="grid"><section class="card"><h2>Recovery week</h2><p class="muted">Lower volume and load while increasing target RIR in future plans.</p><div class="row"><button class="primary" data-action="deload-on">Enable</button><button class="ghost" data-action="deload-off">Disable</button></div></section>
    <section class="card"><h2>Offline queue</h2><p class="muted">Pending sets retain their idempotent client IDs until the server accepts them.</p><button class="secondary" data-action="sync">Sync now</button></section></section>`;
}

function options(values, selected) {
  return values
    .map((value) => `<option ${value === selected ? "selected" : ""}>${value}</option>`)
    .join("");
}

function optionLabels(values, selected) {
  return values
    .map(
      ([value, label]) =>
        `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`
    )
    .join("");
}

async function onSubmit(event) {
  const form = event.target.closest("form");
  if (!form) return;
  event.preventDefault();
  const data = new FormData(form);
  try {
    if (form.dataset.form === "login") {
      localStorage.setItem("myoadapt.apiBase", data.get("apiBase"));
      localStorage.setItem("myoadapt.email", data.get("email"));
      api = createApi();
      const tokens = await api.devLogin(data.get("email"));
      state.token = tokens.accessToken;
      state.refresh = tokens.refreshToken;
      api.setAccessToken(state.token);
      api.setRefreshToken(state.refresh);
      persist();
      try {
        state.profile = await api.profile();
      } catch {}
      try {
        const programResponse = await api.program();
        state.program = programResponse.program;
      } catch {}
      persist();
      location.hash = state.profile ? "#program" : "#profile";
    }
    if (form.dataset.form === "profile") {
      const priorityMuscles = [
        "chest",
        "lats",
        "upper_back",
        "side_delts",
        "biceps",
        "triceps",
        "quads",
        "hamstrings",
        "glutes"
      ];
      const priorities = Object.fromEntries(
        priorityMuscles.map((muscle) => [muscle, Number(data.get(`priority-${muscle}`))])
      );
      const numOrNull = (key) => (data.get(key) === "" ? null : Number(data.get(key)));
      const days = data
        .getAll("trainingDay")
        .map(Number)
        .sort((a, b) => a - b);
      if (days.length < 2) return toast("Select at least 2 training days");
      const selectedInjuries = data.getAll("injury").map(String);
      state.profile = await api.saveProfile({
        trainingAge: data.get("trainingAge"),
        recoveryProfile: Number(data.get("recoveryProfile")),
        sex: data.get("sex"),
        birthYear: numOrNull("birthYear"),
        heightCm: numOrNull("heightCm"),
        weightKg: numOrNull("weightKg"),
        weeklySchedule: {
          days,
          minutesPerDay: Number(data.get("minutes"))
        },
        prefs: {
          ...state.profile?.prefs,
          displayName: String(data.get("displayName") || "").trim(),
          trainingGoal: data.get("trainingGoal"),
          musclePriorities: priorities,
          sessionPreferences: {
            volumeLevel: state.profile?.prefs?.sessionPreferences?.volumeLevel || "recommended",
            exercisesPerSession: Number(data.get("exercisesPerSession"))
          }
        },
        injuries: selectedInjuries.map((jointOrMuscle) => ({
          jointOrMuscle,
          severity: data.get(`injurySeverity-${jointOrMuscle}`)
        })),
        environments: [
          {
            name: data.get("environmentName"),
            equipment: data.getAll("equipment").map(String)
          }
        ]
      });
      await api.setSpecialization(priorities);
      if (state.program && days.length === state.program.daysPerWeek) {
        state.program = (
          await api.setProgram(state.program.daysPerWeek, state.program.splitId, days)
        ).program;
      } else if (state.program) {
        await api.deleteProgram();
        state.program = null;
        state.programDraft = null;
      }
      state.week = null;
      persist();
      toast(
        state.program ? "Profile and training days updated" : "Profile saved · choose your split"
      );
      location.hash = "#program";
    }
    if (form.dataset.form === "plan") await generatePlan(data);
    if (form.dataset.form === "set") await logSet(form, data);
  } catch (error) {
    showError(error);
  }
}

async function generatePlan(data) {
  const result = await api.generatePlan({
    date: data.get("date"),
    minutesAvailable: Number(data.get("minutes")),
    environmentId: data.get("environmentId") || undefined
  });
  state.draft = createSessionDraft(result.sessionId, result.plan);
  state.logged = {};
  persist();
  toast("Session generated");
  render();
}

async function generateDay(date) {
  const result = await api.generatePlan({
    date,
    minutesAvailable: Math.max(state.profile?.weeklySchedule?.minutesPerDay || 45, 45)
  });
  state.draft = createSessionDraft(result.sessionId, result.plan);
  state.logged = {};
  persist();
  toast(`${result.plan.routine.replaceAll("_", " ")} session ready`);
  render();
}

function discardPlan() {
  if (!state.draft) return;
  state.draft = null;
  state.logged = {};
  persist();
  toast("Plan deleted");
  render();
}

function switchAccount() {
  state.token = "";
  state.refresh = "";
  state.profile = null;
  state.program = null;
  state.week = null;
  state.draft = null;
  state.logged = {};
  persist();
  location.hash = "#login";
}

async function logSet(form, data) {
  const performedAt = new Date().toISOString();
  const input = {
    clientSetId: stableClientSetId(
      state.draft.sessionId,
      form.dataset.slug,
      Number(form.dataset.set),
      performedAt
    ),
    exerciseSlug: form.dataset.slug,
    setIndex: Number(form.dataset.set),
    weight: Number(data.get("weight")),
    reps: Number(data.get("reps")),
    rir: Number(data.get("rir")),
    performedAt
  };
  await queue.enqueue(state.draft.sessionId, input);
  state.logged[input.clientSetId] = {
    key: form.dataset.key,
    sessionId: state.draft.sessionId,
    input,
    synced: false
  };
  persist();
  await sync();
  render();
}

async function onClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  try {
    if (action === "generate") document.querySelector('[data-form="plan"]').requestSubmit();
    if (action === "generate-day") await generateDay(button.dataset.date);
    if (action === "discard-plan") discardPlan();
    if (action === "switch-account") switchAccount();
    if (action === "sync") await sync();
    if (action === "why") showWhy(button.dataset.slug);
    if (action === "adjust") adjust(button.dataset.slug, Number(button.dataset.set));
    if (action === "remove-set") {
      state.draft = removePlannedSet(state.draft, button.dataset.slug, Number(button.dataset.set));
      persist();
      render();
    }
    if (action === "swap") await chooseSwap(button.dataset.slug);
    if (action === "swap-pick") await applySwap(button.dataset.source, button.dataset.slug);
    if (action === "add-exercise") chooseMuscleForExercise();
    if (action === "add-muscle") await chooseExerciseForMuscle(button.dataset.muscle);
    if (action === "add-exercise-pick") await addExercise(button.dataset.slug);
    if (action === "choose-days") await chooseDays(Number(button.dataset.days));
    if (action === "choose-exercise-count") await chooseExerciseCount(Number(button.dataset.count));
    if (action === "choose-split")
      await chooseSplit(Number(button.dataset.days), button.dataset.split);
    if (action === "toggle-day") toggleDay(Number(button.dataset.day));
    if (action === "apply-days") await applyDays();
    if (action === "delete-program") await deleteProgram();
    if (action === "manage-week") {
      await previewWeek();
      location.hash = "#plan";
    }
    if (action === "complete") await complete();
    if (action === "skip") await skip();
    if (action === "deload-on" || action === "deload-off") {
      await api.setDeload(action === "deload-on");
      toast(action === "deload-on" ? "Recovery week enabled" : "Recovery week disabled");
    }
  } catch (error) {
    showError(error);
  }
}

function adjust(slug, setIndex) {
  const exercise = state.draft.plan.exercises.find((item) => item.exerciseSlug === slug);
  const set = exercise.sets.find((item) => item.index === setIndex);
  const load = prompt("Target load in kg (negative means assistance)", set.targetLoad ?? "");
  if (load === null) return;
  state.draft = adjustPlannedSet(state.draft, slug, setIndex, { targetLoad: Number(load) });
  persist();
  render();
}

function showWhy(slug) {
  const rationale = explainExercise(state.draft.plan, slug);
  whyContent.innerHTML = `<div class="eyebrow">Explainability</div><h2>Why this exercise?</h2>${rationale.map((item) => `<article class="rationale"><strong>${escapeHtml(item.message)}</strong><div class="muted">${escapeHtml(item.code)}</div></article>`).join("")}`;
  dialog.showModal();
}

async function chooseSwap(slug) {
  const response = await api.exerciseSwaps(
    slug,
    state.draft.plan.context.environmentId || undefined
  );
  if (!response.options.length) return toast("No safe swap available");
  const current = state.draft.plan.exercises.find((item) => item.exerciseSlug === slug);
  whyContent.innerHTML =
    `<div class="eyebrow">Don't like this exercise?</div><h2>Swap ${escapeHtml(current?.exerciseName || slug)}</h2>` +
    `<p class="muted">Same primary muscle, available with your equipment and safe for your injuries. Best match first.</p>` +
    response.options
      .map(
        (option) => `<article class="rationale row between">
          <div><strong>${escapeHtml(option.exerciseName)}</strong><div class="muted">${option.mechanic} · ${option.requiredEquipment.join(", ") || "bodyweight"} · match ${option.score}</div></div>
          <button class="primary" data-action="swap-pick" data-source="${escapeHtml(slug)}" data-slug="${escapeHtml(option.exerciseSlug)}">Choose</button>
        </article>`
      )
      .join("");
  dialog.showModal();
}

async function applySwap(sourceSlug, replacementSlug) {
  const response = await api.exerciseSwaps(
    sourceSlug,
    state.draft.plan.context.environmentId || undefined
  );
  const replacement = response.options.find((option) => option.exerciseSlug === replacementSlug);
  if (!replacement) return toast("That swap is no longer available");
  await api.applyExerciseSwap(state.draft.sessionId, sourceSlug, replacement.exerciseSlug);
  state.draft = swapExercise(state.draft, sourceSlug, replacement);
  persist();
  dialog.close();
  toast(`Swapped to ${replacement.exerciseName}`);
  render();
}

const musclesByRoutine = {
  full_body: [
    "chest",
    "lats",
    "upper_back",
    "side_delts",
    "biceps",
    "triceps",
    "quads",
    "hamstrings",
    "glutes",
    "calves",
    "abs"
  ],
  upper: ["chest", "lats", "upper_back", "side_delts", "rear_delts", "biceps", "triceps"],
  lower: ["quads", "hamstrings", "glutes", "calves", "abs", "lower_back"],
  push: ["chest", "side_delts", "front_delts", "triceps"],
  pull: ["lats", "upper_back", "rear_delts", "biceps", "traps", "forearms"],
  legs: ["quads", "hamstrings", "glutes", "calves", "abs", "lower_back"],
  chest_back: ["chest", "lats", "upper_back", "rear_delts", "traps"],
  shoulders_arms: ["front_delts", "side_delts", "rear_delts", "biceps", "triceps", "forearms"]
};

function chooseMuscleForExercise() {
  const count = state.draft?.plan.exercises.length ?? 0;
  if (count >= 8) return toast("8 exercises is the maximum for one session");
  if (
    count >= 7 &&
    !confirm("More than 7 exercises is usually not ideal for quality and recovery. Add one anyway?")
  )
    return;
  const muscles = musclesByRoutine[state.draft.plan.routine] || [];
  whyContent.innerHTML =
    `<div class="eyebrow">Add one exercise</div><h2>Which muscle group do you want?</h2>` +
    `<p class="muted">We will only show exercises available with your equipment and safe for your recorded injuries.</p>` +
    `<div class="row wrap">${muscles
      .map(
        (muscle) =>
          `<button class="chip" data-action="add-muscle" data-muscle="${muscle}">${muscle.replaceAll("_", " ")}</button>`
      )
      .join("")}</div>`;
  dialog.showModal();
}

async function chooseExerciseForMuscle(muscleId) {
  const response = await api.exerciseAddOptions(
    muscleId,
    state.draft.plan.context.environmentId || undefined
  );
  const used = new Set(state.draft.plan.exercises.map((exercise) => exercise.exerciseSlug));
  const options = response.options.filter((option) => !used.has(option.exerciseSlug));
  if (!options.length) return toast("No additional safe exercise available for this muscle");
  whyContent.innerHTML =
    `<div class="eyebrow">Add ${escapeHtml(muscleId.replaceAll("_", " "))}</div><h2>Choose an exercise</h2>` +
    options
      .slice(0, 8)
      .map(
        (option) => `<article class="rationale row between">
          <div><strong>${escapeHtml(option.exerciseName)}</strong><div class="muted">${option.mechanic} · ${option.requiredEquipment.join(", ") || "bodyweight"}</div></div>
          <button class="primary" data-action="add-exercise-pick" data-slug="${escapeHtml(option.exerciseSlug)}">Add</button>
        </article>`
      )
      .join("");
}

async function addExercise(exerciseSlug) {
  const response = await api.addExercise(state.draft.sessionId, exerciseSlug);
  state.draft.plan = response.plan;
  state.draft.adjustments.push(`Added ${response.exercise.exerciseName}`);
  persist();
  dialog.close();
  toast(`${response.exercise.exerciseName} added`);
  render();
}

async function chooseDays(daysPerWeek) {
  const templates = await api.programTemplates(daysPerWeek);
  state.programDraft = { daysPerWeek, options: templates.options };
  render();
}

async function chooseExerciseCount(exercisesPerSession) {
  const currentPrefs = state.profile?.prefs || {};
  state.profile = await api.saveProfile({
    prefs: {
      ...currentPrefs,
      sessionPreferences: {
        volumeLevel: currentPrefs.sessionPreferences?.volumeLevel || "recommended",
        exercisesPerSession
      }
    }
  });
  state.week = null;
  persist();
  toast(
    exercisesPerSession === 5
      ? "Recommended exercise count selected"
      : `${exercisesPerSession} exercises selected`
  );
  render();
}

async function chooseSplit(daysPerWeek, splitId) {
  const response = await api.setProgram(daysPerWeek, splitId);
  state.program = response.program;
  state.programDraft = null;
  state.dayEdit = [...response.program.trainingDays];
  try {
    state.profile = await api.profile();
  } catch {}
  persist();
  toast(`${response.program.splitName} program set`);
  await previewWeek();
}

function toggleDay(day) {
  const cap = state.program?.daysPerWeek ?? 7;
  const current = state.dayEdit ?? (state.program ? [...state.program.trainingDays] : []);
  if (current.includes(day)) {
    state.dayEdit = current.filter((d) => d !== day);
  } else {
    if (current.length >= cap) return toast(`You can pick ${cap} days for this split`);
    state.dayEdit = [...current, day].sort((a, b) => a - b);
  }
  render();
}

async function applyDays() {
  if (!state.program) return;
  const days = state.dayEdit ?? state.program.trainingDays;
  if (days.length !== state.program.daysPerWeek) {
    return toast(`Pick exactly ${state.program.daysPerWeek} days`);
  }
  const response = await api.setProgram(state.program.daysPerWeek, state.program.splitId, days);
  state.program = response.program;
  state.dayEdit = [...response.program.trainingDays];
  try {
    state.profile = await api.profile();
  } catch {}
  persist();
  toast("Training days updated");
  await previewWeek();
}

async function deleteProgram() {
  await api.deleteProgram();
  state.program = null;
  state.dayEdit = null;
  state.week = null;
  state.programDraft = null;
  persist();
  toast("Program removed");
  render();
}

async function previewWeek() {
  state.week = await api.weekPreview();
  persist();
  render();
}

async function complete() {
  const result = await queue.flush();
  if (result.pending) return toast("Complete after pending sets sync");
  const response = await api.completeSession(state.draft.sessionId);
  toast(
    response.deloadStatus.recommended
      ? "Completed · recovery week recommended"
      : "Session completed"
  );
  state.draft = null;
  state.logged = {};
  persist();
  location.hash = "#analytics";
}

async function skip() {
  await api.skipSession(state.draft.sessionId);
  state.draft = null;
  state.logged = {};
  persist();
  toast("Skipped without penalty");
  location.hash = "#plan";
}

function showError(error) {
  // Auto-refresh failed or no refresh token (e.g. an old session): bounce to login.
  if (error && error.status === 401) {
    state.token = "";
    state.refresh = "";
    persist();
    toast("Session expired — please continue again");
    location.hash = "#login";
    return;
  }
  toast(error instanceof Error ? error.message : String(error));
}

render();
sync();
