/* Riak · causal prediction engine, frontend logic. */

/* ------------------------------------------------------------------ i18n */
const I18N = {
  en: {
    tagline: "Causal prediction engine · “if this, then what?”",
    projects: "Projects", newProject: "+ New scenario", samples: "Try a sample", more: "More",
    buildTitle: "Describe the scenario",
    buildHint: "Paste a scenario, a decision, or a “what if” question. Riak maps out the web of consequences · what this causes, and what those cause next.",
    seedPh: "Paste your scenario here… (e.g. “the government raises fuel prices”, “a city bans private cars”)",
    importUrlPh: "…or paste a link to an article", importFetch: "Fetch", importFile: "Upload file",
    importing: "Fetching page…", importDone: "Imported — review and edit below.", importNeedUrl: "Paste a URL first.",
    importTooBig: "File too large (max 100 KB).", importFail: "Could not read that file.",
    namePh: "Scenario name",
    build: "Map the consequences",
    setupTitle: "Add interventions",
    interventions: "Interventions (“and if we do this…”)",
    interventionsHint: "Inject a new event to see how it shifts the outcome · e.g. “the government announces a subsidy”, “a scandal breaks”.",
    addIntervention: "+ Add intervention", run: "Run prediction",
    tabNetwork: "Network", tabReport: "Report", tabInteract: "Chat", tabMath: "Math",
    events: "Events", prev: "Previous", next: "Next", replay: "Replay",
    building: "Mapping consequences…", built: "Web built · add interventions below.",
    needSeed: "Please paste a scenario first.",
    running: "Running prediction…", done: "Prediction complete.",
    noProject: "Build a scenario first.", loading: "Loading…", llmOff: "LLM offline (rule-based)", llmOn: "LLM connected",
    outcome: "Most likely outcome", confidence: "confidence", keyFindings: "Key outcomes",
    summary: "Prediction", chain: "Most likely path", outcomes: "Top outcomes", web: "Causal web",
    generatedBy: "Consequences reasoned by", ruleBased: "rule-based engine", llm: "language model",
    networkHint: "Each node is an event/consequence · a line means “causes” · drag to pan · scroll to zoom · click to inspect · double-click to chat with a node · ⛓ connects two nodes",
    explainHint: "Pick an event to discuss it with Riak · it can grow the web around it, and you can edit any node.",
    chatPlaceholder: "Ask about this event, or propose a “what if”…",
    send: "Send", you: "You", aiDev: "Riak", rename: "Rename", delete: "Delete",
    connect: "Connect", addConsequence: "Add consequence", connectModeTitle: "Connect mode",
    disconnect: "Disconnect", renamed: "Node renamed.", deleted: "Node deleted.",
    connected: "Nodes linked.", disconnected: "Link removed.", added: "Node added.",
    thinking: "thinking…", editNodePh: "New name for this event", addConsPh: "A new consequence of this event…",
    settings: "Settings", language: "Language", theme: "Theme", reasoningLevel: "Reasoning level",
    donate: "Donate",
    llmSettings: "LLM provider settings", llmSettingsHint: "Connect Riak to any OpenAI-compatible provider · DeepSeek, OpenAI, Qwen, Ollama, or a custom endpoint. Leave empty to stay in offline (rule-based) mode.", llmTest: "Test connection", llmSave: "Save", llmTestOk: "Connection OK", llmTestFail: "Connection failed", llmSaved: "Saved · provider configured",
    undo: "Undo", redo: "Redo",
    compareScenarios: "Compare scenarios", addScenario: "+ Add scenario", runComparison: "Run comparison",
    turbo: "Turbo",
    comparing: "Running comparison…", compareDone: "Comparison complete.", compareResults: "Scenario comparison",
    scenarioDefault: "Scenario {n}",
    timelineTitle: "Most likely timeline", dayN: "day {n}",
    ensembleLine: "Confidence {mean}% · range {lo}%–{hi}% ({runs} runs) · chain stability {stab}%",
    feedbackLoopWarn: "⚠ Feedback loop detected — effects may reinforce each other",
    interventionPh: "What new event happens?", removeTitle: "Remove",
    searchPh: "Search events…", sensTitle: "Sensitivity sweep · how the prediction responds to this link",
    sensRunning: "sweeping…",
  },
  id: {
    tagline: "Mesin prediksi sebab-akibat · “kalau ini, terus apa?”",
    projects: "Proyek", newProject: "+ Skenario baru", samples: "Coba contoh", more: "Lainnya",
    buildTitle: "Jelaskan skenarionya",
    buildHint: "Tempel skenario, keputusan, atau pertanyaan “bagaimana jika”. Riak memetakan jaring konsekuensinya · apa yang ditimbulkannya, dan apa yang ditimbulkan setelahnya.",
    seedPh: "Tempel skenario di sini… (mis. “pemerintah menaikkan harga BBM”, “kota melarang mobil pribadi”)",
    importUrlPh: "…atau tempel link artikel", importFetch: "Ambil", importFile: "Unggah file",
    importing: "Mengambil halaman…", importDone: "Berhasil diambil — periksa dan edit di bawah.", importNeedUrl: "Tempel URL dulu.",
    importTooBig: "File terlalu besar (maks 100 KB).", importFail: "File tidak bisa dibaca.",
    namePh: "Nama skenario",
    build: "Petakan konsekuensinya",
    setupTitle: "Tambahkan intervensi",
    interventions: "Intervensi (“dan kalau kita lakukan ini…”)",
    interventionsHint: "Suntikkan kejadian baru untuk melihat pergeseran hasilnya · mis. “pemerintah mengumumkan subsidi”, “skandal mencuat”.",
    addIntervention: "+ Tambah intervensi", run: "Jalankan prediksi",
    tabNetwork: "Jaringan", tabReport: "Laporan", tabInteract: "Diskusi", tabMath: "Derivasi",
    events: "Peristiwa", prev: "Sebelumnya", next: "Berikutnya", replay: "Ulangi",
    building: "Memetakan konsekuensi…", built: "Jaring terbentuk · tambahkan intervensi di bawah.",
    needSeed: "Tempel skenario dulu.",
    running: "Menjalankan prediksi…", done: "Prediksi selesai.",
    noProject: "Bangun skenario dulu.", loading: "Memuat…", llmOff: "LLM offline (berbasis aturan)", llmOn: "LLM terhubung",
    outcome: "Hasil paling mungkin", confidence: "keyakinan", keyFindings: "Hasil utama",
    summary: "Prediksi", chain: "Jalur paling mungkin", outcomes: "Hasil teratas", web: "Jaring sebab-akibat",
    generatedBy: "Konsekuensi dinalar oleh", ruleBased: "mesin berbasis aturan", llm: "model bahasa",
    networkHint: "Setiap node = kejadian/konsekuensi · garis berarti “menyebabkan” · seret untuk geser · scroll untuk zoom · klik untuk lihat · klik ganda untuk diskusi · ⛓ menghubungkan dua node",
    explainHint: "Pilih sebuah peristiwa untuk mendiskusikannya dengan Riak · ia bisa mengembangkan jaring di sekitarnya, dan kamu bisa mengedit node apa pun.",
    chatPlaceholder: "Tanyakan tentang peristiwa ini, atau ajukan “bagaimana jika”…",
    send: "Kirim", you: "Kamu", aiDev: "Riak", rename: "Ganti nama", delete: "Hapus",
    connect: "Hubungkan", addConsequence: "Tambah konsekuensi", connectModeTitle: "Mode hubung",
    disconnect: "Putuskan", renamed: "Node diganti nama.", deleted: "Node dihapus.",
    connected: "Node terhubung.", disconnected: "Kaitan dihapus.", added: "Node ditambahkan.",
    thinking: "berpikir…", editNodePh: "Nama baru untuk peristiwa ini", addConsPh: "Konsekuensi baru dari peristiwa ini…",
    settings: "Pengaturan", language: "Bahasa", theme: "Tema", reasoningLevel: "Level reasoning",
    donate: "Dukung",
    llmSettings: "Pengaturan provider LLM", llmSettingsHint: "Hubungkan Riak ke provider OpenAI-compatible apa pun · DeepSeek, OpenAI, Qwen, Ollama, atau endpoint custom. Kosongkan untuk tetap mode offline (berbasis aturan).", llmTest: "Tes koneksi", llmSave: "Simpan", llmTestOk: "Koneksi OK", llmTestFail: "Koneksi gagal", llmSaved: "Tersimpan · provider terkonfigurasi",
    undo: "Urungkan", redo: "Lakukan lagi",
    compareScenarios: "Bandingkan skenario", addScenario: "+ Tambah skenario", runComparison: "Jalankan perbandingan",
    turbo: "Turbo",
    comparing: "Menjalankan perbandingan…", compareDone: "Perbandingan selesai.", compareResults: "Perbandingan skenario",
    scenarioDefault: "Skenario {n}",
    timelineTitle: "Linimasa paling mungkin", dayN: "hari {n}",
    ensembleLine: "Keyakinan {mean}% · rentang {lo}%–{hi}% ({runs} run) · stabilitas jalur {stab}%",
    feedbackLoopWarn: "⚠ Umpan balik terdeteksi — efek bisa saling memperkuat",
    interventionPh: "Kejadian baru apa yang terjadi?", removeTitle: "Hapus",
    searchPh: "Cari peristiwa…", sensTitle: "Sweep sensitivitas · respons prediksi terhadap kaitan ini",
    sensRunning: "menyapu…",
  },
  zh: {
    tagline: "因果预测引擎 · “如果这样，会怎样？”",
    projects: "项目", newProject: "+ 新场景", samples: "试试示例", more: "更多",
    buildTitle: "描述场景",
    buildHint: "粘贴场景、决策或“如果”问题。Riak 会绘制出后果网络。",
    seedPh: "在此粘贴场景…",
    importUrlPh: "…或粘贴文章链接", importFetch: "抓取", importFile: "上传文件",
    importing: "正在抓取页面…", importDone: "已导入——请在下方检查并编辑。", importNeedUrl: "请先粘贴链接。",
    importTooBig: "文件过大（最大 100 KB）。", importFail: "无法读取该文件。",
    namePh: "场景名称",
    build: "绘制后果", setupTitle: "添加干预",
    interventions: "干预（“如果我们这样做……”）",
    interventionsHint: "注入新事件，看看结果如何改变。",
    addIntervention: "+ 添加干预", run: "运行预测",
    tabNetwork: "网络", tabReport: "报告", tabInteract: "讨论", tabMath: "数学",
    events: "事件", prev: "上一步", next: "下一步", replay: "重播",
    building: "正在绘制后果…", built: "网络已构建。", needSeed: "请先粘贴场景。",
    running: "运行预测中…", done: "预测完成。",
    noProject: "请先构建场景。", loading: "加载中…", llmOff: "LLM 离线（基于规则）", llmOn: "LLM 已连接",
    outcome: "最可能结果", confidence: "置信度", keyFindings: "主要结果",
    summary: "预测", chain: "最可能路径", outcomes: "首要结果", web: "因果网络",
    generatedBy: "推理方式", ruleBased: "规则引擎", llm: "语言模型",
    networkHint: "每个节点 = 事件/后果 · 连线表示“导致” · 拖动平移 · 滚轮缩放 · 点击查看 · 双击讨论 · ⛓ 连接两个节点",
    explainHint: "选择事件与 Riak 讨论·它可以在其周围扩展网络，你也可以编辑任意节点。",
    chatPlaceholder: "询问此事件，或提出“如果”……",
    send: "发送", you: "你", aiDev: "Riak", rename: "重命名", delete: "删除",
    connect: "连接", addConsequence: "添加后果", connectModeTitle: "连接模式",
    disconnect: "断开", renamed: "节点已重命名。", deleted: "节点已删除。",
    connected: "节点已连接。", disconnected: "连接已移除。", added: "节点已添加。",
    thinking: "思考中…", editNodePh: "此事件的新名称", addConsPh: "此事件的新后果……",
    settings: "设置", language: "语言", theme: "主题", reasoningLevel: "推理等级",
    donate: "支持",
    llmSettings: "LLM 提供商设置", llmSettingsHint: "将 Riak 连接到任何 OpenAI 兼容提供商。留空则保持离线（基于规则）模式。", llmTest: "测试连接", llmSave: "保存", llmTestOk: "连接成功", llmTestFail: "连接失败", llmSaved: "已保存",
    undo: "撤销", redo: "重做",
    compareScenarios: "对比场景", addScenario: "+ 添加场景", runComparison: "运行对比",
    turbo: "极速",
    comparing: "正在运行对比…", compareDone: "对比完成。", compareResults: "场景对比",
    scenarioDefault: "场景 {n}",
    timelineTitle: "最可能时间线", dayN: "第 {n} 天",
    ensembleLine: "置信度 {mean}% · 区间 {lo}%–{hi}%（{runs} 次运行）· 链稳定性 {stab}%",
    feedbackLoopWarn: "⚠ 检测到反馈回路——效应可能相互强化",
    interventionPh: "会发生什么新事件？", removeTitle: "删除",
    searchPh: "搜索事件…", sensTitle: "敏感性扫描 · 预测对该关联的响应",
    sensRunning: "扫描中…",
  },
};

let LANG = "en";
function t(key) { return (I18N[LANG] && I18N[LANG][key]) || I18N.en[key] || key; }
function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.getAttribute("data-i18n")); });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.placeholder = t(el.getAttribute("data-i18n-ph")); });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = t(el.getAttribute("data-i18n-title")); });
  syncNetworkLabels();
}

const NETWORK_LABELS = {
  en: { level: "level", links: "links", likelihood: "likelihood", start: "start", intervention: "intervention", consequence: "consequence", pos: "positive", neg: "negative", neutral: "neutral", causedBy: "caused by", leadsTo: "leads to", dblClick: "double-click to chat", connectModeHint: "connect mode · click two nodes to link them", connectPick: "now click a second node" },
  id: { level: "tingkat", links: "kaitan", likelihood: "kemungkinan", start: "awal", intervention: "intervensi", consequence: "konsekuensi", pos: "positif", neg: "negatif", neutral: "netral", causedBy: "disebabkan oleh", leadsTo: "berujung pada", dblClick: "klik ganda untuk diskusi", connectModeHint: "mode hubung · klik dua node untuk menghubungkannya", connectPick: "sekarang klik node kedua" },
  zh: { level: "层", links: "链接", likelihood: "可能性", start: "起点", intervention: "干预", consequence: "后果", pos: "正面", neg: "负面", neutral: "中性", causedBy: "起因", leadsTo: "导致", dblClick: "双击讨论", connectModeHint: "连接模式 · 点击两个节点连接它们", connectPick: "现在点击第二个节点" },
};
function nl(key) { return (NETWORK_LABELS[LANG] && NETWORK_LABELS[LANG][key]) || NETWORK_LABELS.en[key] || key; }
function syncNetworkLabels() { window.NETWORK_LABELS = NETWORK_LABELS[LANG] || NETWORK_LABELS.en; }

/* ------------------------------------------------------------------ utils */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function toast(msg, isErr) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  el.style.borderColor = isErr ? "var(--red)" : "var(--border)";
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add("hidden"), 3200);
}

/* ---- live processing animation (driven by real trajectory events) ----
   No fake percentages: three pulsing dots + the actual step the engine is on,
   streamed from the trajectory feed. Crossfades whenever the step changes. */
const _procSteps = {};   // status-element id -> step line element

function setStatus(id, msg, kind) {
  const el = $("#" + id);
  el.className = "status " + (kind || "");
  el.innerHTML = "";
  delete _procSteps[id];
  if (kind === "loading") {
    const wrap = document.createElement("span");
    wrap.className = "proc";
    const orb = document.createElement("span");
    orb.className = "proc-orb";
    orb.innerHTML = "<i></i><i></i><i></i>";
    const m = document.createElement("span");
    m.className = "proc-msg";
    m.textContent = msg;
    const step = document.createElement("span");
    step.className = "proc-step";
    wrap.appendChild(orb);
    wrap.appendChild(m);
    wrap.appendChild(step);
    el.appendChild(wrap);
    _procSteps[id] = step;
    // show the latest trajectory step if a job is already streaming
    if (_lastTrajStep) _paintProcStep(step, _lastTrajStep);
  } else {
    el.appendChild(document.createTextNode(msg));
  }
}

/* latest trajectory event, humanised for the processing widget */
let _lastTrajStep = "";

function _procText(ev) {
  const d = (ev.detail || "").trim();
  if (!d) return "";
  const short = d.length > 72 ? d.slice(0, 71) + "…" : d;
  if (ev.kind === "llm") return "🧠 " + short;
  if (ev.kind === "llm_done") return "🧠 ✓ " + short;
  if (ev.kind === "phase") return "⚙ " + short;
  if (ev.kind === "error" || ev.ok === false) return "⚠ " + short;
  return short;
}

function _paintProcStep(stepEl, text) {
  if (stepEl.textContent === text) return;
  stepEl.textContent = text;
  stepEl.classList.remove("swap");
  void stepEl.offsetWidth;   // restart the crossfade animation
  stepEl.classList.add("swap");
}

function _broadcastProcStep(ev) {
  const text = _procText(ev);
  if (!text) return;
  _lastTrajStep = text;
  Object.values(_procSteps).forEach((el) => _paintProcStep(el, text));
}

async function api(path, body) {
  const opts = { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  let data;
  try { data = await r.json(); } catch { data = {}; }
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}

/* ---- async jobs: POST with async:true, then poll /api/jobs/<id> ---- */
async function apiAsync(path, body, onPartial) {
  const start = await api(path, Object.assign({}, body, { async: true }));
  if (!start || !start.job_id) return start; // server ignored async: sync response
  for (;;) {
    await new Promise((res) => setTimeout(res, 1000));
    const st = await api("/api/jobs/" + encodeURIComponent(start.job_id));
    // live partial-web snapshots (project builds): let the canvas grow wave by wave
    if (st.partial && onPartial) onPartial(st.partial);
    if (st.status === "done") return st.result;
    if (st.status === "error") throw new Error(st.error || "job failed");
  }
}

function download(filename, text) {
  const blob = new Blob([text], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------------------------------------------ state */
const state = {
  projects: [],
  currentProject: null,
  web: null, prediction: null, report: null,
  interventions: [],
  compare: { scenarios: [] },
  nodeQuery: "",
  selectedNodeId: null,
  trajTimer: null, trajJob: null, trajSeen: 0,
};

const network = new NetworkRenderer($("#network-canvas"));

/* ------------------------------------------------------------------ theme */
const THEME_KEY = "riak_theme";
function applyTheme(choice) {
  const resolved = choice === "auto"
    ? (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : choice;
  document.documentElement.dataset.theme = resolved;
  Object.assign(window.PALETTE, resolved === "dark" ? window.PALETTE_DARK : window.PALETTE_LIGHT);
  if (state.web) { renderLegend(); network.render(); }
  if (state.prediction && window.MathViz) window.MathViz.render(state.web, state.prediction, LANG);
  try { localStorage.setItem(THEME_KEY, choice); } catch (e) {}
}

/* ------------------------------------------------------------------ init */
async function init() {
  applyI18n();
  $("#lang").addEventListener("change", (e) => { LANG = e.target.value; applyI18n(); if (state.web) renderMathViz(); });
  const themeSel = $("#theme");
  let savedTheme = "auto";
  try { savedTheme = localStorage.getItem(THEME_KEY) || "auto"; } catch (e) {}
  themeSel.value = ["auto", "light", "dark"].includes(savedTheme) ? savedTheme : "auto";
  themeSel.addEventListener("change", (e) => applyTheme(e.target.value));
  applyTheme(savedTheme);
  bindEvents();
  try {
    await refreshLlmBadge();
    await refreshProjects();
  } catch (e) { toast(e.message, true); }
}

/* ---------------------------------------------------------------- llm settings */
const PROVIDERS = {
  custom:   { base: "", model: "", auth: "bearer" },
  deepseek: { base: "https://api.deepseek.com/v1", model: "deepseek-chat", auth: "bearer" },
  openai:   { base: "https://api.openai.com/v1", model: "gpt-4o-mini", auth: "bearer" },
  qwen:     { base: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", auth: "bearer" },
  ollama:   { base: "http://localhost:11434/v1", model: "llama3.1", auth: "none" },
  lmstudio: { base: "http://localhost:1234/v1", model: "local-model", auth: "none" },
};

async function refreshLlmBadge() {
  let cfg;
  try { cfg = await api("/api/llm-config"); } catch { return; }
  const badge = $("#llm-badge");
  if (cfg.configured) {
    badge.textContent = "LLM · " + (cfg.model || "configured");
    badge.className = "badge badge-on";
  } else {
    badge.textContent = t("llmOff");
    badge.className = "badge badge-off";
  }
  $("#llm-base").value = cfg.base_url || "";
  $("#llm-model").value = cfg.model || "";
  $("#llm-key").value = cfg.api_key || "";
  $("#llm-endpoint").value = cfg.endpoint || "/chat/completions";
  $("#llm-auth").value = cfg.auth_type || "bearer";
  $("#llm-reasoning").value = cfg.reasoning_level || "";
}

function openSettings() { $("#settings-modal").classList.remove("hidden"); }
function closeSettings() { $("#settings-modal").classList.add("hidden"); }

function applyProviderPreset() {
  const p = PROVIDERS[$("#llm-provider").value];
  if (!p) return;
  $("#llm-base").value = p.base;
  $("#llm-model").value = p.model;
  $("#llm-auth").value = p.auth;
  if (p.auth === "none") $("#llm-key").value = "";
}

async function saveLlm() {
  const body = {
    base_url: $("#llm-base").value.trim(),
    model: $("#llm-model").value.trim(),
    endpoint: $("#llm-endpoint").value.trim(),
    auth_type: $("#llm-auth").value,
    reasoning_level: $("#llm-reasoning").value,
    header_name: "x-api-key",
    api_key: $("#llm-key").value.trim(),
  };
  try {
    await api("/api/llm-config", body);
    await refreshLlmBadge();
    setStatus("llm-status", t("llmSaved"), "ok");
    toast(t("llmSaved"));
  } catch (e) { setStatus("llm-status", e.message, "err"); }
}

async function testLlm() {
  setStatus("llm-status", t("loading"), "loading");
  try {
    const out = await api("/api/llm-test", {});
    setStatus("llm-status", t("llmTestOk") + " · “" + out.reply + "”", "ok");
  } catch (e) { setStatus("llm-status", t("llmTestFail") + ": " + e.message, "err"); }
}

async function refreshProjects() {
  state.projects = await api("/api/projects");
  renderProjects();
}

function projectItem(p) {
  const li = document.createElement("li");
  li.className = state.currentProject && p.id === state.currentProject.id ? "active" : "";
  li.innerHTML = `<div class="p-name">${escapeHtml(p.name)}</div>
    <div class="p-meta">${p.n_nodes} events · ${escapeHtml(shorten(p.topic, 48))}</div>`;
  li.onclick = () => loadProject(p.id);
  return li;
}

function closeProjectMore() {
  const menu = document.querySelector("#project-list .project-more-menu");
  const btn = document.querySelector("#project-list .project-more-btn");
  if (menu) menu.hidden = true;
  if (btn) btn.classList.remove("open");
}

function renderProjects() {
  const box = $("#project-list");
  box.innerHTML = "";
  if (!state.projects.length) {
    const d = document.createElement("div");
    d.className = "project-empty";
    d.textContent = t("noProject");
    box.appendChild(d); return;
  }
  // show up to 4 projects directly; fold the rest into a "More ▾" dropdown
  const MAX = 4;
  const ul = document.createElement("ul");
  ul.className = "project-list";
  state.projects.slice(0, MAX).forEach((p) => ul.appendChild(projectItem(p)));
  box.appendChild(ul);

  if (state.projects.length > MAX) {
    const wrap = document.createElement("div");
    wrap.className = "project-more";

    const menu = document.createElement("div");
    menu.className = "project-more-menu";
    menu.hidden = true;
    const mul = document.createElement("ul");
    mul.className = "project-list";
    state.projects.slice(MAX).forEach((p) => mul.appendChild(projectItem(p)));
    menu.appendChild(mul);
    // close the dropdown after picking a project from it
    menu.addEventListener("click", (e) => { if (e.target.closest("li")) closeProjectMore(); });

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "project-more-btn";
    btn.textContent = t("more") + " ▾";
    btn.onclick = (e) => {
      e.stopPropagation();
      const willOpen = menu.hidden;
      closeProjectMore();
      if (willOpen) { menu.hidden = false; btn.classList.add("open"); }
    };

    wrap.appendChild(btn);
    wrap.appendChild(menu);
    box.appendChild(wrap);
  }
}

async function loadProject(id) {
  try {
    const p = await api("/api/projects/" + id);
    state.currentProject = p;
    state.web = p.result_web || p.web;
    state.prediction = p.prediction || null;
    state.report = p.report || null;
    $("#seed-text").value = p.seed_text;
    $("#project-name").value = p.name;
    $("#cfg-branching").value = (p.build_config && p.build_config.branching) || 5;
    $("#cfg-depth").value = (p.build_config && p.build_config.depth) || 3;
    $("#cfg-maxnodes").value = (p.build_config && p.build_config.max_nodes) || 2000;
    showSetup(p);
    renderProjects();
    updateUndoRedoButtons(true, true);
    if (state.prediction) showResults({ web: state.web, prediction: state.prediction });
    else $("#results").classList.add("hidden");
    toast(p.name);
  } catch (e) { toast(e.message, true); }
}

/* ------------------------------------------------------------------ build */
/* ------------------------------------------------------- URL / file import */
async function importFromUrl() {
  const url = $("#import-url").value.trim();
  if (!url) { toast(t("importNeedUrl"), true); return; }
  setStatus("build-status", t("importing"), "loading");
  $("#import-fetch").disabled = true;
  try {
    const out = await api("/api/fetch-url", { url });
    $("#seed-text").value = out.text;
    if (!$("#project-name").value.trim() && out.title) $("#project-name").value = out.title.slice(0, 80);
    setStatus("build-status", t("importDone"), "ok");
  } catch (e) { setStatus("build-status", e.message, "err"); }
  finally { $("#import-fetch").disabled = false; }
}

function importFromFile(e) {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  if (f.size > 100 * 1024) { toast(t("importTooBig"), true); e.target.value = ""; return; }
  const rd = new FileReader();
  rd.onload = () => {
    $("#seed-text").value = String(rd.result || "").slice(0, 8000);
    if (!$("#project-name").value.trim()) $("#project-name").value = f.name.replace(/\.[^.]+$/, "");
    setStatus("build-status", t("importDone"), "ok");
  };
  rd.onerror = () => toast(t("importFail"), true);
  rd.readAsText(f);
  e.target.value = "";   // allow re-picking the same file
}

/* ---- live web growth: show the canvas while the engine builds, wave by wave */
function _beginLiveBuild() {
  $("#results").classList.remove("hidden");
  $("#results").classList.add("building");
  switchTab("network");
  network.resetWeb({ nodes: [], edges: [] });
  network.render();
  window.scrollTo({ top: $("#results").offsetTop - 10, behavior: "smooth" });
}

function _liveBuildUpdate(web) {
  if (!web || !web.nodes) return;
  network.setWeb(web);   // incremental: old nodes stay put, new ones grow in
}

function _endLiveBuild() {
  $("#results").classList.remove("building");
}

async function buildWorld() {
  const seed_text = $("#seed-text").value.trim();
  if (!seed_text) { toast(t("needSeed"), true); return; }
  setStatus("build-status", t("building"), "loading");
  $("#build-btn").disabled = true;
  const job = "job-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
  startTrajectory(job);
  _beginLiveBuild();
  try {
    const payload = {
      name: $("#project-name").value.trim() || "Scenario",
      seed_text,
      seed: parseInt($("#seed-num").value) || 42,
      lang: LANG,
      job,
      config: {
        branching: parseInt($("#cfg-branching").value) || 5,
        depth: parseInt($("#cfg-depth").value) || 3,
        max_nodes: parseInt($("#cfg-maxnodes").value) || 2000,
        turbo: $("#cfg-turbo") ? $("#cfg-turbo").checked : false,
      },
    };
    const p = await apiAsync("/api/projects", payload, _liveBuildUpdate);
    state.currentProject = p;
    state.web = p.web; state.prediction = null; state.report = null;
    state.interventions = [];
    const cr = $("#compare-results"); if (cr) { cr.classList.add("hidden"); cr.innerHTML = ""; }
    updateUndoRedoButtons(true, true);
    await refreshProjects();
    showSetup(p);
    setStatus("build-status", t("built"), "ok");
  } catch (e) { setStatus("build-status", e.message, "err"); }
  finally { _endLiveBuild(); stopTrajectory(true); $("#build-btn").disabled = false; }
}

function showSetup(p) {
  $("#step-build").classList.add("hidden");
  $("#step-setup").classList.remove("hidden");
  // keep the (just-grown) web visible — the user watched it build; don't yank it away
  $("#results").classList.remove("hidden");
  switchTab("network");
  renderNodeList(p.web);
  const w = p.web;
  $("#world-summary").innerHTML =
    `<span class="chip"><b>${w.n_nodes}</b> events</span>
     <span class="chip"><b>${w.n_edges}</b> causal links</span>
     <span class="chip"><b>${w.nodes.filter((n) => n.type === "root").length}</b> starting events</span>
     <span class="chip">${escapeHtml(shorten(w.topic, 80))}</span>`;
  if (!network.nodes.length) {
    network.resetWeb(w);   // fresh load (no live build happened) — lay out from scratch
    network.render();
  } else {
    network.setWeb(w);     // came from a live build — adopt final fields, keep positions
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ------------------------------------------------------------------ interventions */
function renderInterventions() {
  const box = $("#interventions");
  box.innerHTML = "";
  state.interventions.forEach((inv, i) => {
    const row = document.createElement("div");
    row.className = "intervention";
    row.innerHTML =
      `<input type="text" value="${escapeHtml(inv.text)}" data-k="text" placeholder="${escapeHtml(t("interventionPh"))}">
       <button class="rm" title="${escapeHtml(t("removeTitle"))}">✕</button>`;
    row.querySelector("input").addEventListener("change", (e) => { inv.text = e.target.value; });
    row.querySelector(".rm").onclick = () => { state.interventions.splice(i, 1); renderInterventions(); };
    box.appendChild(row);
  });
}

function addIntervention() {
  state.interventions.push({ text: "" });
  renderInterventions();
  // focus the new empty input so the user can type right away
  const rows = document.querySelectorAll("#interventions .intervention input");
  if (rows.length) rows[rows.length - 1].focus();
}

/* ------------------------------------------------------------------ A/B compare */
function toggleComparePanel() {
  const panel = $("#compare-panel");
  const willOpen = panel.classList.contains("hidden");
  panel.classList.toggle("hidden");
  if (willOpen && !state.compare.scenarios.length) {
    state.compare.scenarios = [{ name: "", interventions: [{ text: "" }] },
                               { name: "", interventions: [{ text: "" }] }];
    renderCompareSlots();
  }
}

function renderCompareSlots() {
  const box = $("#compare-slots");
  box.innerHTML = "";
  state.compare.scenarios.forEach((sc, i) => {
    const slot = document.createElement("div");
    slot.style.cssText = "border:1px solid var(--border);border-radius:10px;padding:10px;margin:8px 0";
    slot.innerHTML =
      `<div class="row" style="align-items:center">
         <input type="text" class="sc-name" value="${escapeHtml(sc.name)}" placeholder="${escapeHtml(t("scenarioDefault").replace("{n}", i + 1))}">
         <button class="rm sc-rm" title="${escapeHtml(t("delete"))}">✕</button>
       </div>
       <div class="interventions sc-list"></div>
       <button class="btn btn-ghost btn-block sc-add">${t("addIntervention")}</button>`;
    slot.querySelector(".sc-name").addEventListener("change", (e) => { sc.name = e.target.value; });
    slot.querySelector(".sc-rm").onclick = () => {
      state.compare.scenarios.splice(i, 1);
      renderCompareSlots();
    };
    slot.querySelector(".sc-add").onclick = () => {
      sc.interventions.push({ text: "" });
      renderCompareSlots();
    };
    const list = slot.querySelector(".sc-list");
    sc.interventions.forEach((inv, j) => {
      const row = document.createElement("div");
      row.className = "intervention";
      row.innerHTML =
        `<input type="text" value="${escapeHtml(inv.text)}" placeholder="${escapeHtml(t("interventionPh"))}">
         <button class="rm" title="${escapeHtml(t("removeTitle"))}">✕</button>`;
      row.querySelector("input").addEventListener("change", (e) => { inv.text = e.target.value; });
      row.querySelector(".rm").onclick = () => { sc.interventions.splice(j, 1); renderCompareSlots(); };
      list.appendChild(row);
    });
    box.appendChild(slot);
  });
  const addBtn = $("#compare-add");
  if (addBtn) addBtn.disabled = state.compare.scenarios.length >= 4;
}

async function runComparison() {
  if (!state.currentProject) { toast(t("noProject"), true); return; }
  const scenarios = state.compare.scenarios.map((sc, i) => ({
    name: (sc.name || "").trim() || t("scenarioDefault").replace("{n}", i + 1),
    interventions: (sc.interventions || [])
      .filter((x) => (x.text || "").trim())
      .map((x) => ({ text: x.text.trim() })),
  }));
  if (!scenarios.length) return;
  setStatus("compare-status", t("comparing"), "loading");
  $("#compare-run").disabled = true;
  try {
    const out = await apiAsync("/api/compare", { project_id: state.currentProject.id, lang: LANG, scenarios },
      (snap) => {
        // per-scenario progress streamed by the parallel compare
        if (snap && snap.compare_total) {
          const m = $("#compare-status").querySelector(".proc-msg");
          if (m) m.textContent = `${t("comparing")} — ${snap.compare_done}/${snap.compare_total}`;
        }
      });
    renderCompareResults(out.scenarios || []);
    setStatus("compare-status", t("compareDone"), "ok");
  } catch (e) { setStatus("compare-status", e.message, "err"); }
  finally { $("#compare-run").disabled = false; }
}

function renderCompareResults(list) {
  const box = $("#compare-results");
  if (!box) return;
  box.classList.remove("hidden");
  let html = `<h3>${t("compareResults")}</h3>`;
  html += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px">`;
  list.forEach((sc) => {
    const pred = sc.prediction || {};
    const conf = Math.round((pred.confidence || 0) * 100);
    html += `<div style="border:1px solid var(--border);border-radius:10px;padding:12px">`;
    html += `<b>${escapeHtml(sc.name || "")}</b>`;
    html += `<div class="hint" style="margin:6px 0">${conf}% ${t("confidence")}</div>`;
    const ens = pred.ensemble;
    if (ens && ens.confidence && typeof ens.confidence.mean === "number") {
      const line = t("ensembleLine")
        .replace("{mean}", Math.round(ens.confidence.mean * 100))
        .replace("{lo}", Math.round((ens.confidence.lo || 0) * 100))
        .replace("{hi}", Math.round((ens.confidence.hi || 0) * 100))
        .replace("{runs}", ens.runs || 0)
        .replace("{stab}", Math.round((ens.chain_stability || 0) * 100));
      html += `<div class="hint">${escapeHtml(line)}</div>`;
    }
    const top = Array.isArray(pred.top_outcomes) ? pred.top_outcomes.slice(0, 3) : [];
    if (top.length) {
      html += `<div style="margin-top:8px">`;
      top.forEach((o) => {
        const pct = Math.round((o.probability || 0) * 100);
        html += `<div class="bar-row" style="grid-template-columns:1fr 40px"><span>${escapeHtml(shorten(o.text, 40))}</span><span>${pct}%</span></div>`;
      });
      html += `</div>`;
    }
    html += `</div>`;
  });
  html += `</div>`;
  box.innerHTML = html;
}

/* ------------------------------------------------------------------ run */
async function runSimulation() {
  if (!state.currentProject) { toast(t("noProject"), true); return; }
  setStatus("run-status", t("running"), "loading");
  $("#run-btn").disabled = true;
  const job = "job-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
  startTrajectory(job);
  try {
    const config = {
      seed: state.currentProject.seed,
      interventions: state.interventions.filter((i) => (i.text || "").trim()),
    };
    const out = await apiAsync("/api/simulate", { project_id: state.currentProject.id, lang: LANG, config, job });
    state.web = out.web;
    state.prediction = out.prediction;
    state.report = null;
    showResults(out);
    setStatus("run-status", t("done"), "ok");
    await refreshProjects();
  } catch (e) { setStatus("run-status", e.message, "err"); }
  finally {
    stopTrajectory(true);
    $("#run-btn").disabled = false;
  }
}

/* ------------------------------------------------------------------ live trajectory */
const TRAJ_KIND = {
  phase: "phase", llm: "llm", tool: "tool", derive: "derive",
  llm_done: "done", done: "done", error: "error",
};

function trajBadge(kind) {
  const k = TRAJ_KIND[kind] || "other";
  return `<span class="traj-kind ${k}">${escapeHtml(k)}</span>`;
}

function renderTrajectory(rec) {
  const list = $("#trajectory-list");
  const count = $("#trajectory-count");
  const pk = $("#trajectory-state");
  if (!list || !rec) return;
  const events = rec.events || [];
  // append only new events
  if (events.length > state.trajSeen) {
    let html = "";
    for (let i = state.trajSeen; i < events.length; i++) {
      const ev = events[i];
      const cls = i === events.length - 1 ? "active" : "done";
      const detail = ev.ok === false || ev.kind === "error"
        ? `<span class="traj-err-detail">${escapeHtml(ev.detail || "")}</span>`
        : `<span class="traj-detail">${escapeHtml(ev.detail || "")}</span>`;
      html += `<div class="traj-row ${cls}" data-evkey="${i}">
        ${trajBadge(ev.kind)}
        ${detail}
        <span class="traj-time">${escapeHtml(ev.t_str || "")}</span>
      </div>`;
    }
    list.insertAdjacentHTML("beforeend", html);
    state.trajSeen = events.length;
    // stream the newest step into any active processing animation
    _broadcastProcStep(events[events.length - 1]);
  }
  const prevActive = list.querySelector(".traj-row.active");
  if (prevActive && events.length) {
    const last = list.querySelector('[data-evkey="' + (events.length - 1) + '"]');
    prevActive.classList.remove("active");
    prevActive.classList.add("done");
    if (last) { last.classList.add("active"); last.classList.remove("done"); }
  }
  if (count) count.textContent = events.length + (rec.active ? " · live" : "");
  if (pk) {
    if (rec.active) { pk.textContent = "running"; pk.className = "trajectory-state"; }
    else if (rec.ok) { pk.textContent = "done ✓"; pk.className = "trajectory-state done"; }
    else { pk.textContent = "failed ✗"; pk.className = "trajectory-state err"; }
  }
  list.scrollTop = list.scrollHeight;
}

async function pollTrajectory() {
  if (!state.trajJob) return;
  try {
    const rec = await api("/api/trajectory?job=" + encodeURIComponent(state.trajJob));
    renderTrajectory(rec);
    if (rec && !rec.active) {
      // finished server-side: stop polling (keep the final view rendered)
      if (state.trajTimer) { clearInterval(state.trajTimer); state.trajTimer = null; }
    }
  } catch (e) { /* transient, keep polling */ }
}

function startTrajectory(job) {
  stopTrajectory(true);
  state.trajJob = job;
  state.trajSeen = 0;
  _lastTrajStep = "";   // don't leak the previous job's final step into a new run
  const panel = $("#trajectory");
  if (panel) {
    panel.classList.remove("hidden");
    const list = $("#trajectory-list");
    if (list) list.innerHTML = "";
  }
  state.trajTimer = setInterval(pollTrajectory, 1200);
  pollTrajectory();
}

function stopTrajectory(finished) {
  if (state.trajTimer) { clearInterval(state.trajTimer); state.trajTimer = null; }
  if (!state.trajJob) return;
  if (finished) {
    const job = state.trajJob;
    api("/api/trajectory?job=" + encodeURIComponent(job))
      .then((rec) => { if (rec && rec.events && rec.events.length > state.trajSeen) renderTrajectory(rec); })
      .catch(() => {});
  }
  state.trajJob = null;
}

/* ------------------------------------------------------------------ results */
function showResults(res) {
  $("#results").classList.remove("hidden");
  $("#report-body").innerHTML = "";
  renderNetwork(res.web);
  renderNodeList(res.web);
  switchTab("network");
  window.scrollTo({ top: $("#results").offsetTop - 10, behavior: "smooth" });
  generateReport();
}

function switchTab(name) {
  $$("#tabs .tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  ["network", "report", "interact", "math"].forEach((n) => {
    $("#tab-" + n).classList.toggle("hidden", n !== name);
  });
  if (name === "network") network.render();
  // keep the report in sync with any AI/user edits since it was last generated
  if (name === "report" && state.currentProject && state.prediction) generateReport();
  // render the mathematical derivation from the current prediction
  if (name === "math") renderMathViz();
}

function renderMathViz() {
  if (window.MathViz) window.MathViz.render(state.web, state.prediction, LANG);
}

/* ---- network ---- */
function renderLegend() {
  const legend = $("#network-legend");
  const P = window.PALETTE || {};
  const ROOT = P.root || "#3B6EA5";
  const INT = P.intervention || "#8A5BA0";
  legend.innerHTML =
    `<span><span class="dot dot-diamond" style="background:${ROOT}"></span>start</span>
     <span><span class="dot dot-triangle" style="background:${INT}"></span>intervention</span>
     <span><span class="dot" style="background:${P.pos}"></span>positive</span>
     <span><span class="dot" style="background:${P.neg}"></span>negative</span>
     <span><span class="dot" style="background:${P.neutral}"></span>neutral</span>`;
}

function renderNetwork(web) {
  renderLegend();
  network.resetWeb(web);
  network.render();
}

/* ---- report ---- */
async function generateReport() {
  if (!state.currentProject) return;
  try {
    const rep = await api("/api/report", { project_id: state.currentProject.id, lang: LANG });
    state.report = rep;
    renderReport(rep);
  } catch (e) { $("#report-body").innerHTML = `<div class="r-summary">${escapeHtml(e.message)}</div>`; }
}

function renderReport(r) {
  const box = $("#report-body");
  let html = `<div class="r-summary">${escapeHtml(r.summary || "")}</div>`;

  if (r.chain && r.chain.length) {
    html += `<div class="r-section"><h3>${t("chain")}</h3><div class="chain">`;
    r.chain.forEach((c, i) => {
      html += `<span class="chain-node">${escapeHtml(c)}</span>`;
      if (i < r.chain.length - 1) html += `<span class="chain-arrow">→</span>`;
    });
    html += `</div></div>`;
  }

  if (r.top_outcomes && r.top_outcomes.length) {
    html += `<div class="r-section"><h3>${t("outcomes")}</h3>`;
    html += `<div style="max-width:560px">`;
    r.top_outcomes.forEach((o) => {
      const pct = Math.round((o.probability || 0) * 100);
      html += `<div class="bar-row"><span>${escapeHtml(o.text)}</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div><span>${pct}%</span></div>`;
    });
    html += `</div></div>`;
  }

  /* ---- prediction extras (absent on older projects) ---- */
  const pred = state.prediction || {};
  const ens = pred.ensemble;
  if (ens && ens.confidence && typeof ens.confidence.mean === "number") {
    const line = t("ensembleLine")
      .replace("{mean}", Math.round(ens.confidence.mean * 100))
      .replace("{lo}", Math.round((ens.confidence.lo || 0) * 100))
      .replace("{hi}", Math.round((ens.confidence.hi || 0) * 100))
      .replace("{runs}", ens.runs || 0)
      .replace("{stab}", Math.round((ens.chain_stability || 0) * 100));
    html += `<p class="hint">${escapeHtml(line)}</p>`;
  }

  if (pred.feedback_loop) {
    html += `<div class="r-section"><span class="badge badge-off">${escapeHtml(t("feedbackLoopWarn"))}</span></div>`;
  }

  const timeline = Array.isArray(pred.timeline) ? pred.timeline : [];
  if (timeline.length) {
    html += `<div class="r-section"><h3>${t("timelineTitle")}</h3><ol style="max-width:560px;margin:0;padding-left:20px">`;
    timeline.forEach((s) => {
      const day = s && typeof s.day === "number" ? s.day : "–";
      html += `<li style="margin-bottom:6px"><span class="badge">${escapeHtml(t("dayN").replace("{n}", day))}</span> ${escapeHtml((s && s.text) || "")}</li>`;
    });
    html += `</ol></div>`;
  }

  html += `<div class="r-section"><h3>${t("web")}</h3>
    <p>${r.n_nodes} events · ${r.n_edges} causal links</p></div>`;

  box.innerHTML = html;
}

/* ---- chat (interact) + user graph editing ---- */
const REL_VERB = {
  causes: { en: "causes", id: "menyebabkan" },
  leads_to: { en: "leads to", id: "berujung pada" },
  increases: { en: "increases", id: "meningkatkan" },
  decreases: { en: "decreases", id: "menurunkan" },
  enables: { en: "enables", id: "memungkinkan" },
  prevents: { en: "prevents", id: "mencegah" },
  weakens: { en: "weakens", id: "melemahkan" },
  triggers: { en: "triggers", id: "memicu" },
};
function relVerb(r) { return (REL_VERB[r] && REL_VERB[r][LANG]) || (REL_VERB[r] && REL_VERB[r].en) || r || "causes"; }

function getNode(nodeId) { return ((state.web && state.web.nodes) || []).find((n) => n.id === nodeId); }

function renderNodeList(web) {
  const ul = $("#node-list");
  ul.innerHTML = "";
  const q = (state.nodeQuery || "").trim().toLowerCase();
  const nodes = [...(web.nodes || [])]
    .filter((n) => !q || (n.text || "").toLowerCase().includes(q))
    .sort((a, b) => a.level - b.level || (b.probability || 0) - (a.probability || 0));
  nodes.forEach((n) => {
    const li = document.createElement("li");
    li.className = n.id === state.selectedNodeId ? "active" : "";
    const typeLabel = n.type === "root" ? nl("start") : n.type === "intervention" ? nl("intervention") : "L" + n.level;
    const pct = Math.round((n.probability || 0) * 100);
    li.innerHTML = `<div class="a-name">${escapeHtml(shorten(n.text, 44))}</div>
      <div class="a-role">${typeLabel} · ${pct}%</div>`;
    li.onclick = () => { state.selectedNodeId = n.id; renderNodeList(web); openNodeChat(n.id, true); };
    ul.appendChild(li);
  });
}

function renderNodeActions(node) {
  const box = $("#node-actions");
  if (!box) return;
  if (!node) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  box.classList.remove("hidden");
  box.innerHTML = `
    <button class="btn" data-act="rename">✏️ ${t("rename")}</button>
    <button class="btn" data-act="add">＋ ${t("addConsequence")}</button>
    <button class="btn" data-act="connect">⛓ ${t("connect")}</button>
    <button class="btn" data-act="derive">🧮 Derivation</button>
    <button class="btn warn" data-act="delete">🗑 ${t("delete")}</button>`;
  box.querySelector('[data-act="rename"]').onclick = () => renameNode(node.id);
  box.querySelector('[data-act="add"]').onclick = () => addConsequenceNode(node.id);
  box.querySelector('[data-act="connect"]').onclick = () => startConnect(node.id);
  box.querySelector('[data-act="derive"]').onclick = () => fetchNodeDerivation(node.id);
  box.querySelector('[data-act="delete"]').onclick = () => deleteNode(node.id);
  // close derivation panel when the node selection changes
  const nd = $("#node-derivation"); if (nd) nd.classList.add("hidden");
}

function renderConnections(node) {
  const box = $("#conn-list");
  if (!box) return;
  if (!node) { box.innerHTML = ""; return; }
  const byId = {};
  (state.web.nodes || []).forEach((n) => { byId[n.id] = n; });
  const edges = (state.web.edges || []).filter((e) => e.source === node.id || e.target === node.id);
  let html = "";
  edges.forEach((e) => {
    const out = e.source === node.id;
    const other = byId[out ? e.target : e.source];
    if (!other) return;
    html += `<div class="conn"><span class="conn-dir">${out ? "→" : "←"}</span><span class="conn-text">${escapeHtml(shorten(other.text, 36))} <i>· ${relVerb(e.relation)}</i></span><button class="conn-sens" data-s="${e.source}" data-t="${e.target}" title="${escapeHtml(t("sensTitle"))}">∂</button><button class="conn-x" data-s="${e.source}" data-t="${e.target}">✕</button></div>`;
  });
  box.innerHTML = html;
  box.querySelectorAll(".conn-x").forEach((b) => {
    b.onclick = () => disconnectEdge(b.dataset.s, b.dataset.t);
  });
  box.querySelectorAll(".conn-sens").forEach((b) => {
    b.onclick = () => runSensitivity(b.dataset.s, b.dataset.t, b);
  });
}

/* ---------------------------------------------------- edge sensitivity sweep */
async function runSensitivity(source, target, btn) {
  if (!state.currentProject) return;
  // toggle an existing result instead of re-sweeping
  const existing = btn.parentElement.nextElementSibling;
  if (existing && existing.classList && existing.classList.contains("conn-sens-result")) {
    existing.remove();
    return;
  }
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = "…";
  try {
    const weights = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
    const out = await api("/api/sensitivity", {
      project_id: state.currentProject.id, source, target, weights, lang: LANG,
    });
    const pts = out.points || [];
    const row = document.createElement("div");
    row.className = "conn-sens-result";
    if (!pts.length) {
      row.textContent = "–";
    } else {
      const lo = Math.min(...pts.map((p) => p.confidence));
      const hi = Math.max(...pts.map((p) => p.confidence));
      row.innerHTML = `<canvas width="150" height="34"></canvas><span class="sens-range">${Math.round(lo * 100)}% → ${Math.round(hi * 100)}%</span>`;
      drawSensSpark(row.querySelector("canvas"), pts);
    }
    btn.parentElement.after(row);
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
}

function drawSensSpark(canvas, pts) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const pal = window.PALETTE || {};
  ctx.clearRect(0, 0, W, H);
  const xs = pts.map((p) => p.weight);
  const ys = pts.map((p) => p.confidence);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const px = (w) => 4 + ((w - x0) / Math.max(x1 - x0, 1e-9)) * (W - 8);
  const py = (c) => H - 4 - ((c - y0) / Math.max(y1 - y0, 1e-9)) * (H - 8);
  ctx.strokeStyle = pal.accent || "#136F8F";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  pts.forEach((p, i) => { i ? ctx.lineTo(px(p.weight), py(p.confidence)) : ctx.moveTo(px(p.weight), py(p.confidence)); });
  ctx.stroke();
  ctx.fillStyle = pal.accent || "#136F8F";
  pts.forEach((p) => { ctx.beginPath(); ctx.arc(px(p.weight), py(p.confidence), 1.8, 0, Math.PI * 2); ctx.fill(); });
}

async function openNodeChat(nodeId, loadExplain) {
  if (!state.currentProject || !nodeId) return;
  state.selectedNodeId = nodeId;
  const node = getNode(nodeId);
  const prof = $("#chat-profile");
  const log = $("#chat-log");
  if (node && prof) {
    const tl = node.type === "root" ? nl("start") : node.type === "intervention" ? nl("intervention") : nl("consequence");
    prof.innerHTML = `<div class="pi-name">${escapeHtml(node.text)}</div>
      <div class="pi-desc">${tl} · ${nl("level")} ${node.level} · ${nl("likelihood")} ${Math.round((node.probability || 0) * 100)}%</div>`;
  }
  renderNodeActions(node);
  renderConnections(node);
  if (loadExplain !== false) {
    log.innerHTML = `<div class="msg agent"><div class="who">${t("aiDev")}</div>${t("loading")}</div>`;
    try {
      const out = await api("/api/chat", { project_id: state.currentProject.id, node_id: nodeId, lang: LANG });
      log.innerHTML = `<div class="msg agent"><div class="who">${t("aiDev")}</div>${escapeHtml(out.reply || "")}</div>`;
    } catch (e) {
      log.innerHTML = `<div class="msg agent"><div class="who">${t("aiDev")}</div>${escapeHtml(e.message)}</div>`;
    }
  }
  log.scrollTop = log.scrollHeight;
}

/* ------------------------------------------------------------------ node math derivation */
async function fetchNodeDerivation(nodeId) {
  if (!state.currentProject || !nodeId) return;
  const nd = $("#node-derivation");
  if (!nd) return;
  nd.classList.remove("hidden");
  nd.querySelector("#nd-formula").innerHTML = `<i>${t("thinking")}</i>`;
  nd.querySelector("#nd-expl").innerHTML = "";
  nd.querySelector("#nd-err").innerHTML = "";
  nd.querySelector(".nd-source").textContent = "";
  const job = "derive-" + Date.now();
  startTrajectoryLive(job);
  try {
    const out = await api("/api/derive", {
      project_id: state.currentProject.id, node_id: nodeId, lang: LANG, job
    });
    renderNodeDerivation(out);
  } catch (e) {
    const f = nd.querySelector("#nd-formula");
    if (f) f.innerHTML = "";
    const err = nd.querySelector("#nd-err");
    if (err) err.textContent = e.message;
  } finally {
    stopTrajectoryLive();
  }
}

function renderNodeDerivation(d) {
  const nd = $("#node-derivation");
  if (!nd) return;
  nd.classList.remove("hidden");
  const src = nd.querySelector(".nd-source");
  if (src) src.textContent = d && d.source
    ? (d.source === "llm" ? "🌀 AI-derived" : "⚙️ " + d.source)
    + (d.domain ? " · " + d.domain : "") : "";
  const box = nd.querySelector("#nd-formula");
  const expl = nd.querySelector("#nd-expl");
  if (!box || !expl) return;

  const esc = escapeHtml;
  // KaTeX helper: render math text; fall back to plain text on error.
  const k = (latex, el) => {
    if (!latex) return false;
    const t = latex.includes("\\") ? latex : toLatex(latex);
    if (window.katex) {
      try { window.katex.render(t, el, { throwOnError: true, displayMode: true }); return true; }
      catch (e) { /* fall through */ }
    }
    el.textContent = latex;
    el.classList.add("no-katex");
    return false;
  };

  // ---------- header: conclusion math as the headline equation ----------
  box.innerHTML = "";
  const concl = (d && d.conclusion) || {};
  if (concl.math) {
    const el = document.createElement("div");
    box.appendChild(el);
    k(concl.math, el);
  } else if (d && d.formula) {
    // legacy shape
    const el = document.createElement("div");
    box.appendChild(el);
    k(d.formula, el);
  }

  // ---------- body sections ----------
  let html = "";

  const vars = (d && d.variables) || [];
  if (vars.length) {
    const vnames = vars.map(v => (typeof v === "string" ? v : (v.name || "") +
      (v.meaning ? " = " + v.meaning : "")));
    html += `<div class="nd-sec"><b>Variables</b><br>` +
      vnames.map(v => `<code class="nd-var">${esc(v)}</code>`).join(" ") + `</div>`;
  }

  const rels = (d && d.symbolic_relationships) || [];
  if (rels.length) {
    html += `<div class="nd-sec"><b>Symbolic relationships</b><br>` +
      rels.map(r => `<div class="nd-rel">${esc(r)}</div>`).join("") + `</div>`;
  }

  const eqs = (d && d.qualitative_equations) || [];
  if (eqs.length) {
    html += `<div class="nd-sec"><b>Qualitative equations</b><div class="nd-eqs">` +
      eqs.map(e => `<div class="nd-eq" data-eq="${esc(e)}"></div>`).join("") + `</div></div>`;
  }

  const chains = (d && d.propagation_chains) || [];
  if (chains.length) {
    html += `<div class="nd-sec"><b>Propagation</b><br>` +
      chains.map(c => `<div class="nd-chain">${esc(typeof c === "string" ? c : (c.chain || []).join(" → "))}</div>`).join("") + `</div>`;
  }

  if (d && d.feedback_loop) {
    const fb = (typeof d.feedback_loop === "object") ? d.feedback_loop : {};
    const loopTxt = (fb.loop && fb.loop.length) ? esc(fb.loop.join(" → ")) : "";
    html += `<div class="nd-sec nd-feedback">🔁 <b>Feedback loop detected</b>${loopTxt ? ": " + loopTxt : ""}</div>`;
  }

  const hz = (d && d.time_horizon) || {};
  const hzKeys = [["short_term", "Short term"], ["medium_term", "Medium term"], ["long_term", "Long term"]];
  const hzHtml = hzKeys.filter(([key]) => (hz[key] || []).length)
    .map(([key, label]) => `<div class="nd-hz"><b>${label}</b><br>` +
      (hz[key] || []).map(x => `<div class="nd-rel">• ${esc(x)}</div>`).join("") + `</div>`).join("");
  if (hzHtml) html += `<div class="nd-sec"><b>Time horizon</b>${hzHtml}</div>`;

  if (d && d.conflicting_effects) {
    html += `<div class="nd-sec nd-conflict">⚖️ <b>Competing effects</b> — net effect uncertain.</div>`;
  }

  const sc = (d && d.scenarios) || [];
  if (sc.length) {
    html += `<div class="nd-sec"><b>Scenario branches</b>` +
      sc.map(s => {
        const ifTxt = esc(s.if || s.condition || "");
        const thenTxt = Array.isArray(s.then) ? s.then.join(" → ") : (s.then || "");
        const eqHtml = (s.equations || []).map(e => `<div class="nd-eq" data-eq="${esc(e)}"></div>`).join("");
        return `<div class="nd-scen"><span class="nd-if">IF</span> ${ifTxt}<br>` +
               `<span class="nd-then">THEN</span> ${esc(thenTxt)}${eqHtml}</div>`;
      }).join("") + `</div>`;
  }

  const risks = (d && d.probabilities) || [];
  if (risks.length) {
    html += `<div class="nd-sec"><b>Risks</b><br>` +
      risks.map(r => `<div class="nd-rel">• ${esc(r.risk)} → ${(r.probability * 100).toFixed(0)}%` +
        (r.reason ? ` <i>(${esc(r.reason)})</i>` : "") + `</div>`).join("") + `</div>`;
  }

  // legacy fields (older LLM replies may still carry them)
  if (d && d.explanation) html += `<div class="nd-sec"><b>Explanation</b><br>${esc(d.explanation)}</div>`;
  if (d && d.assumptions && d.assumptions.length)
    html += `<div class="nd-sec"><b>Assumptions</b><br>• ${esc(d.assumptions.join("<br>• "))}</div>`;

  if (concl.nl) {
    html += `<div class="nd-sec nd-conclusion"><b>Conclusion</b><br>${esc(concl.nl)}</div>`;
  }

  expl.innerHTML = html || `<span class="nd-err">No derivation available</span>`;

  // render KaTeX inside all equation slots
  expl.querySelectorAll(".nd-eq").forEach((el) => {
    const e = el.getAttribute("data-eq") || "";
    k(e, el);
  });
}

// crude heuristic: turn an inline formula into KaTeX-displayable LaTeX
function toLatex(s) {
  if (!s) return "";
  if (s.includes("\\")) return s;            // already LaTeX
  return s.replace(/\^([0-9A-Za-z_]+)/g, "^{$1}")
            .replace(/Delta/g, "\\Delta")
            .replace(/alpha/g, "\\alpha");
}

// transient (non-persisted) trajectory live-poller, used while a derivation job runs
function startTrajectoryLive(job) {  if (window.__trajTimer) clearInterval(window.__trajTimer);
  window.__trajJob = job;
  window.__trajTimer = setInterval(() => {
    if (!window.__trajJob) return;
    fetch("/api/trajectory?job=" + encodeURIComponent(window.__trajJob))
      .then((r) => r.json())
      .then((rec) => {
        if (rec && rec.events && rec.events.length) {
          const nd = $("#node-derivation");
          if (nd) {
            let s = nd.querySelector(".nd-source");
            if (s) s.textContent = (rec.active ? "live …" : "✓ done");
          }
        }
        if (rec && !rec.active) {
          clearInterval(window.__trajTimer);
          window.__trajTimer = null;
        }
      })
      .catch(() => {});
  }, 800);
}

function stopTrajectoryLive() {
  if (window.__trajTimer) { clearInterval(window.__trajTimer); window.__trajTimer = null; }
  window.__trajJob = null;
}

async function sendNodeMessage() {
  if (!state.currentProject) return;
  const input = $("#chat-input");
  const message = (input.value || "").trim();
  const nodeId = state.selectedNodeId;
  if (!message || !nodeId) return;
  input.value = "";
  const log = $("#chat-log");
  log.insertAdjacentHTML("beforeend", `<div class="msg user"><div class="who">${t("you")}</div>${escapeHtml(message)}</div>`);
  log.insertAdjacentHTML("beforeend", `<div class="msg agent loading"><div class="who">${t("aiDev")}</div>${t("thinking")}</div>`);
  log.scrollTop = log.scrollHeight;
  try {
    const out = await apiAsync("/api/develop", { project_id: state.currentProject.id, node_id: nodeId, message, lang: LANG });
    const loading = log.querySelector(".msg.loading");
    if (loading) loading.remove();
    log.insertAdjacentHTML("beforeend", `<div class="msg agent"><div class="who">${t("aiDev")}</div>${escapeHtml(out.reply || "")}</div>`);
    log.scrollTop = log.scrollHeight;
    if (out.web) applyGraphUpdate(out.web, out.prediction);
    if (getNode(nodeId)) { openNodeChat(nodeId, false); }
    else { state.selectedNodeId = null; $("#chat-profile").innerHTML = ""; renderNodeActions(null); renderConnections(null); }
  } catch (e) {
    const loading = log.querySelector(".msg.loading");
    if (loading) loading.remove();
    log.insertAdjacentHTML("beforeend", `<div class="msg agent"><div class="who">${t("aiDev")}</div>${escapeHtml(e.message)}</div>`);
    log.scrollTop = log.scrollHeight;
  }
}

function applyGraphUpdate(web, prediction, undoState) {
  state.web = web;
  state.prediction = prediction || null;
  state.report = null;
  network.setWeb(web);
  network.render();
  renderNodeList(web);
  refreshProjects();
  // a fresh edit makes undo available and clears the redo stack server-side
  if (undoState) updateUndoRedoButtons(undoState.can_undo, undoState.can_redo);
  else updateUndoRedoButtons(true, false);
}

/* ------------------------------------------------------------------ undo/redo */
function updateUndoRedoButtons(canUndo, canRedo) {
  const u = $("#undo-btn"), r = $("#redo-btn");
  if (u && canUndo != null) u.disabled = !canUndo;
  if (r && canRedo != null) r.disabled = !canRedo;
}

async function undoRedo(which) {
  if (!state.currentProject) { toast(t("noProject"), true); return; }
  const btn = which === "undo" ? $("#undo-btn") : $("#redo-btn");
  try {
    const out = await api("/api/" + which, { project_id: state.currentProject.id });
    applyGraphUpdate(out.web, out.prediction, { can_undo: out.can_undo, can_redo: out.can_redo });
    if (state.selectedNodeId && !getNode(state.selectedNodeId)) {
      state.selectedNodeId = null;
      $("#chat-profile").innerHTML = "";
      renderNodeActions(null);
      renderConnections(null);
    }
  } catch (e) {
    if (btn) btn.disabled = true; // 400: nothing to undo/redo
  }
}

function startConnect(nodeId) {
  network.setConnectMode(true);
  network.connectSource = nodeId || null;
  if (nodeId) network.selected = nodeId;
  switchTab("network");
  toast(t("connectModeTitle"));
}

async function connectNodes(source, target) {
  if (!state.currentProject || source === target) return;
  try {
    const out = await api("/api/graph", { project_id: state.currentProject.id, lang: LANG, mutations: [{ op: "add_edge", from: source, to: target, relation: "causes" }] });
    applyGraphUpdate(out.web, out.prediction);
    toast(t("connected"));
  } catch (e) { toast(e.message, true); }
}

async function disconnectEdge(source, target) {
  if (!state.currentProject) return;
  try {
    const out = await api("/api/graph", { project_id: state.currentProject.id, lang: LANG, mutations: [{ op: "remove_edge", from: source, to: target }] });
    applyGraphUpdate(out.web, out.prediction);
    if (state.selectedNodeId) renderConnections(getNode(state.selectedNodeId));
    toast(t("disconnected"));
  } catch (e) { toast(e.message, true); }
}

async function renameNode(nodeId) {
  if (!state.currentProject) return;
  const node = getNode(nodeId);
  if (!node) return;
  const text = prompt(t("editNodePh"), node.text);
  if (!text || !text.trim() || text.trim() === node.text) return;
  try {
    const out = await api("/api/graph", { project_id: state.currentProject.id, lang: LANG, mutations: [{ op: "update_node", id: nodeId, text: text.trim() }] });
    applyGraphUpdate(out.web, out.prediction);
    openNodeChat(nodeId, false);
    toast(t("renamed"));
  } catch (e) { toast(e.message, true); }
}

async function addConsequenceNode(nodeId) {
  if (!state.currentProject) return;
  const text = prompt(t("addConsPh"));
  if (!text || !text.trim()) return;
  try {
    const out = await api("/api/graph", { project_id: state.currentProject.id, lang: LANG, mutations: [{ op: "add_node", to: nodeId, text: text.trim(), relation: "leads_to" }] });
    applyGraphUpdate(out.web, out.prediction);
    toast(t("added"));
  } catch (e) { toast(e.message, true); }
}

async function deleteNode(nodeId) {
  if (!state.currentProject) return;
  try {
    const out = await api("/api/graph", { project_id: state.currentProject.id, lang: LANG, mutations: [{ op: "remove_node", id: nodeId }] });
    if (state.selectedNodeId === nodeId) state.selectedNodeId = null;
    applyGraphUpdate(out.web, out.prediction);
    if (!getNode(nodeId)) { $("#chat-profile").innerHTML = ""; renderNodeActions(null); renderConnections(null); $("#chat-log").innerHTML = ""; }
    toast(t("deleted"));
  } catch (e) { toast(e.message, true); }
}

/* ---- export ---- */
async function exportData(format) {
  if (!state.currentProject) return;
  try {
    const out = await api("/api/export", { project_id: state.currentProject.id, format });
    download(out.filename, out.content);
  } catch (e) { toast(e.message, true); }
}

/* ------------------------------------------------------------------ events binding */
function bindEvents() {
  $("#build-btn").onclick = buildWorld;
  $("#import-fetch").onclick = importFromUrl;
  $("#import-file-input").onchange = importFromFile;
  $("#run-btn").onclick = runSimulation;
  const _tc = $("#trajectory-clear");
  if (_tc) _tc.onclick = () => { const l = $("#trajectory-list"); if (l) l.innerHTML = ""; const c = $("#trajectory-count"); if (c) c.textContent = ""; };
  $("#new-project-btn").onclick = () => {
    $("#step-setup").classList.add("hidden");
    $("#results").classList.add("hidden");
    $("#step-build").classList.remove("hidden");
    $("#seed-text").value = "";
    $("#seed-text").focus();
    state.currentProject = null; state.web = null; state.prediction = null; state.report = null;
    const cr = $("#compare-results"); if (cr) { cr.classList.add("hidden"); cr.innerHTML = ""; }
    updateUndoRedoButtons(true, true);
    renderProjects();
  };
  $("#add-intervention").onclick = addIntervention;
  $("#compare-toggle").onclick = toggleComparePanel;
  $("#compare-add").onclick = () => {
    if (state.compare.scenarios.length < 4) {
      state.compare.scenarios.push({ name: "", interventions: [{ text: "" }] });
      renderCompareSlots();
    }
  };
  $("#compare-run").onclick = runComparison;

  $$("#tabs .tab").forEach((b) => { b.onclick = () => switchTab(b.dataset.tab); });

  $("#export-json").onclick = () => exportData("json");
  $("#export-md").onclick = () => exportData("markdown");
  $("#export-html").onclick = () => exportData("html");
  $("#export-png").onclick = () => network.downloadPNG();

  network.onOpen = (id) => {
    state.selectedNodeId = id;
    switchTab("interact");
    renderNodeList(state.web);
    openNodeChat(id, true);
  };
  network.onSelect = (id) => {
    state.selectedNodeId = id;
    if (id) renderNodeList(state.web);
  };
  network.onConnect = async (source, target) => {
    network.setConnectMode(false);
    await connectNodes(source, target);
  };

  $("#undo-btn").onclick = () => undoRedo("undo");
  $("#redo-btn").onclick = () => undoRedo("redo");
  $("#zoom-in").onclick = () => network.zoom(1.15);
  $("#zoom-out").onclick = () => network.zoom(0.87);
  $("#fit-view").onclick = () => network.fitView();
  $("#relayout-btn").onclick = () => network.relayout();
  $("#connect-btn").onclick = () => {
    const on = !network.isConnectMode();
    network.setConnectMode(on);
    if (on) toast(t("connectModeTitle"));
  };

  // node chat
  $("#chat-send").onclick = sendNodeMessage;
  $("#chat-input").addEventListener("keydown", (e) => { if (e.key === "Enter") sendNodeMessage(); });
  // live event search
  const ns = $("#node-search");
  if (ns) ns.addEventListener("input", () => {
    state.nodeQuery = ns.value;
    if (state.web) renderNodeList(state.web);
  });

  // LLM settings
  $("#settings-btn").onclick = openSettings;
  $("#llm-badge").onclick = openSettings;
  $("#settings-close").onclick = closeSettings;
  $("#settings-modal").addEventListener("click", (e) => { if (e.target === $("#settings-modal")) closeSettings(); });
  // close the project "More ▾" dropdown when clicking outside of it
  document.addEventListener("click", (e) => { if (!e.target.closest("#project-list .project-more")) closeProjectMore(); });
  // donate dropdown
  $("#donate-btn").onclick = (e) => { e.stopPropagation(); const m = $("#donate-menu"); m.hidden = !m.hidden; };
  $("#donate-menu").addEventListener("click", () => { $("#donate-menu").hidden = true; });
  document.addEventListener("click", (e) => { if (!e.target.closest(".donate-wrap")) $("#donate-menu").hidden = true; });
  $("#llm-provider").onchange = applyProviderPreset;
  $("#llm-test").onclick = testLlm;
  $("#llm-save").onclick = saveLlm;

  // causal equation → mathematical derivation
  $("#formula-btn").onclick = () => switchTab("math");

  window.addEventListener("resize", () => network.render());
}

/* ------------------------------------------------------------------ helpers */
function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function shorten(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n) + "…" : s; }

document.addEventListener("DOMContentLoaded", init);
