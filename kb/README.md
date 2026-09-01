# Custom knowledge-base packs

Drop JSON files here to extend Wanion's **offline** causal knowledge base — no
code changes needed. Each file is one domain pack:

```json
{
  "name": "my-domain",
  "pattern": "\\b(crypto|bitcoin|token)\\b",
  "rules": [
    {"en": "exchanges face liquidity pressure", "id": "bursa kripto menghadapi tekanan likuiditas",
     "relation": "leads_to", "weight": 0.6, "polarity": -0.4}
  ]
}
```

Fields per rule:

| field | meaning | range |
|---|---|---|
| `en` / `id` | consequence text (English / Bahasa Indonesia; `id` falls back to `en`) | 2–200 chars |
| `relation` | edge label: `causes`, `leads_to`, `increases`, `decreases`, `enables`, `prevents`, `weakens`, `triggers` | — |
| `weight` | how likely the consequence follows | 0.0–1.0 |
| `polarity` | how good/bad the consequence is | −1.0–1.0 |

Notes:

- `pattern` is a regex matched against the **event text** (case-insensitive
  keywords recommended, include Indonesian terms if you want bilingual reach).
- Packs are loaded once and cached; call `engine.causal.reload_kb()` (or restart
  the server) after adding/changing files.
- Invalid files are skipped silently — the engine always runs.
- See `crypto-regulation.json` for a complete example.
