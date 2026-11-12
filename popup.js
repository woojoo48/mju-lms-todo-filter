const core = globalThis.MjuTodoCore;
const enabledInput = document.querySelector("#enabled");
const statusEl = document.querySelector("#status");
const courseListEl = document.querySelector("#course-list");

let state = { enabled: true, overrides: {}, courses: [], status: null };
let renderedCoursesJson = "";

const AUTO_LABEL = { show: "자동 · 정규(표시)", hide: "자동 · 비교과(숨김)", unknown: "자동 · 미분류(표시)" };

function renderStatus() {
  enabledInput.checked = state.enabled;
  if (!state.courses.length) {
    statusEl.textContent = state.status?.text || "LMS 페이지를 열면 과목 목록을 가져와요.";
  } else {
    statusEl.textContent = state.status?.text || "LMS 탭을 새로고침하면 적용 상태가 보여요.";
  }
  statusEl.classList.toggle("held", state.status?.state === "held");
}

function createCourseRow(course) {
  const row = document.createElement("label");
  row.className = "course-row";
  const content = document.createElement("span");
  const name = document.createElement("span");
  name.className = "course-name";
  name.textContent = course.name || course.key;
  const meta = document.createElement("span");
  meta.className = "course-code";
  meta.textContent = `할 일 ${course.count}개`;
  content.append(name, meta);

  const select = document.createElement("select");
  select.dataset.courseKey = course.key;
  const options = [
    ["auto", AUTO_LABEL[core.autoClassification(course.key)]],
    [core.SHOW, "항상 표시"],
    [core.HIDE, "숨기기"]
  ];
  for (const [value, label] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }
  select.value = state.overrides[course.key] || "auto";
  select.addEventListener("change", () => {
    const overrides = { ...state.overrides };
    if (select.value === "auto") delete overrides[course.key];
    else overrides[course.key] = select.value;
    state.overrides = overrides;
    chrome.storage.local.set({ courseOverrides: overrides });
  });
  row.append(content, select);
  return row;
}

// 과목 목록이 실제로 바뀔 때만 다시 그린다. 고르던 선택이 초기화되지 않게 하기 위해서다.
function renderCourses() {
  const json = JSON.stringify(state.courses);
  if (json === renderedCoursesJson) return;
  renderedCoursesJson = json;
  courseListEl.replaceChildren(...state.courses.map(createCourseRow));
}

chrome.storage.local.get(["filterEnabled", "courseOverrides", "currentCourses", "filterStatus"], (saved) => {
  state = {
    enabled: saved.filterEnabled !== false,
    overrides: saved.courseOverrides || {},
    courses: Array.isArray(saved.currentCourses) ? saved.currentCourses : [],
    status: saved.filterStatus || null
  };
  renderStatus();
  renderCourses();
});

enabledInput.addEventListener("change", () => {
  state.enabled = enabledInput.checked;
  chrome.storage.local.set({ filterEnabled: state.enabled });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.filterEnabled) state.enabled = changes.filterEnabled.newValue !== false;
  if (changes.courseOverrides) state.overrides = changes.courseOverrides.newValue || {};
  if (changes.filterStatus) state.status = changes.filterStatus.newValue || null;
  if (changes.currentCourses) state.courses = changes.currentCourses.newValue || [];
  renderStatus();
  renderCourses();
});
