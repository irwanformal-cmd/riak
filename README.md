<div align="center">

# ◈ Wanion

**A self-contained causal prediction engine.**

*Paste a scenario — Wanion maps the web of consequences and computes the most likely outcome chain.*

[English](#english) · [Bahasa Indonesia](#bahasa-indonesia)

</div>

---

## English

**Wanion** turns a piece of text — a news story, a policy draft, a decision, a
"what if" question — into a branching **cause → effect web** of events, then
computes the most likely outcome chain through it.

It runs **instantly with zero dependencies and zero API keys**, using a
deterministic rule-based causal engine — and *optionally* upgrades its
reasoning with any OpenAI-compatible LLM when you provide a key.

Originally inspired by the multi-agent concept of
[666ghj/MiroFish](https://github.com/666ghj/MiroFish), Wanion is an original,
independent implementation built around causal event webs instead of a cloud
agent stack.

### What it does

1. **Map the consequences** — paste a scenario. The engine extracts the root
   events and expands them into a cause → effect web: what this causes, and
   what those cause next (configurable branching, depth, and node cap).
2. **Predict** — a max-times causal propagation pass scores every node and
   reports the **most likely outcome chain**, plus detected risks.
3. **Intervene** — add counterfactual interventions ("and if a subsidy is
   announced…") and see how the web and the prediction change.
4. **Interrogate** — chat about any event node, grow the web around it
   (`develop`), or edit the graph directly (relabel, reweight, connect,
   delete nodes).
5. **Derive the math** — every prediction ships with a step-by-step
   **mathematical derivation** (KaTeX-rendered, replayable): qualitative sign
   chains, and quantitative physical mechanisms (kinetic braking, wet-road
   traction, travel time) when the scenario is numeric.
6. **Export** — JSON, Markdown report, or a PNG of the causal network.

### Key properties

| | Wanion |
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

Without a provider, Wanion runs fully offline on its deterministic rule-based
engine.

### Architecture

```
server.py            stdlib HTTP server + REST API (no framework)
engine/
  causal.py          scenario → cause→effect web, prediction, interventions,
                     graph mutations, node explanation, risk detection
  mech.py            quantitative physical mechanisms (braking, traction, …)
  llm.py             optional OpenAI-compatible client (stdlib only)
  trajectory.py      live step-by-step progress events for the UI
static/              no-build web UI (vanilla JS + Canvas + KaTeX)
samples/             example scenarios
test_causal.py       engine test suite — run: python3 test_causal.py
```

### REST API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health`, `/api/config`, `/api/samples` | status, LLM config, samples |
| `GET` | `/api/projects`, `/api/projects/:id` | list / detail |
| `GET` | `/api/trajectory?job=:id` | live progress events for a running job |
| `POST` | `/api/projects` | build a causal web from `{name, seed_text, seed, config}` |
| `POST` | `/api/simulate` | run prediction (+ interventions) |
| `POST` | `/api/report` | narrative causal report |
| `POST` | `/api/chat` | discuss an event node |
| `POST` | `/api/develop` | grow the web around a node |
| `POST` | `/api/derive` | mathematical derivation for a node |
| `POST` | `/api/graph` | edit the graph (mutations) |
| `POST` | `/api/export` | `json` or `markdown` export |
| `GET`/`POST` | `/api/llm-config`, `/api/llm-test` | provider settings & connection test |

### Testing

```bash
python3 test_causal.py
```

### License

MIT — an original implementation, independent of the AGPL-licensed MiroFish
codebase. The swarm-intelligence *concept* is shared; no code was copied.

---

## Bahasa Indonesia

**Wanion** mengubah sebuah teks — berita, draf kebijakan, keputusan, pertanyaan
"bagaimana jika" — menjadi **jaring sebab → akibat** yang bercabang, lalu
menghitung rantai hasil yang paling mungkin terjadi.

Aplikasinya langsung jalan **tanpa dependensi dan tanpa kunci API**, memakai
mesin kausal rule-based yang deterministik — dan *opsional* naik kelas memakai
LLM apa pun yang kompatibel dengan OpenAI jika kamu beri kuncinya.

### Alur

1. **Petakan konsekuensi** — tempel skenario. Mesin mengekstrak peristiwa akar
   lalu mengembangkannya menjadi jaring sebab → akibat (jumlah cabang,
   kedalaman, dan batas node bisa diatur).
2. **Prediksi** — propagasi kausal max-times menilai setiap node dan
   melaporkan **rantai hasil paling mungkin**, plus risiko yang terdeteksi.
3. **Intervensi** — tambahkan intervensi kontrafaktual ("dan kalau subsidi
   diumumkan…") dan lihat perubahan jaring serta prediksinya.
4. **Interogasi** — diskusikan node peristiwa mana pun, kembangkan jaring di
   sekitarnya, atau edit graf langsung (ubah label, bobot, sambungan, hapus).
5. **Derivasi matematika** — setiap prediksi disertai derivasi langkah demi
   langkah (dirender KaTeX, bisa diputar ulang): rantai tanda kualitatif, dan
   mekanisme fisika kuantitatif untuk skenario numerik.
6. **Ekspor** — JSON, laporan Markdown, atau PNG jaring kausal.

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
