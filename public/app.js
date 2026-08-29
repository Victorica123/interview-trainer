const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const STORAGE_KEY = "interviewTrainerProgressV1";
const APPEARANCE_KEY = "interviewTrainerAppearanceV1";
const LOGIN_BROWSER_KEY = "interviewTrainerLoginBrowserV1";
const CUSTOM_SESSIONS_KEY = "interviewTrainerSessionsV1";
const MAX_SESSION_QUESTIONS = 5000;
const QUESTION_ID_PATTERN = /^(be|ai)-\d{3}-[1-5]$/;
const DEFAULT_ANGLE_LABELS = { definition: "概念定义", mechanism: "原理机制", application: "项目应用", pitfall: "故障排查", comparison: "对比选型" };
const SOURCE_TYPE_LABELS = { interview: "真实面经", job: "岗位要求", guide: "维护资料", official: "官方资料", research: "研究依据" };
const TREND_SIGNAL_LABELS = { rising: "近期上升", hot: "近期高频", emerging: "新出现", stable: "持续出现", "sample-low": "样本较少" };
const CONFIDENCE_LABELS = { high: "高", medium: "中", low: "低" };
const CANDIDATE_LEVEL_LABELS = { intern: "实习", campus: "校招", experienced: "社招", unknown: "候选人类型未明确" };
const VIEW_COPY = {
  library: ["QUESTION BANK · 2026", "先回答，再看答案", "题目按近期真实面经、岗位匹配与基础必要性分层，不用从第一页硬背到最后一页。"],
  path: ["BEGINNER ROADMAP", "先完成一条精选主线", "按先修关系分阶段学习；每个阶段只挑最值得新手先掌握的题。"],
  custom: ["CUSTOM STUDY SET", "按自己的目标组合题目", "每个专题可以分别选择知识点、题型、层级、题量和抽题策略。"],
  daily: ["SPACED RECALL", "今天只练应该出现的题", "到期复习优先，系统再补少量核心新题。"],
  mistakes: ["PERSONAL REVIEW", "不会的、想留的，都放在这里", "错题自动收录，收藏与个人笔记随进度一起导入导出。"],
  progress: ["LEARNING EVIDENCE", "把熟悉感变成回答能力", "熟悉度至少达到 3，才算能够完整回答基础问题。"],
  research: ["SOURCE AUDIT", "每一道高频都有依据", "查看题库使用了哪些近期面经、岗位信息和维护中资料。"],
  insights: ["AUDITABLE INTERVIEW SIGNALS", "专项题单与样本趋势", "按公司和岗位练习，并查看统计覆盖、时间范围、排除样本和置信度。"],
  update: ["QUESTION BANK UPDATER", "让题库跟上最新面经", "复查已登记来源，或分析你粘贴的新链接与正文；你审阅草案后才会写入题库。"]
};

const LEARNING_PATHS = {
  backend: [
    { id: "be-foundation", title: "计算机与网络起步", categories: ["计算机网络", "操作系统与Linux"], limit: 15, prerequisite: "不要求编程基础", description: "先建立网络、操作系统和常见数据结构的基本直觉，后面的框架与分布式问题才有落点。" },
    { id: "be-java", title: "Java 语言与集合", categories: ["Java基础", "Java集合"], limit: 20, prerequisite: "能看懂简单 Java 代码", description: "掌握对象、集合、异常、泛型与反射，练习用准确的语言解释 Java 的日常机制。" },
    { id: "be-runtime", title: "并发与 JVM", categories: ["Java并发", "JVM"], limit: 20, prerequisite: "Java 语言与集合", description: "理解线程安全、锁、线程池、内存模型和 JVM 运行过程，先会判断问题，再记具体参数。" },
    { id: "be-spring", title: "Spring 工程基础", categories: ["Spring生态"], limit: 15, prerequisite: "Java 语言与反射基础", description: "从 IoC、AOP、事务到 Web 请求链路，把框架术语还原成工程中的真实行为。" },
    { id: "be-mysql", title: "MySQL 与事务", categories: ["MySQL"], limit: 20, prerequisite: "会写基础 SQL", description: "围绕索引、事务、锁和查询优化建立主线，这是后端面试最稳定的高频模块之一。" },
    { id: "be-middleware", title: "Redis 与消息队列", categories: ["Redis", "消息队列"], limit: 20, prerequisite: "MySQL 与基本并发概念", description: "学习缓存和异步化解决什么问题，以及它们带来的一致性、可靠性和热点风险。" },
    { id: "be-distributed", title: "分布式系统", categories: ["分布式与微服务"], limit: 15, prerequisite: "数据库、缓存与消息队列", description: "从一致性、幂等、限流和分布式锁入门，形成跨服务思考问题的方式。" },
    { id: "be-design", title: "系统设计与项目表达", categories: ["系统设计与场景"], limit: 15, prerequisite: "完成前面至少五个阶段", description: "把零散知识组合成方案，练习容量、瓶颈、故障与取舍，并能讲清自己的项目。" }
  ],
  agent: [
    { id: "ai-model", title: "模型 API 与 Prompt", categories: ["模型与API", "Prompt与上下文"], limit: 18, prerequisite: "会使用一种编程语言发 HTTP 请求", description: "先理解 Token、上下文、采样和结构化输出，再学习如何把任务说明白、把结果约束住。" },
    { id: "ai-rag", title: "RAG 与知识库", categories: ["RAG与知识库"], limit: 18, prerequisite: "模型 API 与 Prompt", description: "从切分、向量化、召回到重排与引用，建立可检索、可解释的知识问答主线。" },
    { id: "ai-agent", title: "Agent 基本架构", categories: ["Agent架构"], limit: 15, prerequisite: "模型调用与 RAG 基础", description: "理解规划、执行、状态与停止条件，区分工作流和真正需要自主决策的 Agent。" },
    { id: "ai-tools", title: "工具调用与 MCP", categories: ["工具与MCP"], limit: 15, prerequisite: "Agent 基本循环", description: "学习函数调用、参数校验、权限边界和 MCP，让模型安全地读取信息并执行动作。" },
    { id: "ai-memory", title: "记忆与多 Agent", categories: ["记忆与多Agent"], limit: 10, prerequisite: "Agent 状态与工具调用", description: "区分短期状态、长期记忆和多角色协作，避免为了架构感而盲目增加 Agent。" },
    { id: "ai-eval", title: "评测与可靠性", categories: ["评测与可靠性"], limit: 15, prerequisite: "至少完成一个 RAG 或 Agent 小项目", description: "用数据集、指标、追踪和安全措施回答‘它到底好不好、为什么失败、能否上线’。" },
    { id: "ai-project", title: "项目与场景表达", categories: ["项目与场景"], limit: 10, prerequisite: "完成前面至少四个阶段", description: "把需求、架构、评测、成本与迭代串起来，形成能经得住追问的完整项目故事。" }
  ]
};

const ANGLE_ORDER = ["definition", "mechanism", "application", "pitfall", "comparison"];

const state = {
  questions: [],
  taxonomy: { angles: [], tracks: { backend: [], agent: [] } },
  sources: [],
  sourceMap: new Map(),
  insights: null,
  progress: loadProgress(),
  customSessions: loadCustomSessions(),
  customDraft: null,
  editingCustomSessionId: null,
  activeTraining: null,
  catalogFilters: { category: "all", topicGroup: "all", concept: "all", angle: "all", company: "all" },
  currentTrack: "all",
  currentView: "library",
  insightTrack: "backend",
  insightCompany: "all",
  currentPathTrack: "backend",
  selectedPathStageId: null,
  currentMistakeFilter: "mistakes",
  selectedId: null,
  visibleCount: 60,
  aiMode: "chat",
  aiMessages: [],
  aiConfig: null,
  appearance: loadAppearance(),
  loginBrowserPreference: loadLoginBrowserPreference(),
  loginBrowsers: [],
  loginBrowserStatus: null,
  updateDraft: null,
  updateRunning: false,
  lastUpdateInfo: null,
  updateTotal: 0,
  updateDone: 0,
  updateSucceeded: 0,
  updateFinalizing: false,
  updateAbort: null,
  sourceCandidates: [],
  selectedCandidateIds: new Set()
};

applyAppearance(state.appearance);

init().catch((error) => {
  console.error(error);
  showToast(`初始化失败：${error.message}`);
});

async function init() {
  bindEvents();
  const [questionPayload, sourcePayload, insights, config] = await Promise.all([
    fetchJson("/api/questions"),
    fetchJson("/api/sources"),
    fetchJson("/api/insights"),
    fetchJson("/api/config")
  ]);
  state.questions = questionPayload.questions || [];
  state.taxonomy = questionPayload.taxonomy || state.taxonomy;
  state.sources = sourcePayload.sources || [];
  state.sourceMap = new Map(state.sources.map((source) => [source.id, source]));
  state.insights = insights;
  updateConfigUI(config);
  updateInitStatus();
  renderAll();
  if (state.currentView === "library" && location.hash.startsWith("#q=")) selectQuestion(location.hash.slice(3));
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `请求失败：${response.status}`);
  return payload;
}

function loadAppearance() {
  try {
    const parsed = JSON.parse(localStorage.getItem(APPEARANCE_KEY) || "{}");
    return {
      theme: ["forest", "ocean", "violet", "amber", "night"].includes(parsed.theme) ? parsed.theme : "forest",
      readingSize: ["compact", "comfortable", "large"].includes(parsed.readingSize) ? parsed.readingSize : "comfortable"
    };
  } catch {
    return { theme: "forest", readingSize: "comfortable" };
  }
}

function loadLoginBrowserPreference() {
  try {
    const value = JSON.parse(localStorage.getItem(LOGIN_BROWSER_KEY) || '"auto"');
    return typeof value === "string" && /^[a-z0-9-]+$/.test(value) ? value : "auto";
  } catch {
    return "auto";
  }
}

function applyAppearance(appearance) {
  document.documentElement.dataset.theme = appearance.theme;
  document.documentElement.dataset.readingSize = appearance.readingSize;
}

function saveBrowserState(key, value, label) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error(`[storage] ${label}保存失败`, error);
    showToast(`${label}未能写入浏览器，请先导出备份并检查浏览器存储权限`);
    return false;
  }
}

function saveAppearance() {
  saveBrowserState(APPEARANCE_KEY, state.appearance, "外观设置");
  applyAppearance(state.appearance);
  renderAppearanceChoices();
}

function loadProgress() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return sanitizeProgress(parsed);
  } catch {
    return {};
  }
}

function sanitizeCustomConfig(input) {
  const track = input?.track === "agent" ? "agent" : "backend";
  const status = ["all", "unseen", "weak", "learning", "mastered"].includes(input?.status) ? input.status : "all";
  const modules = {};
  if (input?.modules && !Array.isArray(input.modules) && typeof input.modules === "object") {
    for (const [category, value] of Object.entries(input.modules).slice(0, 40)) {
      if (!category || !value || Array.isArray(value) || typeof value !== "object") continue;
      modules[String(category).slice(0, 80)] = {
        enabled: Boolean(value.enabled),
        concepts: Array.isArray(value.concepts) ? [...new Set(value.concepts.map(String).filter(Boolean))].slice(0, 300) : [],
        angles: Array.isArray(value.angles) ? [...new Set(value.angles.map(String).filter((angle) => DEFAULT_ANGLE_LABELS[angle]))] : Object.keys(DEFAULT_ANGLE_LABELS),
        tier: ["all", "core", "high", "extended"].includes(value.tier) ? value.tier : "all",
        limit: Math.min(MAX_SESSION_QUESTIONS, Math.max(1, Math.round(Number(value.limit) || 15))),
        strategy: ["balanced", "importance", "weak", "random"].includes(value.strategy) ? value.strategy : "balanced",
        includeIds: Array.isArray(value.includeIds) ? [...new Set(value.includeIds.filter((id) => QUESTION_ID_PATTERN.test(id)))].slice(0, MAX_SESSION_QUESTIONS) : [],
        excludeIds: Array.isArray(value.excludeIds) ? [...new Set(value.excludeIds.filter((id) => QUESTION_ID_PATTERN.test(id)))].slice(0, MAX_SESSION_QUESTIONS) : []
      };
    }
  }
  return { track, status, modules };
}

function sanitizeCustomSessions(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 30).map((session, index) => ({
      id: typeof session?.id === "string" && /^custom-[a-z0-9-]{4,80}$/.test(session.id) ? session.id : `custom-imported-${index}`,
      name: String(session?.name || `自定义题单 ${index + 1}`).slice(0, 60),
      createdAt: typeof session?.createdAt === "string" ? session.createdAt : new Date().toISOString(),
      updatedAt: typeof session?.updatedAt === "string" ? session.updatedAt : new Date().toISOString(),
      config: sanitizeCustomConfig(session?.config),
      questionIds: Array.isArray(session?.questionIds) ? [...new Set(session.questionIds.filter((id) => QUESTION_ID_PATTERN.test(id)))].slice(0, MAX_SESSION_QUESTIONS) : []
    }));
}

function loadCustomSessions() {
  try {
    return sanitizeCustomSessions(JSON.parse(localStorage.getItem(CUSTOM_SESSIONS_KEY) || "[]"));
  } catch {
    return [];
  }
}

function saveCustomSessions() {
  return saveBrowserState(CUSTOM_SESSIONS_KEY, state.customSessions, "自定义题单");
}

function sanitizeProgress(input) {
  if (!input || Array.isArray(input) || typeof input !== "object") return {};
  const clean = {};
  for (const [id, value] of Object.entries(input)) {
    if (!/^(be|ai)-\d{3}-[1-5]$/.test(id) || !value || Array.isArray(value) || typeof value !== "object") continue;
    const level = Math.min(4, Math.max(0, Math.round(Number(value.level) || 0)));
    const attempts = Math.min(100_000, Math.max(0, Math.round(Number(value.attempts) || 0)));
    const validDate = (date) => typeof date === "string" && Number.isFinite(new Date(date).getTime()) ? date : null;
    clean[id] = {
      level,
      attempts,
      answer: typeof value.answer === "string" ? value.answer.slice(0, 20_000) : "",
      note: typeof value.note === "string" ? value.note.slice(0, 10_000) : "",
      favorite: Boolean(value.favorite),
      inMistakeBook: typeof value.inMistakeBook === "boolean" ? value.inMistakeBook : attempts > 0 && level <= 1,
      mistakeCount: Math.min(100_000, Math.max(0, Math.round(Number(value.mistakeCount) || 0))),
      dueAt: validDate(value.dueAt),
      updatedAt: validDate(value.updatedAt)
    };
  }
  return clean;
}

function saveProgress() {
  return saveBrowserState(STORAGE_KEY, state.progress, "学习进度");
}

function bindEvents() {
  $$(".nav-item").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  $$(".track-card").forEach((button) => button.addEventListener("click", () => {
    state.currentTrack = button.dataset.track;
    clearCatalogFilterState();
    state.visibleCount = 60;
    $$(".track-card").forEach((item) => item.classList.toggle("active", item === button));
    switchView("library");
    renderLibrary();
  }));

  ["searchInput", "tierFilter", "statusFilter", "sortSelect"].forEach((id) => {
    $(`#${id}`).addEventListener(id === "searchInput" ? "input" : "change", () => {
      state.visibleCount = 60;
      renderLibrary();
    });
  });
  for (const [id, key] of [["topicGroupFilter", "topicGroup"], ["conceptFilter", "concept"], ["angleFilter", "angle"], ["companyFilter", "company"]]) {
    $(`#${id}`).addEventListener("change", (event) => {
      state.catalogFilters[key] = event.target.value;
      if (key === "topicGroup") state.catalogFilters.concept = "all";
      state.visibleCount = 60;
      renderLibrary();
    });
  }
  $("#categoryDirectory").addEventListener("click", (event) => {
    const button = event.target.closest("[data-catalog-category]");
    if (!button) return;
    state.catalogFilters.category = button.dataset.catalogCategory;
    state.catalogFilters.topicGroup = "all";
    state.catalogFilters.concept = "all";
    state.catalogFilters.company = "all";
    state.visibleCount = 60;
    renderLibrary();
  });
  $("#clearCatalogFilters").addEventListener("click", () => {
    clearCatalogFilterState();
    state.visibleCount = 60;
    renderLibrary();
  });
  $("#activeTrainingBanner").addEventListener("click", handleActiveTrainingAction);

  $("#loadMoreButton").addEventListener("click", () => {
    state.visibleCount += 60;
    renderQuestionList();
  });
  $("#randomButton").addEventListener("click", randomQuestion);
  $("#dailyButton").addEventListener("click", () => switchView("daily"));
  $("#settingsButton").addEventListener("click", openSettings);
  $$('[data-open-appearance]').forEach((button) => button.addEventListener("click", openAppearance));
  $("#closeSettingsButton").addEventListener("click", () => $("#settingsDialog").close());
  $("#settingsForm").addEventListener("submit", saveSettings);
  $("#fetchModelsButton").addEventListener("click", fetchModels);
  $("#settingsForm").elements.apiKey.addEventListener("input", renderKeyStorageHint);
  $("#settingsForm").elements.rememberKey.addEventListener("change", renderKeyStorageHint);
  $("#exportButton").addEventListener("click", exportProgress);
  $("#importInput").addEventListener("change", importProgress);
  $("#closeAppearanceButton").addEventListener("click", () => $("#appearanceDialog").close());
  $("#finishAppearanceButton").addEventListener("click", () => $("#appearanceDialog").close());
  $("#resetAppearanceButton").addEventListener("click", () => {
    state.appearance = { theme: "forest", readingSize: "comfortable" };
    saveAppearance();
  });
  $$('[data-theme-choice]').forEach((button) => button.addEventListener("click", () => {
    state.appearance.theme = button.dataset.themeChoice;
    saveAppearance();
  }));
  $$('[data-reading-size]').forEach((button) => button.addEventListener("click", () => {
    state.appearance.readingSize = button.dataset.readingSize;
    saveAppearance();
  }));
  $$('[data-path-track]').forEach((button) => button.addEventListener("click", () => {
    state.currentPathTrack = button.dataset.pathTrack;
    state.selectedPathStageId = null;
    renderPath();
  }));
  $$('[data-custom-track]').forEach((button) => button.addEventListener("click", () => {
    state.customDraft = createCustomDraft(button.dataset.customTrack);
    state.editingCustomSessionId = null;
    renderCustom();
  }));
  $("#customSessionName").addEventListener("input", (event) => {
    if (state.customDraft) state.customDraft.name = event.target.value.slice(0, 60);
  });
  $("#customStatusFilter").addEventListener("change", (event) => {
    if (state.customDraft) state.customDraft.status = event.target.value;
    renderCustomModules();
    renderCustomPreview();
  });
  $("#customModuleList").addEventListener("change", handleCustomModuleChange);
  $("#customModuleList").addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-custom-toggle-question]");
    if (toggle) {
      const card = toggle.closest("[data-custom-category-card]");
      if (card) toggleCustomQuestionInclusion(card.dataset.customCategoryCard, toggle.dataset.customToggleQuestion);
      return;
    }
    const button = event.target.closest("[data-custom-preview-question]");
    if (button) selectQuestion(button.dataset.customPreviewQuestion);
  });
  $("#saveCustomSession").addEventListener("click", saveCurrentCustomSession);
  $("#startCustomSession").addEventListener("click", startCurrentCustomSession);
  $("#savedSessionList").addEventListener("click", handleSavedSessionAction);
  $$('[data-mistake-filter]').forEach((button) => button.addEventListener("click", () => {
    state.currentMistakeFilter = button.dataset.mistakeFilter;
    renderMistakes();
  }));
  $("#insightTrackSelect").addEventListener("change", (event) => {
    state.insightTrack = event.target.value;
    state.insightCompany = "all";
    renderInsights();
  });
  $("#insightCompanySelect").addEventListener("change", (event) => {
    state.insightCompany = event.target.value;
    renderInsights();
  });
  $("#insightStartButton").addEventListener("click", () => {
    const questionId = selectedInsightTrends()[0]?.questionId;
    if (questionId) selectQuestion(questionId);
  });

  $("#aiToggle").addEventListener("click", () => $("#aiPanel").classList.add("open"));
  $("#closeAiButton").addEventListener("click", () => $("#aiPanel").classList.remove("open"));
  $$("[data-ai-mode]").forEach((button) => button.addEventListener("click", () => useQuickAction(button.dataset.aiMode)));
  $("#chatForm").addEventListener("submit", submitChat);

  $("#updateRunButton").addEventListener("click", runUpdate);
  $("#sourceCandidateAddButton").addEventListener("click", addSourceCandidates);
  $("#sourceDiscoveryButton").addEventListener("click", discoverSourceCandidates);
  $("#sourceCandidateDeleteButton").addEventListener("click", deleteSourceCandidates);
  $("#sourceCandidateList").addEventListener("change", (event) => {
    if (!event.target.classList.contains("source-candidate-check")) return;
    if (event.target.checked) state.selectedCandidateIds.add(event.target.value);
    else state.selectedCandidateIds.delete(event.target.value);
    renderSourceCandidates();
  });
  $("#updateFinalizeButton").addEventListener("click", finalizePartialUpdate);
  $("#updateApplyButton").addEventListener("click", applyUpdate);
  $("#updateDiscardButton").addEventListener("click", discardUpdate);
  $("#updateOpenSettings").addEventListener("click", openSettings);
  $("#updateCancelButton").addEventListener("click", cancelUpdate);
  $("#siteCookieSaveButton").addEventListener("click", saveSiteCookies);
  $("#siteCookieClearButton").addEventListener("click", clearSiteCookies);
  $("#loginNowcoderButton").addEventListener("click", () => loginLaunch("nowcoder"));
  $("#collectNowcoderButton").addEventListener("click", () => loginCollect("nowcoder"));
  $("#loginXhsButton").addEventListener("click", () => loginLaunch("xiaohongshu"));
  $("#collectXhsButton").addEventListener("click", () => loginCollect("xiaohongshu"));
  $("#loginCloseButton").addEventListener("click", loginClose);
  $("#loginBrowserSelect").addEventListener("change", (event) => {
    state.loginBrowserPreference = event.target.value;
    saveBrowserState(LOGIN_BROWSER_KEY, state.loginBrowserPreference, "登录浏览器偏好");
    renderLoginBrowserCapability();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
      event.preventDefault();
      $("#searchInput").focus();
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && document.activeElement === $("#chatInput")) {
      $("#chatForm").requestSubmit();
    }
  });
}

function renderAll() {
  const backendCount = state.questions.filter((question) => question.track === "backend").length;
  const agentCount = state.questions.filter((question) => question.track === "agent").length;
  $("#navQuestionCount").textContent = state.questions.length;
  $("#navCustomCount").textContent = state.customSessions.length;
  $("#allCount").textContent = state.questions.length;
  $("#backendCount").textContent = backendCount;
  $("#agentCount").textContent = agentCount;
  renderLibrary();
  renderDaily();
  renderPath();
  renderCustom();
  renderMistakes();
  renderProgress();
  renderInsights();
  renderSources();
}

function switchView(view) {
  state.currentView = view;
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  $$(".view-section").forEach((section) => section.classList.toggle("active", section.id === `${view}View`));
  const [eyebrow, title, description] = VIEW_COPY[view];
  $("#viewEyebrow").textContent = eyebrow;
  $("#viewTitle").textContent = title;
  $("#viewDescription").textContent = description;
  $("#randomButton").style.display = view === "library" ? "inline-block" : "none";
  $("#dailyButton").style.display = view === "library" ? "inline-block" : "none";
  if (view === "daily") renderDaily();
  if (view === "path") renderPath();
  if (view === "custom") renderCustom();
  if (view === "mistakes") renderMistakes();
  if (view === "progress") renderProgress();
  if (view === "insights") renderInsights();
  if (view === "update") updateInitStatus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function getProgress(questionId) {
  return state.progress[questionId] || { level: 0, attempts: 0, dueAt: null, answer: "", note: "", favorite: false, inMistakeBook: false, mistakeCount: 0 };
}

function isDue(progress) {
  return progress.attempts > 0 && (!progress.dueAt || new Date(progress.dueAt).getTime() <= Date.now());
}

function angleLabel(angle) {
  return state.taxonomy.angles?.find((item) => item.id === angle)?.name || DEFAULT_ANGLE_LABELS[angle] || angle;
}

function clearCatalogFilterState() {
  state.catalogFilters = { category: "all", topicGroup: "all", concept: "all", angle: "all", company: "all" };
}

function questionCompanies(question) {
  return (state.insights?.companies || [])
    .filter((company) => (company.tracks || []).includes(question.track) && (company.concepts || []).includes(question.concept))
    .map((company) => company.name);
}

function progressMatchesStatus(question, status) {
  const progress = getProgress(question.id);
  if (status === "unseen") return progress.attempts === 0;
  if (status === "weak") return progress.attempts > 0 && progress.level <= 1;
  if (status === "learning") return progress.level === 2;
  if (status === "mastered") return progress.level >= 3;
  return true;
}

function setFacetOptions(id, options, selected, allLabel) {
  const select = $(`#${id}`);
  select.innerHTML = `<option value="all">${escapeHtml(allLabel)}</option>${options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join("")}`;
  select.value = options.some((option) => option.value === selected) ? selected : "all";
  return select.value;
}

function catalogQuestions() {
  return state.questions.filter((question) => state.currentTrack === "all" || question.track === state.currentTrack);
}

function renderCatalogDirectory() {
  const base = catalogQuestions();
  const definitions = state.currentTrack === "all"
    ? [
        ...(state.taxonomy.tracks?.backend || []).map((category) => ({ ...category, track: "backend" })),
        ...(state.taxonomy.tracks?.agent || []).map((category) => ({ ...category, track: "agent" }))
      ]
    : (state.taxonomy.tracks?.[state.currentTrack] || []).map((category) => ({ ...category, track: state.currentTrack }));
  const availableCategories = new Set(definitions.map((category) => category.name));
  if (state.catalogFilters.category !== "all" && !availableCategories.has(state.catalogFilters.category)) clearCatalogFilterState();

  $("#categoryDirectory").innerHTML = `<button class="category-directory-card ${state.catalogFilters.category === "all" ? "active" : ""}" data-catalog-category="all"><b>全部专题</b><small>${base.length} 题</small></button>${definitions.map((category) => `<button class="category-directory-card ${state.catalogFilters.category === category.name ? "active" : ""}" data-catalog-category="${escapeHtml(category.name)}"><b>${escapeHtml(category.name)}</b><small>${category.track === "backend" ? "Java 后端" : "AI / Agent"} · ${category.questionCount} 题</small></button>`).join("")}`;

  const categoryBase = base.filter((question) => state.catalogFilters.category === "all" || question.category === state.catalogFilters.category);
  const groups = [...new Set(categoryBase.map((question) => question.topicGroup))].map((name) => ({
    value: name,
    label: `${name}（${categoryBase.filter((question) => question.topicGroup === name).length}）`
  }));
  state.catalogFilters.topicGroup = setFacetOptions("topicGroupFilter", groups, state.catalogFilters.topicGroup, "全部知识组");

  const groupBase = categoryBase.filter((question) => state.catalogFilters.topicGroup === "all" || question.topicGroup === state.catalogFilters.topicGroup);
  const concepts = [...new Set(groupBase.map((question) => question.concept))].map((name) => ({
    value: name,
    label: `${name}（${groupBase.filter((question) => question.concept === name).length}）`
  }));
  state.catalogFilters.concept = setFacetOptions("conceptFilter", concepts, state.catalogFilters.concept, "全部知识点");

  const conceptBase = groupBase.filter((question) => state.catalogFilters.concept === "all" || question.concept === state.catalogFilters.concept);
  const angles = (state.taxonomy.angles || Object.entries(DEFAULT_ANGLE_LABELS).map(([id, name]) => ({ id, name }))).map((angle) => ({
    value: angle.id,
    label: `${angle.name}（${conceptBase.filter((question) => question.angle === angle.id).length}）`
  }));
  state.catalogFilters.angle = setFacetOptions("angleFilter", angles, state.catalogFilters.angle, "全部题型");

  const companies = [...new Set(conceptBase.flatMap(questionCompanies))].sort((a, b) => a.localeCompare(b, "zh-CN")).map((name) => ({
    value: name,
    label: `${name}（${conceptBase.filter((question) => questionCompanies(question).includes(name)).length}）`
  }));
  state.catalogFilters.company = setFacetOptions("companyFilter", companies, state.catalogFilters.company, "全部可审计公司");

  const labels = [];
  if (state.catalogFilters.category !== "all") labels.push(`专题：${state.catalogFilters.category}`);
  if (state.catalogFilters.topicGroup !== "all") labels.push(`知识组：${state.catalogFilters.topicGroup}`);
  if (state.catalogFilters.concept !== "all") labels.push(`知识点：${state.catalogFilters.concept}`);
  if (state.catalogFilters.angle !== "all") labels.push(`题型：${angleLabel(state.catalogFilters.angle)}`);
  if (state.catalogFilters.company !== "all") labels.push(`公司面经关联：${state.catalogFilters.company}`);
  $("#activeCatalogFilters").innerHTML = labels.length ? labels.map((label) => `<span>${escapeHtml(label)}</span>`).join("") : "<small>当前未限定分类，可从上方专题开始浏览。</small>";
  $("#clearCatalogFilters").disabled = labels.length === 0;
}

function renderActiveTrainingBanner() {
  const banner = $("#activeTrainingBanner");
  if (!state.activeTraining?.questionIds?.length) {
    banner.hidden = true;
    banner.innerHTML = "";
    return;
  }
  const index = Math.max(0, state.activeTraining.questionIds.indexOf(state.selectedId));
  banner.hidden = false;
  banner.innerHTML = `<div><span>正在训练</span><strong>${escapeHtml(state.activeTraining.name)}</strong><small>${index + 1} / ${state.activeTraining.questionIds.length} · 题单内进度仍写入原题目</small></div><div><button data-training-action="next" class="primary-button">下一题</button><button data-training-action="exit" class="secondary-button">退出题单</button></div>`;
}

function handleActiveTrainingAction(event) {
  const action = event.target.closest("[data-training-action]")?.dataset.trainingAction;
  if (!action || !state.activeTraining) return;
  if (action === "exit") {
    state.activeTraining = null;
    renderLibrary();
    return;
  }
  const index = Math.max(0, state.activeTraining.questionIds.indexOf(state.selectedId));
  const nextId = state.activeTraining.questionIds[(index + 1) % state.activeTraining.questionIds.length];
  if (nextId) selectQuestion(nextId);
}

function renderLibrary() {
  const progressValues = state.questions.map((question) => getProgress(question.id));
  const due = progressValues.filter(isDue).length;
  const seen = progressValues.filter((item) => item.attempts > 0).length;
  const mastered = progressValues.filter((item) => item.level >= 3).length;
  const strongEvidence = state.questions.filter((item) => item.evidence?.level === "strong").length;
  $("#dueStat").textContent = due;
  $("#navDueCount").textContent = due;
  $("#seenStat").textContent = seen;
  $("#seenPercent").textContent = `占全部 ${state.questions.length ? Math.round(seen / state.questions.length * 100) : 0}%`;
  $("#masteredStat").textContent = mastered;
  $("#evidenceStat").textContent = strongEvidence;
  renderCatalogDirectory();
  renderActiveTrainingBanner();
  renderQuestionList();
  if (state.selectedId) renderQuestionDetail(state.questions.find((item) => item.id === state.selectedId));
}

function filteredQuestions() {
  if (state.activeTraining?.questionIds?.length) {
    const order = new Map(state.activeTraining.questionIds.map((id, index) => [id, index]));
    return state.questions.filter((question) => order.has(question.id)).sort((a, b) => order.get(a.id) - order.get(b.id));
  }
  const query = $("#searchInput").value.trim().toLowerCase();
  const tier = $("#tierFilter").value;
  const status = $("#statusFilter").value;
  const sort = $("#sortSelect").value;

  const result = state.questions.filter((question) => {
    if (state.currentTrack !== "all" && question.track !== state.currentTrack) return false;
    if (state.catalogFilters.category !== "all" && question.category !== state.catalogFilters.category) return false;
    if (state.catalogFilters.topicGroup !== "all" && question.topicGroup !== state.catalogFilters.topicGroup) return false;
    if (state.catalogFilters.concept !== "all" && question.concept !== state.catalogFilters.concept) return false;
    if (state.catalogFilters.angle !== "all" && question.angle !== state.catalogFilters.angle) return false;
    if (state.catalogFilters.company !== "all" && !questionCompanies(question).includes(state.catalogFilters.company)) return false;
    if (tier !== "all" && question.tier !== tier) return false;
    if (!progressMatchesStatus(question, status)) return false;
    if (query) {
      const haystack = `${question.title} ${question.category} ${question.topicGroup} ${question.concept} ${angleLabel(question.angle)} ${questionCompanies(question).join(" ")} ${(question.tags || []).join(" ")}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  result.sort((a, b) => {
    if (sort === "recent") return evidenceRank(b) - evidenceRank(a) || b.importance - a.importance;
    if (sort === "category") return a.category.localeCompare(b.category, "zh-CN") || b.importance - a.importance;
    if (sort === "weak") return getProgress(a.id).level - getProgress(b.id).level || b.importance - a.importance;
    return b.importance - a.importance || a.id.localeCompare(b.id);
  });
  return result;
}

function evidenceRank(question) {
  return ({ strong: 3, medium: 2, foundation: 1 }[question.evidence?.level] || 0) * 100;
}

function renderQuestionList() {
  const questions = filteredQuestions();
  $("#resultCount").textContent = questions.length;
  $("#questionList").innerHTML = questions.slice(0, state.visibleCount).map((question, index) => {
    const progress = getProgress(question.id);
    const companies = questionCompanies(question);
    return `<button class="question-item ${question.id === state.selectedId ? "active" : ""}" data-question-id="${escapeHtml(question.id)}">
      <span class="question-number">${String(index + 1).padStart(2, "0")}</span>
      <span class="question-copy"><strong>${escapeHtml(question.title)}</strong><small><span>${escapeHtml(question.category)}</span><span>·</span><span>${escapeHtml(question.topicGroup)}</span><span>·</span><span>${escapeHtml(angleLabel(question.angle))}</span>${companies.length ? `<span>·</span><span>${escapeHtml(companies.slice(0, 2).join("/"))}面经关联</span>` : ""}<span>·</span><span>熟悉度 ${progress.level}/4</span></small></span>
      <span class="question-score"><b>${question.importance}</b><small>重要度</small></span>
    </button>`;
  }).join("");
  $$("[data-question-id]", $("#questionList")).forEach((button) => button.addEventListener("click", () => selectQuestion(button.dataset.questionId)));
  $("#loadMoreButton").style.display = questions.length > state.visibleCount ? "block" : "none";
}

function selectQuestion(id) {
  const question = state.questions.find((item) => item.id === id);
  if (!question) return;
  state.selectedId = id;
  location.hash = `q=${id}`;
  if (state.currentView !== "library") switchView("library");
  renderQuestionList();
  renderQuestionDetail(question);
  renderActiveTrainingBanner();
  $("#aiContext").textContent = `当前题目：${question.title}`;
  if (innerWidth < 1050) $("#questionDetail").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderPublicQuestionAttention(attention) {
  if (!attention?.available) {
    return '<div class="detail-section"><h3>公开题库关注度</h3><p class="company-attribution">当前公开热门题库标题未匹配到这个知识点；这不会影响真实面经频次统计。</p></div>';
  }
  const banks = (attention.banks || []).map((bank) =>
    '<a href="' + escapeHtml(bank.url) + '" target="_blank" rel="noreferrer">' +
      escapeHtml(bank.title) + ' · 榜单 #' + bank.rank + ' · 题目最高位置 #' + bank.bestPosition + ' ↗</a>'
  ).join("");
  const examples = (attention.examples || []).map((item) =>
    '<a href="' + escapeHtml(item.url) + '" target="_blank" rel="noreferrer"><span>公开标题</span><div><b>' +
      escapeHtml(item.title) + '</b><small>列表位置 #' + item.position + ' · 仅核对标题</small></div><i>↗</i></a>'
  ).join("");
  return '<div class="detail-section"><h3>公开题库关注度</h3><p class="company-attribution">在 ' +
    attention.bankCount + ' 个公开热门题库中匹配到 ' + attention.publicTitleSamples +
    ' 个标题；当前只有一次快照，按低置信信号最多影响 2 分。标题只用于识别知识点，不访问 VIP 答案，也不计入真实面经频次。</p>' +
    (banks ? '<div class="source-links">' + banks + '</div>' : '') +
    (examples ? '<div class="learning-resources">' + examples + '</div>' : '') +
    '</div>';
}

function renderQuestionDetail(question) {
  if (!question) return;
  const progress = getProgress(question.id);
  const sourceLinks = (question.evidence?.sourceIds || []).map((id) => state.sourceMap.get(id)).filter(Boolean);
  const learningLinks = (question.learningSourceIds || []).map((id) => state.sourceMap.get(id)).filter(Boolean);
  const reviewLinks = (question.contentReview?.sourceIds || []).map((id) => state.sourceMap.get(id)).filter(Boolean);
  const publicAttention = question.evidence?.publicQuestionAttention;
  const companies = questionCompanies(question);
  const evidenceText = { strong: "近期面经强信号", medium: "多来源支持", foundation: "基础必要性" }[question.evidence?.level] || "待核查";
  $("#questionDetail").className = "question-detail";
  $("#questionDetail").innerHTML = `<div class="detail-inner">
    <div class="tag-row">
      <span class="tag ${question.tier === "core" ? "core" : ""}">${tierLabel(question.tier)}</span>
      <span class="tag ${question.evidence?.level === "strong" ? "interview" : ""}">${evidenceText}</span>
      <span class="tag">${escapeHtml(question.track === "backend" ? "Java 后端" : "AI / Agent")}</span>
    </div>
    <h2>${escapeHtml(question.title)}</h2>
    <div class="detail-meta"><span>专题：${escapeHtml(question.category)}</span><span>知识组：${escapeHtml(question.topicGroup)}</span><span>知识点：${escapeHtml(question.concept)}</span><span>题型：${escapeHtml(angleLabel(question.angle))}</span><span>难度：${difficultyLabel(question.difficulty)}</span><span>内容状态：${question.contentStatus === "reviewed" ? `已人工复核（${escapeHtml(question.contentReview?.reviewedAt || "日期未知")}）` : "待逐题复核"}</span></div>

    <div class="personal-actions" aria-label="个人题目操作">
      <button id="favoriteButton" class="${progress.favorite ? "active" : ""}"><span>${progress.favorite ? "★" : "☆"}</span>${progress.favorite ? "已收藏" : "收藏题目"}</button>
      <button id="mistakeButton" class="${progress.inMistakeBook ? "active" : ""}"><span>${progress.inMistakeBook ? "✓" : "+"}</span>${progress.inMistakeBook ? "已在错题本" : "加入错题本"}</button>
      <small>${progress.mistakeCount ? `已低分 ${progress.mistakeCount} 次` : "收藏、错题和笔记都会随进度导出"}</small>
    </div>

    <div class="recall-box">
      <label for="recallAnswer">先写下或口述你的答案</label>
      <textarea id="recallAnswer" placeholder="不要求完美。先从脑中提取，再对照答案，效果远好于直接阅读。">${escapeHtml(progress.answer || "")}</textarea>
    </div>

    <div class="answer-actions">
      <button id="hintButton">显示提示</button>
      <button id="answerButton">展开精简答案</button>
      <button id="detailedAnswerButton" class="deep-answer-button">查看新手详细讲解</button>
      <button id="askAiReviewButton">让 AI 评价回答</button>
    </div>
    <div id="hintPanel" class="answer-panel"><h3>思考提示</h3><p>${escapeHtml(question.beginnerHint || `先说明${question.concept}解决的问题，再解释核心机制和适用边界。`)}</p></div>
    <div id="answerPanel" class="answer-panel"><h3>30 秒精简答案</h3><p>${escapeHtml(question.quickAnswer)}</p><h3>回答至少覆盖</h3><ul class="key-points">${(question.keyPoints || []).map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul></div>
    <div id="detailedAnswerPanel" class="answer-panel detailed-answer-panel">
      <div class="learning-order"><b>建议这样学</b><span>先读“一句话先懂”并尝试复述，再看机制与项目，最后处理误区和选型。</span></div>
      <h3>面试时怎么组织</h3>
      <ol class="answer-framework">${(question.answerFramework || []).map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>
      <div class="deep-answer-grid">${(question.detailedAnswer || []).map((section, index) => `<section class="deep-answer-section"><span>${String(index + 1).padStart(2, "0")}</span><div><h4>${escapeHtml(section.title)}</h4><p>${escapeHtml(section.content)}</p></div></section>`).join("")}</div>
      <h3>相关知识点</h3>
      <div class="knowledge-chips">${(question.relatedKnowledge || []).map((topic) => `<button type="button" data-related-topic="${escapeHtml(topic)}">${escapeHtml(topic)}</button>`).join("")}</div>
      <h3>进一步学习来源</h3>
      <div class="learning-resources">${learningLinks.length ? learningLinks.map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer"><span>${escapeHtml(SOURCE_TYPE_LABELS[source.type] || "学习资料")}</span><div><b>${escapeHtml(source.shortTitle || source.title)}</b><small>${escapeHtml(source.notes || "打开来源继续学习")}</small></div><i>↗</i></a>`).join("") : "<p>当前暂无单独的权威学习入口，可先使用下方公开来源交叉核对。</p>"}</div>
      ${(question.learningHints || []).length ? `<h3>八股文网站对应章节</h3><div class="learning-resources">${question.learningHints.map((hint) => hint.url ? `<a href="${escapeHtml(hint.url)}" target="_blank" rel="noreferrer"><span>${escapeHtml(hint.site)}</span><div><b>${escapeHtml(hint.title)}</b><small>打开该站章节</small></div><i>↗</i></a>` : `<div class="hint-no-link"><span>${escapeHtml(hint.site)}</span><div><b>${escapeHtml(hint.title)}</b><small>按章节名在该站内搜索</small></div></div>`).join("")}</div>` : ""}
    </div>

    ${question.contentReview ? `<div class="detail-section content-review-card"><h3>人工内容复核</h3><p>${escapeHtml(question.contentReview.note)}</p><div class="source-links">${reviewLinks.map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.shortTitle || source.title)} ↗</a>`).join("")}</div></div>` : ""}

    <div class="detail-section">
      <h3>当前样本依据</h3>
      <p class="company-attribution">${companies.length ? `该知识点关联 ${escapeHtml(companies.join("、"))} 的可审计面经；这表示知识点出现过，不声称当前问法是公司原题。` : "当前没有公司明确且可审计的直接面经关联，不代表该知识点从未被问过。"}</p>
      <div class="evidence-strip"><div><b>${question.importance}</b><small>综合重要度</small></div><div><b>${sourceLinks.length}</b><small>关联公开来源</small></div><div><b>${escapeHtml(question.evidence?.lastObserved || "—")}</b><small>最近观察</small></div></div>
    </div>

    ${renderPublicQuestionAttention(publicAttention)}

    <div class="detail-section">
      <h3>你的熟悉程度</h3>
      <div class="rating-grid">${[0,1,2,3,4].map((level) => `<button class="rating-button ${progress.level === level && progress.attempts > 0 ? "active" : ""}" data-rating="${level}"><b>${level}</b>${ratingLabel(level)}</button>`).join("")}</div>
    </div>

    <div class="detail-section personal-note-section">
      <div class="section-heading-inline"><h3>个人笔记</h3><small id="noteSaveStatus">自动保存在当前浏览器</small></div>
      <textarea id="personalNote" maxlength="10000" placeholder="例如：自己的理解、容易混淆的点、项目中的例子，或下次复习要追问的问题…">${escapeHtml(progress.note || "")}</textarea>
    </div>

    <div class="detail-section">
      <h3>公开来源</h3>
      <div class="question-source-cards">${sourceLinks.length ? sourceLinks.map((source) => renderSourceAuditCard(source, { compact: true })).join("") : "<span>当前仅有模块级基础证据，等待补充直接面经来源。</span>"}</div>
    </div>
  </div>`;

  $("#recallAnswer").addEventListener("input", (event) => {
    const current = getProgress(question.id);
    state.progress[question.id] = { ...current, answer: event.target.value.slice(0, 20_000) };
    saveProgress();
  });
  $("#personalNote").addEventListener("input", (event) => {
    const current = getProgress(question.id);
    state.progress[question.id] = { ...current, note: event.target.value.slice(0, 10_000), updatedAt: new Date().toISOString() };
    saveProgress();
    renderPersonalCounts();
    $("#noteSaveStatus").textContent = event.target.value.trim() ? "已保存" : "笔记为空";
  });
  $("#favoriteButton").addEventListener("click", () => toggleQuestionFlag(question, "favorite"));
  $("#mistakeButton").addEventListener("click", () => toggleQuestionFlag(question, "inMistakeBook"));
  $("#hintButton").addEventListener("click", () => $("#hintPanel").classList.toggle("open"));
  $("#answerButton").addEventListener("click", () => $("#answerPanel").classList.toggle("open"));
  $("#detailedAnswerButton").addEventListener("click", () => {
    const panel = $("#detailedAnswerPanel");
    panel.classList.toggle("open");
    $("#detailedAnswerButton").textContent = panel.classList.contains("open") ? "收起新手详细讲解" : "查看新手详细讲解";
  });
  $$('[data-related-topic]', $("#questionDetail")).forEach((button) => button.addEventListener("click", () => {
    $("#searchInput").value = button.dataset.relatedTopic;
    state.visibleCount = 60;
    renderLibrary();
    $("#questionList").scrollTo({ top: 0, behavior: "smooth" });
  }));
  $("#askAiReviewButton").addEventListener("click", () => {
    $("#aiPanel").classList.add("open");
    state.aiMode = "review";
    const answer = $("#recallAnswer").value.trim();
    $("#chatInput").value = answer ? `这是我的回答，请评价：\n${answer}` : "我还没有形成答案，请先告诉我应该从哪些方面组织回答。";
    $("#chatInput").focus();
  });
  $$("[data-rating]", $("#questionDetail")).forEach((button) => button.addEventListener("click", () => rateQuestion(question, Number(button.dataset.rating))));
}

function rateQuestion(question, level) {
  const current = getProgress(question.id);
  const intervalDays = [0, 1, 3, 7, 21][level];
  const dueAt = new Date(Date.now() + intervalDays * 86_400_000).toISOString();
  state.progress[question.id] = {
    ...current,
    level,
    attempts: (current.attempts || 0) + 1,
    inMistakeBook: level <= 1 ? true : current.inMistakeBook,
    mistakeCount: (current.mistakeCount || 0) + (level <= 1 ? 1 : 0),
    updatedAt: new Date().toISOString(),
    dueAt
  };
  saveProgress();
  renderAll();
  renderQuestionDetail(question);
  showToast(level <= 1 ? "已加入近期复习队列和错题本" : level >= 3 ? `已记录：${ratingLabel(level)}，${intervalDays} 天后复习` : "已加入近期复习队列");
}

function toggleQuestionFlag(question, field) {
  const current = getProgress(question.id);
  const nextValue = !current[field];
  state.progress[question.id] = { ...current, [field]: nextValue, updatedAt: new Date().toISOString() };
  saveProgress();
  renderAll();
  renderQuestionDetail(question);
  showToast(field === "favorite" ? (nextValue ? "已收藏这道题" : "已取消收藏") : (nextValue ? "已加入错题本" : "已从错题本移除"));
}

function randomQuestion() {
  const pool = filteredQuestions();
  if (!pool.length) return showToast("当前筛选下没有题目");
  selectQuestion(pool[Math.floor(Math.random() * pool.length)].id);
}

function dailyQuestions() {
  const due = state.questions.filter((question) => isDue(getProgress(question.id))).sort((a, b) => b.importance - a.importance);
  const newCore = state.questions.filter((question) => getProgress(question.id).attempts === 0 && question.tier === "core").sort((a, b) => b.importance - a.importance);
  return [...due.slice(0, 15), ...newCore.slice(0, Math.max(0, 20 - due.length))];
}

function renderDaily() {
  const queue = dailyQuestions();
  $("#dailyQueue").innerHTML = queue.length ? queue.map((question, index) => `<div class="daily-item"><div><strong>${index + 1}. ${escapeHtml(question.title)}</strong><small>${escapeHtml(question.category)} · ${getProgress(question.id).attempts ? "到期复习" : "核心新题"}</small></div><button data-daily-id="${escapeHtml(question.id)}">开始</button></div>`).join("") : "<p>今天的复习已经完成。可以去题库随机练习或学习新的核心题。</p>";
  $$("[data-daily-id]", $("#dailyQueue")).forEach((button) => button.addEventListener("click", () => selectQuestion(button.dataset.dailyId)));
}

function stageQuestions(stage, track) {
  const tierRank = { core: 0, high: 1, extended: 2 };
  const candidates = state.questions.filter((question) => question.track === track && stage.categories.includes(question.category));
  const selected = [];
  for (const angle of ANGLE_ORDER) {
    candidates.filter((question) => question.angle === angle).sort((a, b) =>
      (tierRank[a.tier] ?? 9) - (tierRank[b.tier] ?? 9) || a.difficulty - b.difficulty || b.importance - a.importance
    ).forEach((question) => {
      if (selected.length < stage.limit) selected.push(question);
    });
  }
  if (selected.length < stage.limit) {
    candidates.filter((question) => !selected.includes(question)).sort((a, b) => b.importance - a.importance).forEach((question) => {
      if (selected.length < stage.limit) selected.push(question);
    });
  }
  return selected;
}

function pathStageStats(stage, track) {
  const questions = stageQuestions(stage, track);
  const studied = questions.filter((question) => getProgress(question.id).attempts > 0).length;
  const ready = questions.filter((question) => getProgress(question.id).level >= 2).length;
  const mastered = questions.filter((question) => getProgress(question.id).level >= 3).length;
  return { questions, studied, ready, mastered, total: questions.length, percent: questions.length ? Math.round(ready / questions.length * 100) : 0 };
}

function allPathQuestions() {
  const unique = new Map();
  for (const [track, stages] of Object.entries(LEARNING_PATHS)) {
    stages.forEach((stage) => stageQuestions(stage, track).forEach((question) => unique.set(question.id, question)));
  }
  return [...unique.values()];
}

function renderPath() {
  const track = state.currentPathTrack;
  const stages = LEARNING_PATHS[track];
  $$('[data-path-track]').forEach((button) => {
    const active = button.dataset.pathTrack === track;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });

  const stageData = stages.map((stage, index) => ({ stage, index, ...pathStageStats(stage, track) }));
  const recommended = stageData.find((item) => item.ready < item.total) || stageData.at(-1);
  if (!state.selectedPathStageId || !stages.some((stage) => stage.id === state.selectedPathStageId)) state.selectedPathStageId = recommended.stage.id;
  const totals = stageData.reduce((sum, item) => ({ ready: sum.ready + item.ready, mastered: sum.mastered + item.mastered, total: sum.total + item.total }), { ready: 0, mastered: 0, total: 0 });
  const routePercent = totals.total ? Math.round(totals.ready / totals.total * 100) : 0;
  $("#pathSummary").innerHTML = `<article><span>${track === "backend" ? "Java 后端" : "AI / Agent"}精选主线</span><strong>${totals.total} 道</strong><small>完整题库仍可随时检索</small></article><article><span>达到“关键词”以上</span><strong>${totals.ready}</strong><small>路线完成度 ${routePercent}%</small></article><article><span>能够完整回答</span><strong>${totals.mastered}</strong><small>熟悉度达到 3～4</small></article><article class="recommended"><span>建议继续</span><strong>${escapeHtml(recommended.stage.title)}</strong><small>阶段 ${recommended.index + 1} / ${stages.length}</small></article>`;

  $("#pathStages").innerHTML = stageData.map((item) => {
    const complete = item.ready === item.total;
    const isRecommended = item.stage.id === recommended.stage.id;
    const isSelected = item.stage.id === state.selectedPathStageId;
    return `<article class="path-stage-card ${complete ? "complete" : ""} ${isRecommended ? "recommended" : ""} ${isSelected ? "selected" : ""}">
      <button class="path-stage-main" data-path-stage="${escapeHtml(item.stage.id)}">
        <span class="stage-number">${complete ? "✓" : String(item.index + 1).padStart(2, "0")}</span>
        <span class="stage-copy"><small>${complete ? "阶段已完成" : isRecommended ? "建议从这里继续" : `阶段 ${item.index + 1}`}</small><strong>${escapeHtml(item.stage.title)}</strong><span>${escapeHtml(item.stage.description)}</span></span>
        <span class="stage-score"><b>${item.ready}/${item.total}</b><small>已达标</small></span>
      </button>
      <div class="stage-progress"><i style="width:${item.percent}%"></i></div>
      <footer><span>先修：${escapeHtml(item.stage.prerequisite)}</span><button data-path-start="${escapeHtml(item.stage.id)}">${complete ? "再次复习" : item.studied ? "继续阶段" : "开始阶段"}</button></footer>
    </article>`;
  }).join("");

  const selectedStage = stages.find((stage) => stage.id === state.selectedPathStageId) || recommended.stage;
  renderPathStageDetail(selectedStage, track);
  $$('[data-path-stage]', $("#pathStages")).forEach((button) => button.addEventListener("click", () => {
    state.selectedPathStageId = button.dataset.pathStage;
    renderPath();
    $("#pathStageDetail").scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  $$('[data-path-start]', $("#pathStages")).forEach((button) => button.addEventListener("click", () => startPathStage(button.dataset.pathStart, track)));

  const allQuestions = allPathQuestions();
  const allReady = allQuestions.filter((question) => getProgress(question.id).level >= 2).length;
  $("#navPathProgress").textContent = `${allQuestions.length ? Math.round(allReady / allQuestions.length * 100) : 0}%`;
}

function renderPathStageDetail(stage, track) {
  const stats = pathStageStats(stage, track);
  const nextQuestion = stats.questions.find((question) => getProgress(question.id).level < 2) || stats.questions.find((question) => getProgress(question.id).level < 3) || stats.questions[0];
  $("#pathStageDetail").innerHTML = `<div class="path-detail-heading"><div><span class="section-kicker">STAGE CHECKLIST</span><h3>${escapeHtml(stage.title)}</h3><p>${escapeHtml(stage.description)}</p></div><button class="primary-button" data-path-next="${escapeHtml(nextQuestion?.id || "")}">${stats.ready === stats.total ? "复习第一题" : "学习下一题"}</button></div>
    <div class="path-prerequisite"><b>开始前知道这些就够：</b><span>${escapeHtml(stage.prerequisite)}</span><i>路线不锁定，可随时跳阶段。</i></div>
    <div class="path-question-list">${stats.questions.map((question, index) => {
      const progress = getProgress(question.id);
      const status = progress.attempts === 0 ? "未学习" : progress.level >= 3 ? "能回答" : progress.level >= 2 ? "有关键词" : "待巩固";
      return `<button data-path-question="${escapeHtml(question.id)}"><span>${String(index + 1).padStart(2, "0")}</span><div><strong>${escapeHtml(question.title)}</strong><small>${escapeHtml(question.concept)} · ${difficultyLabel(question.difficulty)}</small></div><b class="path-question-status level-${progress.attempts ? progress.level : "new"}">${status}</b></button>`;
    }).join("")}</div>`;
  $$('[data-path-question]', $("#pathStageDetail")).forEach((button) => button.addEventListener("click", () => selectQuestion(button.dataset.pathQuestion)));
  const nextButton = $('[data-path-next]', $("#pathStageDetail"));
  if (nextButton) nextButton.addEventListener("click", () => selectQuestion(nextButton.dataset.pathNext));
}

function startPathStage(stageId, track) {
  const stage = LEARNING_PATHS[track].find((item) => item.id === stageId);
  if (!stage) return;
  const questions = stageQuestions(stage, track);
  const next = questions.find((question) => getProgress(question.id).level < 2) || questions[0];
  if (next) selectQuestion(next.id);
}

function customCategories(track) {
  return state.taxonomy.tracks?.[track] || [];
}

function createCustomDraft(track = "backend", sourceConfig = null, name = "") {
  const safe = sanitizeCustomConfig(sourceConfig || { track });
  const modules = {};
  customCategories(track).forEach((category, index) => {
    const stored = safe.modules[category.name];
    const concepts = category.groups.flatMap((group) => group.concepts.map((concept) => concept.name));
    const validConcepts = (stored?.concepts || []).filter((concept) => concepts.includes(concept));
    const validAngles = (stored?.angles || []).filter((angle) => DEFAULT_ANGLE_LABELS[angle]);
    modules[category.name] = {
      enabled: stored ? stored.enabled : index === 0,
      concepts: validConcepts.length ? validConcepts : concepts,
      angles: validAngles.length ? validAngles : Object.keys(DEFAULT_ANGLE_LABELS),
      tier: stored?.tier || "all",
      limit: stored?.limit || Math.min(15, category.questionCount),
      strategy: stored?.strategy || "balanced",
      includeIds: (stored?.includeIds || []).filter((id) => state.questions.some((question) => question.id === id && question.track === track && question.category === category.name)),
      excludeIds: (stored?.excludeIds || []).filter((id) => state.questions.some((question) => question.id === id && question.track === track && question.category === category.name))
    };
  });
  return { track, status: safe.status, name: String(name || "").slice(0, 60), modules };
}

function stableQuestionHash(value) {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function selectBalancedQuestions(pool, limit) {
  const groups = [...new Set(pool.map((question) => question.concept))].map((concept) =>
    pool.filter((question) => question.concept === concept).sort((a, b) => b.importance - a.importance || a.id.localeCompare(b.id))
  );
  const selected = [];
  let round = 0;
  while (selected.length < limit && groups.some((group) => group[round])) {
    for (const group of groups) {
      if (group[round]) selected.push(group[round]);
      if (selected.length >= limit) break;
    }
    round += 1;
  }
  return selected;
}

function customModuleQuestions(draft, category, applyLimit = true, includeDisabled = false) {
  const module = draft.modules[category];
  if (!module || (!module.enabled && !includeDisabled)) return [];
  const selectedConcepts = new Set(module.concepts || []);
  const selectedAngles = new Set(module.angles || []);
  const pool = state.questions.filter((question) =>
    question.track === draft.track &&
    question.category === category &&
    selectedConcepts.has(question.concept) &&
    selectedAngles.has(question.angle) &&
    (module.tier === "all" || question.tier === module.tier) &&
    progressMatchesStatus(question, draft.status)
  );
  const ordered = module.strategy === "balanced" ? selectBalancedQuestions(pool, pool.length) : [...pool].sort((a, b) => {
    if (module.strategy === "weak") return getProgress(a.id).level - getProgress(b.id).level || b.importance - a.importance;
    if (module.strategy === "random") return stableQuestionHash(`${category}|${a.id}`) - stableQuestionHash(`${category}|${b.id}`);
    return b.importance - a.importance || a.id.localeCompare(b.id);
  });
  if (!applyLimit) return ordered;

  const limit = Math.min(module.limit, pool.length);
  const excluded = new Set(module.excludeIds || []);
  const poolById = new Map(pool.map((question) => [question.id, question]));
  const included = (module.includeIds || []).map((id) => poolById.get(id)).filter((question) => question && !excluded.has(question.id));
  const includedIds = new Set(included.map((question) => question.id));
  return [...included, ...ordered.filter((question) => !includedIds.has(question.id) && !excluded.has(question.id))].slice(0, limit);
}

function customQuestionPreviewMarkup(draft, category) {
  const module = draft.modules[category];
  const selectedIds = new Set(customModuleQuestions(draft, category).map((question) => question.id));
  const candidates = customModuleQuestions(draft, category, false, true);
  if (!candidates.length) return '<p class="custom-question-preview-empty">当前筛选条件下没有匹配题目，请调整知识点、题型、层级或学习状态。</p>';
  return `<ol class="custom-question-preview-list">${candidates.map((question) => {
    const included = module.enabled && selectedIds.has(question.id);
    const answer = String(question.quickAnswer || "").replace(/\s+/g, " ").trim();
    const excerpt = answer.length > 88 ? `${answer.slice(0, 88)}…` : answer;
    return `<li class="${included ? "included" : ""}">
      <div class="custom-question-preview-row">
        <button type="button" class="custom-question-preview-open" data-custom-preview-question="${escapeHtml(question.id)}" title="打开题目详情">
          <span class="custom-question-preview-copy"><strong>${escapeHtml(question.title)}</strong><small>${escapeHtml(question.topicGroup)} · ${escapeHtml(question.concept)} · ${escapeHtml(angleLabel(question.angle))} · ${escapeHtml(tierLabel(question.tier))}</small>${excerpt ? `<em>${escapeHtml(excerpt)}</em>` : ""}</span>
        </button>
        <button type="button" class="custom-question-toggle" data-custom-toggle-question="${escapeHtml(question.id)}" aria-pressed="${included}" aria-label="${included ? "从题单移除" : "收入题单"}：${escapeHtml(question.title)}">${included ? "已收录" : "收入题单"}</button>
      </div>
    </li>`;
  }).join("")}</ol>`;
}

function toggleCustomQuestionInclusion(category, questionId) {
  const draft = state.customDraft;
  const module = draft?.modules?.[category];
  if (!module || !state.questions.some((question) => question.id === questionId && question.track === draft.track && question.category === category)) return;

  const wasIncluded = module.enabled && customModuleQuestions(draft, category).some((question) => question.id === questionId);
  module.includeIds = (module.includeIds || []).filter((id) => id !== questionId);
  module.excludeIds = (module.excludeIds || []).filter((id) => id !== questionId);
  if (wasIncluded) {
    module.excludeIds.unshift(questionId);
  } else {
    module.enabled = true;
    module.includeIds.unshift(questionId);
  }
  module.includeIds = module.includeIds.slice(0, MAX_SESSION_QUESTIONS);
  module.excludeIds = module.excludeIds.slice(0, MAX_SESSION_QUESTIONS);
  updateCustomModuleCard(category);
  renderCustomPreview();
  showToast(wasIncluded ? "已从当前题单移除" : "已收入当前题单");
}

function customQuestionsForDraft(draft = state.customDraft) {
  if (!draft) return [];
  const seen = new Set();
  return customCategories(draft.track).flatMap((category) => customModuleQuestions(draft, category.name))
    .filter((question) => !seen.has(question.id) && seen.add(question.id));
}

function renderCustomModules() {
  const draft = state.customDraft;
  $("#customModuleList").innerHTML = customCategories(draft.track).map((category) => {
    const module = draft.modules[category.name];
    const selected = customModuleQuestions(draft, category.name);
    const available = customModuleQuestions(draft, category.name, false, true).length;
    return `<article class="custom-module-card ${module.enabled ? "enabled" : ""}" data-custom-category-card="${escapeHtml(category.name)}">
      <header>
        <label><input type="checkbox" data-custom-field="enabled" ${module.enabled ? "checked" : ""} /><span><b>${escapeHtml(category.name)}</b><small>${category.groups.length} 个知识组 · ${category.questionCount} 题</small></span></label>
        <strong data-custom-module-count>${module.enabled ? `${selected.length}/${available}` : "未加入"}</strong>
      </header>
      <details ${module.enabled ? "open" : ""}>
        <summary>配置这个专题</summary>
        <div class="custom-config-grid">
          <label>题目层级<select data-custom-field="tier"><option value="all" ${module.tier === "all" ? "selected" : ""}>全部层级</option><option value="core" ${module.tier === "core" ? "selected" : ""}>核心必会</option><option value="high" ${module.tier === "high" ? "selected" : ""}>高频主线</option><option value="extended" ${module.tier === "extended" ? "selected" : ""}>完整备战</option></select></label>
          <label>抽题策略<select data-custom-field="strategy"><option value="balanced" ${module.strategy === "balanced" ? "selected" : ""}>知识点均衡</option><option value="importance" ${module.strategy === "importance" ? "selected" : ""}>重要度优先</option><option value="weak" ${module.strategy === "weak" ? "selected" : ""}>薄弱项优先</option><option value="random" ${module.strategy === "random" ? "selected" : ""}>稳定随机</option></select></label>
          <label>本专题题量<input type="number" data-custom-field="limit" min="1" max="${category.questionCount}" value="${module.limit}" /></label>
        </div>
        <div class="custom-angle-options"><b>题目类型</b>${Object.entries(DEFAULT_ANGLE_LABELS).map(([angle, label]) => `<label><input type="checkbox" data-custom-angle="${angle}" ${module.angles.includes(angle) ? "checked" : ""} />${label}</label>`).join("")}</div>
        <div class="custom-concept-groups"><b>知识点</b>${category.groups.map((group) => `<section><strong>${escapeHtml(group.name)}</strong><div>${group.concepts.map((concept) => `<label><input type="checkbox" data-custom-concept="${escapeHtml(concept.name)}" ${module.concepts.includes(concept.name) ? "checked" : ""} />${escapeHtml(concept.name)}</label>`).join("")}</div></section>`).join("")}</div>
      </details>
      <details class="custom-question-preview">
        <summary>展开查看匹配题目（<span data-custom-preview-count>${available}</span>）</summary>
        <div data-custom-question-preview-list>${customQuestionPreviewMarkup(draft, category.name)}</div>
      </details>
    </article>`;
  }).join("");
}

function updateCustomModuleCard(category) {
  const card = $$('[data-custom-category-card]', $("#customModuleList")).find((item) => item.dataset.customCategoryCard === category);
  if (!card) return;
  const module = state.customDraft.modules[category];
  card.classList.toggle("enabled", module.enabled);
  const selected = customModuleQuestions(state.customDraft, category);
  const available = customModuleQuestions(state.customDraft, category, false, true).length;
  $("[data-custom-module-count]", card).textContent = module.enabled ? `${selected.length}/${available}` : "未加入";
  $("[data-custom-preview-count]", card).textContent = available;
  $("[data-custom-question-preview-list]", card).innerHTML = customQuestionPreviewMarkup(state.customDraft, category);
}

function renderCustomPreview() {
  const draft = state.customDraft;
  if (!draft) return;
  const questions = customQuestionsForDraft(draft);
  const enabled = Object.entries(draft.modules).filter(([, module]) => module.enabled);
  const concepts = new Set(questions.map((question) => question.concept));
  const angles = new Set(questions.map((question) => question.angle));
  $("#customPreview").innerHTML = `<div><span>当前题单</span><strong>${questions.length} 题</strong><small>${enabled.length} 个专题 · ${concepts.size} 个知识点 · ${angles.size} 类问法</small></div><p>${questions.length ? enabled.map(([category]) => `${category} ${customModuleQuestions(draft, category).length} 题`).join(" · ") : "至少启用一个专题，并保留一个知识点和一种题型。"}</p>`;
  $("#startCustomSession").disabled = questions.length === 0;
  $("#saveCustomSession").disabled = questions.length === 0;
}

function renderSavedSessions() {
  $("#navCustomCount").textContent = state.customSessions.length;
  $("#savedSessionList").innerHTML = state.customSessions.length ? state.customSessions.map((session) => {
    const currentDraft = createCustomDraft(session.config.track, session.config, session.name);
    const currentIds = new Set(customQuestionsForDraft(currentDraft).map((question) => question.id));
    const savedIds = new Set(session.questionIds);
    const added = [...currentIds].filter((id) => !savedIds.has(id)).length;
    const removed = [...savedIds].filter((id) => !state.questions.some((question) => question.id === id)).length;
    const modules = Object.entries(session.config.modules || {}).filter(([, module]) => module.enabled).map(([category]) => category);
    return `<article class="saved-session-card">
      <div><span>${session.config.track === "backend" ? "Java 后端" : "AI / Agent"}</span><h3>${escapeHtml(session.name)}</h3><p>${escapeHtml(modules.join(" · ") || "未选择专题")}</p><small>固定 ${session.questionIds.length} 题${added ? ` · 新增 ${added} 道匹配题` : ""}${removed ? ` · ${removed} 道已不存在` : ""}</small></div>
      <div><button class="primary-button" data-session-action="start" data-session-id="${escapeHtml(session.id)}">开始</button><button class="secondary-button" data-session-action="edit" data-session-id="${escapeHtml(session.id)}">编辑</button>${added || removed ? `<button class="secondary-button" data-session-action="refresh" data-session-id="${escapeHtml(session.id)}">刷新题目</button>` : ""}<button class="text-list-button" data-session-action="delete" data-session-id="${escapeHtml(session.id)}">删除</button></div>
    </article>`;
  }).join("") : '<p class="muted">还没有保存题单。配置上方专题后即可保存。</p>';
}

function renderCustom() {
  if (!state.customDraft) state.customDraft = createCustomDraft("backend");
  $$('[data-custom-track]').forEach((button) => {
    const active = button.dataset.customTrack === state.customDraft.track;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  $("#customSessionName").value = state.customDraft.name || "";
  $("#customStatusFilter").value = state.customDraft.status;
  $("#saveCustomSession").textContent = state.editingCustomSessionId ? "更新题单" : "保存题单";
  renderCustomModules();
  renderCustomPreview();
  renderSavedSessions();
}

function handleCustomModuleChange(event) {
  const card = event.target.closest("[data-custom-category-card]");
  if (!card || !state.customDraft) return;
  const category = card.dataset.customCategoryCard;
  const module = state.customDraft.modules[category];
  if (!module) return;
  const field = event.target.dataset.customField;
  if (field === "enabled") module.enabled = event.target.checked;
  if (field === "tier") module.tier = event.target.value;
  if (field === "strategy") module.strategy = event.target.value;
  if (field === "limit") module.limit = Math.min(MAX_SESSION_QUESTIONS, Math.max(1, Math.round(Number(event.target.value) || 1)));
  if (event.target.dataset.customAngle) {
    const angle = event.target.dataset.customAngle;
    module.angles = event.target.checked ? [...new Set([...module.angles, angle])] : module.angles.filter((item) => item !== angle);
  }
  if (event.target.dataset.customConcept) {
    const concept = event.target.dataset.customConcept;
    module.concepts = event.target.checked ? [...new Set([...module.concepts, concept])] : module.concepts.filter((item) => item !== concept);
  }
  updateCustomModuleCard(category);
  renderCustomPreview();
}

function saveCurrentCustomSession() {
  const questions = customQuestionsForDraft();
  if (!questions.length) return showToast("当前配置没有可保存的题目");
  const enabledNames = Object.entries(state.customDraft.modules).filter(([, module]) => module.enabled).map(([category]) => category);
  const name = String(state.customDraft.name || enabledNames.slice(0, 3).join(" + ") || "自定义题单").trim().slice(0, 60);
  const now = new Date().toISOString();
  const config = sanitizeCustomConfig(state.customDraft);
  const existing = state.customSessions.find((session) => session.id === state.editingCustomSessionId);
  const session = {
    id: existing?.id || `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    config,
    questionIds: questions.map((question) => question.id)
  };
  state.customSessions = existing ? state.customSessions.map((item) => item.id === existing.id ? session : item) : [session, ...state.customSessions].slice(0, 30);
  state.editingCustomSessionId = session.id;
  state.customDraft.name = name;
  if (!saveCustomSessions()) return;
  renderCustom();
  showToast(existing ? "题单已更新" : "题单已保存");
}

function beginCustomTraining(name, questionIds) {
  const validIds = questionIds.filter((id) => state.questions.some((question) => question.id === id));
  if (!validIds.length) return showToast("这个题单当前没有可训练题目");
  state.activeTraining = { name, questionIds: validIds };
  const first = validIds.find((id) => getProgress(id).level < 2) || validIds[0];
  selectQuestion(first);
}

function startCurrentCustomSession() {
  const questions = customQuestionsForDraft();
  const enabledNames = Object.entries(state.customDraft.modules).filter(([, module]) => module.enabled).map(([category]) => category);
  beginCustomTraining(state.customDraft.name || enabledNames.join(" + ") || "临时题单", questions.map((question) => question.id));
}

function handleSavedSessionAction(event) {
  const button = event.target.closest("[data-session-action]");
  if (!button) return;
  const session = state.customSessions.find((item) => item.id === button.dataset.sessionId);
  if (!session) return;
  const action = button.dataset.sessionAction;
  if (action === "start") return beginCustomTraining(session.name, session.questionIds);
  if (action === "edit") {
    state.customDraft = createCustomDraft(session.config.track, session.config, session.name);
    state.editingCustomSessionId = session.id;
    renderCustom();
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  if (action === "refresh") {
    const draft = createCustomDraft(session.config.track, session.config, session.name);
    session.questionIds = customQuestionsForDraft(draft).map((question) => question.id);
    session.updatedAt = new Date().toISOString();
    saveCustomSessions();
    renderSavedSessions();
    showToast("题单已按当前题库刷新");
    return;
  }
  if (action === "delete" && confirm(`删除题单“${session.name}”？学习进度不会删除。`)) {
    state.customSessions = state.customSessions.filter((item) => item.id !== session.id);
    if (state.editingCustomSessionId === session.id) state.editingCustomSessionId = null;
    saveCustomSessions();
    renderCustom();
  }
}

function personalCollections() {
  return {
    mistakes: state.questions.filter((question) => getProgress(question.id).inMistakeBook),
    favorites: state.questions.filter((question) => getProgress(question.id).favorite),
    notes: state.questions.filter((question) => getProgress(question.id).note?.trim())
  };
}

function renderPersonalCounts() {
  const collections = personalCollections();
  if ($("#navMistakeCount")) $("#navMistakeCount").textContent = collections.mistakes.length;
  if ($("#mistakeTabCount")) $("#mistakeTabCount").textContent = collections.mistakes.length;
  if ($("#favoriteTabCount")) $("#favoriteTabCount").textContent = collections.favorites.length;
  if ($("#noteTabCount")) $("#noteTabCount").textContent = collections.notes.length;
  return collections;
}

function renderMistakes() {
  const collections = renderPersonalCounts();
  const filter = state.currentMistakeFilter;
  $$('[data-mistake-filter]').forEach((button) => {
    const active = button.dataset.mistakeFilter === filter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  const repeated = collections.mistakes.filter((question) => getProgress(question.id).mistakeCount >= 2).length;
  const withNotes = collections.mistakes.filter((question) => getProgress(question.id).note?.trim()).length;
  $("#mistakeSummary").innerHTML = `<article><span>错题本</span><strong>${collections.mistakes.length}</strong><small>低分自动收录或手动加入</small></article><article><span>反复卡住</span><strong>${repeated}</strong><small>低分记录至少 2 次</small></article><article><span>错题中有笔记</span><strong>${withNotes}</strong><small>用自己的话记录症结</small></article>`;

  const items = [...collections[filter]].sort((a, b) => {
    const pa = getProgress(a.id);
    const pb = getProgress(b.id);
    if (filter === "mistakes") return pa.level - pb.level || (pb.mistakeCount || 0) - (pa.mistakeCount || 0) || b.importance - a.importance;
    return new Date(pb.updatedAt || 0) - new Date(pa.updatedAt || 0) || b.importance - a.importance;
  });
  const emptyCopy = { mistakes: "还没有错题。把题目评为 0～1，或在题目详情中手动加入。", favorites: "还没有收藏。遇到想重点保留的题，点一下“收藏题目”。", notes: "还没有个人笔记。打开任意题目，在熟悉度下方写下自己的理解。" }[filter];
  $("#mistakeList").innerHTML = items.length ? items.map((question) => {
    const progress = getProgress(question.id);
    const reason = filter === "mistakes" ? (progress.mistakeCount ? `低分 ${progress.mistakeCount} 次` : progress.attempts > 0 && progress.level <= 1 ? "历史薄弱题" : "手动加入") : filter === "favorites" ? "已收藏" : "有个人笔记";
    const action = filter === "mistakes" ? `<button class="text-list-button" data-remove-mistake="${escapeHtml(question.id)}">移出错题本</button>` : filter === "favorites" ? `<button class="text-list-button" data-remove-favorite="${escapeHtml(question.id)}">取消收藏</button>` : "";
    return `<article class="mistake-card"><div class="mistake-card-main"><div class="mistake-card-tags"><span>${escapeHtml(question.track === "backend" ? "Java 后端" : "AI / Agent")}</span><span>${escapeHtml(question.category)}</span><b>${reason}</b></div><h3>${escapeHtml(question.title)}</h3><p>${progress.note?.trim() ? escapeHtml(progress.note.trim().slice(0, 140)) : "暂无个人笔记；打开题目后可记录自己真正卡住的地方。"}${progress.note?.trim().length > 140 ? "…" : ""}</p><small>熟悉度 ${progress.attempts ? `${progress.level}/4 · ${ratingLabel(progress.level)}` : "未评级"} · 重要度 ${question.importance}</small></div><div class="mistake-card-actions"><button class="primary-button" data-personal-question="${escapeHtml(question.id)}">继续练习</button>${action}</div></article>`;
  }).join("") : `<div class="personal-empty"><span>✓</span><h3>这里暂时是空的</h3><p>${emptyCopy}</p></div>`;
  $$('[data-personal-question]', $("#mistakeList")).forEach((button) => button.addEventListener("click", () => selectQuestion(button.dataset.personalQuestion)));
  $$('[data-remove-mistake]', $("#mistakeList")).forEach((button) => button.addEventListener("click", () => removePersonalFlag(button.dataset.removeMistake, "inMistakeBook")));
  $$('[data-remove-favorite]', $("#mistakeList")).forEach((button) => button.addEventListener("click", () => removePersonalFlag(button.dataset.removeFavorite, "favorite")));
}

function removePersonalFlag(questionId, field) {
  const current = getProgress(questionId);
  state.progress[questionId] = { ...current, [field]: false, updatedAt: new Date().toISOString() };
  saveProgress();
  renderAll();
  showToast(field === "favorite" ? "已取消收藏" : "已从错题本移除");
}

function renderProgress() {
  const categories = [...new Set(state.questions.map((question) => question.category))];
  const rows = categories.map((category) => {
    const questions = state.questions.filter((question) => question.category === category);
    const score = questions.reduce((sum, question) => sum + getProgress(question.id).level, 0);
    const percent = questions.length ? Math.round(score / (questions.length * 4) * 100) : 0;
    return { category, percent, count: questions.length };
  }).sort((a, b) => b.percent - a.percent || a.category.localeCompare(b.category, "zh-CN"));
  $("#progressDashboard").innerHTML = rows.map((row) => `<div class="progress-row"><span>${escapeHtml(row.category)} <small>(${row.count})</small></span><div class="progress-bar"><i style="width:${row.percent}%"></i></div><b>${row.percent}%</b></div>`).join("");
}

function selectedInsightTrends() {
  const trends = (state.insights?.trends || []).filter((trend) => trend.track === state.insightTrack);
  if (state.insightCompany === "all") return trends;
  const company = (state.insights?.companies || []).find((item) => item.name === state.insightCompany);
  const companyQuestions = new Set(company?.questionIds || []);
  return trends.filter((trend) => companyQuestions.has(trend.questionId));
}

function coveragePlatformCounts(coverage) {
  const counts = new Map((coverage?.platforms || []).map((platform) => [platform.id, platform.count]));
  const known = [
    { id: "nowcoder", name: "牛客" },
    { id: "xiaohongshu", name: "小红书" }
  ];
  const others = (coverage?.platforms || []).filter((platform) => !known.some((item) => item.id === platform.id));
  return [...known.map((platform) => ({ ...platform, count: counts.get(platform.id) || 0 })), ...others];
}

function coverageCards(coverage) {
  const publicSignals = coverage?.publicQuestionSignals;
  const range = coverage?.earliest && coverage?.latest ? `${coverage.earliest} 至 ${coverage.latest}` : "暂无可核验日期";
  return `<div class="coverage-stat-grid">
    <article><span>登记来源</span><b>${coverage?.registeredSources ?? coverage?.interviewSources ?? 0}</b><small>面经、岗位与学习资料</small></article>
    <article><span>面经样本</span><b>${coverage?.interviewSources ?? 0}</b><small>识别为面试经历或问题材料</small></article>
    <article><span>趋势有效</span><b>${coverage?.frequencyEligibleSources ?? 0}</b><small>链接、日期、直接性均可核验</small></article>
    <article><span>独立直接经历</span><b>${coverage?.independentInterviewSamples ?? 0}</b><small>转载去重并排除聚合帖</small></article>
    <article><span>已映射知识点</span><b>${coverage?.mappedInterviewSources ?? 0}</b><small>能影响题目证据与趋势</small></article>
    <article><span>最近 90 天</span><b>${coverage?.recent90Sources ?? 0}</b><small>独立直接样本</small></article>
    <article><span>公开热门标题</span><b>${publicSignals ? `${publicSignals.matchedInScopeTitles}/${publicSignals.inScopeTitles}` : "—"}</b><small>标题映射覆盖，不计面经频次</small></article>
    <article><span>去重 / 聚合</span><b>${(coverage?.duplicateExcluded ?? 0) + (coverage?.aggregateSources ?? 0)}</b><small>不重复放大热度</small></article>
    <article><span>时间范围</span><b class="coverage-date">${escapeHtml(range)}</b><small>以公开发布日期为准</small></article>
  </div><div class="coverage-platforms">${coveragePlatformCounts(coverage).map((platform) => `<span><b>${escapeHtml(platform.name)}</b> ${platform.count} 篇</span>`).join("")}${coverage?.sampleAudit?.scanned ? `<span><b>Sitemap 已筛查</b> ${coverage.sampleAudit.scanned} 个页面</span>` : ""}<span><b>排除频次</b> ${coverage?.excludedSources ?? 0} 篇</span><span><b>互动数据</b> ${coverage?.engagementSources ?? 0} 篇可用</span></div>`;
}

function trendAttentionText(attention) {
  if (!attention?.available) return "关注度未知（页面无明确互动数字）";
  const labels = { views: "浏览", likes: "点赞", favorites: "收藏", comments: "评论" };
  const metrics = Object.entries(attention.metrics || {}).map(([key, value]) => `${labels[key] || key} ${value}`);
  return `关注度：${metrics.join(" / ")}（${attention.sourceCount} 篇有明确数字）`;
}

function renderInsights() {
  if (!state.insights) {
    $("#insightCoverage").innerHTML = '<p class="muted">趋势数据暂不可用。</p>';
    return;
  }
  $("#insightTrackSelect").value = state.insightTrack;
  const companies = (state.insights.companies || []).filter((company) => (company.tracks || []).includes(state.insightTrack));
  if (state.insightCompany !== "all" && !companies.some((company) => company.name === state.insightCompany)) state.insightCompany = "all";
  $("#insightCompanySelect").innerHTML = `<option value="all">全部可审计公司</option>${companies.map((company) => `<option value="${escapeHtml(company.name)}">${escapeHtml(company.name)}（${company.sourceCount} 篇）</option>`).join("")}`;
  $("#insightCompanySelect").value = state.insightCompany;
  $("#insightCoverage").innerHTML = coverageCards(state.insights.coverage);

  const trends = selectedInsightTrends();
  const selectedCompany = companies.find((company) => company.name === state.insightCompany);
  const role = (state.insights.roles || []).find((item) => item.id === state.insightTrack);
  const sourceCount = selectedCompany?.sourceCount ?? new Set(trends.flatMap((trend) => trend.sourceIds || [])).size;
  const selectionName = selectedCompany?.name || role?.name || (state.insightTrack === "backend" ? "Java 后端" : "AI / Agent 应用开发");
  $("#insightSelectionSummary").innerHTML = `<div><span>当前题单</span><strong>${escapeHtml(selectionName)}</strong><small>${trends.length} 个知识点 · ${sourceCount} 篇可统计面经样本${selectedCompany ? ` · 最近观察 ${escapeHtml(selectedCompany.latest || "未知")}` : ""}</small></div><p>公司专项只收录能明确归属该公司的直接面经；聚合帖不会冒充某家公司原题。</p>`;
  $("#insightConceptCount").textContent = `${trends.length} 个知识点`;
  const startButton = $("#insightStartButton");
  startButton.disabled = !trends.length;
  startButton.textContent = trends.length ? `开始这组训练（${trends.length}）` : "当前没有可训练样本";

  $("#insightConceptList").innerHTML = trends.length ? trends.map((trend, index) => {
    const question = state.questions.find((item) => item.id === trend.questionId);
    return `<button class="insight-concept-card" data-insight-question="${escapeHtml(trend.questionId)}"><span>${String(index + 1).padStart(2, "0")}</span><div><strong>${escapeHtml(trend.concept)}</strong><small>${escapeHtml(question?.title || trend.category)} · ${trend.mentions} 篇样本 · ${trend.companyCount} 家明确公司</small></div><b>${trend.heat}<small>样本热度</small></b></button>`;
  }).join("") : '<div class="personal-empty"><span>据</span><h3>当前筛选没有可审计专项题</h3><p>可以切换岗位或选择“全部可审计公司”；也可以在更新题库页补充带链接和发布日期的直接面经。</p></div>';

  $("#insightTrendList").innerHTML = trends.length ? trends.slice(0, 20).map((trend) => `<button class="trend-card" data-insight-question="${escapeHtml(trend.questionId)}"><div><strong>${escapeHtml(trend.concept)}</strong><span class="trend-signal ${escapeHtml(trend.signal)}">${escapeHtml(TREND_SIGNAL_LABELS[trend.signal] || trend.signal)}</span></div><div class="trend-metrics"><span><b>${trend.recent90}</b>近 90 天</span><span><b>${trend.previous90}</b>前 90 天</span><span><b>${trend.mentions}</b>累计样本</span><span><b>${trend.companyCount}</b>公司数</span></div><small>最近观察 ${escapeHtml(trend.lastObserved || "未知")} · 置信度 ${escapeHtml(CONFIDENCE_LABELS[trend.confidence] || trend.confidence)} · ${escapeHtml(trendAttentionText(trend.attention))}</small></button>`).join("") : '<p class="muted">没有可显示的趋势。</p>';
  $$('[data-insight-question]', $("#insightsView")).forEach((button) => button.addEventListener("click", () => selectQuestion(button.dataset.insightQuestion)));
  $("#insightLimitations").innerHTML = `<h3>统计口径与限制</h3><ul>${(state.insights.coverage?.limitations || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderEngagement(source) {
  if (!source.engagement) return "关注度未知";
  const labels = { views: "浏览", likes: "点赞", favorites: "收藏", comments: "评论" };
  const metrics = Object.entries(labels).filter(([key]) => Number.isInteger(source.engagement[key])).map(([key, label]) => `${label} ${source.engagement[key]}`);
  return metrics.length ? `${metrics.join(" · ")}（${source.engagement.capturedAt?.slice(0, 10) || "采集时间未知"}采集）` : "关注度未知";
}

function renderSourceAuditCard(source, { compact = false } = {}) {
  const platform = source.platform?.name || "来源平台未识别";
  const method = source.collection?.methodLabel || "已登记来源";
  const traceability = { "url-and-date": "链接与日期可核验", "url-only": "仅链接可核验", unverified: "待核验" }[source.collection?.traceability] || "待核验";
  const meta = [platform, source.company, source.position, source.publishedAt, source.type === "interview" ? CANDIDATE_LEVEL_LABELS[source.candidateLevel] : null].filter(Boolean);
  const warnings = !compact && (source.qualityWarnings || []).length ? `<ul class="source-warning-list">${source.qualityWarnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>` : "";
  return `<article class="source-audit-card ${compact ? "compact" : ""}"><div class="source-audit-heading"><span class="source-type">${escapeHtml(SOURCE_TYPE_LABELS[source.type] || "公开资料")}</span><div><strong>${escapeHtml(source.title)}</strong><small>${escapeHtml(meta.join(" · "))}</small></div>${source.url ? `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">查看原文 ↗</a>` : '<span class="source-no-link">无原文链接</span>'}</div><div class="source-audit-tags"><span>${escapeHtml(method)}</span><span>${escapeHtml(traceability)}</span><span class="${source.directQuestionEvidence ? "ok" : "warning"}">${source.directQuestionEvidence ? "直接问题证据" : "非直接问题证据"}</span><span class="${source.collection?.frequencyEligible ? "ok" : "warning"}">${source.collection?.frequencyEligible ? "参与趋势" : "不计近期频次"}</span></div><p>${escapeHtml(source.notes || "未填写来源备注")}</p><small class="source-engagement">${escapeHtml(renderEngagement(source))}</small>${warnings}</article>`;
}

function renderSources() {
  $("#sourceList").innerHTML = state.sources.map((source) => renderSourceAuditCard(source)).join("");
  const coverage = state.insights?.coverage;
  $("#researchCoverage").innerHTML = coverage ? `${coverageCards(coverage)}<ul>${(coverage.limitations || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : '<p class="muted">来源覆盖统计暂不可用。</p>';
}

function openAppearance() {
  renderAppearanceChoices();
  $("#appearanceDialog").showModal();
}

function renderAppearanceChoices() {
  $$('[data-theme-choice]').forEach((button) => button.classList.toggle("active", button.dataset.themeChoice === state.appearance.theme));
  $$('[data-reading-size]').forEach((button) => button.classList.toggle("active", button.dataset.readingSize === state.appearance.readingSize));
}

async function openSettings() {
  const config = await fetchJson("/api/config");
  updateConfigUI(config);
  const form = $("#settingsForm");
  for (const [key, value] of Object.entries(config)) {
    if (!form.elements[key]) continue;
    if (form.elements[key].type === "checkbox") form.elements[key].checked = Boolean(value);
    else if (key === "customHeaders") form.elements[key].value = Object.keys(value || {}).length ? JSON.stringify(value, null, 2) : "";
    else form.elements[key].value = value ?? "";
  }
  form.elements.apiKey.value = "";
  $("#settingsStatus").textContent = config.apiKeyStorage === "saved"
    ? "API Key 已保存在当前项目中；输入框留空会保留现有值。"
    : config.apiKeyStorage === "session"
      ? "当前 API Key 只在本次运行内存中，服务重启后需要重新输入。"
      : "当前没有 API Key；不需要密钥的本地模型可保持为空。";
  renderKeyStorageHint();
  $("#settingsDialog").showModal();
}

function configFromForm() {
  const form = $("#settingsForm");
  let customHeaders = {};
  if (form.elements.customHeaders.value.trim()) customHeaders = JSON.parse(form.elements.customHeaders.value);
  return {
    name: form.elements.name.value,
    baseUrl: form.elements.baseUrl.value,
    apiKey: form.elements.apiKey.value,
    model: form.elements.model.value,
    temperature: Number(form.elements.temperature.value),
    maxTokens: Number(form.elements.maxTokens.value),
    customHeaders,
    rememberKey: form.elements.rememberKey.checked
  };
}

function renderKeyStorageHint() {
  const form = $("#settingsForm");
  const hint = $("#apiKeyStorageHint");
  if (!form || !hint) return;
  const entered = Boolean(form.elements.apiKey.value.trim());
  const remember = form.elements.rememberKey.checked;
  const currentStorage = state.aiConfig?.apiKeyStorage || "none";
  hint.classList.toggle("warning", !remember && (entered || currentStorage === "session" || currentStorage === "saved"));
  if (remember) {
    hint.textContent = entered || state.aiConfig?.hasApiKey
      ? "保存后会跨服务重启保留；密钥仍只写入当前项目的 .local 目录。"
      : "已选择持久保存，请先输入 API Key；无需密钥的本地模型可以取消勾选。";
  } else if (entered) {
    hint.textContent = "当前选择“仅本次运行”：关闭或重启服务后，这次输入的 API Key 会消失。";
  } else if (currentStorage === "saved") {
    hint.textContent = "现有密钥已持久保存；取消勾选并保存后，它将只保留到本次服务结束。";
  } else if (currentStorage === "session") {
    hint.textContent = "当前密钥仅存在于本次运行；勾选后保存，才能跨服务重启保留。";
  } else {
    hint.textContent = "未勾选时，API Key 只在当前服务内存中使用，不会写入磁盘。";
  }
}

function confirmKeyStorageChoice(nextConfig) {
  if (nextConfig.rememberKey) return true;
  const newSessionKey = Boolean(nextConfig.apiKey);
  const removesSavedKey = state.aiConfig?.apiKeyStorage === "saved";
  if (!newSessionKey && !removesSavedKey) return true;
  return window.confirm("API Key 将只在本次运行中使用，关闭或重启服务后需要重新输入。确定继续吗？");
}

function configSaveToast(config) {
  if (config.apiKeyStorage === "saved") return "AI 配置和密钥已持久保存";
  if (config.apiKeyStorage === "session") return "AI 配置已保存；密钥仅本次运行有效";
  return "AI 模型配置已保存";
}

async function saveSettings(event) {
  event.preventDefault();
  try {
    const nextConfig = configFromForm();
    if (!confirmKeyStorageChoice(nextConfig)) return;
    const config = await fetchJson("/api/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(nextConfig) });
    updateConfigUI(config);
    updateInitStatus();
    $("#settingsDialog").close();
    showToast(configSaveToast(config));
  } catch (error) {
    $("#settingsStatus").textContent = error.message;
  }
}

async function fetchModels() {
  try {
    const nextConfig = configFromForm();
    if (!confirmKeyStorageChoice(nextConfig)) return;
    $("#settingsStatus").textContent = "正在保存配置并获取模型列表…";
    const config = await fetchJson("/api/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(nextConfig) });
    updateConfigUI(config);
    const payload = await fetchJson("/api/models");
    const storageNote = config.apiKeyStorage === "session" ? " API Key 仅本次运行有效。" : "";
    $("#settingsStatus").textContent = (payload.models.length ? `连接成功。可用模型示例：${payload.models.slice(0, 12).join("、")}` : "连接成功，但接口没有返回模型列表；可以手动填写模型名。") + storageNote;
    renderKeyStorageHint();
  } catch (error) {
    $("#settingsStatus").textContent = error.message;
  }
}

function updateConfigUI(config) {
  state.aiConfig = config;
  const storageSuffix = config.apiKeyStorage === "session" ? " · 密钥仅本次" : "";
  $("#aiModelLabel").textContent = config.baseUrl && config.model ? `${config.name || "自定义"} · ${config.model}${storageSuffix}` : "尚未配置模型";
}

function useQuickAction(mode) {
  state.aiMode = mode;
  const question = state.questions.find((item) => item.id === state.selectedId);
  if (!question) {
    $("#chatInput").value = "请先帮我选择一个适合新手的核心问题，并说明为什么应该先学它。";
  } else if (mode === "hint") {
    $("#chatInput").value = "请只给我一点提示，不要直接公布完整答案。";
  } else if (mode === "explain") {
    $("#chatInput").value = "请把这道题讲给完全没有基础的人听，并给一个具体例子。";
  } else if (mode === "review") {
    const answer = getProgress(question.id).answer;
    $("#chatInput").value = answer ? `这是我的回答，请按评分点评价：\n${answer}` : "请先告诉我一个合格回答应包含哪些部分，但暂时不要给完整答案。";
  } else {
    $("#chatInput").value = "请像面试官一样从这道题开始，每次只追问一个问题。";
  }
  $("#chatInput").focus();
}

async function submitChat(event) {
  event.preventDefault();
  const input = $("#chatInput");
  const content = input.value.trim();
  if (!content) return;
  const question = state.questions.find((item) => item.id === state.selectedId) || null;
  appendChat("user", content);
  state.aiMessages.push({ role: "user", content });
  input.value = "";
  $("#chatStatus").textContent = "思考中…";
  const bubble = appendChat("assistant", "");
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: state.aiMessages.slice(-12), question, mode: state.aiMode })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `请求失败：${response.status}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const chunk = JSON.parse(line);
        if (chunk.delta) {
          fullText += chunk.delta;
          bubble.textContent = fullText;
          $("#chatMessages").scrollTop = $("#chatMessages").scrollHeight;
        }
      }
    }
    state.aiMessages.push({ role: "assistant", content: fullText });
    if (!fullText) bubble.textContent = "模型没有返回文本内容。请检查模型是否兼容 Chat Completions 流式格式。";
  } catch (error) {
    bubble.textContent = `调用失败：${error.message}`;
  } finally {
    $("#chatStatus").textContent = "";
  }
}

function appendChat(role, content) {
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${role}`;
  bubble.textContent = content;
  $("#chatMessages").appendChild(bubble);
  $("#chatMessages").scrollTop = $("#chatMessages").scrollHeight;
  return bubble;
}

function exportProgress() {
  const payload = { version: 3, exportedAt: new Date().toISOString(), progress: state.progress, sessions: state.customSessions };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `interview-trainer-progress-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function importProgress(event) {
  const [file] = event.target.files;
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (!payload.progress || typeof payload.progress !== "object") throw new Error("文件中缺少 progress 数据");
    state.progress = sanitizeProgress(payload.progress);
    if (!saveProgress()) throw new Error("浏览器拒绝保存，请检查存储权限后重试");
    if (Array.isArray(payload.sessions)) {
      state.customSessions = sanitizeCustomSessions(payload.sessions);
      if (!saveCustomSessions()) throw new Error("自定义题单未能写入浏览器");
    }
    renderAll();
    showToast(Array.isArray(payload.sessions) ? "学习进度与自定义题单已导入" : "学习进度已导入");
  } catch (error) {
    showToast(`导入失败：${error.message}`);
  } finally {
    event.target.value = "";
  }
}

// ---------- 更新题库 ----------

function formatCandidateTime(value) {
  if (!value) return "尚未用于分析";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "时间未知";
}

function renderSourceCandidates() {
  const list = $("#sourceCandidateList");
  if (!list) return;
  const existingIds = new Set(state.sourceCandidates.map((candidate) => candidate.id));
  state.selectedCandidateIds = new Set([...state.selectedCandidateIds].filter((id) => existingIds.has(id)));
  const pending = state.sourceCandidates.filter((candidate) => candidate.status === "pending").length;
  const registered = state.sourceCandidates.length - pending;
  $("#sourceCandidateCount").textContent = `${state.sourceCandidates.length} 条 · ${pending} 待分析 · ${registered} 已登记`;
  $("#sourceCandidateDeleteButton").disabled = state.updateRunning || state.selectedCandidateIds.size === 0;
  $("#sourceCandidateAddButton").disabled = state.updateRunning;
  $("#sourceDiscoveryButton").disabled = state.updateRunning;
  if (!state.sourceCandidates.length) {
    list.innerHTML = '<div class="source-candidate-empty">还没有候选链接。搜索到新的面经后，可以先粘贴到这里排队。</div>';
    return;
  }
  list.innerHTML = state.sourceCandidates.map((candidate) => {
    let host = candidate.platformName || "其他网站";
    try { host = new URL(candidate.url).hostname; } catch {}
    const checked = state.selectedCandidateIds.has(candidate.id) ? " checked" : "";
    const statusCopy = candidate.status === "registered" ? "已登记" : "待分析";
    const registeredCopy = candidate.registeredSource ? ` · 已对应：${candidate.registeredSource.title}` : "";
    return `<article class="source-candidate-card"><input type="checkbox" class="source-candidate-check" value="${escapeHtml(candidate.id)}" aria-label="选择 ${escapeHtml(candidate.url)}"${checked} /><div class="source-candidate-copy"><b>${escapeHtml(candidate.platformName || "其他网站")} · ${escapeHtml(host)}</b><a href="${escapeHtml(candidate.url)}" target="_blank" rel="noreferrer">${escapeHtml(candidate.url)}</a><small>加入：${escapeHtml(formatCandidateTime(candidate.addedAt))} · 最近使用：${escapeHtml(formatCandidateTime(candidate.lastUsedAt))}${escapeHtml(registeredCopy)}</small></div><span class="candidate-status ${candidate.status === "registered" ? "registered" : ""}">${statusCopy}</span></article>`;
  }).join("");
}

async function loadSourceCandidates() {
  try {
    const payload = await fetchJson("/api/discovery/candidates");
    state.sourceCandidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    renderSourceCandidates();
    $("#sourceCandidateStatus").textContent = "候选只保存在当前项目的 .local 目录";
  } catch (error) {
    $("#sourceCandidateStatus").textContent = `候选池读取失败：${error.message}`;
  }
}

async function addSourceCandidates() {
  const input = $("#sourceCandidateInput");
  const urls = input.value.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (!urls.length) return showToast("请先粘贴至少一个候选链接");
  $("#sourceCandidateAddButton").disabled = true;
  try {
    const payload = await fetchJson("/api/discovery/candidates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ urls })
    });
    state.sourceCandidates = payload.candidates || [];
    for (const id of payload.addedIds || []) state.selectedCandidateIds.add(id);
    input.value = "";
    renderSourceCandidates();
    $("#sourceCandidateStatus").textContent = `新增 ${payload.added || 0} 条，合并重复 ${payload.duplicates || 0} 条；新候选已勾选`;
    showToast(payload.added ? "候选链接已保存并勾选" : "链接已在候选池中");
  } catch (error) {
    showToast(`保存候选失败：${error.message}`);
  } finally {
    $("#sourceCandidateAddButton").disabled = state.updateRunning;
  }
}

async function discoverSourceCandidates() {
  const button = $("#sourceDiscoveryButton");
  button.disabled = true;
  button.textContent = "正在扫描公开 Sitemap…";
  $("#sourceCandidateStatus").textContent = "正在拉取近期候选并用本地规则筛选；首次运行可能需要几分钟，之后会命中缓存";
  try {
    const payload = await fetchJson("/api/discovery/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: 300, scanLimit: 13500, concurrency: 8 })
    });
    state.sourceCandidates = payload.candidates || [];
    for (const id of payload.addedIds || []) state.selectedCandidateIds.add(id);
    renderSourceCandidates();
    const stats = payload.discovery || {};
    $("#sourceCandidateStatus").textContent = `扫描 ${stats.scanned || 0} 个公开页面，识别 ${stats.accepted || 0} 篇有效面经；新增候选 ${payload.added || 0}，缓存命中 ${stats.cacheHits || 0}`;
    showToast(payload.added ? "近期面经候选已加入并勾选" : "没有新的可用候选");
  } catch (error) {
    $("#sourceCandidateStatus").textContent = `自动发现失败：${error.message}`;
    showToast(`自动发现失败：${error.message}`);
  } finally {
    button.disabled = state.updateRunning;
    button.textContent = "发现近期面经候选";
  }
}

async function deleteSourceCandidates() {
  const ids = [...state.selectedCandidateIds];
  if (!ids.length) return;
  if (!confirm(`确定从本机候选池删除所选 ${ids.length} 条链接吗？这不会删除已经登记的题库来源。`)) return;
  $("#sourceCandidateDeleteButton").disabled = true;
  try {
    const payload = await fetchJson("/api/discovery/candidates", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids })
    });
    state.sourceCandidates = payload.candidates || [];
    state.selectedCandidateIds.clear();
    renderSourceCandidates();
    $("#sourceCandidateStatus").textContent = `已删除 ${payload.removed || 0} 条候选链接`;
    showToast("所选候选已删除");
  } catch (error) {
    showToast(`删除失败：${error.message}`);
    renderSourceCandidates();
  }
}

async function updateInitStatus() {
  try {
    const status = await fetchJson("/api/update/status");
    const ok = Boolean(status.configured);
    const runningElsewhere = Boolean(status.running) && !state.updateRunning;
    const hasPendingDraft = Boolean(status.draftAvailable || state.updateDraft);
    const keyStorageWarning = status.apiKeyStorage === "session" ? " 当前 API Key 仅本次运行有效，服务重启后需重新输入。" : "";
    state.lastUpdateInfo = status.lastUpdate || null;
    $("#updateConfigBanner").classList.toggle("ok", ok);
    $("#updateConfigTitle").textContent = ok ? `已配置模型：${status.model}` : "尚未配置 AI 模型";
    $("#updateConfigSub").textContent = (runningElsewhere ? `有一项更新分析正在运行：${status.completed || 0}/${status.planned || "?"} 已结束，${status.usable || 0} 个有可用结果。` : ok ? "更新题库将使用该模型抓取分析来源、提取概念并生成新题草案。" : "更新题库需要 AI 参与分析；请先配置 Base URL 和模型名称，未配置时功能不可用。") + keyStorageWarning;
    $("#updateRunButton").disabled = !ok || state.updateRunning || runningElsewhere || hasPendingDraft;
    $("#updateCancelButton").hidden = !state.updateRunning && !runningElsewhere;
    $("#updateRunHint").textContent = runningElsewhere ? "同一时间只允许一项更新；可以先取消当前任务。" : hasPendingDraft ? "已有待审阅草案，请先应用或放弃后再开始新的分析。" : ok ? "" : "需要先在 AI 模型设置中配置 Base URL 和模型名称。";
    renderUpdateHistory();
    if (status.draftAvailable && !state.updateDraft && !state.updateRunning && !runningElsewhere) {
      const saved = await fetchJson("/api/update/draft");
      if (saved.draft) {
        renderUpdateReport(saved.draft);
        showToast("已恢复上次尚未应用的更新草案");
      }
    }
    siteCookiesInit();
    loginStatusInit();
    loadSourceCandidates();
  } catch {
    $("#updateConfigTitle").textContent = "无法获取配置状态";
  }
}

async function loginStatusInit() {
  try {
    const status = await fetchJson("/api/login/status");
    state.loginBrowserStatus = status;
    state.loginBrowsers = Array.isArray(status.availableBrowsers) && status.availableBrowsers.length
      ? status.availableBrowsers
      : [{ id: "auto", name: "自动选择（Chrome / Edge）", canCollect: true }];
    const select = $("#loginBrowserSelect");
    select.replaceChildren(...state.loginBrowsers.map((browser) => {
      const option = document.createElement("option");
      option.value = browser.id;
      option.textContent = browser.name;
      return option;
    }));
    const preferred = state.loginBrowsers.some((browser) => browser.id === state.loginBrowserPreference)
      ? state.loginBrowserPreference
      : "auto";
    state.loginBrowserPreference = preferred;
    select.value = preferred;
    $("#loginBrowserStatus").textContent = status.running
      ? `${status.browserName || "登录浏览器"} 运行中（调试端口 ${status.port}）`
      : "登录浏览器未启动";
    renderLoginBrowserCapability();
  } catch {
    $("#loginBrowserCapability").textContent = "无法检测本机浏览器；仍可手动粘贴 Cookie";
  }
}

function renderLoginBrowserCapability() {
  const selected = state.loginBrowsers.find((browser) => browser.id === state.loginBrowserPreference);
  const canCollect = Boolean(selected?.canCollect);
  $("#loginBrowserCapability").textContent = canCollect
    ? "支持自动采集：将使用项目专属资料，不读取你的日常浏览器数据"
    : "仅打开登录页：请登录后手动复制并粘贴 Cookie";
  const activeCanCollect = Boolean(state.loginBrowserStatus?.running && state.loginBrowserStatus?.canCollect !== false);
  $("#collectNowcoderButton").disabled = !activeCanCollect;
  $("#collectXhsButton").disabled = !activeCanCollect;
  $("#loginCloseButton").disabled = !state.loginBrowserStatus?.running;
}

async function loginLaunch(site) {
  try {
    const result = await fetchJson("/api/login/launch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ site, browserId: state.loginBrowserPreference })
    });
    const canCollect = result.canCollect !== false;
    state.loginBrowserStatus = { ...result, canCollect };
    $("#loginBrowserStatus").textContent = result.message || "登录页已打开";
    renderLoginBrowserCapability();
    showToast(canCollect ? `已用 ${result.browserName || "登录浏览器"} 打开，可在登录后自动采集` : "登录页已打开，登录后请手动粘贴 Cookie");
  } catch (error) {
    showToast("打开失败：" + error.message);
  }
}

async function loginCollect(site) {
  try {
    const result = await fetchJson("/api/login/collect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ site })
    });
    renderSiteCookies(result);
    $("#loginBrowserStatus").textContent = result.message || "";
    showToast(result.count ? "登录态已采集" : "未采集到登录态");
  } catch (error) {
    showToast("采集失败：" + error.message);
  }
}

async function loginClose() {
  try {
    const result = await fetchJson("/api/login/close", { method: "POST" });
    state.loginBrowserStatus = result;
    $("#loginBrowserStatus").textContent = result.message || "登录浏览器未启动";
    renderLoginBrowserCapability();
    showToast(result.message || "已关闭登录浏览器");
  } catch (error) {
    showToast("关闭失败：" + error.message);
  }
}

async function siteCookiesInit() {
  try {
    renderSiteCookies(await fetchJson("/api/site-cookies"));
  } catch {
    $("#siteCookieStatus").textContent = "无法获取登录态状态";
  }
}

function renderSiteCookies(status) {
  const label = (name, entry) => entry && entry.hasCookie ? name + "：已保存（" + entry.tail + "）" : name + "：未配置";
  $("#siteCookieStatus").textContent = label("牛客", status.nowcoder) + " · " + label("小红书", status.xiaohongshu);
}

async function saveSiteCookies() {
  try {
    const nowcoder = $("#nowcoderCookieInput").value.trim();
    const xiaohongshu = $("#xhsCookieInput").value.trim();
    const status = await fetchJson("/api/site-cookies", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nowcoder, xiaohongshu })
    });
    renderSiteCookies(status);
    showToast("登录态已保存（只存在本机 .local/）");
  } catch (error) {
    showToast("保存失败：" + error.message);
  }
}

async function clearSiteCookies() {
  try {
    await fetchJson("/api/site-cookies", { method: "DELETE" });
    $("#nowcoderCookieInput").value = "";
    $("#xhsCookieInput").value = "";
    $("#siteCookieStatus").textContent = "牛客：未配置 · 小红书：未配置";
    showToast("已清除站点登录态");
  } catch (error) {
    showToast("清除失败：" + error.message);
  }
}

function renderUpdateHistory() {
  const box = $("#updateHistoryBox");
  if (!box) return;
  const info = state.lastUpdateInfo;
  if (!info) {
    box.innerHTML = '<p class="muted">还没有应用过更新。题库来自 2026-08-28 的调研快照。</p>';
    return;
  }
  if (info.rolledBackAt) {
    box.innerHTML = `<p>最近操作：<b>已撤销更新</b>（${new Date(info.rolledBackAt).toLocaleString()}），题库恢复为 ${info.counts?.total ?? "—"} 题。</p>`;
    return;
  }
  box.innerHTML = `<p>最近更新：<b>${new Date(info.appliedAt).toLocaleString()}</b> · 新增来源 ${info.addedSources ?? "—"} · 既有来源补证据 ${info.patchedSources ?? 0} · 新增概念 ${info.addedConcepts ?? "—"} · 当次应用后 ${info.counts?.total ?? "—"} 题 · 当前版本 ${state.questions.length} 题。</p><button id="updateRollbackButton" class="secondary-button">撤销最近一次更新</button>`;
  $("#updateRollbackButton")?.addEventListener("click", rollbackUpdate);
}

async function runUpdate() {
  if (state.updateRunning) return;
  if (state.updateDraft) return showToast("请先应用或放弃当前待审阅草案");
  state.updateRunning = true;
  renderSourceCandidates();
  $("#updateRunButton").disabled = true;
  $("#updateCancelButton").hidden = false;
  $("#updateProgress").hidden = false;
  $("#updateReport").hidden = true;
  state.updateDraft = null;
  state.updateTotal = 0;
  state.updateDone = 0;
  state.updateSucceeded = 0;
  state.updateFinalizing = false;
  state.updateAbort = new AbortController();
  $("#updateFinalizeButton").hidden = true;
  $("#updateFinalizeButton").disabled = false;
  $("#updateFinalizeButton").textContent = "用已完成结果生成草案";
  $("#updateProgressLog").innerHTML = "";
  $("#updateProgressCount").textContent = "0";
  appendUpdateLog("开始更新分析…", "ok");
  try {
    const autoFetch = $("#updateAutoFetch").checked;
    const manualUrls = $("#updateManualUrls").value.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const manualText = $("#updateManualText").value.trim();
    const response = await fetch("/api/update/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        autoFetch,
        maxAutoSources: Number($("#updateMaxAutoSources").value),
        analysisMode: $("#updateAnalysisMode").value,
        candidateIds: [...state.selectedCandidateIds],
        manualUrls,
        manualTexts: manualText ? [{ label: "手动粘贴文本", text: manualText }] : [],
        perSourceTimeoutMs: Number($("#updatePerSourceTimeout").value) * 1000,
        budgetMs: Number($("#updateBudget").value) * 60_000
      }),
      signal: state.updateAbort.signal
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `请求失败：${response.status}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try { handleUpdateEvent(JSON.parse(line)); } catch {}
      }
    }
  } catch (error) {
    if (error.name === "AbortError") {
      appendUpdateLog("已取消本次分析。", "info");
      showToast("已取消分析");
    } else {
      appendUpdateLog(`失败：${error.message}`, "fail");
      showToast(`更新失败：${error.message}`);
    }
  } finally {
    state.updateRunning = false;
    state.updateAbort = null;
    renderSourceCandidates();
    $("#updateRunButton").disabled = false;
    $("#updateCancelButton").hidden = true;
    $("#updateFinalizeButton").hidden = true;
    updateInitStatus();
  }
}

async function finalizePartialUpdate() {
  if (!state.updateRunning || state.updateSucceeded < 1 || state.updateFinalizing) return;
  const button = $("#updateFinalizeButton");
  state.updateFinalizing = true;
  button.disabled = true;
  button.textContent = "正在收口已完成结果…";
  try {
    const result = await fetchJson("/api/update/finalize-partial", { method: "POST" });
    appendUpdateLog(`准备提前生成草案：保留 ${result.usable} 个可用来源，停止尚未完成的分析。`, "info");
    showToast("正在用已完成结果生成草案");
  } catch (error) {
    state.updateFinalizing = false;
    button.disabled = false;
    button.textContent = "用已完成结果生成草案";
    showToast(`生成部分草案失败：${error.message}`);
  }
}

async function cancelUpdate() {
  const localAbort = state.updateAbort;
  $("#updateCancelButton").disabled = true;
  try {
    const result = await fetchJson("/api/update/cancel", { method: "POST" });
    if (!result.cancelled && localAbort) localAbort.abort();
    showToast(result.cancelled ? "正在停止分析…" : result.message || "当前没有运行中的分析");
  } catch (error) {
    if (localAbort) localAbort.abort();
    showToast(`取消失败：${error.message}`);
  } finally {
    $("#updateCancelButton").disabled = false;
    if (!localAbort) setTimeout(updateInitStatus, 300);
  }
}

function handleUpdateEvent(event) {
  switch (event.phase) {
    case "start":
      state.updateTotal = event.plan.auto.length + event.plan.manualUrls + event.plan.manualTexts;
      state.updateDone = 0;
      $("#updateProgressCount").textContent = "0/" + state.updateTotal;
      appendUpdateLog(`计划：自动来源 ${event.plan.auto.length} 篇、候选/手动链接 ${event.plan.manualUrls} 个、手动文本 ${event.plan.manualTexts} 份；模式 ${event.plan.analysisMode === "scale" ? "大样本增量" : event.plan.analysisMode === "compatible" ? "兼容慢模型" : event.plan.analysisMode === "quality" ? "高质量" : "均衡"}，处理并发 ${event.plan.analysisConcurrency}，AI 批次约 ${event.plan.aiBatchSize || 1} 篇。`, "info");
      break;
    case "batch":
      if (event.status === "circuit-open") {
        appendUpdateLog(`⚠ 弱模型保护已触发：连续 ${event.failures || 3} 个批次不可用，剩余来源自动改用单篇分析。`, "info");
      } else if (event.status === "circuit-bypass") {
        // 熔断后的来源会在单篇分析阶段逐一显示，不重复刷屏。
      } else if (event.status === "pending") appendUpdateLog(`⏳ 批量 AI 分析：${event.sources} 个低置信来源…`, "pending", event.id);
      else {
        clearPendingAnalyze(event.id);
        appendUpdateLog(event.status === "ok" ? `✓ 批量 AI 完成：${event.usable}/${event.sources} 个结果可用（${Math.round((event.durationMs || 0) / 1000)}s）` : `⚠ 批量结果不可用，将只对缺失来源降级单篇分析：${event.error || "返回格式异常"}`, event.status === "ok" ? "ok" : "info");
      }
      break;
    case "fetch":
      if (event.status === "ok") appendUpdateLog(`✓ 抓取 ${event.label}（${event.chars} 字符）`, "ok");
      else appendUpdateLog(`✗ 跳过 ${event.label}：${event.error}`, "fail");
      break;
    case "analyze":
      if (event.status === "pending") {
        appendUpdateLog(`⏳ 分析中：${event.label}…`, "pending", event.label);
      } else if (event.status === "ok") {
        clearPendingAnalyze(event.label);
        state.updateDone += 1;
        if (Number(event.conceptCount) > 0) state.updateSucceeded += 1;
        if (state.updateSucceeded > 0 && !state.updateFinalizing) $("#updateFinalizeButton").hidden = false;
        $("#updateProgressCount").textContent = state.updateDone + "/" + state.updateTotal;
        const method = event.analysisMethod === "deterministic" ? "本地预筛" : event.analysisMethod === "batch-ai" ? "批量 AI" : event.cached ? "缓存命中" : "单篇 AI";
        appendUpdateLog(`✓ 分析 ${event.label}：映射 ${event.conceptCount} 个概念（${method}${event.durationMs ? " · " + Math.round(event.durationMs / 1000) + "s" : ""}）`, "ok");
      } else if (event.status === "skipped-budget") {
        clearPendingAnalyze(event.label);
        state.updateDone += 1;
        $("#updateProgressCount").textContent = state.updateDone + "/" + state.updateTotal;
        appendUpdateLog(`⏭ 跳过 ${event.label}：超过本次总时长预算`, "info");
      } else if (event.status === "skipped-partial") {
        clearPendingAnalyze(event.label);
        state.updateDone += 1;
        appendUpdateLog(`⏹ 已停止未完成来源：${event.label}`, "info");
      } else if (event.status === "empty") {
        clearPendingAnalyze(event.label);
        state.updateDone += 1;
        $("#updateProgressCount").textContent = state.updateDone + "/" + state.updateTotal;
        appendUpdateLog(`○ 分析 ${event.label}：没有可入库的新概念${event.durationMs ? "（耗时 " + Math.round(event.durationMs / 1000) + "s）" : ""}`, "info");
      } else {
        clearPendingAnalyze(event.label);
        state.updateDone += 1;
        $("#updateProgressCount").textContent = state.updateDone + "/" + state.updateTotal;
        appendUpdateLog(`✗ 分析 ${event.label} 失败：${event.error}${event.durationMs ? "（耗时 " + Math.round(event.durationMs / 1000) + "s）" : ""}`, "fail");
      }
      break;
    case "evaluate":
      if (event.status === "ok") appendUpdateLog(`✓ AI 评分复核 ${event.reviewed} 题，调整 ${event.adjusted} 题${event.durationMs ? "（耗时 " + Math.round(event.durationMs / 1000) + "s）" : ""}`, "ok");
      else if (event.status === "fallback") appendUpdateLog(`⚠ AI 评分复核未生效（${event.error || "模型返回不可用"}），保留公式基线分${event.durationMs ? "（耗时 " + Math.round(event.durationMs / 1000) + "s）" : ""}`, "info");
      else if (event.status === "budget-skip") appendUpdateLog("⚠ 剩余时间不足，跳过 AI 评分复核，保留公式基线分", "info");
      else if (event.status === "partial-skip") appendUpdateLog("○ 部分收口模式跳过 AI 评分复核，直接使用本地公式", "info");
      else if (event.status === "mode-skip") appendUpdateLog("○ 兼容慢模型模式跳过 AI 评分复核，直接使用本地公式", "info");
      else appendUpdateLog(`○ 本次无需 AI 评分复核`, "info");
      break;
    case "partial":
      appendUpdateLog(`正在用已完成结果生成草案：成功 ${event.completed}/${event.planned} 个来源。`, "ok");
      break;
    case "draft":
      state.updateDraft = event.draft;
      $("#updateFinalizeButton").hidden = true;
      renderUpdateReport(event.draft);
      appendUpdateLog("分析完成，请在下方审阅更新报告。", "ok");
      break;
    case "cancelled":
      appendUpdateLog("已取消本次分析；后台任务已停止。", "info");
      showToast("已取消分析");
      break;
    case "done":
      appendUpdateLog("分析结束。", "info");
      break;
    case "error":
      appendUpdateLog(`错误：${event.error}`, "fail");
      break;
  }
}

function clearPendingAnalyze(label) {
  $$(".update-log-item.pending").forEach((item) => { if (item.dataset.analyzeLabel === label) item.remove(); });
}

function appendUpdateLog(text, status, label) {
  const log = $("#updateProgressLog");
  const item = document.createElement("li");
  item.className = `update-log-item ${status || ""}`;
  if (label) item.dataset.analyzeLabel = label;
  item.textContent = text;
  log.appendChild(item);
  log.scrollTop = log.scrollHeight;
  if (state.updateTotal) {
    const pending = document.querySelectorAll("#updateProgressLog .update-log-item.pending").length;
    const shown = state.updateDone >= state.updateTotal ? state.updateTotal : state.updateDone + pending;
    $("#updateProgressCount").textContent = shown + "/" + state.updateTotal;
  }
}

function renderUpdateReport(draft) {
  state.updateDraft = draft;
  $("#updateReport").hidden = false;
  const failCount = (draft.sourceResults || []).filter((result) => result.status === "fail").length;
  const emptyCount = (draft.sourceResults || []).filter((result) => result.status === "empty").length;
  const okCount = (draft.sourceResults || []).filter((result) => result.status === "ok").length;
  const emptyBanner = $("#updateEmptyBanner");
  if (draft.partial?.finalized) {
    emptyBanner.hidden = false;
    emptyBanner.innerHTML = `<b>这是提前收口的部分更新报告。</b><span>计划 ${draft.partial.plannedSources} 个来源，已保留 ${draft.partial.completedSources} 个成功结果，其余 ${draft.partial.skippedSources} 个可在下次更新时依靠本地缓存继续分析。</span>`;
  } else if (!draft.newSources.length && !draft.newConcepts.length) {
    emptyBanner.hidden = false;
    emptyBanner.innerHTML = `<b>本次没有产生新的来源或题目。</b><span>有产出 ${okCount} 个来源、无新概念 ${emptyCount} 个、失败 ${failCount} 个。已存在的考点会自动并入现有题目（见下方「旧题分数重算」）；若失败较多，通常是模型服务超时或波动，可减少来源数量后重试。</span>`;
  } else {
    emptyBanner.hidden = true;
  }
  const performance = draft.performance || {};
  const capacity = draft.capacityPolicy || {};
  const evidenceSummary = performance.evidenceAccepted != null
    ? ` · 证据校验 ${performance.evidenceAccepted} 通过/${performance.evidenceRejected || 0} 拦截${performance.semanticRechecks ? `（定向复核 ${performance.semanticRechecks}）` : ""}`
    : "";
  const circuitSummary = performance.batchCircuitTrips ? ` · 已触发弱模型熔断，${performance.batchBypassedSources || 0} 个来源改走单篇` : "";
  $("#updateReportSummary").textContent = `样本 ${performance.inputSources ?? draft.sourceResults?.length ?? 0} · AI 调用 ${performance.calls ?? "—"}（节省 ${performance.aiCallsSaved ?? "—"}）${evidenceSummary}${circuitSummary} · 新来源 ${draft.newSources.length} · 新概念晋级 ${draft.newConcepts.length}（+${draft.newConcepts.length * 5} 题）· 观察池 ${draft.conceptWatchlist?.length ?? 0} · 容量 ${capacity.beforeQuestions ?? "—"}/${capacity.targetQuestions ?? 1000} · 旧题分数变化 ${draft.rescorePreview.changed}`;
  $("#updateNewSources").innerHTML = draft.newSources.length
    ? draft.newSources.map((source) => `<label class="check-card"><input type="checkbox" class="update-source-check" value="${escapeHtml(source.id)}" checked /><span><b>${escapeHtml(source.shortTitle || source.title)}</b><small>${escapeHtml(source.title)} · ${SOURCE_TYPE_LABELS[source.type] || "公开资料"}${source.publishedAt ? ` · ${escapeHtml(source.publishedAt)}` : ""}${source.company ? ` · ${escapeHtml(source.company)}` : ""} · ${source.collection?.frequencyEligible ? "参与趋势" : "不计近期频次"}</small>${source.notes ? `<small class="muted">${escapeHtml(source.notes)}</small>` : ""}${(source.qualityWarnings || []).length ? `<ul class="source-warning-list">${source.qualityWarnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>` : ""}</span></label>`).join("")
    : '<p class="muted">本次没有新增来源。</p>';
  const refreshes = draft.sourceRefreshes || [];
  $("#updateSourceRefreshes").innerHTML = refreshes.length ? refreshes.map((refresh) => {
    const source = state.sourceMap.get(refresh.sourceId);
    const engagement = refresh.engagement ? Object.entries({ views: "浏览", likes: "点赞", favorites: "收藏", comments: "评论" }).filter(([key]) => Number.isInteger(refresh.engagement[key])).map(([key, label]) => `${label} ${refresh.engagement[key]}`).join(" · ") : "关注度未知";
    return `<article class="source-refresh-card"><div><b>${escapeHtml(source?.shortTitle || source?.title || refresh.sourceId)}</b><small>${refresh.collection?.frequencyEligible ? "继续参与趋势统计" : "不计近期频次"} · ${escapeHtml(refresh.collection?.capturedAt?.slice(0, 10) || "复查时间未知")} · ${escapeHtml(engagement || "关注度未知")}</small></div>${(refresh.qualityWarnings || []).length ? `<ul class="source-warning-list">${refresh.qualityWarnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>` : '<span class="quality-ok">未发现新的来源质量警告</span>'}</article>`;
  }).join("") : '<p class="muted">本次没有复查既有来源。</p>';
  const questionByConcept = new Map();
  for (const question of draft.newConceptQuestions || []) {
    if (!questionByConcept.has(question.concept)) questionByConcept.set(question.concept, []);
    questionByConcept.get(question.concept).push(question);
  }
  $("#updateNewConcepts").innerHTML = draft.newConcepts.length
    ? draft.newConcepts.map((concept) => {
        const questions = questionByConcept.get(concept.name) || [];
        const tierLabelOf = (tier) => ({ core: "核心", high: "高频", extended: "扩展" })[tier] || tier;
        return `<label class="check-card concept-card"><input type="checkbox" class="update-concept-check" value="${escapeHtml(concept.name)}" checked /><span><b>${escapeHtml(concept.name)}</b><small>${escapeHtml(concept.category)}${concept.topicGroup ? ` · ${escapeHtml(concept.topicGroup)}` : ""} · ${concept.track === "agent" ? "AI / Agent" : "Java 后端"} · 优先级 ${concept.priority}/5 · 来源：${escapeHtml(concept.originSource || "")}</small>${(concept.learningHints || []).length ? `<small>学习位置：${concept.learningHints.map((hint) => hint.site + " · " + hint.title).join("；")}</small>` : ""}<ol>${questions.map((question) => `<li><em>${tierLabelOf(question.tier)}</em>${escapeHtml(question.title)}${question.adjusted ? `<i class="ai-badge" title="${escapeHtml(question.note)}">AI ${question.importance}</i>` : ""}</li>`).join("")}</ol></span></label>`;
      }).join("")
    : '<p class="muted">本次没有新增概念。</p>';
  const watchlist = draft.conceptWatchlist || [];
  $("#updateConceptWatchlist").innerHTML = watchlist.length ? watchlist.slice(0, 80).map((concept) => `<article class="source-refresh-card"><div><b>${escapeHtml(concept.name)}</b><small>${escapeHtml(concept.category || "待分类")} · ${concept.promotion?.recentSources ?? 0} 个近期独立样本 · ${concept.promotion?.companyCount ?? 0} 家明确公司 · ${concept.promotion?.platformCount ?? 0} 个平台</small></div><span class="quality-ok">${escapeHtml(concept.promotion?.reason || "继续观察，不生成题目")}</span></article>`).join("") : '<p class="muted">当前没有待观察的新概念。</p>';
  const rows = draft.rescorePreview.affected || [];
  $("#updateRescore").innerHTML = rows.length
    ? `<table class="rescore-table"><thead><tr><th>题目</th><th>重要度</th><th>层级</th><th>证据</th><th>加权支持</th><th>AI 复核</th></tr></thead><tbody>${rows.map((row) => {
        const arrow = row.final.importance > row.before.importance ? " ▲" : row.final.importance < row.before.importance ? " ▼" : "";
        const scoreCell = row.adjusted
          ? `${row.before.importance} → ${row.formula.importance} → <b>${row.final.importance}</b>`
          : `${row.before.importance} → <b>${row.final.importance}</b>${arrow}`;
        const evidenceLabel = { strong: "强信号", medium: "多来源", foundation: "基础" }[row.before.evidence] || row.before.evidence;
        const evidenceLabelAfter = { strong: "强信号", medium: "多来源", foundation: "基础" }[row.formula.evidence] || row.formula.evidence;
        const aiCell = row.adjusted
          ? `<span class="ai-badge">AI ${row.final.importance > row.formula.importance ? "+" : ""}${row.final.importance - row.formula.importance}</span> ${escapeHtml(row.note)}`
          : "—";
        return `<tr><td>${escapeHtml(row.title)}</td><td>${scoreCell}</td><td>${tierLabel(row.before.tier)} → ${tierLabel(row.final.tier)}</td><td>${evidenceLabel} → ${evidenceLabelAfter}</td><td>${row.before.weightedSupport} → ${row.formula.weightedSupport}</td><td class="ai-cell">${aiCell}</td></tr>`;
      }).join("")}</tbody></table>${draft.rescorePreview.changed > rows.length ? `<p class="muted">仅显示前 ${rows.length} 条，共 ${draft.rescorePreview.changed} 条。</p>` : ""}`
    : '<p class="muted">已有题目分数没有变化。</p>';
}

async function applyUpdate() {
  if (!state.updateDraft) return;
  const applyButton = $("#updateApplyButton");
  if (applyButton.disabled) return;
  const selectedSourceIds = $$(".update-source-check", $("#updateNewSources")).filter((input) => input.checked).map((input) => input.value);
  const selectedConceptNames = $$(".update-concept-check", $("#updateNewConcepts")).filter((input) => input.checked).map((input) => input.value);
  if (!selectedSourceIds.length && !selectedConceptNames.length && !(state.updateDraft.existingSourcePatches || []).length && !(state.updateDraft.sourceRefreshes || []).length) return showToast("没有选择任何更新内容");
  applyButton.disabled = true;
  applyButton.textContent = "正在应用并校验…";
  try {
    const payload = await fetchJson("/api/update/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selectedSourceIds, selectedConceptNames })
    });
    showToast(`更新已应用：题库现共 ${payload.counts.total} 题`);
    state.updateDraft = null;
    location.reload();
  } catch (error) {
    showToast(`应用失败：${error.message}`);
    applyButton.disabled = false;
    applyButton.textContent = "应用所选更新";
  }
}

async function discardUpdate() {
  try {
    await fetchJson("/api/update/discard", { method: "POST" });
    state.updateDraft = null;
    $("#updateReport").hidden = true;
    await updateInitStatus();
    showToast("已放弃本次分析");
  } catch (error) {
    showToast(`放弃草案失败：${error.message}`);
  }
}

function rollbackUpdate() {
  const button = $("#updateRollbackButton");
  if (!button) return;
  if (button.dataset.armed !== "1") {
    button.dataset.armed = "1";
    button.textContent = "再点一次确认撤销";
    setTimeout(() => { if (button.isConnected) { button.dataset.armed = "0"; button.textContent = "撤销最近一次更新"; } }, 3000);
    return;
  }
  button.dataset.armed = "0";
  button.disabled = true;
  fetchJson("/api/update/rollback", { method: "POST" })
    .then((payload) => { showToast(`已恢复：题库 ${payload.counts.total} 题`); location.reload(); })
    .catch((error) => { button.disabled = false; showToast(`撤销失败：${error.message}`); });
}

function tierLabel(tier) {
  return ({ core: "核心必会", high: "高频主线", extended: "完整备战" })[tier] || tier;
}

function difficultyLabel(level) {
  return ({ 1: "入门", 2: "基础", 3: "进阶", 4: "困难", 5: "深入" })[level] || "基础";
}

function ratingLabel(level) {
  return ["不会", "眼熟", "关键词", "能回答", "能追问"][level] || "";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

let toastTimer;
function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}
