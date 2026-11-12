(() => {
  const core = globalThis.MjuTodoCore;

  const BADGE = "#header_todo .new_cnt";
  const ASIDE_COUNT = "#asideTodoCnt";
  const ASIDE_ZONE = "#aside_todo_zone";
  const ASIDE_ITEMS = "#aside_todo_zone a.aside_list_todo_item";
  const MODAL = "#todo_pop";
  const MODAL_CARDS = "#todo_pop a.todo_wrap[data-kj]";
  const MODAL_TABS = "#todo_pop button.todo_tab[data-kjkey]";
  const MODAL_CATEGORIES = "#todo_pop button.todo_category[data-id]";
  const HIDDEN = "mju-todo-hidden";
  const LIST_URL = "/ilos/mp/todo_list.acl";
  const FORM_URL = "/ilos/mp/todo_list_form.acl";
  const COUNT_URL = "/ilos/co/todo_list_count.acl";
  const REFETCH_GAP_MS = 5000;

  let enabled = true;
  let overrides = {};
  let courseNames = {};
  let cards = null;          // [{ key, type }] 마지막으로 확인한 전체 할 일
  let expectedTotal = null;  // todo_list_count.acl 의 TODO_CNT (배지와 달리 99에서 잘리지 않음)
  let fetchError = "";
  let fetching = false;
  let lastFetchAt = 0;
  let lastFetchNative = null;
  let lastFetchCount = null;
  let lastRefetchKey = "";   // 마지막으로 다시 받기를 시도한 (배지 숫자|목록 수)
  let lastStatusJson = "";
  let lastCoursesJson = "";
  let timer;
  let refetchTimer;

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  // ---- LMS 원래 숫자 기억/복원 ----

  // LMS가 쓴 숫자를 data-mju-native에 기억한다. 우리가 쓴 숫자(data-mju-rendered)와 다르면 LMS가 새로 쓴 값이다.
  function readNative(el) {
    if (!el) return null;
    const current = core.normalize(el.textContent);
    if (/^\d+$/.test(current) && current !== el.dataset.mjuRendered) el.dataset.mjuNative = current;
    return core.parseCount(el.dataset.mjuNative ?? current);
  }

  function renderCount(el, count) {
    if (!el) return;
    readNative(el);
    const next = String(count);
    el.dataset.mjuRendered = next;
    if (el.textContent !== next) el.textContent = next;
  }

  function restoreCount(el) {
    if (!el) return;
    readNative(el); // LMS가 그사이 새로 쓴 숫자가 있으면 그것을 원래 값으로 삼는다.
    const native = el.dataset.mjuNative;
    delete el.dataset.mjuRendered;
    if (native !== undefined && core.normalize(el.textContent) !== native) el.textContent = native;
  }

  function setHidden(el, hidden) {
    if (el.classList.contains(HIDDEN) !== hidden) el.classList.toggle(HIDDEN, hidden);
  }

  // ---- 데이터 ----

  async function post(path) {
    const response = await fetch(new URL(path, location.origin), {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest"
      },
      body: "encoding=utf-8"
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  }

  const parseHtml = (text) => new DOMParser().parseFromString(text, "text/html");

  // 전체 수를 못 받아도 목록 확인은 계속한다 (그때는 배지 숫자로 확인).
  async function fetchTotal() {
    try {
      return core.parseCount(JSON.parse(await post(COUNT_URL))?.param?.TODO_CNT);
    } catch {
      return null;
    }
  }

  const cardFrom = (el) => ({ key: el.dataset.kj || "", type: el.dataset.id || "" });

  function tabsFrom(root) {
    return [...root.querySelectorAll("button.todo_tab[data-kjkey]")].map((button) => ({
      key: button.dataset.kjkey,
      name: core.normalize(button.querySelector(".todo_subjt_nm")?.textContent)
    }));
  }

  function rememberNames(tabs) {
    let changed = false;
    for (const tab of tabs) {
      if (tab.key && tab.name && courseNames[tab.key] !== tab.name) {
        courseNames[tab.key] = tab.name;
        changed = true;
      }
    }
    if (changed) chrome.storage.local.set({ courseNames });
  }

  async function fetchCards() {
    if (fetching) return;
    fetching = true;
    lastFetchAt = Date.now();
    lastFetchNative = readNative($(BADGE));
    try {
      const [listText, total] = await Promise.all([post(LIST_URL), fetchTotal()]);
      // data-kj가 빠진 카드도 세어 검증에서 걸러지게 한다. 빈 목록 안내(.no_data)는 LMS처럼 뺀다.
      cards = [...parseHtml(listText).querySelectorAll("a.todo_wrap:not(.no_data)")].map(cardFrom);
      expectedTotal = total;
      lastFetchCount = cards.length;
      fetchError = "";
      if (cards.some((card) => card.key && !courseNames[card.key])) {
        rememberNames(tabsFrom(parseHtml(await post(FORM_URL))));
      }
    } catch (error) {
      fetchError = `할 일 목록을 불러오지 못해 원래 화면을 유지해요 (${error.message}).`;
    } finally {
      fetching = false;
      scheduleRefresh();
    }
  }

  function modalCards() {
    return $$(MODAL_CARDS);
  }

  // ---- 화면 반영 ----

  function coursesForMatching() {
    return Object.entries(courseNames).map(([key, name]) => ({ key, name }))
      .concat((cards || []).filter((card) => card.key && !courseNames[card.key]).map((card) => ({ key: card.key, name: "" })));
  }

  function asideKey(item, courses) {
    const attrs = [...item.attributes].map((attr) => attr.value).join(" ");
    const info = item.querySelector(".aside_list_info")?.textContent || "";
    return core.matchCourseKey({ attrs, info }, courses);
  }

  function applyModal(active) {
    const items = modalCards();
    if (!items.length) return;
    for (const el of items) setHidden(el, active && core.shouldHide(el.dataset.kj, overrides, enabled));
    for (const tab of $$(MODAL_TABS)) setHidden(tab, active && core.shouldHide(tab.dataset.kjkey, overrides, enabled));

    // LMS는 탭을 고를 때 보이는 카드에만 .on을 붙이고 유형 숫자를 다시 센다. 같은 기준에 숨김을 더해 다시 센다.
    const counts = core.countVisibleByType(items.map((el) => ({
      type: el.dataset.id,
      visible: el.classList.contains("on") && !(active && el.classList.contains(HIDDEN))
    })));
    for (const button of $$(MODAL_CATEGORIES)) {
      const countEl = button.querySelector(".cate_cnt");
      if (!countEl) continue;
      if (active) {
        renderCount(countEl, counts[button.dataset.id] || 0);
        setHidden(button, (counts[button.dataset.id] || 0) === 0);
      } else {
        restoreCount(countEl);
        setHidden(button, false);
      }
    }
  }

  function applyAside(active) {
    const courses = active ? coursesForMatching() : [];
    for (const item of $$(ASIDE_ITEMS)) {
      setHidden(item, active && core.shouldHide(asideKey(item, courses), overrides, enabled));
    }
  }

  function computeStatus() {
    if (!enabled) return { state: "off", text: "전체 과목을 표시 중이에요." };
    if (fetchError) return { state: "held", text: fetchError };
    if (!cards) return { state: "pending", text: "할 일 목록을 확인하는 중이에요." };
    const native = readNative($(BADGE));
    const check = core.validateCards(cards, { total: expectedTotal, badge: native });
    if (!check.ok) return { state: "held", text: check.reason, native, count: cards.length };
    const { visible, total } = core.summarize(cards, overrides, enabled);
    return { state: "applied", text: `정규 과목만 표시 중 · ${visible} / 전체 ${total}`, visible, total };
  }

  function apply() {
    // 할 일 UI가 없는 페이지는 아무것도 하지 않는다 (다른 탭의 상태 문구를 덮어쓰지 않기 위해).
    if (!hasTodoUi()) return;
    // UI가 늦게 그려진 페이지는 이때 처음 목록을 받는다.
    if (!cards && !fetching && !lastFetchAt) fetchCards();
    // 할 일 창이 열려 있으면 화면에 막 그려진 목록이 가장 최신이다.
    const items = modalCards();
    if (items.length) cards = items.map(cardFrom);

    const status = computeStatus();
    const active = status.state === "applied";
    const badge = $(BADGE);
    const asideCount = $(ASIDE_COUNT);

    if (active) {
      renderCount(badge, core.badgeText(status.visible)); // LMS처럼 상단 배지는 99까지만
      renderCount(asideCount, status.visible);
    } else {
      restoreCount(badge);
      restoreCount(asideCount);
    }
    applyAside(active);
    applyModal(active);
    ensureToggle(status);
    ensureModalStatus(status);
    publish(status);
    maybeRefetch(status);
  }

  // LMS 숫자나 할 일 창의 목록 수가 마지막으로 받은 것과 달라지면(과제 완료·추가) 목록과 전체 수를 다시 받는다.
  // 같은 상태로는 한 번만 다시 받는다. 요청 자체가 실패한 경우(native 없음)는 새로고침 때 다시 시도한다.
  function maybeRefetch(status) {
    if (fetching || status.state !== "held" || status.native === undefined) return;
    if (status.native === lastFetchNative && status.count === lastFetchCount) return;
    // 다시 받아도 어긋남이 계속되는 상태(예: 할 일 창 카드 수가 응답과 계속 다름)에서 반복 요청하지 않는다.
    const key = `${status.native}|${status.count}`;
    if (key === lastRefetchKey) return;
    const wait = REFETCH_GAP_MS - (Date.now() - lastFetchAt);
    // 간격 안이면 남은 시간 뒤에 한 번만 다시 확인한다 (폴링 아님).
    if (wait > 0) {
      clearTimeout(refetchTimer);
      refetchTimer = setTimeout(scheduleRefresh, wait);
      return;
    }
    lastRefetchKey = key;
    fetchCards();
  }

  function publish(status) {
    const statusJson = JSON.stringify({ state: status.state, text: status.text });
    if (statusJson !== lastStatusJson) {
      lastStatusJson = statusJson;
      chrome.storage.local.set({ filterStatus: { state: status.state, text: status.text, at: Date.now() } });
    }
    if (!cards) return;
    const tabs = Object.entries(courseNames).map(([key, name]) => ({ key, name }));
    const keysNow = new Set(cards.map((card) => card.key));
    // 현재 할 일이 있는 과목만 목록에 둔다. 지난 학기 과목은 자연히 빠진다.
    const courses = core.buildCourseList(cards, tabs.filter((tab) => keysNow.has(tab.key)));
    const coursesJson = JSON.stringify(courses);
    if (coursesJson !== lastCoursesJson) {
      lastCoursesJson = coursesJson;
      chrome.storage.local.set({ currentCourses: courses });
    }
  }

  function ensureToggle(status) {
    const header = $(ASIDE_ZONE)?.closest(".aside_list_container")?.querySelector(".aside_list_header");
    if (!header) return;
    let button = header.querySelector(".mju-todo-inline-toggle");
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "mju-todo-inline-toggle";
      button.addEventListener("click", () => chrome.storage.local.set({ filterEnabled: !enabled }));
      header.appendChild(button);
    }
    const label = enabled ? "전체 보기" : "정규만 보기";
    if (button.textContent !== label) button.textContent = label;
    if (button.title !== status.text) button.title = status.text;
    button.classList.toggle("mju-todo-held", status.state === "held");
    button.setAttribute("aria-pressed", String(enabled));
  }

  function ensureModalStatus(status) {
    const box = $(`${MODAL} .todo_list_box`);
    if (!box) return;
    let bar = box.querySelector(":scope > .mju-todo-filter-status");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "mju-todo-filter-status";
      const text = document.createElement("span");
      text.className = "mju-todo-filter-status-text";
      const button = document.createElement("button");
      button.type = "button";
      button.addEventListener("click", () => chrome.storage.local.set({ filterEnabled: !enabled }));
      bar.append(text, button);
      box.insertBefore(bar, box.firstChild);
    }
    const text = bar.querySelector(".mju-todo-filter-status-text");
    const button = bar.querySelector("button");
    if (text.textContent !== status.text) text.textContent = status.text;
    const label = enabled ? "전체 보기" : "정규만 보기";
    if (button.textContent !== label) button.textContent = label;
    bar.classList.toggle("mju-todo-held", status.state === "held");
  }

  function scheduleRefresh() {
    clearTimeout(timer);
    timer = setTimeout(apply, 80);
  }

  // ---- 시작 ----

  function relevant(record) {
    const node = record.target;
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!el) return false;
    if (el.closest(`${BADGE}, ${ASIDE_COUNT}, ${ASIDE_ZONE}, ${MODAL}`)) return true;
    const roots = `${BADGE}, ${ASIDE_COUNT}, ${MODAL}, ${ASIDE_ZONE}`;
    return [...record.addedNodes].some((added) =>
      added.nodeType === Node.ELEMENT_NODE && (added.matches(roots) || added.querySelector?.(roots)));
  }

  function hasTodoUi() {
    return Boolean($(BADGE) || $(ASIDE_ZONE) || $(MODAL));
  }

  chrome.storage.local.get(["filterEnabled", "courseOverrides", "courseNames"], (saved) => {
    enabled = saved.filterEnabled !== false;
    overrides = saved.courseOverrides || {};
    courseNames = saved.courseNames || {};
    // LMS는 탭을 고를 때 카드의 .on 클래스만 바꾸기도 하므로 class 속성 변화도 본다.
    new MutationObserver((records) => {
      if (records.some(relevant)) scheduleRefresh();
    }).observe(document.body, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    // 할 일 UI가 있으면 첫 apply()에서 목록을 받는다. 필터가 꺼져 있어도 받는다(팝업 과목 목록, 켰을 때 즉시 반영).
    apply();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.courseOverrides) overrides = changes.courseOverrides.newValue || {};
    // 다른 탭이 알아낸 과목 이름을 합친다. 탭마다 덮어쓰다 이름을 잃지 않게 하기 위해서다.
    if (changes.courseNames) courseNames = { ...(changes.courseNames.newValue || {}), ...courseNames };
    if (changes.filterEnabled) enabled = changes.filterEnabled.newValue !== false;
    if (changes.filterEnabled || changes.courseOverrides) scheduleRefresh();
  });
})();
