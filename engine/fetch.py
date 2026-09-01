"""Safe URL fetching for scenario import — stdlib only.

Security model: this module fetches arbitrary user-supplied URLs on behalf of
the server, so it is built SSRF-first:

- http/https schemes only
- the target host is DNS-resolved and EVERY resulting IP must be public —
  private, loopback, link-local (incl. 169.254.169.254 cloud metadata),
  multicast and reserved ranges are rejected
- redirects are re-validated hop by hop (a public URL that 302s to an
  internal address is a classic bypass), max 3 hops
- response size is capped while streaming (never buffers a huge body)
- robots.txt is honoured on a best-effort basis (politeness, not security)

fetch_url_text() returns {"title", "text", "final_url"} or raises FetchError.
"""

import html
import ipaddress
import re
import socket
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser

USER_AGENT = "Riak/1.0 (+https://github.com/riak-engine/riak)"
MAX_BYTES = 1024 * 1024          # 1 MB body cap
MAX_REDIRECTS = 3
TIMEOUT = 10                     # seconds per request
MAX_TEXT_CHARS = 8000            # returned text is capped for the seed box
ALLOWED_CONTENT = ("text/html", "text/plain", "application/xhtml")


class FetchError(Exception):
    """User-presentable fetch failure (message is safe to show in the UI)."""


def _is_public_ip(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    return not (ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_multicast or ip.is_reserved or ip.is_unspecified)


def validate_url(url: str, allow_private: bool = False) -> str:
    """Scheme + SSRF host check. Returns the normalised URL or raises FetchError.
    `allow_private` exists ONLY for the test-suite's local stub servers."""
    url = (url or "").strip()
    if not url:
        raise FetchError("empty URL")
    parsed = urllib.parse.urlparse(url if "://" in url else "http://" + url)
    if parsed.scheme not in ("http", "https"):
        raise FetchError("only http:// and https:// URLs are supported")
    host = parsed.hostname
    if not host:
        raise FetchError("URL has no host")
    try:
        port = parsed.port
    except ValueError:   # e.g. "http://host:garbage" — malformed port
        raise FetchError("invalid URL")
    if not allow_private:
        try:
            infos = socket.getaddrinfo(host, port or (443 if parsed.scheme == "https" else 80),
                                       proto=socket.IPPROTO_TCP)
        except socket.gaierror:
            raise FetchError(f"host not found: {host}")
        ips = {info[4][0] for info in infos}
        if not ips:
            raise FetchError(f"host not found: {host}")
        for ip in ips:
            if not _is_public_ip(ip):
                raise FetchError("that URL points to a private/internal address — not allowed")
    return urllib.parse.urlunparse(parsed)


def _robots_allows(url: str) -> bool:
    """Best-effort robots.txt check. On any error we allow (politeness feature,
    not a security boundary — SSRF protection is validate_url's job)."""
    try:
        parsed = urllib.parse.urlparse(url)
        robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
        rp = urllib.robotparser.RobotFileParser()
        req = urllib.request.Request(robots_url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=5) as resp:
            rp.parse(resp.read(64 * 1024).decode("utf-8", "replace").splitlines())
        return rp.can_fetch(USER_AGENT, url)
    except Exception:  # noqa: BLE001
        return True


class _GuardedRedirect(urllib.request.HTTPRedirectHandler):
    """Re-validate every redirect hop against the SSRF rules."""

    def __init__(self, allow_private: bool):
        self._allow_private = allow_private
        self.hops = 0
        super().__init__()

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        self.hops += 1
        if self.hops > MAX_REDIRECTS:
            raise FetchError(f"too many redirects (max {MAX_REDIRECTS})")
        validate_url(newurl, allow_private=self._allow_private)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_TAG_RE = re.compile(r"<[^>]+>")
_STRIP_BLOCKS_RE = re.compile(
    r"<(script|style|noscript|svg|nav|footer|header|form|aside)\b[^>]*>.*?</\1>",
    re.IGNORECASE | re.DOTALL)
_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)
_WS_RE = re.compile(r"[ \t\r\f\v]+")
_BLANKLINES_RE = re.compile(r"\n\s*\n+")


def extract_text(raw: str):
    """HTML → (title, readable text). Deliberately simple: good enough for
    article pages; JS-rendered SPAs and paywalls are a known limitation."""
    title = ""
    m = _TITLE_RE.search(raw)
    if m:
        title = html.unescape(m.group(1)).strip()
    body = _STRIP_BLOCKS_RE.sub("\n", raw)
    body = re.sub(r"<(br|p|div|li|h[1-6]|tr)\b[^>]*>", "\n", body, flags=re.IGNORECASE)
    body = _TAG_RE.sub(" ", body)
    body = html.unescape(body)
    lines = [_WS_RE.sub(" ", ln).strip() for ln in body.split("\n")]
    text = _BLANKLINES_RE.sub("\n\n", "\n".join(ln for ln in lines if ln)).strip()
    return title, text[:MAX_TEXT_CHARS]


def fetch_url_text(url: str, allow_private: bool = False) -> dict:
    """Fetch + extract. Raises FetchError with a UI-safe message on failure."""
    url = validate_url(url, allow_private=allow_private)
    if not _robots_allows(url):
        raise FetchError("the site's robots.txt disallows fetching this page")
    redirect = _GuardedRedirect(allow_private)
    opener = urllib.request.build_opener(redirect)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with opener.open(req, timeout=TIMEOUT) as resp:
            ctype = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            if ctype and not any(ctype.startswith(a) for a in ALLOWED_CONTENT):
                raise FetchError(f"unsupported content type: {ctype}")
            final_url = resp.geturl()
            charset = resp.headers.get_content_charset() or "utf-8"
            chunks, total = [], 0
            while True:
                chunk = resp.read(64 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_BYTES:
                    raise FetchError(f"page too large (max {MAX_BYTES // 1024} KB)")
                chunks.append(chunk)
    except FetchError:
        raise
    except urllib.error.HTTPError as exc:
        raise FetchError(f"the site returned HTTP {exc.code}")
    except (urllib.error.URLError, socket.timeout, TimeoutError):
        raise FetchError("could not reach that URL (timeout or connection failed)")
    raw = b"".join(chunks).decode(charset, "replace")
    title, text = extract_text(raw)
    if len(text) < 40:
        raise FetchError("could not extract readable text (JS-heavy page or paywall?)")
    return {"title": title, "text": text, "final_url": final_url}
