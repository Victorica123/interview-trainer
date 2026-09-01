export const FAILURE_REASONS = [
  { id: "unknown", label: "完全不会", shortLabel: "不会" },
  { id: "forgot-keywords", label: "关键词想不起来", shortLabel: "忘关键词" },
  { id: "confused-concepts", label: "和相近概念混淆", shortLabel: "概念混淆" },
  { id: "weak-mechanism", label: "机制和因果讲不清", shortLabel: "机制不清" },
  { id: "no-example", label: "不会结合项目举例", shortLabel: "不会举例" },
  { id: "weak-troubleshooting", label: "不会排查和验证", shortLabel: "不会排查" }
];

export const MAX_ATTEMPT_HISTORY = 12;
export const MAX_HISTORY_ANSWER_CHARS = 600;
export const REVIEW_KINDS = ["independent", "hinted", "revealed", "legacy"];

const QUESTION_ID_PATTERN = /^(be|ai)-\d{3}-[1-5]$/;
const REASON_IDS = new Set(FAILURE_REASONS.map((reason) => reason.id));
const REVIEW_KIND_IDS = new Set(REVIEW_KINDS);

function boundedInteger(value, min, max) {
  return Math.min(max, Math.max(min, Math.round(Number(value) || 0)));
}

function boundedNumber(value, min, max, fallback = min) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function validDate(value) {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime()) ? value : null;
}

export function sanitizeReasonCodes(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((reason) => typeof reason === "string" && REASON_IDS.has(reason)))].slice(0, FAILURE_REASONS.length);
}

function sanitizeHistory(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-MAX_ATTEMPT_HISTORY).flatMap((entry) => {
    if (!entry || Array.isArray(entry) || typeof entry !== "object") return [];
    const at = validDate(entry.at);
    if (!at) return [];
    return [{
      level: boundedInteger(entry.level, 0, 4),
      selfLevel: boundedInteger(entry.selfLevel ?? entry.level, 0, 4),
      reasonCodes: sanitizeReasonCodes(entry.reasonCodes),
      answerPreview: typeof entry.answerPreview === "string" ? entry.answerPreview.slice(0, MAX_HISTORY_ANSWER_CHARS) : "",
      reviewKind: REVIEW_KIND_IDS.has(entry.reviewKind) ? entry.reviewKind : "legacy",
      scheduledDays: boundedNumber(entry.scheduledDays, 0.25, 365, 1),
      stabilityDays: boundedNumber(entry.stabilityDays, 0.25, 365, 1),
      at
    }];
  });
}

export function defaultProgress() {
  return {
    level: 0,
    attempts: 0,
    answer: "",
    note: "",
    favorite: false,
    inMistakeBook: false,
    mistakeCount: 0,
    stabilityDays: 0,
    difficulty: 5,
    lapses: 0,
    lastReviewAt: null,
    lastReviewKind: null,
    reasonCodes: [],
    history: [],
    dueAt: null,
    updatedAt: null
  };
}

export function sanitizeProgressEntry(value) {
  if (!value || Array.isArray(value) || typeof value !== "object") return defaultProgress();
  const level = boundedInteger(value.level, 0, 4);
  const attempts = boundedInteger(value.attempts, 0, 100_000);
  return {
    level,
    attempts,
    answer: typeof value.answer === "string" ? value.answer.slice(0, 20_000) : "",
    note: typeof value.note === "string" ? value.note.slice(0, 10_000) : "",
    favorite: Boolean(value.favorite),
    inMistakeBook: typeof value.inMistakeBook === "boolean" ? value.inMistakeBook : attempts > 0 && level <= 1,
    mistakeCount: boundedInteger(value.mistakeCount, 0, 100_000),
    stabilityDays: boundedNumber(value.stabilityDays, 0, 365, 0),
    difficulty: boundedNumber(value.difficulty, 1, 10, 5),
    lapses: boundedInteger(value.lapses, 0, 100_000),
    lastReviewAt: validDate(value.lastReviewAt),
    lastReviewKind: REVIEW_KIND_IDS.has(value.lastReviewKind) ? value.lastReviewKind : null,
    reasonCodes: sanitizeReasonCodes(value.reasonCodes),
    history: sanitizeHistory(value.history),
    dueAt: validDate(value.dueAt),
    updatedAt: validDate(value.updatedAt)
  };
}

export function sanitizeProgress(input) {
  if (!input || Array.isArray(input) || typeof input !== "object") return {};
  const clean = {};
  for (const [id, value] of Object.entries(input)) {
    if (!QUESTION_ID_PATTERN.test(id) || !value || Array.isArray(value) || typeof value !== "object") continue;
    clean[id] = sanitizeProgressEntry(value);
  }
  return clean;
}

function roundedDays(value) {
  return Math.round(Math.min(365, Math.max(0.25, value)) * 4) / 4;
}

function adaptiveSchedule(current, selfLevel, reviewKind, at) {
  const cap = reviewKind === "revealed" ? 2 : reviewKind === "hinted" ? 3 : 4;
  const level = Math.min(selfLevel, cap);
  const previousStability = current.stabilityDays || [0.25, 1, 2, 5, 14][current.level] || 1;
  const lastReviewMs = current.lastReviewAt ? new Date(current.lastReviewAt).getTime() : NaN;
  const elapsedDays = Number.isFinite(lastReviewMs) ? Math.max(0, (new Date(at).getTime() - lastReviewMs) / 86_400_000) : previousStability;
  const elapsedFactor = Math.min(1.8, Math.max(0.65, elapsedDays / Math.max(0.25, previousStability)));
  const supportFactor = reviewKind === "independent" ? 1 : reviewKind === "hinted" ? 0.78 : 0.52;
  const difficulty = boundedNumber(
    current.difficulty + (2 - level) * 0.55 + (reviewKind === "independent" ? -0.15 : reviewKind === "hinted" ? 0.2 : 0.55),
    1,
    10,
    5
  );
  const ease = Math.min(1.2, Math.max(0.72, 1.18 - (difficulty - 1) * 0.055));
  let stabilityDays;
  if (level === 0) stabilityDays = Math.max(0.25, previousStability * 0.28);
  else if (level === 1) stabilityDays = Math.max(1, previousStability * 0.62);
  else if (level === 2) stabilityDays = Math.max(2, previousStability * 1.35 * elapsedFactor * supportFactor * ease);
  else if (level === 3) stabilityDays = Math.max(5, previousStability * 2.05 * elapsedFactor * supportFactor * ease);
  else stabilityDays = Math.max(14, previousStability * 2.85 * elapsedFactor * ease);
  stabilityDays = roundedDays(stabilityDays);
  return {
    level,
    difficulty: Math.round(difficulty * 100) / 100,
    stabilityDays,
    scheduledDays: stabilityDays,
    lapses: current.lapses + (level <= 1 ? 1 : 0)
  };
}

export function recordProgressRating(currentValue, { level, answer = "", reasonCodes = [], reviewKind = "independent", now = new Date() }) {
  const current = sanitizeProgressEntry(currentValue);
  const selfLevel = boundedInteger(level, 0, 4);
  const safeReviewKind = ["independent", "hinted", "revealed"].includes(reviewKind) ? reviewKind : "independent";
  const at = now instanceof Date && Number.isFinite(now.getTime()) ? now.toISOString() : new Date().toISOString();
  const schedule = adaptiveSchedule(current, selfLevel, safeReviewKind, at);
  const nextLevel = schedule.level;
  let reasons = sanitizeReasonCodes(reasonCodes);
  if (nextLevel === 0 && reasons.length === 0) reasons = ["unknown"];
  if (nextLevel === 1 && reasons.length === 0) reasons = ["forgot-keywords"];
  if (nextLevel >= 3) reasons = [];
  const dueAt = new Date(new Date(at).getTime() + schedule.scheduledDays * 86_400_000).toISOString();
  const answerPreview = String(answer || "").trim().slice(0, MAX_HISTORY_ANSWER_CHARS);
  const history = [...current.history, {
    level: nextLevel,
    selfLevel,
    reasonCodes: reasons,
    answerPreview,
    reviewKind: safeReviewKind,
    scheduledDays: schedule.scheduledDays,
    stabilityDays: schedule.stabilityDays,
    at
  }].slice(-MAX_ATTEMPT_HISTORY);
  return {
    ...current,
    level: nextLevel,
    attempts: Math.min(100_000, current.attempts + 1),
    inMistakeBook: nextLevel <= 1 ? true : current.inMistakeBook,
    mistakeCount: Math.min(100_000, current.mistakeCount + (nextLevel <= 1 ? 1 : 0)),
    stabilityDays: schedule.stabilityDays,
    difficulty: schedule.difficulty,
    lapses: schedule.lapses,
    lastReviewAt: at,
    lastReviewKind: safeReviewKind,
    reasonCodes: nextLevel >= 3 ? [] : reasons,
    history,
    updatedAt: at,
    dueAt
  };
}

export function weaknessScore(question, progressValue, nowMs = Date.now()) {
  const progress = sanitizeProgressEntry(progressValue);
  if (progress.attempts === 0) return 0;
  if (progress.level >= 3) return 0;
  const recent = progress.history.slice(-5);
  const levelScore = [12, 9, 5, 1, 0][progress.level];
  const recentLow = recent.filter((entry) => entry.level <= 1).length;
  const recentLearning = recent.filter((entry) => entry.level === 2).length;
  const mistakeScore = Math.min(6, progress.mistakeCount || 0);
  const dueScore = !progress.dueAt || new Date(progress.dueAt).getTime() <= nowMs ? 2 : 0;
  const reasonScore = Math.min(3, progress.reasonCodes.length);
  const importanceTieBreaker = Math.max(0, Math.min(0.98, Number(question?.importance || 0) / 100));
  return levelScore + recentLow * 2 + recentLearning + mistakeScore + dueScore + reasonScore + importanceTieBreaker;
}

function weakestDimensions(questions, progressMap, keyOf, nowMs) {
  const groups = new Map();
  for (const question of questions) {
    const progress = sanitizeProgressEntry(progressMap[question.id]);
    if (progress.attempts === 0) continue;
    const key = keyOf(question);
    const row = groups.get(key) || { name: key, attempted: 0, weak: 0, score: 0 };
    row.attempted += 1;
    if (progress.level <= 2) row.weak += 1;
    row.score += weaknessScore(question, progress, nowMs);
    groups.set(key, row);
  }
  return [...groups.values()]
    .map((row) => ({ ...row, averageScore: row.attempted ? row.score / row.attempted : 0 }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.averageScore - a.averageScore || b.weak - a.weak || a.name.localeCompare(b.name, "zh-CN"));
}

export function buildWeaknessReport(questions, progressMap, nowMs = Date.now()) {
  const studied = questions.filter((question) => sanitizeProgressEntry(progressMap[question.id]).attempts > 0);
  const weak = studied.filter((question) => sanitizeProgressEntry(progressMap[question.id]).level <= 2);
  const repeated = studied.filter((question) => sanitizeProgressEntry(progressMap[question.id]).mistakeCount >= 2);
  const reasonCounts = new Map();
  for (const question of studied) {
    const progress = sanitizeProgressEntry(progressMap[question.id]);
    const entries = progress.history.length ? progress.history : [{ reasonCodes: progress.reasonCodes }];
    for (const entry of entries) {
      for (const reason of entry.reasonCodes) reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
    }
  }
  const topReasons = [...reasonCounts.entries()]
    .map(([id, count]) => ({ id, count, label: FAILURE_REASONS.find((reason) => reason.id === id)?.label || id }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh-CN"));
  return {
    studied: studied.length,
    weak: weak.length,
    repeated: repeated.length,
    topReasons,
    categories: weakestDimensions(questions, progressMap, (question) => question.category, nowMs),
    angles: weakestDimensions(questions, progressMap, (question) => question.angle, nowMs)
  };
}

export function buildWeakFocusQueue(questions, progressMap, limit = 20, nowMs = Date.now()) {
  const target = Math.max(1, Math.min(100, Math.round(Number(limit) || 20)));
  const ranked = questions
    .map((question) => ({ question, score: weaknessScore(question, progressMap[question.id], nowMs) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.question.importance || 0) - Number(a.question.importance || 0) || a.question.id.localeCompare(b.question.id));
  const selected = [];
  const selectedIds = new Set();
  const categoryCounts = new Map();
  const conceptCounts = new Map();
  for (const item of ranked) {
    if (selected.length >= target) break;
    const categoryCount = categoryCounts.get(item.question.category) || 0;
    const conceptCount = conceptCounts.get(item.question.concept) || 0;
    if (categoryCount >= 4 || conceptCount >= 2) continue;
    selected.push(item.question);
    selectedIds.add(item.question.id);
    categoryCounts.set(item.question.category, categoryCount + 1);
    conceptCounts.set(item.question.concept, conceptCount + 1);
  }
  for (const item of ranked) {
    if (selected.length >= target) break;
    if (!selectedIds.has(item.question.id)) selected.push(item.question);
  }
  return selected;
}
