// 실행: node --test tests/core.test.js
// 실제 LMS 응답은 저장하지 않고, 확인한 구조를 흉내 낸 가짜 데이터만 쓴다.
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../core.js");

const REG_A = "A20263ABC012340001"; // 정규: ABC01234-0001
const REG_B = "A20263XYZ056780002"; // 정규: XYZ05678-0002
const EXT_A = "N2026B10207";       // 비교과
const EXT_B = "N2026B31201";       // 비교과

const tabs = [
  { key: REG_A, name: "자료구조" },
  { key: REG_B, name: "자료구조실습" },
  { key: EXT_A, name: "온라인 특강(Study Skill Up)" },
  { key: EXT_B, name: "My Dream, Myongji Dream 전공선택 유튜브 경진대회" },
  { key: "A20263QQQ000000003", name: "할 일 없는 정규 과목" }
];

function cards(spec) {
  return Object.entries(spec).flatMap(([key, n]) => Array.from({ length: n }, () => ({ key, type: "report1" })));
}

test("자동 분류: A는 표시, N은 숨김, 그 밖은 미분류", () => {
  assert.equal(core.autoClassification(REG_A), "show");
  assert.equal(core.autoClassification(EXT_A), "hide");
  assert.equal(core.autoClassification("Z123"), "unknown");
  assert.equal(core.autoClassification(""), "unknown");
});

test("수동 설정이 자동 분류보다 우선한다", () => {
  assert.equal(core.effectiveClassification(EXT_A, { [EXT_A]: "show" }), "show");
  assert.equal(core.effectiveClassification(REG_A, { [REG_A]: "hide" }), "hide");
  assert.equal(core.effectiveClassification(REG_A, { [REG_A]: "garbage" }), "show");
});

test("필터가 꺼져 있거나 키가 없거나 미분류면 숨기지 않는다", () => {
  assert.equal(core.shouldHide(EXT_A, {}, false), false);
  assert.equal(core.shouldHide("", {}, true), false);
  assert.equal(core.shouldHide("Z999", {}, true), false);
  assert.equal(core.shouldHide(EXT_A, {}, true), true);
});

test("관찰한 화면(전체 50, 정규 6)을 재현하면 6이 보인다", () => {
  const list = cards({ [REG_A]: 2, [REG_B]: 4, [EXT_A]: 30, [EXT_B]: 14 });
  assert.deepEqual(core.validateCards(list, { total: 50, badge: 50 }), { ok: true, reason: "" });
  assert.deepEqual(core.validateCards(list, { badge: 50 }), { ok: true, reason: "" });
  assert.deepEqual(core.summarize(list, {}, true), { total: 50, visible: 6 });
  assert.deepEqual(core.summarize(list, {}, false), { total: 50, visible: 50 });
  assert.deepEqual(core.summarize(list, { [EXT_B]: "show" }, true), { total: 50, visible: 20 });
});

test("검증: 숫자 불일치나 키 없는 카드는 보류한다", () => {
  const list = cards({ [REG_A]: 2, [EXT_A]: 3 });
  assert.equal(core.validateCards(list, { badge: 6 }).ok, false);
  assert.match(core.validateCards(list, { badge: 6 }).reason, /6.*5/);
  assert.equal(core.validateCards(list, { total: 6, badge: 5 }).ok, false);
  assert.equal(core.validateCards([...list, { key: "", type: "x" }], { total: 6 }).ok, false);
  assert.equal(core.validateCards(list, {}).ok, true);
  assert.equal(core.validateCards(list, undefined).ok, true);
  assert.equal(core.validateCards([], { total: 0, badge: 0 }).ok, true);
  assert.equal(core.validateCards(null, { total: 0 }).ok, false);
});

test("99개 초과: LMS 배지는 99에서 잘리지만 전체 수(TODO_CNT)로 정확히 확인한다", () => {
  const list = cards({ [REG_A]: 5, [EXT_A]: 141 }); // 146개
  assert.equal(core.validateCards(list, { total: 146, badge: 99 }).ok, true);
  assert.equal(core.validateCards(list, { total: 146, badge: null }).ok, true);
  // 전체 수와 목록이 다르면 99를 넘어도 보류
  assert.equal(core.validateCards(list, { total: 147, badge: 99 }).ok, false);
  // 배지가 전체 수와 어긋나면(그사이 목록이 바뀜) 보류 → 다시 받기
  assert.equal(core.validateCards(list, { total: 146, badge: 98 }).ok, false);
  assert.equal(core.validateCards(cards({ [REG_A]: 50 }), { total: 50, badge: 49 }).ok, false);
});

test("99개 초과: 전체 수를 못 받으면 배지 99 = '99개 이상'으로 본다", () => {
  assert.equal(core.validateCards(cards({ [EXT_A]: 146 }), { badge: 99 }).ok, true);
  assert.equal(core.validateCards(cards({ [EXT_A]: 99 }), { badge: 99 }).ok, true);
  assert.equal(core.validateCards(cards({ [EXT_A]: 98 }), { badge: 99 }).ok, false);
  assert.equal(core.validateCards(cards({ [EXT_A]: 146 }), { badge: 98 }).ok, false);
});

test("배지 표시 숫자는 LMS처럼 99로 제한한다", () => {
  assert.equal(core.badgeText(6), 6);
  assert.equal(core.badgeText(99), 99);
  assert.equal(core.badgeText(120), 99);
});

test("과목 목록: 탭 이름을 쓰고, 정규→미분류→비교과 순, 그 안에서 할 일 많은 순, 탭에 없는 키도 넣는다", () => {
  const list = core.buildCourseList(cards({ [EXT_A]: 3, [REG_A]: 1, N2026ZZZ: 2, Z1: 1 }), tabs);
  assert.deepEqual(list.map((c) => [c.key, c.count]), [
    [REG_A, 1], [REG_B, 0], ["A20263QQQ000000003", 0],
    ["Z1", 1],
    [EXT_A, 3], ["N2026ZZZ", 2], [EXT_B, 0]
  ]);
  assert.equal(list.find((c) => c.key === REG_A).name, "자료구조");
  assert.equal(list.find((c) => c.key === "Z1").name, "");
});

test("과목 코드 추출", () => {
  assert.equal(core.extractCourseCode("자료구조(ABC01234-0001)"), "ABC012340001");
  assert.equal(core.extractCourseCode("온라인 특강(Study Skill Up)(102-07)"), "");
});

test("미리보기 카드 매칭: 속성 > 코드 > 이름, 이름이 비슷한 과목을 섞지 않는다", () => {
  const courses = core.buildCourseList([], tabs);
  assert.equal(core.matchCourseKey({ attrs: `x ${EXT_B} y`, info: "아무거나" }, courses), EXT_B);
  assert.equal(core.matchCourseKey({ attrs: "", info: "자료구조(ABC01234-0001)" }, courses), REG_A);
  assert.equal(core.matchCourseKey({ attrs: "", info: "자료구조실습(XYZ05678-0002)" }, courses), REG_B);
  assert.equal(core.matchCourseKey({ attrs: "", info: "자료구조" }, courses), REG_A);
  assert.equal(core.matchCourseKey({ attrs: "", info: "My Dream, Myongji Dream 전공선택 유튜브 경...(-01)" }, courses), EXT_B);
  assert.equal(core.matchCourseKey({ attrs: "", info: "온라인 특강(Study Skill Up)(102-07)" }, courses), EXT_A);
  // "자료" 로 시작하는 과목이 둘이면 확신할 수 없으므로 null (숨기지 않음)
  assert.equal(core.matchCourseKey({ attrs: "", info: "자료...(1)" }, courses), null);
  assert.equal(core.matchCourseKey({ attrs: "", info: "없는 과목(000-00)" }, courses), null);
});

test("유형별 숫자는 보이는 카드만 센다", () => {
  const counts = core.countVisibleByType([
    { type: "lecture_weeks", visible: true },
    { type: "lecture_weeks", visible: false },
    { type: "survey", visible: false },
    { type: "report1", visible: true },
    { type: "", visible: true }
  ]);
  assert.deepEqual(counts, { lecture_weeks: 1, survey: 0, report1: 1 });
});

test("parseCount", () => {
  assert.equal(core.parseCount(" 50 "), 50);
  assert.equal(core.parseCount(""), null);
  assert.equal(core.parseCount("50+"), null);
});
