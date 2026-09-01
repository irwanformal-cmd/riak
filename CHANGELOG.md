# Changelog

All notable changes to Riak are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **Parallel LLM calls**: expansion chunks within a level and A/B compare
  scenarios now run concurrently (RIAK_LLM_WORKERS, default 4) — a level
  with many events costs one chunk's latency instead of N, and 4 scenarios
  ≈ the wall-time of 1 on providers that parallelize
- **Turbo build mode** (opt-in checkbox): one parallel LLM call per root
  generates its whole subtree; every node still passes the engine's
  validate→derive gate, with per-root rule-based fallback. Best on
  latency-bound providers; generation-bound models gain little
- **Live web growth**: the canvas now shows the causal web being built from
  zero, wave by wave, synchronised with the engine (roots appear first, each
  expansion wave animates in). The backend streams partial-web snapshots
  through the async job record; the renderer grows new nodes beside their
  parents without moving existing ones. After the build the web stays on
  screen next to the intervention setup
- **URL import**: paste a link, Riak fetches the page and fills the scenario
  box (title auto-fills the project name). SSRF-hardened: http/https only,
  private/loopback/link-local/reserved IPs rejected at every redirect hop,
  1 MB cap, 10 s timeout, robots.txt honoured, heavy-tier rate limited
- **File import**: upload a local .txt/.md as the scenario seed (read fully
  in the browser — nothing is uploaded to the server)
- 6 new tests covering the SSRF guard and text extraction

## [1.0.0]

### Added
- Causal-web prediction engine: deterministic rule-based core with optional
  OpenAI-compatible LLM enhancement (any provider)
- Monte-Carlo ensemble predictions with P10–P90 confidence intervals
- Prediction timeline with per-edge delay estimates and horizon in days
- Feedback-loop detection (multi-pass propagation)
- What-if interventions, A/B scenario comparison (up to 4), per-edge
  sensitivity analysis (∂ sparklines)
- Quantitative mechanism models: braking, traction, travel time,
  dose-response, learning curve, SIR epidemic, price elasticity,
  compound growth — with engine-verified derivations
- Custom knowledge-base packs (`kb/*.json`, hot-reloadable)
- Historical backtesting harness (`backtest.py` + `backtests/`)
- Async job pattern for long builds (HTTP 202 + polling), live trajectory
  panel, live processing animation in the UI
- LLM response cache (FIFO 500, disk-persisted)
- Undo/redo (20 steps), event search, root-path highlighting in the canvas
- Export: JSON, Markdown, standalone HTML report
- Multi-language UI: English, Bahasa Indonesia, 中文
- Light/dark/auto themes, mobile-responsive layout
- Donate dropdown (Buy Me a Coffee, Saweria)

### Security
- Same-origin enforcement (removed CORS `*`) — blocks browser drive-by
  attacks against local instances
- Optional bearer-token auth (`RIAK_TOKEN`) with loud warning when binding
  beyond localhost without it
- Tiered rate limiting for LLM-spending endpoints (`RIAK_RATE_LIMIT_HEAVY`)
- Sensitive files (`llm_config.json`, projects, LLM cache) written `0600`
- 500 responses no longer leak internal exception details
- Security headers: `X-Content-Type-Options`, `Referrer-Policy`,
  `X-Frame-Options`
- 2 MB request-body cap (413)

### Notes
- Renamed from the project's earlier working title to **Riak**; legacy
  `MIROFISH_*` / `WANION_*` env vars remain as fallbacks
- Zero runtime dependencies: Python 3.9+ standard library only
