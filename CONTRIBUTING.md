# Contributing to Riak

Terima kasih sudah mau berkontribusi! · Thanks for wanting to contribute!
This file is bilingual-ish: English first, ringkasan Bahasa di bawah.

## The two easiest ways to contribute (no deep code knowledge needed)

### 1. Add a knowledge-base pack (`kb/*.json`)

KB packs teach the **offline** engine new domains — pure JSON, no Python:

```json
{
  "name": "my-domain",
  "pattern": "keyword|another keyword|kata kunci",
  "rules": [
    ["cause text (en)", "teks sebab (id)", "leads_to", 0.75, -0.5]
  ]
}
```

Rule format: `[cause_en, cause_id, relation, probability, polarity]`
(relation ∈ `leads_to|causes|triggers|results_in`, polarity −1…+1).
Drop the file in `kb/`, restart, done. See `kb/README.md` and
`kb/crypto-regulation.json` for a full example. Great first PRs: packs for
sports, gaming, Indonesian politics, climate, startups…

### 2. Add a quantitative mechanism (`engine/mech.py`)

If a domain has real math (like the existing braking / SIR / elasticity
models), add an operator: implement `def my_model(inputs, lang)`,
register it in `_OPERATORS`, add a keyword branch in `mecher_derive`,
and write tests in `test_mech.py` following the existing pattern.

## Code contributions

**Setup**: none — Python 3.9+ standard library only. No pip install, no
build step. `python3 server.py` and you're running.

**Before submitting a PR**

```sh
python3 test_causal.py && python3 test_mech.py && \
python3 test_determinism.py && python3 test_api.py && python3 test_llm_cache.py
node --check static/app.js   # if you touched frontend
```

All must pass (CI runs the same on Python 3.9 and 3.12).

**House rules**

- **Stdlib only** for anything the server imports — this is a core design
  principle, not a preference. (Dev-tooling exceptions can be discussed.)
- Keep Python 3.9 compatibility (no 3.10+ syntax).
- The engine is the authority over LLM output: validate, don't trust.
- UI strings must be added to all three locales (`en`, `id`, `zh`) in
  `static/app.js`.
- Frontend is build-free vanilla JS — no frameworks, no bundlers.
- Determinism matters: same seed → same web. Never call `random` without
  the seeded `rng`.

**Commit style**: short imperative summary; explain *why* in the body.

## Ringkasan (Bahasa Indonesia)

- Cara termudah berkontribusi: **tambah KB pack** di `kb/` (JSON murni,
  tanpa coding) atau **model mekanisme kuantitatif** di `engine/mech.py`.
- Tanpa dependency: cukup Python 3.9+. Jalankan semua test sebelum PR.
- Aturan utama: stdlib only, kompatibel Python 3.9, string UI ditambahkan
  ke 3 bahasa, dan engine tetap deterministik per seed.

## Questions?

Open a discussion/issue — pertanyaan dalam Bahasa Indonesia sangat diterima.
