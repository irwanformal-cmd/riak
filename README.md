<div align="center">

<img src="assets/logo.png" alt="Riak logo" width="120">

# Riak

**A self-contained causal prediction engine.**

*Paste a scenario. Riak maps the web of consequences and computes the most likely outcome chain.*

[![tests](https://github.com/irwanformal-cmd/riak/actions/workflows/test.yml/badge.svg)](https://github.com/irwanformal-cmd/riak/actions/workflows/test.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![python: 3.9+](https://img.shields.io/badge/python-3.9%2B-blue.svg)](https://www.python.org)
[![dependencies: zero](https://img.shields.io/badge/dependencies-zero-brightgreen.svg)](#key-properties)

[English](#english) · [Bahasa Indonesia](#bahasa-indonesia) · [中文](#中文)

</div>

---

## English

**Riak** turns a piece of text (a news story, a policy draft, a decision, a
"what if" question) into a branching **cause → effect web** of events, then
computes the most likely outcome chain through it.

It runs **instantly with zero dependencies and zero API keys**, using a
deterministic rule-based causal engine. Optionally, it upgrades its
reasoning with any OpenAI-compatible LLM when you provide a key.

Originally inspired by the multi-agent concept of
[666ghj/MiroFish](https://github.com/666ghj/MiroFish), Riak is an original,
independent implementation built around causal event webs instead of a cloud
agent stack.

### What it does

1. **Map the consequences:** paste a scenario, **import it from a URL**, or
   **upload a .txt/.md file**. The engine extracts the root
   events and expands them into a cause → effect web: what this causes, and
   what those cause next (configurable branching, depth, and node cap).
   URL fetching is SSRF-hardened (public IPs only, per-hop redirect checks,
   size/time caps, robots.txt respected).
2. **Predict with confidence:** a max-times causal propagation pass scores
   every node and reports the **most likely outcome chain with a timeline**
   (when each effect materialises). A built-in **Monte-Carlo ensemble**
   re-runs the web with jittered edge weights and reports P10–P90
   **confidence intervals** and chain stability.
3. **Intervene and compare:** add counterfactual interventions ("and if a
   subsidy is announced…"), then **A/B-compare up to 4 intervention scenarios
   side by side**. A sensitivity sweep shows how the prediction responds to
   any single causal link.
4. **Interrogate:** chat about any event node, grow the web around it
   (`develop`), or edit the graph directly (relabel, reweight, connect,
   delete nodes) with full **undo/redo**. User edits can even create
   **feedback loops** (protest → repression → bigger protest). Propagation
   then iterates until it converges.
5. **Derive the math:** every prediction ships with a step-by-step
   **mathematical derivation** (KaTeX-rendered, replayable): qualitative sign
   chains, and quantitative mechanisms (kinetic braking, wet-road traction,
   travel time, **SIR epidemics, price elasticity, compound growth**) when the
   scenario is numeric.
6. **Export:** JSON, Markdown, a **self-contained static HTML report**, or a
   PNG of the causal network.

### Key properties

| | Riak |
|---|---|
| Runs offline / no API key | ✅ deterministic rule-based engine |
| LLM integration | ✅ optional, any OpenAI-compatible endpoint |
| Reproducible runs | ✅ deterministic per seed |
| Editable causal graph | ✅ nodes & edges are first-class |
| Live engine trajectory | ✅ watch each build/simulate step as it happens |
| Quantitative mechanisms | ✅ physics models for numeric scenarios |
| Multilingual | ✅ English · Bahasa Indonesia · 中文 |
| Install friction | ✅ `python3 server.py` only |

### Quick start

```bash
python3 server.py          # or: ./run.sh
# open http://127.0.0.1:8000
```

Requires **Python 3.9+** (standard library only, nothing to install).

Optional LLM: connect any OpenAI-compatible provider (OpenAI, DeepSeek,
Qwen/DashScope, Ollama, LM Studio, or a custom endpoint). Easiest way is the
**⚙ settings** button in the UI: pick a provider preset, paste the base
URL / model / key, then **Test connection**. Config is saved to
`data/llm_config.json` and takes priority over environment variables:

```bash
cp .env.example .env       # edit and add LLM_API_KEY / LLM_BASE_URL / LLM_MODEL_NAME
python3 server.py
```

Without a provider, Riak runs fully offline on its deterministic rule-based
engine.

### Architecture

```
server.py            stdlib HTTP server + REST API (no framework)
engine/
  causal.py          scenario → cause→effect web, prediction, Monte-Carlo
                     ensemble, interventions, graph mutations, risk detection
  mech.py            quantitative mechanisms (braking, traction, SIR, …)
  llm.py             optional OpenAI-compatible client + disk response cache
  trajectory.py      live step-by-step progress events for the UI
static/              no-build web UI (vanilla JS + Canvas + KaTeX)
samples/             example scenarios
kb/                  user-extensible offline knowledge-base packs (JSON)
backtests/           historical scenarios with known outcomes
backtest.py          backtesting CLI (run: python3 backtest.py)
test_*.py            test suites (engine, mechanisms, determinism, HTTP API)
```

### REST API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health`, `/api/config`, `/api/samples` | status, LLM config, samples |
| `GET` | `/api/projects`, `/api/projects/:id` | list / detail |
| `GET` | `/api/trajectory?job=:id` | live progress events for a running job |
| `GET` | `/api/jobs/:id` | poll an async job (`POST` with `{"async": true}`) |
| `POST` | `/api/projects` | build a causal web from `{name, seed_text, seed, config}` |
| `POST` | `/api/simulate` | run prediction (+ interventions, + Monte-Carlo ensemble) |
| `POST` | `/api/report` | narrative causal report |
| `POST` | `/api/chat` | discuss an event node |
| `POST` | `/api/develop` | grow the web around a node |
| `POST` | `/api/derive` | mathematical derivation for a node |
| `POST` | `/api/graph` | edit the graph (mutations) |
| `POST` | `/api/undo`, `/api/redo` | walk the edit history |
| `POST` | `/api/compare` | A/B-compare 1–4 intervention scenarios |
| `POST` | `/api/sensitivity` | sweep one edge's weight, see the response curve |
| `POST` | `/api/export` | `json`, `markdown`, or self-contained `html` export |
| `GET`/`POST` | `/api/llm-config`, `/api/llm-test` | provider settings & connection test |
| `POST` | `/api/llm-cache-clear` | flush the LLM response cache |

Heavy endpoints (`/api/projects`, `/api/simulate`, `/api/develop`) accept
`{"async": true}` which returns `202 {job_id}`. Poll `GET /api/jobs/:id` for
the result.
Requests are limited to 2 MB and rate-limited per IP (default 600/min,
`RIAK_RATE_LIMIT`). Logs go to stderr and a rotating `server.log`.

### Custom knowledge-base packs

Drop JSON files into `kb/` to extend the offline rule-based engine with your
own domains (bilingual rules, weights, polarities). See `kb/README.md` and
the included `crypto-regulation.json` example. Reload with a server restart
or `engine.causal.reload_kb()`.

### Testing

```bash
python3 test_causal.py        # engine validator & integration
python3 test_mech.py          # quantitative mechanisms
python3 test_determinism.py   # same seed → identical web (advertised property)
python3 test_api.py           # HTTP endpoint integration
python3 test_llm_cache.py     # LLM cache (incl. concurrency regression)
python3 backtest.py           # historical-scenario scorecard (hit@6, Brier)
```

All suites run in CI via GitHub Actions (Python 3.9 + 3.12).

### Docker

```bash
docker build -t riak .
docker run -p 8000:8000 -v riak-data:/app/data riak
# open http://127.0.0.1:8000
```

### Roadmap

Where Riak is heading. Contributions and discussion welcome:

- **Decision mode:** frame a question as A-vs-B and get a scored
  recommendation, not just two predictions
- **Reference-class forecasting:** anchor probabilities to base rates of
  similar past events (the biggest known accuracy lever)
- **Plugin packs + registry:** community KB/scenario/locale packs with
  one-click install (PR-curated, no marketplace infra)
- **Prediction tracking:** re-run a scenario over time and watch the
  forecast drift
- **Calibration layer:** probabilities fitted against the backtest corpus
- **Job cancellation & in-flight LLM dedup**

See [CHANGELOG.md](CHANGELOG.md) for what already shipped.

### License

MIT. An original implementation, independent of the AGPL-licensed MiroFish
codebase. The swarm-intelligence *concept* is shared; no code was copied.
Third-party assets (KaTeX, fonts) are credited in [NOTICE](NOTICE).

---

## Bahasa Indonesia

**Riak** mengubah sebuah teks (berita, draf kebijakan, keputusan, pertanyaan
"bagaimana jika") menjadi **jaring sebab → akibat** yang bercabang, lalu
menghitung rantai hasil yang paling mungkin terjadi.

Aplikasinya langsung jalan **tanpa dependensi dan tanpa kunci API**, memakai
mesin kausal rule-based yang deterministik. Secara *opsional*, ia bisa naik
kelas memakai LLM apa pun yang kompatibel dengan OpenAI jika kamu beri
kuncinya.

### Alur

1. **Petakan konsekuensi:** tempel skenario. Mesin mengekstrak peristiwa akar
   lalu mengembangkannya menjadi jaring sebab → akibat (jumlah cabang,
   kedalaman, dan batas node bisa diatur).
2. **Prediksi dengan keyakinan:** propagasi kausal max-times menilai setiap
   node dan melaporkan **rantai hasil paling mungkin beserta linimasanya**.
   **Ensemble Monte-Carlo** bawaan menjalankan ulang jaring dengan bobot yang
   diacak dan melaporkan **interval keyakinan** P10–P90 plus stabilitas rantai.
3. **Intervensi dan bandingkan:** tambahkan intervensi kontrafaktual ("dan
   kalau subsidi diumumkan…"), lalu **bandingkan hingga 4 skenario intervensi
   berdampingan (A/B)**. Sweep sensitivitas memperlihatkan respons prediksi
   terhadap setiap mata rantai kausal.
4. **Interogasi:** diskusikan node peristiwa mana pun, kembangkan jaring di
   sekitarnya, atau edit graf langsung (ubah label, bobot, sambungan, hapus)
   dengan **undo/redo** penuh. Edit pengguna bahkan bisa membentuk **feedback
   loop** (protes → represi → protes membesar). Propagasi lalu beriterasi
   sampai konvergen.
5. **Derivasi matematika:** setiap prediksi disertai derivasi langkah demi
   langkah (dirender KaTeX, bisa diputar ulang): rantai tanda kualitatif, dan
   mekanisme kuantitatif (pengereman, traksi, waktu tempuh, **SIR epidemi,
   elastisitas harga, compound growth**) untuk skenario numerik.
6. **Ekspor:** JSON, Markdown, **laporan HTML statis mandiri**, atau PNG
   jaring kausal.

### Cara pakai

```bash
python3 server.py          # atau: ./run.sh
# buka http://127.0.0.1:8000
```

Cukup Python 3.9+ (hanya pustaka standar). Untuk mode LLM opsional, salin
`.env.example` ke `.env`, isi `LLM_API_KEY`, lalu jalankan ulang. Atau atur
langsung dari tombol **⚙** di antarmuka.

### Pengujian

```bash
python3 test_causal.py
```

### Roadmap

Lihat bagian [Roadmap](#roadmap) di atas: mode keputusan A-vs-B, base rates,
plugin registry, impor URL, pelacakan prediksi, dan kalibrasi.

### Lisensi

MIT. Implementasi orisinal yang independen dari kode MiroFish (AGPL).
Aset pihak ketiga (KaTeX, font) dicatat di [NOTICE](NOTICE).

---

## 中文

**Riak** 把一段文本（新闻、政策草案、决策、"如果……会怎样"的问题）转化成
分支式的**因果事件网络**，然后计算出最可能的结果链。

它开箱即用，**零依赖、零 API 密钥**，基于确定性规则因果引擎运行。如果你
提供密钥，它也可以接入任何兼容 OpenAI 的 LLM 来增强推理能力。

### 工作流程

1. **绘制后果图谱：**粘贴情景，**从 URL 导入**，或**上传 .txt/.md 文件**。
   引擎提取根事件并扩展为因果网络：这件事导致什么，这些结果又引发什么
   （分支数、深度、节点上限均可配置）。
2. **带置信度的预测：**max-times 因果传播为每个节点打分，给出**最可能的
   结果链及时间线**（每个效应何时发生）。内置 **Monte-Carlo 集成**用抖动
   后的边权重重复运行，给出 P10–P90 **置信区间**和链稳定性。
3. **干预与对比：**加入反事实干预（"如果宣布补贴……"），然后**并排 A/B
   对比最多 4 种干预情景**。灵敏度扫描展示预测对每一条因果边的响应。
4. **追问：**与任意事件节点对话，在其周围扩展网络，或直接编辑图谱
   （改标签、改权重、连边、删节点），支持完整**撤销/重做**。用户编辑
   甚至可以形成**反馈回路**（抗议 → 镇压 → 更大规模抗议），传播会迭代
   至收敛。
5. **数学推导：**每次预测都附带逐步**数学推导**（KaTeX 渲染，可回放）：
   定性符号链，以及数值情景下的定量机制（刹车制动、湿滑路面牵引力、
   行程时间、**SIR 传染病、价格弹性、复合增长**）。
6. **导出：**JSON、Markdown、**独立静态 HTML 报告**或因果网络 PNG。

### 快速上手

```bash
python3 server.py          # 或：./run.sh
# 打开 http://127.0.0.1:8000
```

仅需 Python 3.9+（只用标准库，无需安装任何东西）。可选的 LLM 模式：把
`.env.example` 复制为 `.env`，填入 `LLM_API_KEY` 后重启，或直接在界面
点击 **⚙** 按钮设置。

### 测试

```bash
python3 test_causal.py        # 引擎验证与集成测试
python3 test_mech.py          # 定量机制测试
python3 test_determinism.py   # 相同种子得到相同网络
python3 test_api.py           # HTTP 接口集成测试
python3 backtest.py           # 历史情景评分
```

### 路线图

见上文 [Roadmap](#roadmap)：A-vs-B 决策模式、基准概率、插件库、预测
追踪和校准层。

### 许可证

MIT。原创实现，独立于 MiroFish 代码（AGPL）。第三方资产（KaTeX、
字体）见 [NOTICE](NOTICE)。
