"""Causal prediction web — turn a scenario into a cause→effect web of events.

Each node is an EVENT / CONSEQUENCE (a proposition, not a person). Each edge is
a causal link ("A causes B"). The engine expands a scenario into a branching web
of consequences, then computes the most-likely outcome chain. It uses the LLM for
causal reasoning when a provider is configured, and falls back to a curated
rule-based knowledge base so the app always runs offline.

Content language: every generated string (events, consequences, summary,
explanation) honours the `lang` argument ("en" | "id").
"""

from __future__ import annotations

import hashlib
import json
import os
import random
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

from . import llm
from . import mech
from . import trajectory

_POS = re.compile(r"\b(improve|increase|rise|grow|benefit|support|boost|recover|expand|succeed|win|gain|prosper|calm|stabilize|prevent|relief|reform|meningkat|membaik|naik|tumbuh|berhasil|menang|memulihkan|stabil|mencegah|bantuan|dukungan|aman|damai|makmur|meluas|menguat|mendorong|mempermudah|memperbaiki|menguntungkan)\b", re.I)
_NEG = re.compile(r"\b(worsen|decline|fall|drop|collapse|crisis|protest|conflict|damage|harm|loss|fail|lose|escalate|tighten|burden|risk|threat|shortage|boycott|backlash|scarcity|outbreak|ban|memburuk|menurun|turun|jatuh|runtuh|krisis|protes|demo|konflik|kerusakan|rugi|gagal|kalah|ketat|beban|risiko|ancaman|kelangkaan|wabah|boikot|larangan|penolakan|tekanan|tertekan|melemah|melambat|terhambat|terancam|kekurangan)\b", re.I)

# Rule-based causal knowledge base: (domain regex, [(en, id, relation, weight, polarity), ...])
_KB = [
    (r"\b(price|cost|tax|tariff|subsidy|fuel|energy|inflation|wage|salary|rent|harga|biaya|pajak|subsidi|bbm|energi|inflasi|upah|gaji|sewa)\b", [
        ("cost of living rises", "biaya hidup naik", "increases", 0.8, -0.6),
        ("household budgets tighten", "anggaran rumah tangga mengetat", "leads_to", 0.7, -0.5),
        ("public dissatisfaction grows", "ketidakpuasan publik meningkat", "leads_to", 0.6, -0.5),
        ("government faces budget pressure", "pemerintah menghadapi tekanan anggaran", "leads_to", 0.5, -0.3),
        ("demand shifts toward cheaper alternatives", "permintaan beralih ke alternatif lebih murah", "leads_to", 0.5, 0.0),
    ]),
    (r"\b(protest|demonstration|strike|unrest|riot|boycott|rally|protes|demo|unjuk rasa|mogok|boikot)\b", [
        ("authorities deploy a security response", "aparat mengerahkan respons keamanan", "leads_to", 0.7, -0.4),
        ("media coverage amplifies the issue", "liputan media memperbesar isu", "leads_to", 0.6, 0.0),
        ("officials weigh policy concessions", "pejabat mempertimbangkan konsesi kebijakan", "leads_to", 0.5, 0.2),
        ("public order tensions escalate", "ketegangan ketertiban publik meningkat", "leads_to", 0.5, -0.6),
        ("supporters of the cause mobilize further", "pendukung gerakan semakin termobilisasi", "leads_to", 0.5, 0.0),
    ]),
    (r"\b(regulat|ban|law|policy|rule|mandate|legislation|compliance|aturan|regulasi|larangan|kebijakan|undang|peraturan)\b", [
        ("affected businesses face compliance costs", "bisnis terdampak menanggung biaya kepatuhan", "increases", 0.7, -0.4),
        ("legal challenges are filed", "gugatan hukum diajukan", "leads_to", 0.6, -0.3),
        ("enforcement capacity becomes strained", "kapasitas penegakan jadi terbebani", "leads_to", 0.5, -0.3),
        ("behavior shifts to avoid the restriction", "perilaku bergeser menghindari pembatasan", "leads_to", 0.5, 0.0),
        ("a public debate over the trade-off opens", "perdebatan publik soal trade-off terbuka", "leads_to", 0.5, 0.0),
    ]),
    (r"\b(disease|virus|vaccine|health|hospital|outbreak|pandemic|epidemic|sick|penyakit|virus|vaksin|kesehatan|rumah sakit|wabah|pandemi)\b", [
        ("healthcare demand surges", "permintaan layanan kesehatan melonjak", "increases", 0.8, -0.5),
        ("preventive measures are adopted", "langkah pencegahan diadopsi", "leads_to", 0.6, 0.2),
        ("medical supply chains come under strain", "rantai pasokan medis terbebani", "leads_to", 0.6, -0.5),
        ("public anxiety about the risk spreads", "kecemasan publik atas risiko menyebar", "leads_to", 0.5, -0.4),
        ("research and response funding increases", "dana riset dan penanganan meningkat", "leads_to", 0.5, 0.2),
    ]),
    (r"\b(climate|pollution|deforest|emission|carbon|flood|drought|disaster|environment|iklim|polusi|deforestasi|emisi|karbon|banjir|kekeringan|bencana|lingkungan)\b", [
        ("extreme weather events become more frequent", "cuaca ekstrem semakin sering terjadi", "increases", 0.7, -0.6),
        ("food and water security deteriorates", "ketahanan pangan dan air memburuk", "leads_to", 0.6, -0.6),
        ("pressure for green investment grows", "tekanan untuk investasi hijau meningkat", "leads_to", 0.6, 0.3),
        ("communities in vulnerable areas relocate", "masyarakat di daerah rentan pindah", "leads_to", 0.5, -0.4),
        ("insurance and infrastructure costs climb", "biaya asuransi dan infrastruktur naik", "increases", 0.5, -0.4),
    ]),
    (r"\b(ai|automation|technology|internet|social media|data|algorithm|software|digital|otomatisasi|teknologi|media sosial|algoritma)\b", [
        ("routine jobs face displacement", "pekerjaan rutin terancam tergantikan", "leads_to", 0.7, -0.5),
        ("productivity in some sectors improves", "produktivitas di sebagian sektor meningkat", "increases", 0.6, 0.4),
        ("privacy and misinformation concerns rise", "kekhawatiran privasi dan misinformasi naik", "increases", 0.6, -0.4),
        ("new skills and training demand emerges", "muncul kebutuhan keterampilan dan pelatihan baru", "leads_to", 0.5, 0.2),
        ("regulators scrutinize the technology", "regulator mengawasi teknologi itu", "leads_to", 0.5, 0.0),
    ]),
    (r"\b(crime|security|terror|military|war|conflict|violence|attack|kejahatan|keamanan|teror|militer|perang|konflik|kekerasan|serangan)\b", [
        ("security spending and surveillance increase", "belanja keamanan dan pengawasan meningkat", "increases", 0.7, -0.3),
        ("civil liberties face new restrictions", "kebebasan sipil menghadapi pembatasan baru", "leads_to", 0.6, -0.5),
        ("displacement and humanitarian needs grow", "pengungsian dan kebutuhan kemanusiaan meningkat", "increases", 0.6, -0.6),
        ("international tensions sharpen", "ketegangan internasional menajam", "leads_to", 0.5, -0.5),
        ("community resilience efforts strengthen", "upaya ketahanan komunitas menguat", "leads_to", 0.5, 0.3),
    ]),
    (r"\b(school|education|university|college|curriculum|student|teacher|sekolah|pendidikan|universitas|kurikulum|siswa|guru|pelajar)\b", [
        ("access to quality learning shifts", "akses ke pembelajaran berkualitas bergeser", "leads_to", 0.7, 0.0),
        ("funding and staffing pressures emerge", "tekanan pendanaan dan tenaga pengajar muncul", "leads_to", 0.6, -0.4),
        ("families reassess education choices", "keluarga menimbang ulang pilihan pendidikan", "leads_to", 0.5, 0.0),
        ("skills gaps in the workforce widen", "kesenjangan keterampilan tenaga kerja melebar", "leads_to", 0.5, -0.4),
        ("curriculum reform debate intensifies", "perdebatan reformasi kurikulum menguat", "leads_to", 0.5, 0.0),
    ]),
    (r"\b(transport|road|traffic|transit|rail|commute|logistics|shipping|transportasi|jalan|macet|kereta|komuter|logistik)\b", [
        ("commute times and congestion change", "waktu perjalanan dan kemacetan berubah", "leads_to", 0.7, 0.0),
        ("logistics and delivery costs shift", "biaya logistik dan pengiriman bergeser", "leads_to", 0.6, -0.4),
        ("demand for alternatives rises", "permintaan alternatif meningkat", "increases", 0.6, 0.2),
        ("air quality and emissions are affected", "kualitas udara dan emisi terdampak", "leads_to", 0.5, 0.0),
        ("access to jobs and services changes", "akses ke pekerjaan dan layanan berubah", "leads_to", 0.5, 0.0),
    ]),
    (r"\b(housing|property|construction|homeless|mortgage|perumahan|properti|konstruksi|rumah|kpr)\b", [
        ("housing affordability worsens", "keterjangkauan perumahan memburuk", "leads_to", 0.7, -0.6),
        ("construction activity adjusts", "aktivitas konstruksi menyesuaikan", "leads_to", 0.6, 0.0),
        ("rental pressure spreads to nearby areas", "tekanan sewa menyebar ke area sekitar", "leads_to", 0.5, -0.5),
        ("demand for housing policy reform grows", "tuntutan reformasi kebijakan perumahan meningkat", "increases", 0.5, 0.2),
        ("household formation is delayed", "pembentukan rumah tangga tertunda", "leads_to", 0.5, -0.4),
    ]),
    (r"\b(job|unemploy|layoff|hiring|worker|labour|labor|factory|pekerjaan|pengangguran|phk|buruh|tenaga kerja|pabrik)\b", [
        ("household incomes come under pressure", "pendapatan rumah tangga tertekan", "leads_to", 0.7, -0.5),
        ("consumer spending softens", "belanja konsumen melemah", "leads_to", 0.6, -0.4),
        ("retraining and support programs expand", "program pelatihan ulang dan dukungan meluas", "leads_to", 0.5, 0.2),
        ("migration of workers between regions rises", "migrasi pekerja antardaerah meningkat", "increases", 0.5, 0.0),
        ("labor negotiations intensify", "negosiasi ketenagakerjaan menguat", "leads_to", 0.5, -0.2),
    ]),
    (r"\b(election|government|politics|corruption|leader|president|minister|campaign|pemilu|pemerintah|politik|korupsi|presiden|menteri|kampanye)\b", [
        ("political support and opposition realign", "dukungan dan oposisi politik menyusun ulang", "leads_to", 0.7, 0.0),
        ("governing stability comes under strain", "stabilitas pemerintahan tertekan", "leads_to", 0.6, -0.4),
        ("policy priorities shift", "prioritas kebijakan bergeser", "leads_to", 0.6, 0.0),
        ("public trust in institutions fluctuates", "kepercayaan publik pada institusi berfluktuasi", "leads_to", 0.5, -0.3),
        ("coalition and alliance negotiations intensify", "negosiasi koalisi dan aliansi menguat", "leads_to", 0.5, 0.0),
    ]),
    (r"\b(food|agricultur|crop|harvest|farm|rice|supply|pangan|pertanian|panen|beras|pasokan)\b", [
        ("food prices rise at markets", "harga pangan naik di pasar", "increases", 0.8, -0.5),
        ("imports are needed to cover the shortfall", "impor dibutuhkan untuk menutup kekurangan", "leads_to", 0.6, -0.3),
        ("rural incomes are affected", "pendapatan pedesaan terdampak", "leads_to", 0.6, 0.0),
        ("hoarding and panic buying appear", "penimbunan dan panic buying muncul", "leads_to", 0.5, -0.4),
        ("government considers market intervention", "pemerintah mempertimbangkan intervensi pasar", "leads_to", 0.5, 0.0),
    ]),
    (r"\b(credit|debt|loan|bank|finance|interest|currency|capital|kredit|utang|pinjaman|bank|keuangan|bunga|mata uang|modal)\b", [
        ("borrowing costs for households rise", "biaya pinjaman rumah tangga naik", "increases", 0.7, -0.5),
        ("business investment slows", "investasi usaha melambat", "leads_to", 0.6, -0.4),
        ("currency and capital flows shift", "arus mata uang dan modal bergeser", "leads_to", 0.6, 0.0),
        ("credit access tightens for small firms", "akses kredit usaha kecil mengetat", "leads_to", 0.5, -0.4),
        ("financial regulators step up oversight", "regulator keuangan meningkatkan pengawasan", "leads_to", 0.5, 0.0),
    ]),
]

_GENERIC = [
    ("public attention on the issue grows", "perhatian publik pada isu ini meningkat", "leads_to", 0.7, 0.0),
    ("affected groups voice their concerns", "kelompok terdampak menyuarakan kekhawatiran", "leads_to", 0.6, -0.3),
    ("policymakers face pressure to respond", "pembuat kebijakan tertekan untuk merespons", "leads_to", 0.55, 0.0),
    ("media coverage of the issue increases", "liputan media tentang isu ini meningkat", "leads_to", 0.5, 0.0),
]

# ------------------------------------------------------------ custom KB packs
# Users can extend the offline knowledge base by dropping JSON packs into kb/
# next to the project root. Format per file:
#   {"name": "my-domain",
#    "pattern": "\\b(crypto|bitcoin)\\b",
#    "rules": [{"en": "...", "id": "...", "relation": "leads_to",
#               "weight": 0.6, "polarity": -0.3}, ...]}
# Broken packs are skipped silently — the engine must always run.
_KB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "kb")
_custom_kb: list | None = None


def _load_custom_kb(force: bool = False) -> list:
    """Load (and cache) user KB packs from kb/*.json, validated into _KB shape."""
    global _custom_kb
    if _custom_kb is not None and not force:
        return _custom_kb
    packs: list = []
    if os.path.isdir(_KB_DIR):
        for fn in sorted(os.listdir(_KB_DIR)):
            if not fn.endswith(".json"):
                continue
            try:
                with open(os.path.join(_KB_DIR, fn), encoding="utf-8") as f:
                    pack = json.load(f)
                pat = str(pack["pattern"])
                re.compile(pat)  # validate the regex up front
                rules = []
                for r in pack.get("rules") or []:
                    en = str(r.get("en") or "").strip()
                    idn = str(r.get("id") or en).strip()
                    rel = str(r.get("relation") or "leads_to").strip()
                    w = clamp(float(r.get("weight", 0.5)), 0.0, 1.0)
                    pol = clamp(float(r.get("polarity", 0.0)))
                    if en:
                        rules.append((en, idn, rel, round(w, 2), round(pol, 2)))
                if rules:
                    packs.append((pat, rules))
            except Exception:  # noqa: BLE001 — a broken pack must never break the engine
                continue
    _custom_kb = packs
    return packs


def reload_kb() -> int:
    """Force-reload custom KB packs (e.g. after the user drops a new file)."""
    return len(_load_custom_kb(force=True))

# Markers that an event is a PERSONAL daily-life act (first person going somewhere,
# being late, commuting, waking up, arriving...). For these we must NOT fire the
# institutional/policy consequences of a matched KNOWLEDGE-BASE domain. "I go to
# school" is a personal act about arriving on time — it is NOT an education-policy
# scenario, so "tenaga pengajar / kurikulum / kesenjangan keterampilan" etc. are a
# domain+scale teleport and must be suppressed.
_PERSONAL_ACT = re.compile(
    r"\b(aku|saya|gue|gua|kita|kami|i\b|i'm|i’m|my|me|we\b|our|aku\b)\b"
    r"|\b(pergi|berangkat|datang|tiba|pulang|jalan|naik|bangun|berangkat|telat|terlambat|"
    r"tepat waktu|jam|pagi|siang|sore|malam|kereta|sepeda|mobil|motor|bus|ojek|go\b|leave|"
    r"arrive|walk|commute|wake|late|on time|school|work|kantor|kampus)\b",
    re.I,
)
# Markers that an event is genuinely an INSTITUTIONAL / POLICY / MACRO context, i.e.
# the institutional consequences of a KB domain are legitimate here (a government
# policy, a sector reform, an economy, a public-health mandate...). When these are
# present the personal-context suppression below does NOT apply.
_INSTITUTION_CTX = re.compile(
    r"\b(pemerintah|government|kebijakan|policy|undang|law|regulasi|regulation|aturan|"
    r"rule|mandat|mandate|menteri|minister|lembaga|institution|otonom|authority|negara|"
    r"nation|nasional|national|daerah|regional|provinsi|kabupaten|kota\b|parlemen|"
    r"parliament|ruu|dpr|sektor|sector|anggaran|budget|pajak|tax|subsidi|subsidy|"
    r"ekonomi|econom|pasar|market|saham|pemilu|election|kampanye|campaign|"
    r"reformasi|reform|program\b|skema|scheme|krisis|crisis|wabah|outbreak|pandemi|"
    r"pandemi|kesehatan masy|public health|nasional|pemerintah|industri|industry)\b",
    re.I,
)
# Vocabulary that marks a KNOWLEDGE-BASE consequence as institutional/macro in NATURE,
# regardless of whether the text happens to trip _MACRO_KEYWORDS. Used to suppress such
# consequences under a personal act parent. (These are the education/policy-style
# system-scale outcomes the KB emits for keywords like "sekolah".)
_INSTITUTION_CONS = re.compile(
    r"\b(pendidikan|education|pembelajaran|tenaga pengajar|tenaga pendidik|kurikulum|"
    r"curriculum|keterampilan tenaga|skills|kesenjangan|anggaran|pendanaan|funding|staffing|"
    r"reformasi|reform|kebijakan|policy|pemerintah|government|regulasi|regulation|"
    r"lembaga|institution|masyarak|commun|publik|public|pasar\b|market\b|ekonomi|econom|"
    r"tenaga kerja|workforce|pekerjaan|lapangan kerja|nasional|national|global)\b",
    re.I,
)

# LLM call budget + circuit breaker: cap how many reasoning calls a single web
# build makes, and stop trying the LLM only after several CONSECUTIVE failures —
# a single slow/timeout call (reasoning models can take >60s) must not kill the
# whole build and silently drop everything to generic rule-based templates.
_LLM_BUDGET = 24
_LLM_MAX_FAILS = 3
# Max events per LLM expansion call. One giant call for a whole level emits tens
# of thousands of tokens; slow providers (~90 tok/s, reasoning models) cannot
# finish that in time and every event silently dropped to generic rule-based
# templates. Two events per call keeps each response small enough to complete.
_LLM_CHUNK = 2


def _llm_workers() -> int:
    """Concurrent LLM calls allowed during expansion/compare (env-tunable)."""
    try:
        return max(1, int(os.environ.get("RIAK_LLM_WORKERS")
                          or os.environ.get("WANION_LLM_WORKERS", "4")))
    except ValueError:
        return 4
_llm_calls = 0
_llm_failed = False
_llm_fail_streak = 0

# ---------------------------------------------------------------- causal validation
# The engine is the causal authority: LLM output is an untrusted hypothesis.
_SCALE_LADDER = ["individual", "group", "organization", "community", "regional", "national", "global"]
_SCALE_RANK = {s: i for i, s in enumerate(_SCALE_LADDER)}
_TEMPORAL_ONEHOP_OK = {"immediate", "short_term", "unknown", None}

# Substrings signalling a system/macro scale (national/global/institutional). A candidate
# matching one of these is treated as "national" scale and rejected from a local parent.
# This list doubles as the domain-jump detector: institutional/political/social-system
# concepts are system-scale, so from an individual/local parent they are a domain+scale jump.
_MACRO_KEYWORDS = (
    "labor market", "labour market", "workforce", "skills gap", "kesenjangan keterampilan",
    "tenaga kerja", "ketenagakerjaan", "consumer spending", "belanja konsumen",
    "national", "nasional", "nationwide", "global", "geopolitik", "international", "internasional",
    "media coverage", "liputan media", "public attention", "perhatian publik",
    "government", "pemerintah", "policy", "kebijakan", "legislation", "undang-undang",
    "regulation", "regulasi", "macroeconomic", "makroekonomi", "monetary", "fiscal", "fiskal",
    "moneter", "labor negotiation", "negosiasi ketenagakerjaan", "retraining", "pelatihan ulang",
    "migration of workers", "migrasi pekerja", "unemployment", "pengangguran", "gdp", "inflation",
    "inflasi", "trade deficit", "currency crisis", "krisis mata uang", "economic growth",
    "pertumbuhan ekonomi", "policymaker", "pembuat kebijakan", "politics", "politik",
    "curriculum", "kurikulum", "reform", "reformasi", "funding", "pendanaan",
    "staffing", "tenaga pengajar",
    "poverty", "kemiskinan", "inequality", "ketimpangan", "income gap", "kesenjangan pendapatan",
    "social mobility", "mobilitas sosial", "crime rate", "tingkat kejahatan", "public health",
    "kesehatan masyarakat", "literacy", "melek huruf", "drop-out", "putus sekolah",
)

_debug_enabled = False
_debug_trace: list[dict] = []


def _infer_scale(text: str) -> str:
    """Heuristic scale of a node's text: 'national' if it names system/macro terms,
    else 'individual'. (The LLM's explicit `scale` field is preferred when present.)"""
    t = (text or "").lower()
    return "national" if any(kw in t for kw in _MACRO_KEYWORDS) else "individual"


def _infer_domain(text: str) -> str | None:
    t = (text or "").lower()
    for dom, pats in (
        ("physical", ("speed", "brak", "traction", "distance", "energi", "kecepatan", "rem", "traksi",
                      "jarak", "road", "jalan", "rain", "hujan", "friction", "gesekan")),
        ("behavioral", ("decide", "driver", "cautious", "rushed", "memutuskan", "berhati", "terburu",
                        "stress", "stres", "berkendara", "late", "terlambat")),
        ("economic", ("cost", "price", "budget", "spending", "income", "biaya", "harga", "anggaran",
                      "belanja", "pendapatan")),
        ("social", ("community", "family", "families", "masyarakat", "keluarga", "public", "publik")),
        ("institutional", ("policy", "government", "regulation", "school", "kebijakan", "pemerintah",
                           "sekolah", "university", "universitas")),
    ):
        if any(p in t for p in pats):
            return dom
    return None


def _state_merge(parent_state: dict, state_changes) -> dict:
    """Carry ancestor state forward and apply the candidate's state changes (path dependency)."""
    merged = dict(parent_state or {})
    for sc in state_changes or []:
        if isinstance(sc, dict) and sc.get("variable"):
            merged[str(sc["variable"])] = sc.get("to")
    return merged


def _seed_spec(text: str) -> dict:
    """Infer an initial quantitative-state spec for a SEED node from natural language,
    so physics operators can run even though the seed text carries no numbers. Every
    value here is an explicit assumption (recorded by mech.init_state)."""
    t = (text or "").lower()
    spec: dict = {}
    if re.search(r"\b(hujan|rain|basah|wet|licin|slippery)\b", t):
        spec["road_wet"] = True
    if re.search(r"\b(cepat|fast|speed|ngebut|laju|rasa|melaju)\b", t):
        spec["initial_state"] = {"speed_kmh": 70.0}
    elif re.search(r"\b(pelan|slow|lambat|jalan kaki|berjalan)\b", t):
        spec["initial_state"] = {"speed_kmh": 25.0}
    if re.search(r"\b(sekolah|school|kerja|office|kampus|jalan|pergi|berangkat)\b", t):
        spec.setdefault("initial_state", {})["distance_km"] = 5.0
    return spec


def _reset_llm():
    global _llm_calls, _llm_failed, _llm_fail_streak, _debug_enabled, _debug_trace
    _llm_calls = 0
    _llm_failed = False
    _llm_fail_streak = 0
    _debug_enabled = False
    _debug_trace = []


_llm_state_lock = threading.Lock()


def _use_llm(fn, *args):
    """Call an LLM helper unless the budget is spent or the breaker has tripped.
    The breaker trips only after _LLM_MAX_FAILS consecutive failures, so one
    transient timeout doesn't disable LLM enrichment for the rest of the build.
    A success resets the streak; a truly dead provider still stops after a few
    wasted calls and the rule-based engine takes over.

    Thread-safe: expansion chunks and compare scenarios now run on parallel
    worker threads, so the shared budget/breaker state is lock-guarded. The
    lock is only held for the (cheap) bookkeeping — never during the HTTP call.
    """
    global _llm_calls, _llm_failed, _llm_fail_streak
    with _llm_state_lock:
        if _llm_failed or _llm_calls >= _LLM_BUDGET:
            return None
        _llm_calls += 1
    try:
        out = fn(*args)
    except Exception:  # noqa: BLE001
        out = None
    with _llm_state_lock:
        if not out:
            _llm_fail_streak += 1
            if _llm_fail_streak >= _LLM_MAX_FAILS:
                _llm_failed = True
        else:
            _llm_fail_streak = 0
    return out


def clamp(v: float, lo: float = -1.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, v))


def clamp_int(v, lo, hi):
    try:
        v = int(v)
    except (TypeError, ValueError):
        v = lo
    return max(lo, min(hi, v))


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", s.lower())).strip()


def _sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?。！？\n])\s+", text.strip())
    return [p.strip() for p in parts if p.strip()]


def _polarity(text: str) -> float:
    p = bool(_POS.search(text))
    n = bool(_NEG.search(text))
    if p and not n:
        return 0.6
    if n and not p:
        return -0.6
    return 0.0


def _lang(lang: str | None) -> str:
    return "id" if lang == "id" else "en"


def extract_root_events(text: str, rng: random.Random, n: int = 4, lang: str = "en") -> list[str]:
    """Key events/propositions the web starts from."""
    lang = _lang(lang)
    via_llm = _use_llm(llm.extract_events, text, n, lang)
    if via_llm:
        return via_llm[:n]
    out, seen = [], set()
    for s in _sentences(text):
        s = s[:100].strip().rstrip(".!?。！？")
        key = _norm(s)
        if len(s) < 8 or key in seen:
            continue
        seen.add(key)
        out.append(s)
        if len(out) >= n:
            break
    return out or [(text[:120].strip() or ("Skenario tanpa judul" if lang == "id" else "Untitled scenario"))]


def _is_personal_act(text: str) -> bool:
    """True when the event looks like a PERSONAL daily-life act (first person going
    somewhere / being late / commuting) rather than a policy or system event. For such
    events the institutional KB consequences (e.g. 'tenaga pengajar', 'kurikulum') are a
    domain+scale teleport and must be suppressed."""
    t = (text or "").lower()
    if _INSTITUTION_CTX.search(t):
        return False
    return bool(_PERSONAL_ACT.search(t))


def _is_institution_consequence(text: str) -> bool:
    """True when a knowledge-base consequence is institutional/macro in NATURE, so it
    should not be attached to a personal daily-life act (the 'sekolah -> tenaga pengajar'
    teleport)."""
    return bool(_INSTITUTION_CONS.search(text or ""))


# Personal commute / arrival / timeliness markers: going somewhere with a concern about
# arriving on time (late / on time / leaving early / this morning). For these the engine
# should emit a RELEVANT personal consequence (e.g. "won't be late") instead of falling
# through to generic media/policy fallout.
_PERSONAL_TRAVEL = re.compile(
    r"\b(pergi|berangkat|datang|tiba|pulang|jalan|naik|kereta|sepeda|mobil|motor|bus|ojek|"
    r"telat|terlambat|tepat waktu|lambat|awal\b|pagi|jam\b|sekolah|kantor|kampus|kerja|"
    r"leaving|arrive|commute|late|on time|early|school|work|office)\b",
    re.I,
)


def _personal_travel_consequences(event: str, lang: str) -> list[tuple[str, str, float, float]]:
    """For a personal trip-with-timeliness event, RELEVANT personal consequences such as
    'arrive earlier and won't be late'. Returns a list of (text, relation, weight, polarity),
    or [] when the event is not a personal travel/arrival situation. These replace the
    institutional/generic media-policy consequences that would otherwise teleport."""
    t = (event or "").lower()
    # Must look like a personal act (not policy) AND involve leaving/arriving/timeliness.
    if _INSTITUTION_CTX.search(t) or not _PERSONAL_ACT.search(t):
        return []
    if not _PERSONAL_TRAVEL.search(t):
        return []
    # destination noun, if present (sekolah / kantor / kampus / kerja / school / office...)
    dest = None
    for w in ("sekolah", "kantor", "kampus", "kerja", "school", "office", "work"):
        if w in t:
            dest = w
            break
    dest_text = dest if dest else ("tempat tujuan" if lang == "id" else "the destination")
    earlier = bool(re.search(r"\b(6\b|jam 6|lebih awal|pagi|lebih cepat|pergi jam|early)\b", t))
    if lang == "id":
        if earlier:
            return [
                (f"tiba di {dest_text} lebih awal dan tidak akan telat", "leads_to", 0.85, 0.5),
                ("punya waktu lebih luang sebelum kegiatan dimulai", "leads_to", 0.7, 0.3),
                ("risiko stres karena terburu-buru menurun", "leads_to", 0.7, 0.3),
            ]
        return [
            (f"risiko terlambat ke {dest_text} menurun", "leads_to", 0.8, 0.4),
            ("perjalanan jadi lebih tenang dan tidak tergesa", "leads_to", 0.65, 0.3),
        ]
    if earlier:
        return [
            (f"arrives at {dest_text} earlier and won't be late", "leads_to", 0.85, 0.5),
            ("has more free time before the activity starts", "leads_to", 0.7, 0.3),
            ("stress from rushing decreases", "leads_to", 0.7, 0.3),
        ]
    return [
        (f"risk of being late to {dest_text} drops", "leads_to", 0.8, 0.4),
        ("the trip becomes calmer and less hurried", "leads_to", 0.65, 0.3),
    ]


def _rule_expand(event: str, n: int, rng: random.Random, lang: str = "en", ancestry: str | None = None) -> list[tuple[str, str, float, float]]:
    """Rule-based consequences from the knowledge base, in the requested language.
    `ancestry` (the causal path leading to `event`) lets the personal/travel context of a
    personal seed propagate down the chain, so derived consequence nodes stay personal
    instead of falling back to institutional generic consequences."""
    lang = _lang(lang)
    hits: list[tuple[str, str, str, float, float]] = []
    for pat, cons in [*_load_custom_kb(), *_KB]:  # user packs first, then built-ins
        if re.search(pat, event):
            hits.extend(cons)
    # A PERSONAL daily-life act ("I go to school / I'm late") is not an education-policy
    # scenario: drop the institutional/macro consequences the KB emits for a matching
    # place/institution keyword. This is what stopped "sekolah -> kurangnya tenaga
    # pendidikan" from being a context-teleport. If any ancestor was a personal act,
    # the whole subtree stays personal (derived phrases like "more free time" carry no
    # personal pronoun on their own).
    personal = _is_personal_act(event) or bool(ancestry and _is_personal_act(ancestry))
    if personal:
        hits = [h for h in hits if not _is_institution_consequence(h[1] if lang == "id" else h[0])]
    # For a personal trip-with-timeliness act, emit RELEVANT personal consequences
    # ("won't be late", "more free time") and never fall through to the institutional
    # generic media/policy consequences — those are still a context teleport for a
    # personal routine.
    personal_travel = _personal_travel_consequences(event, lang)
    if personal and not personal_travel and ancestry:
        personal_travel = _personal_travel_consequences(ancestry, lang)
    if personal_travel:
        hits = []
    # The institutional generic consequences (media / policymakers / public attention) are
    # a context teleport for a personal act too, so never use them for a personal scenario.
    if not hits and not personal:
        hits = list(_GENERIC)
    rng.shuffle(hits)
    out, seen = [], set()

    def _emit(text, rel, w, pol):
        key = _norm(text)
        if key in seen:
            return False
        seen.add(key)
        out.append((text, rel, w, pol))
        return True

    if personal_travel:
        for text, rel, w, pol in personal_travel:
            _emit(text, rel, round(w, 2), pol)
    for en, id_text, rel, w, pol in hits:
        text = id_text if lang == "id" else en
        if _emit(text, rel, round(w, 2), pol) and len(out) >= n:
            break
    return out


def expand_consequences(event: str, n: int, rng: random.Random, lang: str = "en") -> list[tuple[str, str, float, float]]:
    """Return [(consequence_text, relation, weight, polarity), ...] for a single event.
    LLM candidates are normalized and engine-validated against the event as the parent."""
    lang = _lang(lang)
    via_llm = _use_llm(llm.causal_expand, event, n, lang)
    if via_llm:
        parent = {"text": event, "scale": _infer_scale(event)}
        out, seen = [], set()
        for cand in via_llm:
            c = _normalize_candidate(cand, rng, lang)
            if c is None:
                continue
            key = _norm(c["text"])
            if key in seen:
                continue
            seen.add(key)
            ok, _ = validate_candidate(c, parent, lang)
            if not ok:
                continue
            out.append((c["text"], c["relation"], c["probability"], c["polarity"]))
            if len(out) >= n:
                break
        return out
    return _rule_expand(event, n, rng, lang)


def _ancestry(nid: str, parent: dict[str, str], node_by_id: dict[str, dict], maxlen: int = 6) -> str:
    """Causal ancestor chain root -> ... -> parent (EXCLUDING nid), for path dependency."""
    chain: list[str] = []
    cur, seen = nid, set()
    while cur in node_by_id and cur not in seen:
        seen.add(cur)
        nxt = parent.get(cur)
        if not nxt:
            break
        pnode = node_by_id.get(nxt)
        if not pnode:
            break
        chain.append(pnode["text"])
        cur = nxt
    chain.reverse()
    if len(chain) > maxlen:
        chain = [chain[0]] + ["..."] + chain[-(maxlen - 1):]
    return " -> ".join(chain)


def _normalize_candidate(raw, rng: random.Random, lang: str = "en") -> dict | None:
    """Normalize an LLM candidate dict OR a rule-based (text, rel, w, pol) tuple into a
    canonical candidate dict. Returns None if the text is unusable."""
    if isinstance(raw, dict):
        text = str(raw.get("text") or "").strip()
        if not (2 <= len(text) <= 200):
            return None
        mech = raw.get("mechanism")
        sc = raw.get("state_changes")
        tr = raw.get("temporal_relation")
        dom = raw.get("domain")
        scale = raw.get("scale")
        conf = raw.get("confidence")
        prob = raw.get("probability")
        if prob is None:
            prob = raw.get("likelihood")  # accept the LLM schema's alternate key
        rel = raw.get("relation") or "leads_to"
        source = "llm"
        # operator spec (the LLM only PROPOSES which mechanism applies + params/assumptions;
        # the engine computes). Pass these through for _derive_candidate / mech.derive.
        op = raw.get("operator") or raw.get("mechanism_id")
        op_params = {
            "operator": op, "speed_reduction": raw.get("speed_reduction"),
            "friction_mu": raw.get("friction_mu"), "road_wet": raw.get("road_wet"),
            "mass_kg": raw.get("mass_kg"), "uncertainty": raw.get("uncertainty"),
            "assumptions": raw.get("assumptions"),
        }
    elif isinstance(raw, (tuple, list)) and len(raw) >= 3:
        text = str(raw[0] or "").strip()
        if not (2 <= len(text) <= 200):
            return None
        rel = raw[1] if isinstance(raw[1], str) else "leads_to"
        prob = raw[2]
        mech = "rule-based knowledge base"
        sc, tr, dom, scale, conf = None, "immediate", None, None, None
        source = "rule"
        op_params = None
    else:
        return None
    if rel not in RELATIONS:
        rel = "leads_to"
    if prob is None:
        prob = round(rng.uniform(0.55, 0.88), 2)
    prob = max(0.02, min(0.99, prob))
    out = {
        "text": text, "relation": rel, "probability": round(prob, 3),
        "polarity": round(_polarity(text), 2),
        "mechanism": mech, "state_changes": sc, "temporal_relation": tr,
        "domain": dom, "scale": scale, "confidence": conf, "source": source,
    }
    if op_params:
        out.update(op_params)
    return out


def validate_candidate(cand: dict, parent: dict, lang: str = "en") -> tuple[bool, str]:
    """Engine-side causal authority: accept/reject a candidate BEFORE it becomes a node.
    LLM output is an untrusted hypothesis; this is the gate. Returns (accepted, reason)."""
    tr = cand.get("temporal_relation")
    if tr not in _TEMPORAL_ONEHOP_OK:
        return False, "non-immediate temporal_relation (%s)" % tr
    # LLM candidates must carry a direct causal mechanism; rule-based ones are curated.
    if cand.get("source") == "llm" and not cand.get("mechanism"):
        return False, "missing causal mechanism"
    # scale continuity: no leap of more than one rung of the ladder
    parent_scale = parent.get("scale") or _infer_scale(parent.get("text", ""))
    cand_scale = cand.get("scale") or _infer_scale(cand["text"])
    pr = _SCALE_RANK.get(parent_scale, 0)
    cr = _SCALE_RANK.get(cand_scale, 0)
    if cr - pr > 1:
        return False, "scale jump (%s -> %s)" % (parent_scale, cand_scale)
    # physical/mathematical sanity on numeric state changes (no negative speed/distance/time)
    for sc in cand.get("state_changes") or []:
        if not isinstance(sc, dict):
            continue
        var = str(sc.get("variable") or "").lower()
        if var in ("speed", "distance", "time", "duration", "kecepatan", "jarak", "waktu", "durasi"):
            for v in (sc.get("from"), sc.get("to")):
                if isinstance(v, (int, float)) and not isinstance(v, bool) and v < 0:
                    return False, "physically impossible negative %s" % var
    return True, "accepted"


def _derive_candidate(cand: dict, parent: dict, rng: random.Random, lang: str = "en") -> dict:
    """Run the engine's mathematical/physical derivation for one candidate, making
    the ENGINE — not the LLM — the authority over the child's quantitative state,
    its edge probability, and its formula. The LLM only proposed the operator spec.

    If mech.derive yields a Derivation, its probability REPLACES the LLM's likelihood
    (math -> network feedback). If it cannot derive, fall back to an explicit
    assumption-based derivation so every edge still carries honest provenance + a
    math-derived (weak) probability instead of a fabricated number."""
    spec = {
        "operator": cand.get("operator") or cand.get("mechanism_id"),
        "child_text": cand["text"],
        "mechanism": cand.get("mechanism"),
        "confidence": cand.get("confidence") or cand.get("probability"),
        "uncertainty": cand.get("uncertainty"),
        "domain": cand.get("domain"),
        "scale": cand.get("scale"),
        "speed_reduction": cand.get("speed_reduction"),
        "friction_mu": cand.get("friction_mu"),
        "road_wet": cand.get("road_wet"),
        "mass_kg": cand.get("mass_kg"),
        "state_changes": cand.get("state_changes"),
        "assumptions": cand.get("assumptions"),
    }
    deriv = mech.derive(parent, spec)
    if deriv is None:  # bad spec -> honest assumption fallback, never fabricate
        spec["operator"] = "assumption_based"
        spec.setdefault("confidence", 0.4)
        spec.setdefault("uncertainty", 0.7)
        deriv = mech.derive(parent, spec) or {}
    trajectory.push("tool", f"derive “{cand['text'][:48]}” → {deriv.get('operator') if deriv else '?'}",
                    operator=deriv.get("operator") if deriv else None)
    if deriv:
        cand["probability"] = deriv.get("probability", cand.get("probability", 0.5))
        cand["derived_state"] = deriv.get("child_state")
        cand["formula"] = deriv.get("formula_latex")
        cand["formula_plain"] = deriv.get("formula_plain")
        cand["uncertainty"] = deriv.get("uncertainty")
        cand["assumptions"] = deriv.get("assumptions")
        cand["operator"] = deriv.get("operator")
        cand["mechanism"] = deriv.get("mechanism") or cand.get("mechanism")
        if deriv.get("child_text"):
            cand["derived_text"] = deriv["child_text"]
        cand["scale"] = deriv.get("scale") or cand.get("scale")
        cand["domain"] = deriv.get("domain") or cand.get("domain")
    return cand


def _expand_many(items: list[tuple[str, str, str]], n: int, rng: random.Random, lang: str = "en",
                 node_by_id: dict[str, dict] | None = None) -> dict[str, list[dict]]:
    """Expand events with small batched LLM calls (rule-based fallback per event).
    Each candidate (LLM or rule) is normalized and validated by the engine before
    being returned. `items` = [(node_id, text, ancestry), ...].
    Returns {node_id: [candidate_dict, ...]}.

    Expansion runs in chunks of _LLM_CHUNK events instead of one call per level:
    an oversized response reliably times out on slow providers, which used to drop
    every node of that level to generic rule-based text. If a chunk fails, its
    events are retried individually before falling back to rules."""
    lang = _lang(lang)
    node_by_id = node_by_id or {}
    texts = [t for _, t, _ in items]
    contexts = [c for _, _, c in items]
    raw_lists: list[list | None] = [None] * len(items)
    # Expansion chunks run in PARALLEL (RIAK_LLM_WORKERS, default 4): each chunk
    # is an independent LLM call, and on slow reasoning providers a level with
    # many events used to cost N_chunks × call latency sequentially. Same
    # prompts, same validation — just concurrent. Set workers to 1 to restore
    # strictly sequential behaviour (e.g. rate-limited providers).
    chunks = [(off, texts[off:off + _LLM_CHUNK], contexts[off:off + _LLM_CHUNK])
              for off in range(0, len(items), _LLM_CHUNK)]
    parent_job = trajectory.get_job()

    def _run_chunk(off: int, sub_t: list, sub_c: list) -> dict:
        if parent_job:
            trajectory.set_job(parent_job)   # route llm events to the right trajectory
        got: dict[int, list] = {}
        chunk = _use_llm(llm.batch_expand, sub_t, n, lang, sub_c)
        if chunk is None and len(sub_t) > 1:
            # one slow/large event can poison a chunk; retry its events one by one
            for j in range(len(sub_t)):
                one = _use_llm(llm.batch_expand, [sub_t[j]], n, lang, [sub_c[j]])
                if one and one[0]:
                    got[off + j] = one[0]
        elif chunk:
            for j in range(len(sub_t)):
                if j < len(chunk) and chunk[j]:
                    got[off + j] = chunk[j]
        return got

    def _absorb(got: dict) -> None:
        for pos, raw in got.items():
            raw_lists[pos] = raw

    workers = _llm_workers()
    if len(chunks) > 1 and workers > 1:
        with ThreadPoolExecutor(max_workers=min(workers, len(chunks))) as pool:
            for got in pool.map(lambda c: _run_chunk(*c), chunks):
                _absorb(got)
    else:
        for c in chunks:
            _absorb(_run_chunk(*c))
    out: dict[str, list[dict]] = {}
    for i, (nid, text, _) in enumerate(items):
        parent = node_by_id.get(nid) or {}
        raw_list = raw_lists[i]
        if not raw_list:
            raw_list = _rule_expand(text, n, rng, lang, ancestry=contexts[i] if i < len(contexts) else None)
        kept: list[dict] = []
        seen_texts: set[str] = set()
        for raw in raw_list:
            cand = _normalize_candidate(raw, rng, lang)
            if cand is None:
                continue
            key = _norm(cand["text"])
            if key in seen_texts:
                if _debug_enabled:
                    _debug_trace.append({
                        "node": nid, "candidate": cand["text"], "mechanism": cand.get("mechanism"),
                        "state_changes": cand.get("state_changes"), "domain": cand.get("domain"),
                        "scale": cand.get("scale") or _infer_scale(cand["text"]),
                        "decision": "REJECT", "reason": "duplicate",
                    })
                continue
            seen_texts.add(key)
            ok, reason = validate_candidate(cand, parent, lang)
            if _debug_enabled:
                _debug_trace.append({
                    "node": nid, "candidate": cand["text"], "mechanism": cand.get("mechanism"),
                    "state_changes": cand.get("state_changes"), "domain": cand.get("domain"),
                    "scale": cand.get("scale") or _infer_scale(cand["text"]),
                    "decision": "ACCEPT" if ok else "REJECT", "reason": reason,
                })
            if ok:
                # ENGINE computes the child's state + probability + formula (math -> network).
                # The LLM only proposed the operator spec; it never sets the edge weight.
                cand = _derive_candidate(cand, parent, rng, lang)
                kept.append(cand)
        out[nid] = kept
    return out


# ------------------------------------------------------------- time dimension
# Rough delay (days) until a consequence materialises, by the kind of event.
# Heuristic, deliberately coarse — it gives the prediction a timeline, not a clock.
_DELAY_RULES = [
    (r"\b(protest|riot|strike|unrest|attack|crash|accident|viral|trending|demo|rusuh|mogok|serangan|kecelakaan)\b", 2),
    (r"\b(media|news|coverage|attention|debate|anxiety|liputan|perdebatan|kecemasan)\b", 3),
    (r"\b(health|disease|hospital|vaccine|outbreak|supply chain|wabah|penyakit|vaksin|rumah sakit)\b", 14),
    (r"\b(price|cost|inflation|budget|market|demand|supply|income|spending|harga|inflasi|pasar|anggaran)\b", 30),
    (r"\b(regulat|law|policy|ban|legislation|compliance|enforcement|undang|regulasi|kebijakan|larangan)\b", 90),
    (r"\b(education|school|curriculum|skill|training|sekolah|kurikulum|pelatihan|keterampilan)\b", 180),
    (r"\b(climate|environment|deforest|emission|carbon|iklim|lingkungan|deforestasi|emisi)\b", 365),
]
_DELAY_DEFAULT = 21


def estimate_delay_days(text: str) -> int:
    """Heuristic days-until-effect for a consequence text (domain-keyword based)."""
    for pat, days in _DELAY_RULES:
        if re.search(pat, text or "", re.I):
            return days
    return _DELAY_DEFAULT


def _slug(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:8]


def build_web(seed_text: str, seed: int, config: dict | None = None, lang: str = "en",
              on_progress=None) -> dict:
    """Expand a scenario into a cause→effect web of events.

    on_progress (optional) is called with a lightweight partial-web snapshot
    {nodes, edges, n_nodes, n_edges, topic} after the roots are created and
    after every expansion wave — the server streams these to the UI so the
    canvas can show the web GROWING live instead of appearing at once."""
    config = config or {}
    lang = _lang(lang)
    _reset_llm()
    trajectory.begin()
    rng = random.Random(seed)
    # Generous safety bounds (not hard product limits): branching/depth only set
    # how quickly the web fills toward max_nodes, which is the real memory guard.
    branching = clamp_int(config.get("branching", 5), 1, 200)
    depth = clamp_int(config.get("depth", 3), 1, 50)
    max_nodes = clamp_int(config.get("max_nodes", 2000), 1, 20000)
    global _debug_enabled
    _debug_enabled = bool(config.get("debug"))

    topic = next((s[:160] for s in _sentences(seed_text) if len(s) >= 12), seed_text[:160].strip())

    nodes: list[dict] = []
    edges: list[dict] = []
    seen: dict[tuple[int, str], str] = {}
    node_by_id: dict[str, dict] = {}
    parent: dict[str, str] = {}
    idx = 0

    def add_node(text: str, type_: str, level: int, polarity: float, cand: dict | None = None, parent_nid: str | None = None) -> str:
        nonlocal idx
        # dedup key uses the FINAL node text (the engine's derived text if present), so two
        # candidates with the same LLM proposal but different computed states stay distinct.
        final_text = cand.get("derived_text") if cand else None
        key = (level, _norm(final_text or text))  # same consequence at different depth = distinct node
        if key in seen:
            return seen[key]
        nid = f"n{idx:03d}"
        idx += 1
        seen[key] = nid
        node = {
            "id": nid, "text": text, "type": type_, "level": level,
            "polarity": round(polarity, 2), "probability": 0.0,
        }
        if cand is not None:
            pnode = node_by_id.get(parent_nid) if parent_nid else None
            # the engine derived a concrete, quantitative child text -> prefer it
            derived_text = cand.get("derived_text")
            if derived_text:
                node["text"] = derived_text
            node["state_changes"] = cand.get("state_changes")
            node["causal_mechanism"] = cand.get("mechanism")
            node["domain"] = cand.get("domain") or _infer_domain(node["text"])
            node["scale"] = cand.get("scale") or _infer_scale(node["text"])
            node["temporal_context"] = cand.get("temporal_relation")
            # state: prefer the engine's math-derived state (path dependency); else merge
            base_state = pnode.get("state", {}) if pnode else {}
            node["state"] = cand.get("derived_state") or _state_merge(base_state, cand.get("state_changes"))
            node["formula"] = cand.get("formula")
            node["formula_plain"] = cand.get("formula_plain")
            node["uncertainty"] = cand.get("uncertainty")
            node["assumptions"] = cand.get("assumptions")
            node["operator"] = cand.get("operator")
            node["metadata"] = {"confidence": cand.get("confidence"), "source": cand.get("source")}
        else:
            # root/seed node: initialise quantitative state (every value an assumption)
            node["state"] = mech.init_state(_seed_spec(text))
            node["scale"] = _infer_scale(text)
            node["domain"] = _infer_domain(text)
            node["causal_mechanism"] = None
            node["state_changes"] = None
            node["temporal_context"] = None
            node["formula"] = None
            node["formula_plain"] = None
            node["uncertainty"] = None
            node["assumptions"] = None
            node["operator"] = None
            node["metadata"] = {"source": "seed"}
        nodes.append(node)
        node_by_id[nid] = node
        return nid

    def _emit_progress():
        if on_progress:
            on_progress({"nodes": list(nodes), "edges": list(edges),
                         "n_nodes": len(nodes), "n_edges": len(edges), "topic": topic})

    roots = extract_root_events(seed_text, rng, lang=lang)
    frontier: list[tuple[str, int]] = [(add_node(r, "root", 0, _polarity(r)), 0) for r in roots]
    trajectory.push("phase", f"extract {len(roots)} starting event(s)")
    # connect sequential roots so a split scenario flows as ONE causal chain
    # instead of N disconnected trees — BFS still expands each root independently.
    for i in range(len(frontier) - 1):
        src = frontier[i][0]
        tgt = frontier[i + 1][0]
        edges.append({"source": src, "target": tgt, "relation": "and-then",
                      "weight": 0.5, "mechanism": None, "state_changes": None,
                      "formula": None, "uncertainty": None, "operator": None,
                      "delay_days": 0})
        parent[tgt] = src
    _emit_progress()   # roots visible immediately — the "drop" before the ripples

    def _place_candidate(parent_nid: str, cand: dict, level: int) -> str | None:
        """Attach an ALREADY validated+derived candidate under a parent (shared by
        the classic wave loop — where _expand_many ran the gate — and the turbo
        assembler, which runs the gate itself just below). Returns child id or
        None when the web is full."""
        if idx >= max_nodes:
            return None
        cid = add_node(cand["text"], "consequence", level, cand["polarity"], cand, parent_nid)
        edges.append({"source": parent_nid, "target": cid, "relation": cand["relation"],
                      "weight": cand["probability"], "mechanism": cand.get("mechanism"),
                      "state_changes": cand.get("state_changes"),
                      "formula": cand.get("formula"), "uncertainty": cand.get("uncertainty"),
                      "operator": cand.get("operator"),
                      "delay_days": estimate_delay_days(node_by_id[cid]["text"])})
        parent[cid] = parent_nid
        return cid

    turbo = bool(config.get("turbo")) and llm.is_configured() and frontier
    if turbo:
        # TURBO: one LLM call per root generates its WHOLE subtree, all roots in
        # PARALLEL — the ~depth+1 sequential round-trips collapse to ~2 rounds
        # (roots call + one parallel subtree round). Assembly is level-by-level
        # with the exact same validation as the classic path; a root whose call
        # failed falls back to a rule-based chain. Waves are paced slightly so
        # the live canvas still shows the web growing (assembly itself is instant).
        trajectory.push("phase", f"turbo: generate {len(frontier)} subtree(s) in parallel")
        root_ids = [nid for nid, _ in frontier]
        parent_job = trajectory.get_job()

        def _fetch(root_text: str):
            if parent_job:
                trajectory.set_job(parent_job)   # route llm events from worker threads
            return _use_llm(llm.build_subtree, root_text, topic, depth, branching, lang)

        texts = [node_by_id[nid]["text"] for nid in root_ids]
        if len(texts) > 1 and _llm_workers() > 1:
            with ThreadPoolExecutor(max_workers=min(_llm_workers(), len(texts))) as pool:
                trees = list(pool.map(_fetch, texts))
        else:
            trees = [_fetch(t) for t in texts]

        frontiers: list[list[tuple[str, object]]] = [
            [(rid, tree)] for rid, tree in zip(root_ids, trees)]
        for level in range(1, depth + 1):
            if idx >= max_nodes:
                break
            trajectory.push("phase", f"turbo: assemble depth {level}")
            added = False
            for qi in range(len(root_ids)):
                nxt: list[tuple[str, object]] = []
                for parent_nid, tree in frontiers[qi]:
                    ptext = node_by_id[parent_nid]["text"]
                    if isinstance(tree, dict):
                        children = (tree.get("children") or [])[:branching]
                    else:
                        # subtree call failed (or rule child): local rule-based chain
                        children = _rule_expand(ptext, branching, rng, lang,
                                                ancestry=_ancestry(parent_nid, parent, node_by_id))
                    for child in children:
                        cand = _normalize_candidate(child, rng, lang)
                        if cand is None:
                            continue
                        pnode = node_by_id[parent_nid]
                        ok, _reason = validate_candidate(cand, pnode, lang)   # engine gate
                        if not ok:
                            continue
                        cand = _derive_candidate(cand, pnode, rng, lang)
                        cid = _place_candidate(parent_nid, cand, level)
                        if cid is None:
                            continue
                        added = True
                        nxt.append((cid, child if isinstance(child, dict) else None))
                frontiers[qi] = nxt
            _emit_progress()          # a turbo wave settled
            if on_progress and added:
                time.sleep(0.9)       # pace the reveal; the canvas poll is ~1s
            if not added:
                break
    else:
        # expand level-by-level, batching all events of a level into one LLM call
        while frontier and idx < max_nodes:
            level = frontier[0][1]
            if level >= depth:
                break
            trajectory.push("phase", f"expand depth {level} → {level + 1} ({len(frontier)} node(s))")
            items = [(nid, node_by_id[nid]["text"], _ancestry(nid, parent, node_by_id)) for nid, _ in frontier]
            results = _expand_many(items, branching, rng, lang, node_by_id)
            next_frontier: list[tuple[str, int]] = []
            for nid, cons in results.items():
                for cand in cons:
                    cid = _place_candidate(nid, cand, level + 1)
                    if cid is None:
                        continue
                    next_frontier.append((cid, level + 1))
            frontier = next_frontier
            _emit_progress()   # a full wave settled — let the UI show it

    result = {
        "id": uuid.uuid4().hex[:12],
        "seed": seed,
        "lang": lang,
        "topic": topic,
        "n_nodes": len(nodes),
        "n_edges": len(edges),
        "nodes": nodes,
        "edges": edges,
    }
    if _debug_enabled:
        result["debug_trace"] = list(_debug_trace)
    trajectory.push("phase", f"web complete: {len(nodes)} events, {len(edges)} links")
    trajectory.end()
    return result


def predict(web: dict, lang: str = "en") -> dict:
    """Propagate likelihood through the causal web and find the dominant chain.

    Propagation is multi-pass (Bellman-Ford style): a single level-ordered pass
    suffices for the tree-shaped webs build_web produces, but user edits can add
    back-edges that form FEEDBACK LOOPS (protest → repression → bigger protest).
    Extra passes let probability flow around such loops until it converges —
    products of weights < 1 damp each lap, so the process always terminates.
    """
    lang = _lang(lang)
    nodes = {n["id"]: n for n in web["nodes"]}
    for n in web["nodes"]:
        n["probability"] = 1.0 if n["type"] in ("root", "intervention") else 0.0
        n["_best_parent"] = None

    ordered = sorted(web["edges"], key=lambda e: nodes[e["source"]]["level"])
    max_passes = min(len(nodes) + 1, 50)
    feedback = False
    for pass_no in range(max_passes):
        improved = False
        for e in ordered:
            s = nodes[e["source"]]
            t = nodes[e["target"]]
            cand = s["probability"] * e["weight"]
            if cand > t["probability"] + 1e-12:
                t["probability"] = cand
                t["_best_parent"] = e["source"]
                improved = True
        if not improved:
            break
        if pass_no > 0:
            feedback = True  # a later pass still improved things -> a loop is active

    has_out = {e["source"] for e in web["edges"]}
    leaves = [n for n in web["nodes"] if n["id"] not in has_out]
    leaves.sort(key=lambda n: -n["probability"])

    chain: list[str] = []
    if leaves:
        cur: str | None = leaves[0]["id"]
        seen: set[str] = set()
        while cur and cur not in seen:
            seen.add(cur)
            chain.append(cur)
            cur = nodes[cur].get("_best_parent")
        chain.reverse()

    for n in web["nodes"]:
        n.pop("_best_parent", None)

    # timeline: cumulative delay along the most likely chain
    edge_delay = {(e["source"], e["target"]): e.get("delay_days") for e in web["edges"]}
    timeline = []
    day = 0
    for i, cid in enumerate(chain):
        if i:
            d = edge_delay.get((chain[i - 1], cid))
            day += d if isinstance(d, (int, float)) else estimate_delay_days(nodes[cid]["text"])
        timeline.append({"id": cid, "text": nodes[cid]["text"], "day": int(day)})

    chain_nodes = [nodes[c] for c in chain]
    top = leaves[:6]
    return {
        "most_likely_chain": [c for c in chain],
        "confidence": round((leaves[0]["probability"] if leaves else 0.0), 3),
        "feedback_loop": feedback,
        "timeline": timeline,
        "horizon_days": timeline[-1]["day"] if timeline else 0,
        "top_outcomes": [
            {"id": n["id"], "text": n["text"], "probability": round(n["probability"], 3)}
            for n in top
        ],
        "summary": _summarize(web, chain_nodes, lang),
    }


def _percentile(sorted_vals: list[float], q: float) -> float:
    """Simple linear-interpolation percentile; sorted_vals must be sorted, non-empty."""
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    pos = q * (len(sorted_vals) - 1)
    lo = int(pos)
    hi = min(lo + 1, len(sorted_vals) - 1)
    frac = pos - lo
    return sorted_vals[lo] * (1 - frac) + sorted_vals[hi] * frac


def predict_ensemble(web: dict, lang: str = "en", runs: int = 25, noise: float = 0.15,
                     seed: int | None = None) -> dict:
    """Monte-Carlo confidence intervals over the edge weights.

    Re-runs max-product propagation `runs` times, jittering every edge weight by
    ±`noise` (multiplicative, clamped to [0,1]). Reports how stable the prediction
    is: per-outcome mean probability with a P10–P90 interval, the confidence CI,
    and how often the modal chain wins (chain stability). Deterministic per seed.
    Does NOT mutate the web.
    """
    runs = max(2, int(runs))
    noise = clamp(float(noise), 0.0, 0.9)
    rng = random.Random(web.get("seed", 0) if seed is None else seed)
    nodes = {n["id"]: n for n in web["nodes"]}
    edges = web["edges"]
    ordered_idx = sorted(range(len(edges)), key=lambda i: nodes[edges[i]["source"]]["level"])
    has_out = {e["source"] for e in edges}
    leaf_ids = [n["id"] for n in web["nodes"] if n["id"] not in has_out]

    acc: dict[str, list[float]] = {n["id"]: [] for n in web["nodes"]}
    chain_wins: dict[tuple, int] = {}
    conf_samples: list[float] = []

    for _ in range(runs):
        jitter = [clamp(e["weight"] * (1 + rng.uniform(-noise, noise)), 0.0, 1.0) for e in edges]
        prob = {nid: (1.0 if n["type"] in ("root", "intervention") else 0.0)
                for nid, n in nodes.items()}
        best: dict[str, str | None] = {}
        for i in ordered_idx:
            e = edges[i]
            cand = prob[e["source"]] * jitter[i]
            if cand > prob[e["target"]]:
                prob[e["target"]] = cand
                best[e["target"]] = e["source"]
        leaves = sorted(leaf_ids, key=lambda nid: -prob[nid])
        if leaves:
            conf_samples.append(prob[leaves[0]])
            cur: str | None = leaves[0]
            chain: list[str] = []
            seen: set[str] = set()
            while cur and cur not in seen:
                seen.add(cur)
                chain.append(cur)
                cur = best.get(cur)
            chain_wins[tuple(reversed(chain))] = chain_wins.get(tuple(reversed(chain)), 0) + 1
        for nid, p in prob.items():
            acc[nid].append(p)

    def _stats(vals: list[float]) -> dict:
        vals = sorted(vals)
        return {"mean": round(sum(vals) / len(vals), 3),
                "lo": round(_percentile(vals, 0.10), 3),
                "hi": round(_percentile(vals, 0.90), 3)}

    modal_chain, modal_wins = ((), 0)
    if chain_wins:
        modal_chain, modal_wins = max(chain_wins.items(), key=lambda kv: kv[1])

    top_leaf_stats = sorted(
        ({"id": nid, "text": nodes[nid]["text"], **_stats(acc[nid])} for nid in leaf_ids),
        key=lambda d: -d["mean"])[:6]
    keep = {d["id"] for d in top_leaf_stats} | set(modal_chain)
    return {
        "runs": runs,
        "noise": noise,
        "confidence": _stats(conf_samples) if conf_samples else {"mean": 0.0, "lo": 0.0, "hi": 0.0},
        "chain_stability": round(modal_wins / runs, 3),
        "modal_chain": list(modal_chain),
        "top_outcomes": top_leaf_stats,
        "per_node": {nid: _stats(acc[nid]) for nid in keep},
    }


def _summarize(web: dict, chain: list[dict], lang: str) -> str:
    lang = _lang(lang)
    if not chain:
        return ("Tidak ada rantai sebab-akibat yang bisa disimpulkan dari skenario ini."
                if lang == "id" else "No causal chain could be resolved from this scenario.")
    root = chain[0]["text"]
    leaf = chain[-1]["text"]
    conf = round(chain[-1]["probability"] * 100)
    steps = " → ".join(n["text"] for n in chain)
    if lang == "id":
        return f"Jika {_lc(root)}, hasil yang paling mungkin adalah {_lc(leaf)} (≈{conf}%).\nJalur: {steps}."
    return f"If {_lc(root)}, the most likely outcome is {_lc(leaf)} (≈{conf}% confidence).\nPath: {steps}."


def _lc(s: str) -> str:
    return s[0].lower() + s[1:] if s else s


def apply_interventions(web: dict, interventions: list[dict], rng: random.Random, config: dict | None = None, lang: str = "en") -> dict:
    """Inject new events as intervention roots and expand their consequences."""
    if not interventions:
        return web
    lang = _lang(lang)
    _reset_llm()
    config = config or {}
    branching = clamp_int(config.get("branching", 5), 1, 200)
    depth = clamp_int(config.get("depth", 3), 1, 50)
    max_nodes = clamp_int(config.get("max_nodes", 2000), 1, 20000)
    global _debug_enabled
    _debug_enabled = bool(config.get("debug"))

    nodes = list(web["nodes"])
    edges = list(web["edges"])
    seen = {(n["level"], _norm(n["text"])): n["id"] for n in nodes}
    node_by_id = {n["id"]: n for n in nodes}
    parent = {e["target"]: e["source"] for e in edges}
    idx = len(nodes)

    def add_node(text: str, type_: str, level: int, polarity: float, cand: dict | None = None, parent_nid: str | None = None) -> str:
        nonlocal idx
        key = (level, _norm(text))
        if key in seen:
            return seen[key]
        nid = f"n{idx:03d}"
        idx += 1
        seen[key] = nid
        node = {
            "id": nid, "text": text, "type": type_, "level": level,
            "polarity": round(polarity, 2), "probability": 0.0,
        }
        if cand is not None:
            pnode = node_by_id.get(parent_nid) if parent_nid else None
            # the engine derived a concrete, quantitative child text -> prefer it
            derived_text = cand.get("derived_text")
            if derived_text:
                node["text"] = derived_text
            node["state_changes"] = cand.get("state_changes")
            node["causal_mechanism"] = cand.get("mechanism")
            node["domain"] = cand.get("domain") or _infer_domain(node["text"])
            node["scale"] = cand.get("scale") or _infer_scale(node["text"])
            node["temporal_context"] = cand.get("temporal_relation")
            # state: prefer the engine's math-derived state (path dependency); else merge
            base_state = pnode.get("state", {}) if pnode else {}
            node["state"] = cand.get("derived_state") or _state_merge(base_state, cand.get("state_changes"))
            node["formula"] = cand.get("formula")
            node["formula_plain"] = cand.get("formula_plain")
            node["uncertainty"] = cand.get("uncertainty")
            node["assumptions"] = cand.get("assumptions")
            node["operator"] = cand.get("operator")
            node["metadata"] = {"confidence": cand.get("confidence"), "source": cand.get("source")}
        else:
            # root/seed node: initialise quantitative state (every value an assumption)
            node["state"] = mech.init_state(_seed_spec(text))
            node["scale"] = _infer_scale(text)
            node["domain"] = _infer_domain(text)
            node["causal_mechanism"] = None
            node["state_changes"] = None
            node["temporal_context"] = None
            node["formula"] = None
            node["formula_plain"] = None
            node["uncertainty"] = None
            node["assumptions"] = None
            node["operator"] = None
            node["metadata"] = {"source": "seed"}
        nodes.append(node)
        node_by_id[nid] = node
        return nid

    for inv in interventions:
        text = (inv.get("text") or "").strip()
        target_id = (inv.get("target") or "").strip()
        state_patch = inv.get("state") or {}
        if target_id and target_id in node_by_id:
            # TARGETED intervention: patch the node's quantitative state, then re-derive its
            # subtree so the intervention propagates through the math model AND the network
            # (the new children's states/probabilities are recomputed from the patched state).
            tnode = node_by_id[target_id]
            tnode["state"] = {**(tnode.get("state") or {}), **state_patch}
            tnode.setdefault("interventions", []).append(
                {"text": text or "state patch", "state": dict(state_patch)})
            frontier: list[tuple[str, int]] = [(target_id, tnode.get("level", 0))]
        elif text:
            # DEFAULT: inject as a new intervention root and expand its consequences.
            nid = add_node(text, "intervention", 0, _polarity(text))
            frontier: list[tuple[str, int]] = [(nid, 0)]
        else:
            continue
        while frontier and idx < max_nodes:
            level = frontier[0][1]
            if level >= depth:
                break
            items = [(cid, node_by_id[cid]["text"], _ancestry(cid, parent, node_by_id)) for cid, _ in frontier]
            results = _expand_many(items, branching, rng, lang, node_by_id)
            next_frontier: list[tuple[str, int]] = []
            for cid, cons in results.items():
                for cand in cons:
                    if idx >= max_nodes:
                        break
                    tid = add_node(cand["text"], "consequence", level + 1, cand["polarity"], cand, cid)
                    edges.append({"source": cid, "target": tid, "relation": cand["relation"],
                                  "weight": cand["probability"], "mechanism": cand.get("mechanism"),
                                  "state_changes": cand.get("state_changes"),
                                  "formula": cand.get("formula"), "uncertainty": cand.get("uncertainty"),
                                  "operator": cand.get("operator"),
                                  "delay_days": estimate_delay_days(node_by_id[tid]["text"])})
                    parent[tid] = cid
                    next_frontier.append((tid, level + 1))
            frontier = next_frontier

    web["nodes"] = nodes
    web["edges"] = edges
    web["n_nodes"] = len(nodes)
    web["n_edges"] = len(edges)
    if _debug_enabled:
        web["debug_trace"] = list(_debug_trace)
    return web


def causal_report(web: dict, prediction: dict, lang: str = "en") -> dict:
    """Structured report for the frontend."""
    lang = _lang(lang)
    nodes = {n["id"]: n for n in web["nodes"]}
    chain = prediction["most_likely_chain"]
    findings = []
    if chain:
        findings.append(prediction["summary"].split("\n")[0])
    for o in prediction["top_outcomes"][:4]:
        findings.append(f"{o['text']} — {round(o['probability'] * 100)}%")
    interventions = [n for n in web["nodes"] if n["type"] == "intervention"]
    if interventions:
        findings.append((f"{len(interventions)} intervensi disuntikkan dan diperluas."
                         if lang == "id" else f"{len(interventions)} intervention(s) injected and expanded."))
    chain_texts = [nodes[c]["text"] for c in chain]
    return {
        "summary": prediction["summary"].split("\n")[0],
        "chain": chain_texts,
        "confidence": prediction["confidence"],
        "top_outcomes": prediction["top_outcomes"],
        "findings": findings,
        "n_nodes": web["n_nodes"],
        "n_edges": web["n_edges"],
        "lang": lang,
    }


def explain_node(web: dict, node_id: str, lang: str = "en") -> dict:
    """Explain why a node exists — LLM when available, rule-based otherwise."""
    lang = _lang(lang)
    nodes = {n["id"]: n for n in web["nodes"]}
    node = nodes.get(node_id)
    if not node:
        return {"node": None, "reply": ("Node tidak ditemukan." if lang == "id" else "Node not found."),
                "causes": [], "effects": []}
    causes = [(nodes[e["source"]]["text"], e["relation"]) for e in web["edges"] if e["target"] == node_id]
    effects = [(nodes[e["target"]]["text"], e["relation"]) for e in web["edges"] if e["source"] == node_id]

    via_llm = llm.explain_node(node["text"], causes, effects, lang)
    if via_llm:
        return {"node": node["text"], "reply": via_llm,
                "causes": [t for t, _ in causes], "effects": [t for t, _ in effects]}

    prob = node.get("probability", 0.0)
    cause_texts = [t for t, _ in causes]
    effect_texts = [t for t, _ in effects]
    parts: list[str] = []
    if lang == "id":
        if cause_texts:
            parts.append("Peristiwa ini muncul dari: " + "; ".join(cause_texts[:4]) + ".")
        else:
            parts.append("Ini adalah peristiwa awal dari skenario.")
        if effect_texts:
            parts.append("Kemudian dapat memicu: " + "; ".join(effect_texts[:5]) + ".")
        if prob:
            parts.append(f"Perkiraan kemungkinannya sekitar {round(prob * 100)}%.")
    else:
        if cause_texts:
            parts.append("This event arises from: " + "; ".join(cause_texts[:4]) + ".")
        else:
            parts.append("This is a starting event of the scenario.")
        if effect_texts:
            parts.append("Then it can trigger: " + "; ".join(effect_texts[:5]) + ".")
        if prob:
            parts.append(f"Its estimated likelihood is about {round(prob * 100)}%.")
    reply = " ".join(parts)
    return {"node": node["text"], "reply": reply, "causes": cause_texts, "effects": effect_texts}


# ------------------------------------------------------------- graph editing
RELATIONS = {"causes", "leads_to", "increases", "decreases", "enables", "prevents", "weakens", "triggers"}


def _next_node_id(nodes: list[dict]) -> str:
    mx = -1
    for n in nodes:
        m = re.match(r"^n(\d+)$", n["id"])
        if m:
            mx = max(mx, int(m.group(1)))
    return f"n{mx + 1:03d}"


def apply_mutations(web: dict, mutations: list[dict], selected_node_id: str | None = None,
                    lang: str = "en", rng: random.Random | None = None) -> tuple[dict, list[dict]]:
    """Apply a list of graph edits in place and return (web, applied_mutations).

    Supported ops: add_node (a consequence under `to`), add_root, add_edge,
    remove_edge, remove_node, update_node. Invalid ops are skipped silently so a
    sloppy LLM output can never corrupt the web.
    """
    lang = _lang(lang)
    rng = rng or random.Random(0)
    nodes = list(web["nodes"])
    edges = list(web["edges"])
    node_by_id = {n["id"]: n for n in nodes}
    seen = {(n["level"], _norm(n["text"])): n["id"] for n in nodes}
    edge_keys = {(e["source"], e["target"]) for e in edges}

    def add_node(text: str, type_: str, level: int) -> str:
        key = (level, _norm(text))
        if key in seen:
            return seen[key]
        nid = _next_node_id(nodes)
        node = {"id": nid, "text": text, "type": type_, "level": level,
                "polarity": round(_polarity(text), 2), "probability": 0.0}
        nodes.append(node)
        node_by_id[nid] = node
        seen[key] = nid
        return nid

    applied: list[dict] = []
    for m in mutations or []:
        if not isinstance(m, dict):
            continue
        op = m.get("op")
        try:
            if op == "add_node":
                text = str(m.get("text") or "").strip()
                if not text:
                    continue
                parent = node_by_id.get(m.get("to")) or node_by_id.get(selected_node_id)
                if not parent:
                    continue
                rel = m.get("relation") if m.get("relation") in RELATIONS else "leads_to"
                cid = add_node(text, "consequence", int(parent["level"]) + 1)
                w = round(rng.uniform(0.55, 0.88), 2)
                if (parent["id"], cid) not in edge_keys:
                    edges.append({"source": parent["id"], "target": cid, "relation": rel, "weight": w,
                                  "delay_days": estimate_delay_days(text)})
                    edge_keys.add((parent["id"], cid))
                applied.append({"op": "add_node", "id": cid, "to": parent["id"], "text": text, "relation": rel, "weight": w})
            elif op == "add_root":
                text = str(m.get("text") or "").strip()
                if not text:
                    continue
                type_ = m.get("type") if m.get("type") in ("root", "intervention") else "intervention"
                cid = add_node(text, type_, 0)
                applied.append({"op": "add_root", "id": cid, "text": text, "type": type_})
            elif op == "add_edge":
                s, t = m.get("from"), m.get("to")
                if s in node_by_id and t in node_by_id and s != t and (s, t) not in edge_keys:
                    rel = m.get("relation") if m.get("relation") in RELATIONS else "causes"
                    w = round(rng.uniform(0.55, 0.88), 2)
                    edges.append({"source": s, "target": t, "relation": rel, "weight": w,
                                  "delay_days": estimate_delay_days(node_by_id[t]["text"])})
                    edge_keys.add((s, t))
                    applied.append({"op": "add_edge", "from": s, "to": t, "relation": rel, "weight": w})
            elif op == "remove_edge":
                s, t = m.get("from"), m.get("to")
                kept = [e for e in edges if not (e["source"] == s and e["target"] == t)]
                if len(kept) != len(edges):
                    edges[:] = kept
                    edge_keys.discard((s, t))
                    applied.append({"op": "remove_edge", "from": s, "to": t})
            elif op == "remove_node":
                nid = m.get("id")
                if nid in node_by_id:
                    n = node_by_id[nid]
                    seen.pop((n["level"], _norm(n["text"])), None)
                    nodes[:] = [x for x in nodes if x["id"] != nid]
                    edges[:] = [e for e in edges if e["source"] != nid and e["target"] != nid]
                    del node_by_id[nid]
                    edge_keys = {(e["source"], e["target"]) for e in edges}
                    applied.append({"op": "remove_node", "id": nid})
            elif op == "update_node":
                nid = m.get("id")
                text = str(m.get("text") or "").strip()
                if nid in node_by_id and text:
                    old = node_by_id[nid]["text"]
                    node_by_id[nid]["text"] = text
                    node_by_id[nid]["polarity"] = round(_polarity(text), 2)
                    seen.pop((node_by_id[nid]["level"], _norm(old)), None)
                    seen[(node_by_id[nid]["level"], _norm(text))] = nid
                    applied.append({"op": "update_node", "id": nid, "text": text})
        except Exception:  # noqa: BLE001 — never let one bad op break the batch
            continue

    web["nodes"] = nodes
    web["edges"] = edges
    web["n_nodes"] = len(nodes)
    web["n_edges"] = len(edges)
    return web, applied


def offline_develop(web: dict, node_id: str, lang: str = "en",
                    rng: random.Random | None = None) -> tuple[dict, str, list[dict]]:
    """Rule-based fallback for AI co-development: grow the chosen node a bit."""
    lang = _lang(lang)
    rng = rng or random.Random(0)
    nodes = {n["id"]: n for n in web["nodes"]}
    node = nodes.get(node_id)
    if not node:
        return web, ("Node tidak ditemukan." if lang == "id" else "Node not found."), []
    # ancestry = the chain of ancestor texts leading to this node, so a personal seed's
    # context propagates here (avoid re-teleporting to institutional consequences).
    parent_of = {e["target"]: e["source"] for e in web["edges"]}
    anc: list[str] = []
    cur = node_id
    while cur in parent_of and len(anc) < 6:
        p = parent_of.get(cur)
        pnode = nodes.get(p)
        if not pnode:
            break
        anc.append(pnode["text"])
        cur = p
    ancestry = " -> ".join(reversed(anc))
    cons = _rule_expand(node["text"], 3, rng, lang, ancestry=ancestry)
    mutations = [{"op": "add_node", "to": node_id, "text": t, "relation": rel} for t, rel, _w, _p in cons]
    web, applied = apply_mutations(web, mutations, node_id, lang, rng)
    texts = [m["text"] for m in applied if m.get("text")]
    if lang == "id":
        reply = f"Saya kembangkan “{node['text']}” menjadi {len(texts)} konsekuensi baru: " + "; ".join(texts) + "."
    else:
        reply = f"I expanded “{node['text']}” into {len(texts)} new consequences: " + "; ".join(texts) + "."
    return web, reply, applied


# ----------------------------------------------- on-demand math derivation API
def ancestry_texts(web: dict, node_id: str, maxlen: int = 6) -> list[str]:
    """Return the text of this node's causal ancestors (closest-first), by walking
    edges backwards toward roots. Used to give the LLM real context for a derivation."""
    nodes = {n["id"]: n for n in web["nodes"]}
    parent_of = {e["target"]: e["source"] for e in web["edges"]}
    chain: list[str] = []
    cur = node_id
    seen: set[str] = set()
    while cur not in seen:
        seen.add(cur)
        nxt = parent_of.get(cur)
        if not nxt:
            break
        pnode = nodes.get(nxt)
        if not pnode:
            break
        chain.append(pnode.get("text", ""))
        cur = nxt
        if len(chain) >= maxlen:
            break
    return chain


def mecher_derive(event: str, ancestors: list[str], lang: str = "en") -> dict:
    """Lightweight, purely mechanistic fallback derivation keyed only off text — used when
    the LLM is unavailable. Produces a plausible delta-style formula and a couple of
    assumptions so the UI never shows an empty math panel."""
    if lang == "id":
        expl = "Asumsi berdasarkan struktur skenario secara umum."
        base = "ΔX"
    else:
        expl = "A generic mechanistic assumption derived from the scenario structure."
        base = "ΔX"
    cause = ancestors[-1] if ancestors else "the upstream driver"
    cause = cause[:60]
    if any(k in event.lower() for k in ("hujan", "curah", "basah", "licin")) or "rain" in event.lower():
        return {"variables": ["visibility", "traction", "speed"],
                "formula": f"{base}(traction) = -{0.18:g} * R(hujan)",
                "explanation": expl + " (efek hujan pada kohesi jalan)",
                "assumptions": ["Lapisan air menurunkan koefisien gesek"], "mechanism": "fluid_damping",
                "units": {"R": "mm/h", "speed": "km/h"}, "source": "mech"}
    if any(k in event.lower() for k in ("macet", "trafik", "lalu lintas")) or "traffic" in event.lower():
        return {"variables": ["density", "flow", "speed"],
                "formula": f"{base}(flow) = -0.9 * kepadatan(kendaraan) + 0.3 * kapasitas_jalan",
                "explanation": expl + " (kepadatan kendaraan menurunkan aliran lalu-lintas)",
                "assumptions": ["Model fundamental diagram"], "mechanism": "traffic_flow",
                "units": {"density": "veh/km", "flow": "veh/h"}, "source": "mech"}
    # quantitative operators from mech.py: run the real model, not just a template
    low = event.lower()
    if any(k in low for k in ("epidemic", "infection", "outbreak", "pandemic",
                              "wabah", "infeksi", "penularan", "pandemi")):
        d = mech.derive({"state": {}}, {"operator": "sir_epidemic"}) or {}
        note = (" Model SIR dijalankan." if lang == "id" else " SIR model evaluated.")
        return {"variables": ["susceptible", "infected", "recovered", "R0"],
                "formula": d.get("formula_plain") or "R0 = beta/gamma",
                "explanation": expl + note + " " + str(d.get("child_text") or ""),
                "assumptions": list(d.get("assumptions") or ["Model SIR standar"]),
                "mechanism": "sir_epidemic",
                "units": {"population": "people", "peak_time": "days"}, "source": "mech"}
    if any(k in low for k in ("price", "demand", "elasticity",
                              "harga", "permintaan", "elastisitas")):
        d = mech.derive({"state": {}}, {"operator": "price_elasticity"}) or {}
        note = (" Model elastisitas dijalankan." if lang == "id" else " Elasticity model evaluated.")
        return {"variables": ["price", "quantity", "revenue"],
                "formula": d.get("formula_plain") or "dQ% = elasticity * dP%",
                "explanation": expl + note + " " + str(d.get("child_text") or ""),
                "assumptions": list(d.get("assumptions") or ["Elastisitas harga konstan"]),
                "mechanism": "price_elasticity",
                "units": {"price": "%", "quantity": "%", "revenue": "%"}, "source": "mech"}
    if any(k in low for k in ("growth", "investment", "population", "compound",
                              "pertumbuhan", "investasi", "populasi", "majemuk")):
        d = mech.derive({"state": {}}, {"operator": "compound_growth"}) or {}
        note = (" Model pertumbuhan majemuk dijalankan." if lang == "id" else " Compound growth evaluated.")
        return {"variables": ["initial_value", "growth_rate", "periods", "final_value"],
                "formula": d.get("formula_plain") or "F = P(1+r)^n",
                "explanation": expl + note + " " + str(d.get("child_text") or ""),
                "assumptions": list(d.get("assumptions") or ["Laju pertumbuhan konstan"]),
                "mechanism": "compound_growth",
                "units": {"growth_rate": "%/period", "periods": "periods"}, "source": "mech"}
    return {"variables": ["cause", "effect", "coupling"],
            "formula": f"{base}(effect) = alpha * f({cause[:20]})",
            "explanation": expl,
            "assumptions": ["Hubungan kausal monoton"], "mechanism": "linear_coupling",
            "units": {}, "source": "mech"}


# ----------------------------------------------------- qualitative math derivation
# A small qualitative-causal knowledge layer (QSIM-style sign propagation) used by
# `mecher_derive_qualitative` so a full structured derivation is always available
# without an LLM. Sign convention: edge (cause, effect, +1) means "cause up =>
# effect up"; -1 means "cause up => effect down". Numbers are never invented — every
# relationship is a direction (+ / -) plus a symbolic f().
_QVAR = [  # variable name -> keyword phrases (en + id) that surface it in text
    ("public_transit_usage", ["free public transit", "public transit", "public transport",
                              "mass transit", "free transit", "transit gratis", "transport umum",
                              "transport gratis"]),
    ("vehicle_traffic", ["vehicle traffic", "car traffic", "traffic", "lalu lintas",
                         "kendar", "driving", "motor vehicle", "private car", "mobil pribadi"]),
    ("congestion", ["congestion", "kemacetan", "traffic jam", "gridlock", "macet"]),
    ("air_pollution", ["pollution", "polusi", "emission", "emisi", "air quality", "kualitas udara"]),
    ("city_debt", ["city debt", "utang kota", "hutang kota", "municipal debt", "government debt",
                   "fiscal deficit", "deficit", "utang pemerintah", "hutang pemerintah"]),
    ("private_operator_revenue", ["private operator revenue", "operator revenue",
                                  "private operator", "pendapatan operator", "operator transport",
                                  "pendapatan oper", "revenue"]),
    ("operating_cost", ["operating cost", "biaya operasional", "operasional", "opex",
                        "cost of service", "biaya layanan", "biaya mengoperasikan"]),
    ("ridership", ["ridership", "penumpang", "pengguna transport", "pengguna transit",
                   "penggunaan transit", "pengguna", "penggunaan transportasi"]),
    ("fare", ["fare", "tarif", "ticket", "tiket"]),
    ("budget", ["budget", "anggaran", "pembiayaan", "funding", "subsidy",
                "subsidi", "fiscal space", "ruang keuangan"]),
    ("cost_of_living", ["cost of living", "biaya hidup"]),
    ("public_health", ["public health", "kesehatan masyarakat", "kesehatan"]),
]

# (cause, effect, sign): if cause goes UP, effect moves by `sign` (+1 up / -1 down).
_QGRAPH = [
    ("public_transit_usage", "vehicle_traffic", -1),
    ("public_transit_usage", "ridership", 1),
    ("public_transit_usage", "operating_cost", 1),
    ("vehicle_traffic", "congestion", 1),
    ("vehicle_traffic", "air_pollution", 1),
    ("vehicle_traffic", "operating_cost", 1),
    ("congestion", "air_pollution", 1),
    ("ridership", "fare", -1),
    ("ridership", "operating_cost", 1),
    ("fare", "private_operator_revenue", 1),
    ("operating_cost", "city_debt", 1),
    ("city_debt", "operating_cost", 1),          # positive feedback: debt → higher cost → more debt
    ("air_pollution", "public_health", -1),
    ("congestion", "public_health", -1),
]

# qualitative time horizon bucket for each variable
_QHORIZON = {
    "vehicle_traffic": "short_term", "congestion": "short_term", "air_pollution": "short_term",
    "ridership": "short_term", "public_transit_usage": "short_term",
    "fare": "medium_term", "operating_cost": "medium_term", "private_operator_revenue": "medium_term",
    "public_health": "medium_term",
    "city_debt": "long_term", "budget": "long_term", "cost_of_living": "long_term",
}

# verb -> (family, object_sign): how the OBJECT of the verb moves
#   reduce: object goes down (cuts/reduces), raise: object goes up (raises),
#   hurt: object goes down (hurts revenue)
_VERB_SIGN = {
    "cut": "down", "cuts": "down", "cutting": "down", "cut": "down",
    "reduce": "down", "reduces": "down", "reduced": "down", "reducing": "down",
    "lower": "down", "lowers": "down", "lowered": "down", "lowering": "down",
    "decrease": "down", "decreases": "down", "decreased": "down", "decreasing": "down",
    "drop": "down", "drops": "down", "dropped": "down", "dropping": "down",
    "raise": "up", "raises": "up", "raised": "up", "raising": "up",
    "increase": "up", "increases": "up", "increased": "up", "increasing": "up",
    "grow": "up", "grows": "up", "grown": "up", "growing": "up",
    "rise": "up", "rises": "up", "risen": "up", "rising": "up",
    "boost": "up", "boosts": "up", "boosted": "up", "boosting": "up",
    "improve": "up", "improves": "up", "improved": "up", "improving": "up",
    "hurt": "down", "hurts": "down", "hurt": "down", "damages": "down",
    "damage": "down", "undermine": "down", "undermines": "down",
    "harm": "down", "harms": "down", "worsen": "down", "worsens": "down", "worsened": "down",
    # Indonesian
    "mengurangi": "down", "memotong": "down", "menurunkan": "down",
    "menyebabkan": "up", "menaikkan": "up", "meningkatkan": "up", "membesarkan": "up",
    "merusak": "down", "mengorbankan": "down", "memburuk": "down", "menyusahkan": "down",
}

_TRADEOFF = re.compile(r"\b(but|however|while|although|although|namun|meskipun|walau|sedangkan|tapi)\b", re.I)
_TRADEOFF_ONLY = re.compile(r"\b(but|namun|tapi)\b", re.I)


def _vars_in(text: str) -> list[str]:
    """Variable names surfaced by keyword matches in `text`, in order of appearance, unique."""
    t = (text or "").lower()
    found, seen = [], set()
    for name, kws in _QVAR:
        for kw in kws:
            idx = t.find(kw)
            if idx >= 0 and name not in seen:
                seen.add(name)
                found.append((idx, name))
                break
    found.sort()
    return [n for _, n in found]


def _vars_of(text: str) -> dict[str, list[str]]:
    """All variable matches grouped, returning {var: [phrases]} for presence checks."""
    t = (text or "").lower()
    out: dict[str, list[str]] = {}
    for name, kws in _QVAR:
        hits = [kw for kw in kws if kw in t]
        if hits:
            out[name] = hits
    return out


def _sign_str(s) -> str:
    if s is None or s == 0:
        return "↔"
    return "↑" if s > 0 else "↓"


def _verb_objects(text: str) -> list[tuple[str, str, str]]:
    """Find (verb, object_var, object_sign) predicate triples in `text`.

    A verb's object(s) are the variable keywords occurring at/after the verb, up to
    the next verb or sentence end. Handles "cuts congestion & pollution" (multiple
    objects) by collecting all variables in the clause after the verb."""
    t = (text or "").lower()
    # find all variable keyword positions
    var_hits: list[tuple[int, str]] = []
    for name, kws in _QVAR:
        for kw in kws:
            idx = t.find(kw)
            if idx >= 0:
                var_hits.append((idx, name))
                break
    var_hits.sort()
    # find all verb positions
    verb_hits: list[tuple[int, str, str]] = []
    for verb, osign in _VERB_SIGN.items():
        for m in re.finditer(r"\b" + re.escape(verb) + r"\b", t):
            verb_hits.append((m.start(), verb, osign))
    verb_hits.sort()
    # sentence/period boundaries (split into clauses)
    sentence_ends = [m.end() for m in re.finditer(r"[.!?]", t)]
    # next verb position after each position
    next_verb_pos = [v[0] for v in verb_hits]
    out: list[tuple[str, str, str]] = []
    for vpos, verb, osign in verb_hits:
        # clause end = next verb or next sentence end or end of text
        clause_end = len(t)
        for nvp in next_verb_pos:
            if nvp > vpos:
                clause_end = nvp
                break
        for sep in sentence_ends:
            if sep > vpos and sep < clause_end:
                clause_end = sep
                break
        # collect all variables in [vpos, clause_end]
        objs = [name for idx, name in var_hits if vpos <= idx <= clause_end]
        for obj in objs:
            out.append((verb, obj, osign))
    return out


def _graph_edges_present(signs: dict[str, int]) -> list[tuple[str, str, int]]:
    """Qualitative graph edges whose endpoints both appear in the derived sign set."""
    nodes = set(signs)
    return [(a, e, s) for (a, e, s) in _QGRAPH if a in nodes and e in nodes]


def _detect_cycle(graph_edges, roots) -> bool:
    """True if the qualitative graph contains a directed cycle reachable from any root."""
    adj: dict[str, list[str]] = {}
    for a, e, _s in graph_edges:
        adj.setdefault(a, []).append(e)
    seen, stack = set(), set()

    def dfs(n):
        seen.add(n); stack.add(n)
        for nxt in adj.get(n, []):
            if nxt in stack:
                return True
            if nxt not in seen and dfs(nxt):
                return True
        stack.discard(n)
        return False

    return any(dfs(r) for r in roots if r in adj)


def _proceed_chains(graph_edges, signs, roots) -> list[list[str]]:
    """All root→leaf propagation paths (variable name lists) in the derived sign set."""
    adj: dict[str, list[str]] = {}
    for a, e, _s in graph_edges:
        adj.setdefault(a, []).append(e)
    leaves = {e for a, e, _s in graph_edges} - {a for a, _e, _s in graph_edges} | set(roots)
    leaves = {e for e in {a for a, _e, _s in graph_edges} | {e for _a, e, _s in graph_edges} - {a for a, _e, _s in graph_edges}}
    chains: list[list[str]] = []

    def dfs(node, path):
        nxt = adj.get(node, [])
        if not nxt:
            if len(path) > 1:
                chains.append(list(path))
            return
        for child in nxt:
            if child in path:  # stop at cycles
                if len(path) > 1:
                    chains.append(list(path) + [child])
                continue
            dfs(child, path + [child])

    for r in roots:
        dfs(r, [r])
    return chains


def _chain_to_str(chain: list[str], signs: dict[str, int], join=" → ") -> str:
    def _one(v):
        s = signs.get(v)
        return f"{v} {_sign_str(s)}"
    return join.join(_one(v) for v in chain)


def _partial(name: str) -> str:
    return name.replace("_", r"\_")


def _latex_eq(a: str, e: str, sign: int) -> str:
    """∂effect/∂cause with sign (>0 or <0) as a latex fragment."""
    rel = ">" if sign > 0 else "<"
    return (r"\frac{\partial " + _partial(e) + r"}{\partial " + _partial(a) + "}"
            + f" {rel} 0")


def mecher_derive_qualitative(event: str, ancestors: list[str], lang: str = "en") -> dict:
    """Purely mechanistic *qualitative* derivation fallback (no LLM, no invented numbers).

    Sign-propagates the scenario's driver variable(s) through a small qualitative causal
    graph using only ↑/↓ direction signs, ∂ partial derivatives and symbolic f() relations.
    Always returns the full structured shape (variables, symbolic_relationships,
    qualitative_equations, propagation_chains, feedback_loop, time_horizon,
    conflicting_effects, scenarios, conclusion) so the UI always has something to render."""
    lang = _lang(lang)
    text = ((event or "") + "\n" + " ".join(ancestors or [])).strip()
    body = text.lower()

    # 1) variables surfaced by the narrative
    present = _vars_of(text)
    var_names = list(present.keys())
    # 2) driver = an introduced/increased intervention variable; default to first present var
    driver = var_names[0] if var_names else None
    if not driver:
        # generic qualitative driver from the event polarity
        driver = "intervention"
        var_names = ["intervention", "outcome"]

    # 3) direct verb-object relationships from the narrative (the "cuts X / raises Y" layer)
    preds = _verb_objects(text)
    direct: dict[str, int] = {}          # var -> net sign from direct predicates
    for _verb, obj, osign in preds:
        direct[obj] = 1 if osign == "up" else -1
        if obj not in var_names:
            var_names.append(obj)

    # 4) sign propagation through the qualitative graph, rooted at the driver (UP)
    signs: dict[str, int] = {driver: 1}
    order = [driver]
    # iterative relax: for each known sign, propagate across active edges
    changed = True
    while changed:
        changed = False
        for a, e, s in _graph_edges_present({**signs}):
            if a in signs and e not in signs:
                signs[e] = signs[a] * s
                order.append(e)
                changed = True
            elif a in signs and e in signs:
                # conflicting signs from independent paths?
                pass
    # reconcile with direct narrative signs where the graph has no opinion
    for v, sg in direct.items():
        if v not in signs:
            signs[v] = sg
        else:
            signs[v] = sg  # narrative verb is authoritative for the direct effect

    # ensure every surfaced variable has a sign (inherit from driver via polarity if unknown)
    for v in var_names:
        if v not in signs:
            signs[v] = _polarity(text) or 1

    # 5) symbolic relationships + qualitative equations
    symbolic, equations = [], []
    for a, e, s in _graph_edges_present(signs):
        if a in signs and e in signs:
            sa, se = signs[a], signs[e]
            symbolic.append(f"{a} {_sign_str(sa)} → {e} {_sign_str(se)}")
            equations.append(_latex_eq(a, e, s))
    for obj, sg in direct.items():
        if obj == driver:
            continue
        rel = f"{driver} {_sign_str(signs.get(driver, 1))} → {obj} {_sign_str(sg)}"
        if rel not in symbolic:
            symbolic.append(rel)
        eq = _latex_eq(driver, obj, sg)
        if eq not in equations:
            equations.append(eq)

    # 6) propagation chains
    chains = _proceed_chains(_graph_edges_present(signs), signs, [driver])
    chain_strs = [_chain_to_str(c, signs) for c in chains] if chains else [
        _chain_to_str([driver, *(v for v in var_names if v != driver)], signs)
    ]

    # 7) feedback loop (cycle reachable from driver)
    feedback = _detect_cycle(_graph_edges_present(signs), [driver])

    # 8) conflicting effects: a single variable pushed both ways, or a trade-off ("but")
    conflicting = False
    child_signs: dict[str, set[int]] = {}
    for a, e, s in _graph_edges_present(signs):
        child_signs.setdefault(e, set()).add(signs[a] * s)
    for v, sset in child_signs.items():
        if len(sset) > 1:
            conflicting = True
    if _TRADEOFF_ONLY.search(body) and len(var_names) > 2:
        # trade-off phrasing (cuts X but raises Y) => competing valence effects
        ups = sum(1 for v, s in signs.items() if v != driver and s > 0)
        downs = sum(1 for v, s in signs.items() if v != driver and s < 0)
        conflicting = conflicting or (ups > 0 and downs > 0)

    # 9) time horizon buckets
    horizon = {"short_term": [], "medium_term": [], "long_term": []}
    for v, s in signs.items():
        if v == driver:
            continue
        bucket = _QHORIZON.get(v, "medium_term")
        horizon[bucket].append(f"{v} {_sign_str(s)}")
    # an explicit duration phrase nudges the horizon
    m = re.search(r"for\s+(\d+)\s*(months?|years?|months?|bulan|tahun)", body)
    if m:
        q = int(m.group(1))
        unit = m.group(2)
        if "bulan" in unit or "month" in unit:
            horizon["short_term"] = [f"time horizon ≈ {q} months"] + horizon["short_term"]
        elif "year" in unit or "tahun" in unit:
            horizon["medium_term"] = [f"time horizon ≈ {q} years or more"] + horizon["medium_term"]

    # 10) scenarios: one per trade-off branch + the propagation chain
    scenarios: list[dict] = []
    halves = _TRADEOFF_ONLY.split(text) if _TRADEOFF_ONLY.search(body) else [text]
    # split preserving clauses separated by 'and' / '&' too — keep simple: per driver effect
    effect_vars = [v for v in var_names if v != driver and v in direct]
    if not effect_vars:
        effect_vars = [v for v in order if v != driver][:3]
    grp = _TRADEOFF_ONLY.split(text) if _TRADEOFF_ONLY.search(body) else [text]
    # positive-outcome branch
    pos = [v for v in signs if v != driver and signs[v] < 0
           and v in ("congestion", "air_pollution", "vehicle_traffic")]
    neg = [v for v in signs if v != driver and signs[v] > 0
           and v in ("city_debt", "operating_cost")]
    if pos and (neg or _TRADEOFF.search(body)):
        scenarios.append({
            "if": f"{driver} {_sign_str(signs.get(driver, 1))}",
            "then": " → ".join(f"{v} {_sign_str(signs[v])}" for v in pos),
            "equations": [_latex_eq(v, v, 0) if False else _latex_eq(driver, v, signs[v]) for v in pos],
        })
    if neg:
        scenarios.append({
            "if": f"{driver} {_sign_str(signs.get(driver, 1))}",
            "then": " → ".join(f"{v} {_sign_str(signs[v])}" for v in neg),
            "equations": [_latex_eq(driver, v, signs[v]) for v in neg],
        })
    # always ensure at least one scenario
    if not scenarios:
        scenarios.append({
            "if": f"{driver} {_sign_str(signs.get(driver, 1))}",
            "then": " → ".join(f"{v} {_sign_str(signs[v])}" for v in (effect_vars or order[1:])),
            "equations": [_latex_eq(driver, v, signs[v]) for v in (effect_vars or order[1:])],
        })

    # 11) conclusion
    math_parts = []
    for v in (pos or effect_vars):
        math_parts.append(_latex_eq(driver, v, signs.get(v, 1)))
    for v in (neg or []):
        math_parts.append(_latex_eq(driver, v, signs.get(v, 1)))
    if feedback:
        math_parts.append(r"\text{positive feedback loop}")
    conclusion_math = "  \\wedge  ".join(math_parts) if math_parts else _latex_eq(driver, "outcome", 1)
    if lang == "id":
        conclusion_nl = (f"{driver.replace('_', ' ').capitalize()} naik menyebabkan perubahan arah "
                         f"yang bertentangan pada beberapa variabel (efek konflik): " +
                         "; ".join(f"{v} {_sign_str(signs[v])}" for v in var_names if v != driver) + ".")
    else:
        conclusion_nl = (
            f"Increasing {driver.replace('_', ' ')} propagates directionally through the web: "
            + "; ".join(f"{v.replace('_', ' ')} {_sign_str(signs[v])}"
                        for v in var_names if v != driver) + "."
        )
    if feedback:
        conclusion_nl += (
            " A positive feedback loop (more debt → higher operating cost → more debt) amplifies "
            "the fiscal strain over time." if lang == "en"
            else " Sebuah umpan balik positif (lebih banyak utang → biaya operasional naik → lebih banyak utang) memperkuat tekanan keuangan."
        )

    return {
        "variables": var_names,
        "symbolic_relationships": symbolic,
        "qualitative_equations": equations,
        "propagation_chains": chain_strs,
        "feedback_loop": bool(feedback),
        "time_horizon": horizon,
        "conflicting_effects": bool(conflicting),
        "scenarios": scenarios,
        "conclusion": {"math": conclusion_math, "nl": conclusion_nl},
        "domain": detect_domain(text),
        "units": {},
        "source": "mech",
    }


def detect_domain(text: str) -> str:
    """Detect the physics/economic domain from event text — picks the right math model."""
    t = (text or "").lower()
    domains = {
        "traffic_physics": ["hujan", "licin", "macet", "lalu lintas", "kecelakaan",
                            "jalan", "kendar", "ban", "rem", "friks", "kecepatan"],
        "macroeconomics": ["harga", "inflasi", "pengangguran", "ppn", "bi ", "biaya",
                           "ekonomi", "subsid", "pemerintah", "pajak", "modal"],
        "power_grid": ["listrik", "pemadaman", "arus", "grid", "tekanan", "genset",
                       "transformator", "distribusi"],
        "civil_infra": ["jalan", "jembatan", "trotoar", "bangunan", "gempa", "struktur"],
        "public_policy": ["kebijakan", "regulasi", "larangan", "imbalan", "insentif",
                          "normatif", "undang", "transit", "congestion", "pollution",
                          "debt", "operator", "subsidy", "fare", "ridership",
                          "utang", "kebijakan transport", "transportasi publik",
                          "pajak", "subsidi transport", "emisi", "polusi"],
        "epidemiology": ["wabah", "virus", "infeksi", "penularan", "vaksin", "imun"],
    }
    for domain, keywords in domains.items():
        if any(kw in t for kw in keywords):
            return domain
    return "general_causality"


def compute_risks(text: str, ancestors: list[str], web: dict | None, lang: str = "en") -> list[dict]:
    """Compute domain-specific risk probabilities for THIS node.

    Only emits risks that are *relevant* to the node's text/domain — e.g. a
    node about rain => P(slippery_road); a node about traffic => P(jam), etc.
    """
    risks: list[dict] = []
    tl = (text or "").lower()
    ac = [a.lower() for a in ancestors]

    if lang == "id":
        if "hujan" in tl or "basah" in tl or "embun" in tl:
            # P(jalan licin) naik dengan hujan + turunnya suhu
            p = min(1.0, 0.35 + 0.06 * len([a for a in ac if "hujan" in a])
                    + 0.04 * len([a for a in ac if "dingin" in a or "su" in a]))
            risks.append({"risk": "jalan_licin", "probability": round(p, 2),
                          "reason": "curah hujan + suhu di bawah titik embun meningkatkan lapisan air pada permukaan"})
        if "macet" in tl or "lalu lintas" in tl or "kemacetan" in tl:
            dens = 0.4 + 0.03 * len(ac)
            risks.append({"risk": "kemacetan_lanjutan", "probability": round(min(1.0, dens), 2),
                          "reason": "volume kendaraan melebihi kapasitas alir jalan"})
        if "harga" in tl or "bbm" in tl or "ppn" in tl:
            p = min(1.0, 0.25 + 0.015 * len(ac))
            risks.append({"risk": "inflasi_makanan", "probability": round(p, 2),
                          "reason": "kenaikan harga energi langsung menaikkan biaya rantai pasok"})
    else:
        if "rain" in tl or "wet" in tl or "dew" in tl or "damp" in tl:
            p = min(1.0, 0.35 + 0.06 * len([a for a in ac if "rain" in a or "storm" in a]))
            risks.append({"risk": "slippery_road", "probability": round(p, 2),
                          "reason": "precipitation + dew point lowering create a moisture film on the road surface"})
        if "traffic" in tl or "jam" in tl or "congestion" in tl:
            p = min(1.0, 0.4 + 0.03 * len(ac))
            risks.append({"risk": "ongoing_congestion", "probability": round(p, 2),
                          "reason": "vehicle volume exceeds road capacity, reinforcing delay"})
        if "price" in tl or "bbm" in tl or "ppn" in tl or "vat" in tl:
            p = min(1.0, 0.25 + 0.015 * len(ac))
            risks.append({"risk": "price_pass_through", "probability": round(p, 2),
                          "reason": "direct price shocks transmit up the supply chain, lifting headline inflation"})

    return risks
