/* Riak · Advanced Mathematical Reasoning Visualizer.
 *
 * Reads the *existing* prediction/causal result (web + prediction, already
 * present in the frontend) and renders it as ONE continuous mathematical
 * derivation · a long vertical stream of equations that build on each other,
 * like a page from a research derivation.
 *
 * The engine's actual math is a max-times (Viterbi / tropical max-plus)
 * propagation over the causal DAG:
 *
 *     P(root) = P(intervention) = 1
 *     P(v)    = max_{u→v} [ P(u) · w_uv ]
 *     Ŷ       = argmax_x P(x)
 *
 * We do NOT change that engine · we only re-express it faithfully, step by
 * step, with a numerical self-check that recomputes the propagation and
 * confirms it matches the prediction.
 *
 * Rendering: KaTeX when available (loaded from CDN); graceful plain-text
 * fallback otherwise. Steps reveal progressively (◀ ▶ ⏯ ↻ + "Step k / n").
 */
(function () {
  "use strict";

  const PAL = window.PALETTE || {};
  // live palette lookup (so theme switching recolors the derivation without a reload)
  const COL = new Proxy({}, {
    get(_, k) {
      const map = {
        sub: ["accent", "#2E8B6E"],   // substituted / carried input
        wt: ["accent2", "#33563F"],   // weight / operator
        res: ["amber", "#9A6B3A"],    // newly computed result
        ok: ["pos", "#2E8B6E"],
        bad: ["neg", "#B4554D"],
      };
      const m = map[k];
      return m ? (PAL[m[0]] || m[1]) : undefined;
    },
  });

  const hasKatex = () => typeof window.katex !== "undefined" && window.katex.render;

  function num(v) {
    v = Number(v) || 0;
    return String(Math.round(v * 1000) / 1000);
  }

  function katex(el, latex, fallback) {
    if (hasKatex()) {
      try {
        window.katex.render(latex, el, { throwOnError: false, displayMode: true });
        return;
      } catch (e) { /* fall through to plain text */ }
    }
    el.textContent = fallback || latex || "";
    el.classList.add("no-katex");
  }

  function L(lang) {
    const t = {
      en: {
        title: "Mathematical derivation",
        subtitle: "Max-times causal propagation",
        def: "Probability field over the causal events",
        init: "Starting events carry unit probability",
        initNote: "roots and interventions begin certain",
        recurrence: "Propagation rule · each consequence takes its strongest cause",
        indexed: "Indexed form over the parent set",
        matrix: "Vector form · a max-times (Viterbi) product",
        tropical: "Log-domain · the tropical (max-plus) semiring",
        tropicalNote: "log of a max-product equals a max of sums",
        chain: "Dominant chain · the argmax path",
        result: "Most likely outcome",
        verify: "Independent numerical verification",
        verifyOk: "verified · recomputed probabilities match the prediction",
        verifyFail: "verification found mismatches",
        verifyNoteOk: "independent recomputation matches the engine",
        verifyNoteFail: "recomputed values differ from the prediction",
        maxOver: (k) => "max over " + k + " parent(s)",
        noPrediction: "Run a prediction to derive the concrete computation.",
        play: "Play", pause: "Pause", step: "Step", events: "events", links: "causal links",
      },
      id: {
        title: "Derivasi matematis",
        subtitle: "Propagasi sebab-akibat max-times",
        def: "Medan probabilitas atas peristiwa kausal",
        init: "Peristiwa awal membawa probabilitas satuan",
        initNote: "akar dan intervensi mulai pasti",
        recurrence: "Aturan propagasi · tiap konsekuensi mengambil sebab terkuatnya",
        indexed: "Bentuk berindeks atas himpunan induk",
        matrix: "Bentuk vektor · produk max-times (Viterbi)",
        tropical: "Domain log · semiring tropis (max-plus)",
        tropicalNote: "log dari max-product sama dengan max dari jumlah",
        chain: "Rantai dominan · jalur argmax",
        result: "Hasil paling mungkin",
        verify: "Verifikasi numerik independen",
        verifyOk: "terverifikasi · probabilitas hasil hitung ulang cocok dengan prediksi",
        verifyFail: "verifikasi menemukan ketidakcocokan",
        verifyNoteOk: "hitung ulang independen cocok dengan mesin",
        verifyNoteFail: "nilai hasil hitung ulang berbeda dari prediksi",
        maxOver: (k) => "maksimum atas " + k + " induk",
        noPrediction: "Jalankan prediksi untuk menurunkan perhitungan konkret.",
        play: "Putar", pause: "Jeda", step: "Langkah", events: "peristiwa", links: "kaitan kausal",
      },
      zh: {
        title: "数学推导",
        subtitle: "最大-乘积因果传播",
        def: "因果事件上的概率场",
        init: "起始事件概率为 1",
        initNote: "根与干预起始为确定",
        recurrence: "传播规则 · 每个后果取最强原因",
        indexed: "父集上的索引形式",
        matrix: "向量形式 · 最大-乘积（Viterbi）",
        tropical: "对数域 · 热带（max-plus）半环",
        tropicalNote: "最大乘积的对数等于和的最大值",
        chain: "主导链 · argmax 路径",
        result: "最可能结果",
        verify: "独立数值验证",
        verifyOk: "已验证 · 重算概率与预测一致",
        verifyFail: "验证发现不一致",
        verifyNoteOk: "独立重算与引擎一致",
        verifyNoteFail: "重算值与预测不同",
        maxOver: (k) => "在 " + k + " 个父节点上取最大",
        noPrediction: "运行预测以推导具体计算。",
        play: "播放", pause: "暂停", step: "步骤", events: "事件", links: "因果连接",
      },
    };
    return t[lang] || t.en;
  }

  // Operation tag labels (short, shown to the left of each step).
  function opLabel(op, lang) {
    const map = {
      en: { initial: "initial", transformation: "transform", substitution: "substitute", simplification: "simplify", expand: "expand", verify: "verify" },
      id: { initial: "awal", transformation: "transformasi", substitution: "substitusi", simplification: "sederhanakan", expand: "perluas", verify: "verifikasi" },
      zh: { initial: "初始", transformation: "变换", substitution: "代入", simplification: "化简", expand: "展开", verify: "验证" },
    };
    return (map[lang] || map.en)[op] || op;
  }

  // Independent re-run of the engine's max-times propagation, for verification.
  // Uses a local map so it never mutates the web nodes.
  function verify(web, prediction) {
    const nodes = (web && web.nodes) || [];
    const edges = (web && web.edges) || [];
    const byId = {};
    const p = {}; // id -> recomputed probability
    nodes.forEach((n) => {
      byId[n.id] = n;
      p[n.id] = (n.type === "root" || n.type === "intervention") ? 1 : 0;
    });
    const ordered = edges.slice().sort((a, b) =>
      ((byId[a.source] && byId[a.source].level) || 0) - ((byId[b.source] && byId[b.source].level) || 0));
    ordered.forEach((e) => {
      if (!(e.source in p) || !(e.target in p)) return;
      const cand = p[e.source] * (Number(e.weight) || 0);
      if (cand > p[e.target]) p[e.target] = cand;
    });
    let mismatches = 0;
    nodes.forEach((n) => {
      if (Math.abs((p[n.id] || 0) - (Number(n.probability) || 0)) > 1e-3) mismatches++;
    });
    return { ok: mismatches === 0, mismatches };
  }

  function buildDerivation(web, prediction, lang) {
    const l = L(lang);
    const nodes = (web && web.nodes) || [];
    const edges = (web && web.edges) || [];
    const N = nodes.length, E = edges.length;
    const nRoots = nodes.filter((n) => n.type === "root" || n.type === "intervention").length;
    const steps = [];
    const push = (kind, operation, latex, fallback, group, note) =>
      steps.push({ kind, operation, latex, fallback, group, note });

    if (N === 0) {
      push("note", "initial", "", l.noPrediction, "result", l.noPrediction);
      return { title: l.title, subtitle: l.subtitle, verified: false, nEvents: 0, nEdges: 0, steps };
    }

    // ---- 1. setup ---------------------------------------------------------
    push("rule", "initial",
      `P\\colon\\mathcal{X}\\to[0,1],\\qquad \\mathcal{X}=\\{x_1,\\ldots,x_{${N}}\\}`,
      `P: X → [0,1],  X = {x_1, …, x_${N}}`,
      "setup", `${N} ${l.events} · ${E} ${l.links}`);
    push("equation", "initial",
      `P(x)=1\\quad\\forall x\\in\\mathcal{R},\\qquad |\\mathcal{R}|=${nRoots}`,
      `P(x)=1 for every starting event (${nRoots} roots/interventions)`,
      "setup", l.initNote);

    // ---- 2. propagation (the recurrence) ----------------------------------
    push("equation", "transformation",
      `P(x)=\\max_{u\\to x}\\Bigl[\\,P(u)\\,w_{ux}\\,\\Bigr]`,
      `P(x) = max over causes u→x of [ P(u) · w_ux ]`,
      "propagation", l.recurrence);
    push("equation", "transformation",
      `P(x_i)=\\max_{j\\in\\operatorname{Pa}(i)} P(x_j)\\,W_{ji},\\qquad i=1,\\ldots,${N}`,
      `P(x_i) = max over parents j of P(x_j)·W_ji`,
      "propagation", l.indexed);
    push("equation", "transformation",
      `\\mathbf{p}^{(t+1)}=W^{\\top}\\boxtimes\\mathbf{p}^{(t)},\\qquad p^{(t+1)}_i=\\max_{j}\\bigl(p^{(t)}_j\\,W_{ji}\\bigr)`,
      `p^(t+1) = max-times product of Wᵀ and p^(t)`,
      "propagation", l.matrix);
    push("equation", "transformation",
      `\\ell(x)=\\log P(x),\\qquad \\ell(x)=\\max_{u\\to x}\\bigl[\\ell(u)+\\log w_{ux}\\bigr]`,
      `ℓ(x) = log P(x);  ℓ(x) = max over u→x of [ ℓ(u) + log w_ux ]`,
      "propagation", l.tropicalNote);

    // ---- 3. concrete dominant chain --------------------------------------
    const chain = (prediction && prediction.most_likely_chain) || null;
    const hasPred = !!chain && chain.length > 0;
    if (hasPred) {
      const byId = {};
      nodes.forEach((n) => { byId[n.id] = n; });
      const cn = chain.map((id) => byId[id]).filter(Boolean);
      for (let t = 1; t < cn.length; t++) {
        const child = cn[t], parent = cn[t - 1];
        const e = edges.find((ed) => ed.source === parent.id && ed.target === child.id);
        const w = e ? Number(e.weight) || 0 : 0;
        const pPar = Number(parent.probability) || 0;
        const pChild = Number(child.probability) || 0;
        const nPar = edges.filter((ed) => ed.target === child.id).length;

        // ---- 3a. the engine's phenomenon-specific derivation for this node (network→math) ----
        const formula = (child.formula) || (e && e.formula) || "";
        const formulaPlain = (child.formula_plain) || (e && e.formula_plain) || "";
        const op = (child.operator) || (e && e.operator) || "";
        const unc = (child.uncertainty != null) ? child.uncertainty : (e && e.uncertainty);
        const assumptions = Array.isArray(child.assumptions) ? child.assumptions : [];
        if (formulaPlain) {
          push("equation", "transformation", formula || "",
            formulaPlain, "derivation",
            (op ? op + " · " : "") + "“" + (child.text || "").slice(0, 40) + "”"
            + (unc != null ? " · u≈" + Number(unc).toFixed(2) : ""));
          if (assumptions.length) {
            push("note", "assumption", "", assumptions.join(" · "), "derivation",
              assumptions.length + " asumsi eksplisit");
          }
        }
        // ---- 3b. propagation step (max-times) ----
        push("computation", t === 1 ? "substitution" : "simplification",
          `P(v_{${t}})=\\textcolor{${COL.sub}}{${num(pPar)}}\\times\\textcolor{${COL.wt}}{${num(w)}}=\\textcolor{${COL.res}}{${num(pChild)}}`,
          `P(v_${t}) = ${num(pPar)} × ${num(w)} = ${num(pChild)}`,
          "chain", (nPar > 1 ? l.maxOver(nPar) + " · " : "") + "“" + (child.text || "") + "”");
      }
      // ---- 4. result ------------------------------------------------------
      const leaf = cn[cn.length - 1];
      push("result", "simplification",
        `\\hat{Y}=\\arg\\max_{x\\in\\mathcal{X}}P(x)=v_{${cn.length - 1}},\\qquad P(\\hat{Y})=\\textcolor{${COL.res}}{${num(leaf.probability)}}`,
        `Most likely outcome: ${leaf.text}  (P = ${num(leaf.probability)})`,
        "result", l.result);
      if (prediction.top_outcomes && prediction.top_outcomes.length) {
        const tops = prediction.top_outcomes.slice(0, 3)
          .map((o) => num(o.probability)).join(" · ");
        push("note", "expand", "", tops, "result", "top outcomes · P = " + tops);
      }
    } else {
      push("note", "initial", "", l.noPrediction, "result", l.noPrediction);
    }

    // ---- 5. verification ---------------------------------------------------
    const v = verify(web, prediction);
    if (hasPred) {
      push("verify", "verify",
        v.ok
          ? `\\textcolor{${COL.ok}}{\\checkmark}\\quad \\text{${l.verifyOk}}`
          : `\\textcolor{${COL.bad}}{\\times}\\quad \\text{${l.verifyFail}}`,
        v.ok ? "✓ " + l.verifyOk : "✕ " + l.verifyFail + " (" + v.mismatches + ")",
        "verify", v.ok ? l.verifyNoteOk : l.verifyNoteFail);
    }

    return { title: l.title, subtitle: l.subtitle, verified: v.ok, nEvents: N, nEdges: E, steps };
  }

  /* ---------------------------------------------------------------- renderer */
  const state = { steps: [], cursor: 0, timer: null, lang: "en" };

  function el(id) { return document.getElementById(id); }

  function updateCounter() {
    const c = el("math-stepcount");
    if (!c) return;
    const n = state.steps.length;
    const l = L(state.lang);
    c.textContent = n ? (l.step + " " + Math.min(state.cursor + 1, n) + " / " + n) : (l.step + " 0 / 0");
  }

  function updatePlayButton() {
    const b = el("math-play");
    if (!b) return;
    const l = L(state.lang);
    b.innerHTML = state.timer ? "⏸ " + l.pause : "▶ " + l.play;
  }

  function renderStep(step, i) {
    const d = document.createElement("div");
    d.className = "math-step pending";
    d.dataset.i = i;
    const op = document.createElement("div");
    op.className = "ms-op";
    op.textContent = opLabel(step.operation, state.lang);
    const body = document.createElement("div");
    body.className = "ms-body";
    if (step.latex || step.fallback) {
      const eq = document.createElement("div");
      eq.className = "ms-eq";
      katex(eq, step.latex, step.fallback);
      body.appendChild(eq);
    }
    if (step.note) {
      const note = document.createElement("div");
      note.className = "ms-note";
      note.textContent = step.note;
      body.appendChild(note);
    }
    const nm = document.createElement("div");
    nm.className = "ms-num";
    nm.textContent = "(" + (i + 1) + ")";
    d.appendChild(op);
    d.appendChild(body);
    d.appendChild(nm);
    return d;
  }

  function setCursor(k) {
    const n = state.steps.length;
    if (!n) return;
    state.cursor = Math.max(0, Math.min(n - 1, k));
    const canvas = el("math-canvas");
    if (!canvas) return;
    canvas.querySelectorAll(".math-step").forEach((d, i) => {
      const reveal = i <= state.cursor;
      const wasPending = d.classList.contains("pending");
      d.classList.toggle("pending", !reveal);
      d.classList.toggle("active", i === state.cursor);
      if (reveal && wasPending) {
        d.classList.remove("entering");
        void d.offsetWidth; // restart the reveal animation
        d.classList.add("entering");
      }
    });
    updateCounter();
  }

  function pause() {
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    updatePlayButton();
  }

  function play() {
    if (state.timer) { pause(); return; }
    if (state.cursor >= state.steps.length - 1) setCursor(0);
    state.timer = setInterval(() => {
      if (state.cursor >= state.steps.length - 1) { pause(); return; }
      setCursor(state.cursor + 1);
    }, 720);
    updatePlayButton();
  }

  function bind() {
    const prev = el("math-prev"), next = el("math-next"),
          playb = el("math-play"), replay = el("math-replay");
    if (prev) prev.onclick = () => setCursor(state.cursor - 1);
    if (next) next.onclick = () => setCursor(state.cursor + 1);
    if (playb) playb.onclick = play;
    if (replay) replay.onclick = () => { pause(); setCursor(0); };
  }

  let lastRender = null;
  let _katexWatch = null;

  function _watchKatex() {
    // KaTeX is loaded async; if it shows up a moment after a render, upgrade
    // the plain-text fallback to real typesetting.
    if (_katexWatch) return;
    let tries = 0;
    _katexWatch = setInterval(() => {
      if (hasKatex()) { clearInterval(_katexWatch); _katexWatch = null; _renderNow(); }
      else if (++tries > 40) { clearInterval(_katexWatch); _katexWatch = null; }
    }, 100);
  }

  function render(web, prediction, lang) {
    lastRender = { web, prediction, lang: lang || "en" };
    _renderNow();
    if (!hasKatex()) _watchKatex();
  }

  function _renderNow() {
    const a = lastRender;
    if (!a) return;
    state.lang = a.lang;
    const d = buildDerivation(a.web, a.prediction, state.lang);
    state.steps = d.steps;
    const title = el("math-title");
    const status = el("math-status");
    if (title) title.textContent = d.title;
    if (status) status.textContent = d.subtitle;
    const canvas = el("math-canvas");
    if (canvas) {
      canvas.innerHTML = "";
      d.steps.forEach((s, i) => canvas.appendChild(renderStep(s, i)));
    }
    const prevCursor = state.cursor;
    setCursor(Math.min(prevCursor, d.steps.length - 1));
    updatePlayButton();
  }

  window.MathViz = {
    render: render,
    bind: bind,
    buildDerivation: buildDerivation,
    verify: verify,
    hasContent: () => state.steps.length > 0,
  };

  if (typeof document !== "undefined" && document.readyState !== "loading") {
    bind();
  } else if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", bind);
  }
})();
