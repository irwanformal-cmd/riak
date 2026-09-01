# Security Policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security reports.
Instead, email the maintainer (see the GitHub profile) or use
**GitHub → Security → Report a vulnerability** (private advisory).

Please include: affected version, reproduction steps, and impact.
You will get a first response within a few days.

## Security model — read before deploying

Riak is designed as a **local, single-user application**. The defaults are
safe for that use; exposing it to a network needs extra care.

**Stored secrets.** The LLM API key is stored in **plaintext** at
`data/llm_config.json` (written with owner-only `0600` permissions).
Projects and the LLM cache (`data/llm_cache.json`) may contain private
scenario text and are also written `0600`. Protect the `data/` directory
accordingly, and never commit it.

**Defaults that protect you**

- Binds to `127.0.0.1` only.
- Same-origin enforcement: browsers cannot call the API from other origins
  (no CORS headers are sent), which blocks "drive-by" attacks from
  malicious websites against your local instance.
- Per-IP rate limits, plus a stricter tier for endpoints that spend LLM
  quota (`RIAK_RATE_LIMIT_HEAVY`, default 30/min).
- 2 MB request-body cap.

**Exposing Riak to a network (multi-user / public demo)**

1. Set a strong `RIAK_TOKEN` — every `/api/*` call then requires
   `Authorization: Bearer <token>`. The server prints a loud warning if
   you bind a non-localhost host without it.
2. Put it behind TLS (a reverse proxy such as Caddy/nginx) — the token is
   sent as a header and must not travel over plain HTTP.
3. Review `RIAK_RATE_LIMIT` / `RIAK_RATE_LIMIT_HEAVY` for your budget.
4. Treat the LLM provider as a cost surface: anyone who can reach the API
   can spend your quota within the rate limits.

**Out of scope (by design):** multi-user isolation, per-user quotas, and
sandboxing of LLM output beyond the built-in schema/whitelist validation.
If you need these, run separate instances per user.
