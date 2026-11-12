// 순수 로직: DOM과 chrome API에 의존하지 않는다. content.js, popup.js, Node 테스트가 함께 쓴다.
(function (root) {
  const SHOW = "show";
  const HIDE = "hide";
  const UNKNOWN = "unknown";

  const normalize = (value) => String(value || "").replace(/ /g, " ").replace(/\s+/g, " ").trim();

  // LMS 과목 키: 정규 과목은 "A2026..."(학기 코드), 비교과·비정규 프로그램은 "N2026...".
  function autoClassification(key) {
    if (/^A\d/.test(key || "")) return SHOW;
    if (/^N\d/.test(key || "")) return HIDE;
    return UNKNOWN;
  }

  function effectiveClassification(key, overrides) {
    const manual = overrides && overrides[key];
    if (manual === SHOW || manual === HIDE) return manual;
    return autoClassification(key);
  }

  // 미분류(알 수 없는 키)와 키가 없는 항목은 숨기지 않는다.
  function shouldHide(key, overrides, enabled) {
    return Boolean(enabled && key && effectiveClassification(key, overrides) === HIDE);
  }

  function parseCount(text) {
    const value = normalize(text);
    return /^\d+$/.test(value) ? Number(value) : null;
  }

  // LMS는 상단 배지에 TODO_CNT > 99 ? 99 : TODO_CNT 를 쓴다. 확장도 같은 규칙으로 표시한다.
  const BADGE_CAP = 99;
  const badgeText = (count) => Math.min(count, BADGE_CAP);
  const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

  // cards: [{ key, type }]
  // expected.total: todo_list_count.acl 의 TODO_CNT (잘리지 않은 전체 수, 모르면 null)
  // expected.badge: 화면 배지에 LMS가 쓴 숫자 (99에서 잘림, 없으면 null)
  function validateCards(cards, expected) {
    const { total = null, badge = null } = expected || {};
    if (!Array.isArray(cards)) return { ok: false, reason: "할 일 목록을 읽지 못했어요." };
    if (cards.some((card) => !card.key)) {
      return { ok: false, reason: "과목을 확인할 수 없는 할 일이 있어 원래 화면을 유지해요." };
    }
    if (isNumber(total)) {
      if (total !== cards.length) {
        return { ok: false, reason: `LMS 전체 수(${total})와 목록 수(${cards.length})가 달라 원래 화면을 유지해요.` };
      }
      // 배지가 전체 수와 어긋나면 그사이 LMS 쪽 목록이 바뀐 것이다 (과제 완료·추가).
      if (isNumber(badge) && badge !== badgeText(total)) {
        return { ok: false, reason: `LMS 숫자(${badge})가 바뀌어 목록을 다시 확인해요.` };
      }
      return { ok: true, reason: "" };
    }
    // 전체 수를 못 받았으면 배지로 확인한다. 99는 "99개 이상"이라는 뜻이다.
    if (isNumber(badge) && badge !== badgeText(cards.length)) {
      return { ok: false, reason: `LMS 숫자(${badge})와 목록 수(${cards.length})가 달라 원래 화면을 유지해요.` };
    }
    return { ok: true, reason: "" };
  }

  function summarize(cards, overrides, enabled) {
    const visible = cards.filter((card) => !shouldHide(card.key, overrides, enabled)).length;
    return { total: cards.length, visible };
  }

  const AUTO_ORDER = { [SHOW]: 0, [UNKNOWN]: 1, [HIDE]: 2 };

  // tabs: [{ key, name }] (할 일 창의 과목 탭), cards: [{ key }]
  // 정렬: 정규 → 미분류 → 비교과, 그 안에서 할 일 많은 순, 이름순.
  function buildCourseList(cards, tabs) {
    const byKey = new Map();
    for (const tab of tabs || []) {
      if (tab.key && !byKey.has(tab.key)) byKey.set(tab.key, { key: tab.key, name: normalize(tab.name), count: 0 });
    }
    for (const card of cards || []) {
      if (!card.key) continue;
      if (!byKey.has(card.key)) byKey.set(card.key, { key: card.key, name: "", count: 0 });
      byKey.get(card.key).count += 1;
    }
    return [...byKey.values()].sort((a, b) =>
      AUTO_ORDER[autoClassification(a.key)] - AUTO_ORDER[autoClassification(b.key)] ||
      b.count - a.count || (a.name || a.key).localeCompare(b.name || b.key, "ko"));
  }

  // "알고리즘(HEB01206-5983)" -> "HEB012065983"
  function extractCourseCode(text) {
    const match = normalize(text).match(/([A-Z]{3}\d{5})-(\d{4})/);
    return match ? match[1] + match[2] : "";
  }

  function stripCourseSuffix(text) {
    return normalize(text)
      .replace(/\([^()]*\)\s*$/, "")
      .replace(/(\.{2,}|…)\s*$/, "")
      .trim();
  }

  function uniqueKey(candidates) {
    const keys = [...new Set(candidates.map((course) => course.key))];
    return keys.length === 1 ? keys[0] : null;
  }

  // 오른쪽 미리보기 카드처럼 과목 키 속성이 없는 항목의 과목 키를 찾는다. 확실하지 않으면 null.
  // item: { attrs: 속성 값을 이어 붙인 문자열, info: "과목명(코드)" 텍스트 }
  function matchCourseKey(item, courses) {
    const list = (courses || []).filter((course) => course.key);
    const attrs = item.attrs || "";
    const byAttr = list.filter((course) => attrs.includes(course.key));
    if (byAttr.length) return uniqueKey(byAttr);

    const code = extractCourseCode(item.info);
    if (code) {
      const byCode = list.filter((course) => course.key.includes(code));
      if (byCode.length) return uniqueKey(byCode);
    }

    const name = stripCourseSuffix(item.info);
    if (name.length < 2) return null;
    const exact = list.filter((course) => normalize(course.name) === name);
    if (exact.length) return uniqueKey(exact);
    return uniqueKey(list.filter((course) => normalize(course.name).startsWith(name)));
  }

  // items: [{ type, visible }] -> { [type]: 보이는 개수 }
  function countVisibleByType(items) {
    const counts = {};
    for (const item of items || []) {
      if (!item.type) continue;
      if (counts[item.type] === undefined) counts[item.type] = 0;
      if (item.visible) counts[item.type] += 1;
    }
    return counts;
  }

  const api = {
    SHOW, HIDE, UNKNOWN, BADGE_CAP,
    normalize, parseCount, badgeText, autoClassification, effectiveClassification, shouldHide,
    validateCards, summarize, buildCourseList, extractCourseCode, stripCourseSuffix,
    matchCourseKey, countVisibleByType
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MjuTodoCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
