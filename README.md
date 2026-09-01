<div align="center">

# ◈ Riak

**A self-contained causal prediction engine.**

*Paste a scenario — Riak maps the web of consequences and computes the most likely outcome chain.*

[English](#english) · [Bahasa Indonesia](#bahasa-indonesia)

</div>

---

## English

**Riak** turns a piece of text — a news story, a policy draft, a decision, a
"what if" question — into a branching **cause → effect web** of events, then
computes the most likely outcome chain through it.

It runs **instantly with zero dependencies and zero API keys**, using a
deterministic rule-based causal engine — and *optionally* upgrades its
reasoning with any OpenAI-compatible LLM when you provide a key.

Originally inspired by the multi-agent concept of
[666ghj/MiroFish](https://github.com/666ghj/MiroFish), Riak is an original,
independent implementation built around causal event webs instead of a cloud
agent stack.

### What it does

1. **Map the consequences** — paste a scenario. The engine extracts the root
   events and expands them into a cause → effect web: what this causes, and
   what those cause next (configurable branching, depth, and node cap).
2. **Predict with confidence** — a max-times causal propagation pass scores
   every node and reports the **most likely outcome chain with a timeline**
   (when each effect materialises). A built-in **Monte-Carlo ensemble**
   re-runs the web with jittered edge weights and reports P10–P90
   **confidence intervals** and chain stability.
3. **Intervene & compare** — add counterfactual interventions ("and if a
   subsidy is announced…"), then **A/B-compare up to 4 intervention scenarios
   side by side**. A sensitivity sweep shows how the prediction responds to
   any single causal link.
4. **Interrogate** — chat about any event node, grow the web around it
   (`develop`), or edit the graph directly (relabel, reweight, connect,
   delete nodes) with full **undo/redo**. User edits can even create
   **feedback loops** (protest → repression → bigger protest) — propagation
   iterates until it converges.
5. **Derive the math** — every prediction ships with a step-by-step
   **mathematical derivation** (KaTeX-rendered, replayable): qualitative sign
   chains, and quantitative mechanisms (kinetic braking, wet-road traction,
   travel time, **SIR epidemics, price elasticity, compound growth**) when the
   scenario is numeric.
6. **Export** — JSON, Markdown, a **self-contained static HTML report**, or a
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

Requires **Python 3.9+** (standard library only — nothing to install).

Optional LLM — connect any OpenAI-compatible provider (OpenAI, DeepSeek,
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
backtest.py          backtesting CLI — run: python3 backtest.py
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
`{"async": true}` → `202 {job_id}`; poll `GET /api/jobs/:id` for the result.
Requests are limited to 2 MB and rate-limited per IP (default 600/min,
`RIAK_RATE_LIMIT`). Logs go to stderr and a rotating `server.log`.

### Custom knowledge-base packs

Drop JSON files into `kb/` to extend the offline rule-based engine with your
own domains (bilingual rules, weights, polarities) — see `kb/README.md` and
the included `crypto-regulation.json` example. Reload with a server restart
or `engine.causal.reload_kb()`.

### Testing

```bash
python3 test_causal.py        # engine validator & integration
python3 test_mech.py          # quantitative mechanisms
python3 test_determinism.py   # same seed → identical web (advertised property)
python3 test_api.py           # HTTP endpoint integration
python3 backtest.py           # historical-scenario scorecard (hit@6, Brier)
```

All suites run in CI via GitHub Actions (Python 3.9 + 3.12).

### License

MIT — an original implementation, independent of the AGPL-licensed MiroFish
codebase. The swarm-intelligence *concept* is shared; no code was copied.

---

## Bahasa Indonesia

**Riak** mengubah sebuah teks — berita, draf kebijakan, keputusan, pertanyaan
"bagaimana jika" — menjadi **jaring sebab → akibat** yang bercabang, lalu
menghitung rantai hasil yang paling mungkin terjadi.

Aplikasinya langsung jalan **tanpa dependensi dan tanpa kunci API**, memakai
mesin kausal rule-based yang deterministik — dan *opsional* naik kelas memakai
LLM apa pun yang kompatibel dengan OpenAI jika kamu beri kuncinya.

### Alur

1. **Petakan konsekuensi** — tempel skenario. Mesin mengekstrak peristiwa akar
   lalu mengembangkannya menjadi jaring sebab → akibat (jumlah cabang,
   kedalaman, dan batas node bisa diatur).
2. **Prediksi dengan keyakinan** — propagasi kausal max-times menilai setiap
   node dan melaporkan **rantai hasil paling mungkin beserta linimasanya**.
   **Ensemble Monte-Carlo** bawaan menjalankan ulang jaring dengan bobot yang
   diacak dan melaporkan **interval keyakinan** P10–P90 plus stabilitas rantai.
3. **Intervensi & bandingkan** — tambahkan intervensi kontrafaktual ("dan
   kalau subsidi diumumkan…"), lalu **bandingkan hingga 4 skenario intervensi
   berdampingan (A/B)**. Sweep sensitivitas memperlihatkan respons prediksi
   terhadap setiap mata rantai kausal.
4. **Interogasi** — diskusikan node peristiwa mana pun, kembangkan jaring di
   sekitarnya, atau edit graf langsung (ubah label, bobot, sambungan, hapus)
   dengan **undo/redo** penuh. Edit pengguna bahkan bisa membentuk **feedback
   loop** (protes → represi → protes membesar) — propagasi beriterasi sampai
   konvergen.
5. **Derivasi matematika** — setiap prediksi disertai derivasi langkah demi
   langkah (dirender KaTeX, bisa diputar ulang): rantai tanda kualitatif, dan
   mekanisme kuantitatif (pengereman, traksi, waktu tempuh, **SIR epidemi,
   elastisitas harga, compound growth**) untuk skenario numerik.
6. **Ekspor** — JSON, Markdown, **laporan HTML statis mandiri**, atau PNG
   jaring kausal.

### Cara pakai

```bash
python3 server.py          # atau: ./run.sh
# buka http://127.0.0.1:8000
```

Cukup Python 3.9+ (hanya pustaka standar). Untuk mode LLM opsional, salin
`.env.example` ke `.env`, isi `LLM_API_KEY`, lalu jalankan ulang — atau atur
langsung dari tombol **⚙** di antarmuka.

### Pengujian

```bash
python3 test_causal.py
```

### Lisensi

MIT — implementasi orisinal, independen dari kode MiroFish (AGPL).
