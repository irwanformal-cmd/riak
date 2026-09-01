# Changelog

All notable changes to Riak are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
