#!/usr/bin/env python3
"""
VC Breakout v4.4 — Ingest Script
==================================
Reads raw Hubble/Panorama dumps and produces internal_<ae>.json per AE.
Deterministic transform — agents save raw bytes only, this script does all mapping.

Usage:
    python3 ingest_v4.py --ae jeanne fionn rami --today 2026-07-28
"""

import json
import argparse
import sys
from pathlib import Path
from datetime import datetime, date


RAW_DIR = Path(__file__).parent / "raw"
WORK_DIR = Path(__file__).parent / "work"


def parse_funding_stage(funding_str: str | None) -> str | None:
    if not funding_str:
        return None
    s = funding_str.lower().strip()
    if "pre" in s and ("seed" in s or "series" in s):
        return "pre_series_a"
    if "seed" in s:
        return "pre_series_a"
    if "series a" in s or "series_a" in s:
        return "series_a"
    if "series b" in s or "series_b" in s:
        return "series_b"
    if any(x in s for x in ["series c", "series_c", "series d", "series_d", "series e", "post_series"]):
        return "post_series_c"
    if "ipo" in s:
        return "post_series_c"
    return None


def months_between(date_str: str | None, today: date) -> int | None:
    if not date_str:
        return None
    try:
        d = datetime.strptime(date_str[:10], "%Y-%m-%d").date()
        return max(0, (today.year - d.year) * 12 + (today.month - d.month))
    except (ValueError, TypeError):
        return None


def load_account_domains(ae: str) -> dict[str, str]:
    path = RAW_DIR / f"account_domains_{ae}.json"
    if not path.exists():
        return {}
    with open(path) as f:
        raw = json.load(f)
    rows = raw if isinstance(raw, list) else raw.get("results", raw.get("data", []))
    return {r["account_id"]: r["domain"] for r in rows if r.get("account_id") and r.get("domain")}


def load_domains_core(ae: str) -> dict[str, dict]:
    path = RAW_DIR / f"domains_core_{ae}.json"
    if not path.exists():
        return {}
    with open(path) as f:
        raw = json.load(f)
    rows = raw if isinstance(raw, list) else raw.get("results", raw.get("data", []))
    return {r["domain"]: r for r in rows if r.get("domain")}


def load_investor_tiers() -> dict[str, str]:
    path = RAW_DIR / "investor_tiers.json"
    if not path.exists():
        return {}
    with open(path) as f:
        raw = json.load(f)
    rows = raw if isinstance(raw, list) else raw.get("results", raw.get("data", []))
    seen = {}
    for r in rows:
        d = r.get("investor_domain")
        if d and d not in seen:
            seen[d] = r.get("tier")
    return seen


def normalize_domain(url: str | None) -> str | None:
    """Strip scheme/www/path so a PitchBook `website` value matches a bare domain."""
    if not url:
        return None
    d = url.strip().lower()
    d = d.split("://", 1)[-1]
    d = d.split("/", 1)[0]
    if d.startswith("www."):
        d = d[4:]
    return d or None


ACCELERATOR_MARKERS = ("accelerator", "incubator")


def classify_pitchbook_substage(row: dict) -> tuple[str | None, bool, bool]:
    """Returns (startup_substage, is_accelerator, is_acquired) from PitchBook deal-type fields.

    Never maps to the coarse `funding_stage` enum — this is display/scoring
    nuance only (see SKILL.md Phase 1h/1i and Data Integrity Rule 7).
    """
    last_type = (row.get("last_financing_deal_type") or "").strip()
    last_type2 = (row.get("last_financing_deal_type2") or "").strip()
    first_type = (row.get("first_financing_deal_type") or "").strip()
    first_type2 = (row.get("first_financing_deal_type2") or "").strip()
    business_status = (row.get("business_status") or "").lower()
    financing_status = (row.get("company_financing_status") or "").lower()

    last_is_accelerator = any(m in last_type.lower() for m in ACCELERATOR_MARKERS) \
        or any(m in last_type2.lower() for m in ACCELERATOR_MARKERS)

    # PitchBook logs no-equity accelerator *program participation* (e.g. Station F,
    # Snowflake Startup Accelerator) as a "last financing" event even when no money
    # changed hands (last_financing_size is null) — or when a small grant did change
    # hands (e.g. a $25k CPA.com accelerator grant on top of a real $17.2M seed round).
    # Either way that's not a priced financing round — fall back to the last real
    # round so a VC-backed company doesn't get misclassified as accelerator-financed
    # just for joining a program later. "Non-equity" in the deal type is the reliable
    # signal here, not the size field (grants can carry a small nonzero size).
    last_is_non_equity = "non-equity" in last_type.lower() or "non-equity" in last_type2.lower()
    if last_is_accelerator and (row.get("last_financing_size") is None or last_is_non_equity):
        substage = first_type2 or first_type or last_type2 or last_type or None
        deal_is_accelerator = any(m in first_type.lower() for m in ACCELERATOR_MARKERS) \
            or any(m in first_type2.lower() for m in ACCELERATOR_MARKERS)
    else:
        substage = last_type2 or last_type or None
        deal_is_accelerator = last_is_accelerator

    is_accelerator = any(m in business_status for m in ACCELERATOR_MARKERS) \
        or any(m in financing_status for m in ACCELERATOR_MARKERS) \
        or deal_is_accelerator

    # A company that's been acquired is no longer an independent VC-backable
    # prospect under this identity — flag it so scoring can deprioritize rather
    # than rank it as a live breakout candidate. Uses the same last-event field
    # as the accelerator check, but is a distinct (non-exclusive) condition.
    is_acquired = "merger/acquisition" in last_type.lower() or "merger/acquisition" in last_type2.lower()

    return substage, is_accelerator, is_acquired


def load_pitchbook(ae: str) -> dict[str, dict]:
    """Returns domain -> PitchBook row, keyed by normalized `website`."""
    path = RAW_DIR / f"pitchbook_{ae}.json"
    if not path.exists():
        return {}
    with open(path) as f:
        raw = json.load(f)
    rows = raw if isinstance(raw, list) else raw.get("results", raw.get("data", []))
    out = {}
    for r in rows:
        domain = normalize_domain(r.get("website"))
        if domain and domain not in out:
            out[domain] = r
    return out


def load_domain_history(ae: str) -> dict[str, str]:
    """Returns domain -> headcount_trend (growing/flat/shrinking)."""
    path = RAW_DIR / f"domain_history_{ae}.json"
    if not path.exists():
        return {}
    with open(path) as f:
        raw = json.load(f)
    rows = raw if isinstance(raw, list) else raw.get("results", raw.get("data", []))

    domain_months = {}
    for r in rows:
        d = r.get("domain")
        if not d:
            continue
        domain_months.setdefault(d, []).append(r)

    trends = {}
    for domain, months in domain_months.items():
        months.sort(key=lambda x: x.get("month", ""))
        counts = [_to_float(m.get("features__employee_count")) for m in months]
        counts = [c for c in counts if c is not None]
        if len(counts) >= 2:
            if counts[-1] > counts[0] * 1.1:
                trends[domain] = "growing"
            elif counts[-1] < counts[0] * 0.9:
                trends[domain] = "shrinking"
            else:
                trends[domain] = "flat"
    return trends


def ingest_territory(ae: str) -> list[dict]:
    path = RAW_DIR / f"territory_{ae}.json"
    if not path.exists():
        print(f"ERROR: {path} not found", file=sys.stderr)
        return []
    with open(path) as f:
        raw = json.load(f)

    rows = raw if isinstance(raw, list) else raw.get("results", raw.get("data", []))

    account_domains = load_account_domains(ae)
    domains_core = load_domains_core(ae)
    domain_history = load_domain_history(ae)

    accounts = []
    for row in rows:
        # Hubble query template 29178 (Phase 1a) returns Title Case column
        # names with spaces/punctuation (e.g. "Account Id", "Is AI Company?"),
        # not the lowercase snake_case keys this function originally assumed.
        # Verified against real template output 2026-08-11 — the snake_case-only
        # lookup silently dropped every row (account_id always None). Check both
        # forms so hand-built test fixtures (snake_case) and real Hubble dumps
        # (Title Case) both work.
        acc = {
            "account_id": row.get("Account Id") or row.get("account_id") or row.get("sfdc_account_id") or row.get("entity_id"),
            "account_name": row.get("Account Name") or row.get("account_name") or row.get("company_name") or "—",
            "ae": ae.capitalize(),
            "country": row.get("decision_country") or row.get("country") or "—",
            "startup_type": row.get("Top Startup Type") or row.get("Startup Type") or row.get("top_startup_type") or row.get("startup_type"),
            "ai_flag": bool(row.get("Is AI Company?") or row.get("ai_flag") or row.get("is_ai")),
            "piv_last_90d_eur": _to_float(row.get("piv_usd_last_90d") or row.get("piv_last_90d")),
            "piv_prior_90d_eur": _to_float(row.get("piv_usd_prior_90d") or row.get("piv_prior_90d")),
            "piv_90d_growth_pct": None,
            "piv_mom_accelerating": False,
            "multi_investor_p0": False,
            "is_bootstrapped": False,
            "domain": None,
            "employees_count": None,
            "headcount_trend": None,
            "investor_tier": None,
            "startup_substage": None,
            "is_accelerator": False,
            "is_acquired": False,
            "pitchbook_growth_percentile": None,
            "pitchbook_financing_status_note": None,
        }
        if acc["account_id"] is None:
            continue

        # Enrich from CDM via account-to-domain mapping
        domain = account_domains.get(acc["account_id"])
        if domain:
            acc["domain"] = domain
            cdm = domains_core.get(domain, {})
            if cdm:
                acc["account_name"] = cdm.get("canonical_name") or acc["account_name"]
                acc["employees_count"] = _to_float(cdm.get("employees__count"))
                cdm_startup = cdm.get("segmentation__company_segment_details__startup_type")
                cdm_top = cdm.get("segmentation__company_segment_details__top_startup_type")
                if cdm_top:
                    acc["startup_type"] = cdm_top
                elif cdm_startup:
                    acc["startup_type"] = cdm_startup
                cdm_stage = cdm.get("funding__last_funding_stage")
                if cdm_stage:
                    acc["cdm_funding_stage"] = cdm_stage

            # Headcount trend from DNA history
            trend = domain_history.get(domain)
            if trend:
                acc["headcount_trend"] = trend

        # PIV growth calculation
        last = acc["piv_last_90d_eur"]
        prior = acc["piv_prior_90d_eur"]
        if last and prior and prior > 0:
            acc["piv_90d_growth_pct"] = round((last - prior) / prior * 100, 1)

        accounts.append(acc)
    return accounts


def merge_funding_events(accounts: list[dict], ae: str, today: date):
    path = RAW_DIR / f"funding_events_{ae}.json"
    if not path.exists():
        return

    with open(path) as f:
        raw = json.load(f)
    rows = raw if isinstance(raw, list) else raw.get("results", raw.get("data", []))

    investor_tiers = load_investor_tiers()

    # Build lookup: domain -> most recent event with a usable amount.
    # Rows arrive most-recent-first (ORDER BY funding_month DESC). The truly-latest
    # row for a domain can be a non-monetary event (funding_type "unknown"/"other",
    # funding_amount null — e.g. a continued-investor mention with no new round) that
    # would otherwise shadow a real, slightly older priced round and force
    # funding_round_amount_eur to null. Verified 2026-08-11: this happened for
    # solveintelligence.com (Feb-2026 "unknown" row with null amount ranked ahead of
    # the real Dec-2025 $40M Series B), which then triggered merge_pitchbook's
    # PitchBook-size fallback below and produced a 1,000,000x-too-small amount.
    domain_funding = {}
    domain_investors = {}
    for row in rows:
        domain = row.get("domain")
        if not domain:
            continue
        existing = domain_funding.get(domain)
        if existing is None:
            domain_funding[domain] = row
        elif existing.get("funding_amount") is None and row.get("funding_amount") is not None:
            domain_funding[domain] = row
        domain_investors.setdefault(domain, []).append(row.get("investor_names") or "")

    # Match accounts to funding events by domain
    for acc in accounts:
        domain = acc.get("domain")
        if not domain:
            continue
        event = domain_funding.get(domain)
        if not event:
            continue
        acc["funding_stage"] = parse_funding_stage(event.get("funding_type")) or acc.get("cdm_funding_stage")
        acc["months_since_round"] = months_between(event.get("announced_date"), today)
        acc["funding_round_amount_eur"] = _to_float(event.get("funding_amount"))

        # Determine best investor tier from all investors in this domain's rounds
        best_tier = None
        tier_rank = {"P0": 3, "P1": 2, "P2": 1}
        all_investors = " | ".join(domain_investors.get(domain, []))
        for inv_domain, tier in investor_tiers.items():
            if inv_domain and inv_domain in all_investors.lower():
                if tier_rank.get(tier, 0) > tier_rank.get(best_tier, 0):
                    best_tier = tier
        if best_tier:
            acc["investor_tier"] = best_tier
            p0_count = sum(1 for inv_d, t in investor_tiers.items()
                          if t == "P0" and inv_d and inv_d in all_investors.lower())
            acc["multi_investor_p0"] = p0_count >= 2

    # Fallback: use cdm_funding_stage for accounts without hub events
    for acc in accounts:
        if not acc.get("funding_stage") and acc.get("cdm_funding_stage"):
            acc["funding_stage"] = parse_funding_stage(acc["cdm_funding_stage"])


def merge_pitchbook(accounts: list[dict], ae: str, today: date):
    pitchbook = load_pitchbook(ae)
    if not pitchbook:
        return

    for acc in accounts:
        domain = acc.get("domain")
        if not domain:
            continue
        row = pitchbook.get(domain)
        if not row:
            continue

        substage, is_accelerator, is_acquired = classify_pitchbook_substage(row)
        acc["startup_substage"] = substage
        acc["is_accelerator"] = is_accelerator
        acc["is_acquired"] = is_acquired
        acc["pitchbook_financing_status_note"] = row.get("financing_status_note")

        growth_pctile = _to_float(row.get("growth_rate_percentile"))
        if growth_pctile is not None:
            acc["pitchbook_growth_percentile"] = growth_pctile

        # Fallback only — hub.investor_funding_events (Phase 1e) stays authoritative.
        # Same non-equity-grant trap as classify_pitchbook_substage above: a "last
        # financing" that's actually a small accelerator grant would otherwise leak
        # its tiny size/date in as the round amount/recency for a real priced round.
        last_type = (row.get("last_financing_deal_type") or "").lower()
        last_type2 = (row.get("last_financing_deal_type2") or "").lower()
        last_is_grant = any(m in last_type or m in last_type2 for m in ACCELERATOR_MARKERS) \
            and (row.get("last_financing_size") is None or "non-equity" in last_type or "non-equity" in last_type2)
        date_field = "first_financing_date" if last_is_grant else "last_financing_date"
        size_field = "first_financing_size" if last_is_grant else "last_financing_size"

        if acc.get("months_since_round") is None:
            acc["months_since_round"] = months_between(row.get(date_field), today)
        if acc.get("funding_round_amount_eur") is None:
            # PitchBook's *_financing_size is denominated in millions of USD (e.g. 40
            # means $40M), unlike hub.investor_funding_events' funding_amount which is
            # raw USD. Verified 2026-08-11: without this conversion, this fallback
            # silently wrote 40 instead of 40,000,000 for a $40M round.
            pb_size_m = _to_float(row.get(size_field))
            acc["funding_round_amount_eur"] = pb_size_m * 1_000_000 if pb_size_m is not None else None


def merge_gap_data(accounts: list[dict], ae: str):
    path = RAW_DIR / f"gap_{ae}.json"
    if not path.exists():
        return

    with open(path) as f:
        raw = json.load(f)
    rows = raw if isinstance(raw, list) else raw.get("results", raw.get("data", []))

    gap_lookup = {}
    for row in rows:
        aid = row.get("account_id") or row.get("sfdc_account_id")
        if aid:
            gap_lookup.setdefault(aid, row)

    for acc in accounts:
        gap = gap_lookup.get(acc["account_id"])
        if not gap:
            continue
        # Merge PIV from gap query if territory didn't have it. Gap query returns
        # USD-millions (piv_last_90d_usd_m); raw-USD keys are also accepted for
        # callers that already converted.
        if acc["piv_last_90d_eur"] is None:
            usd_m = _to_float(gap.get("piv_last_90d_usd_m"))
            acc["piv_last_90d_eur"] = usd_m * 1_000_000 if usd_m is not None else \
                _to_float(gap.get("piv_usd_last_90d") or gap.get("pay_ins_volume_usd_90d"))
        if acc.get("piv_prior_90d_eur") is None:
            usd_m = _to_float(gap.get("piv_prior_90d_usd_m"))
            acc["piv_prior_90d_eur"] = usd_m * 1_000_000 if usd_m is not None else \
                _to_float(gap.get("piv_usd_prior_90d") or gap.get("pay_ins_volume_usd_prior_90d"))
        if acc.get("piv_90d_growth_pct") is None and gap.get("piv_90d_growth_pct") is not None:
            acc["piv_90d_growth_pct"] = _to_float(gap.get("piv_90d_growth_pct"))

        # Recompute growth in case PIV was just filled in above from the gap query
        last = acc["piv_last_90d_eur"]
        prior = acc.get("piv_prior_90d_eur")
        if acc["piv_90d_growth_pct"] is None and last and prior and prior > 0:
            acc["piv_90d_growth_pct"] = round((last - prior) / prior * 100, 1)


def _to_float(val) -> float | None:
    if val is None:
        return None
    try:
        v = float(val)
        return v if v != 0 else None
    except (ValueError, TypeError):
        return None


def ingest_ae(ae: str, today: date, allow_degraded_piv: bool = False) -> list[dict]:
    accounts = ingest_territory(ae)
    if not accounts:
        print(f"WARNING: No accounts for {ae}", file=sys.stderr)
        return []

    merge_funding_events(accounts, ae, today)
    merge_pitchbook(accounts, ae, today)
    merge_gap_data(accounts, ae)

    # Stats
    total = len(accounts)
    null_piv = sum(1 for a in accounts if a["piv_last_90d_eur"] is None)
    null_stage = sum(1 for a in accounts if not a.get("funding_stage"))
    print(f"  {ae}: {total} accounts | null PIV: {null_piv}/{total} ({null_piv/total*100:.0f}%) | null stage: {null_stage}/{total} ({null_stage/total*100:.0f}%)", file=sys.stderr)

    if null_piv / total > 0.8:
        if allow_degraded_piv:
            # Verified, not silently degraded: caller confirmed the gap query is
            # genuinely unobtainable this run (see SKILL.md Phase 1b) rather than
            # broken. D1 correctly reads `—` per Data Integrity Rule 6 — that's not
            # the same as a broken query, so don't block output on a small/manual run.
            print(f"WARNING: {ae} has >80% null PIV — proceeding with degraded D1 (--allow_degraded_piv set)", file=sys.stderr)
        else:
            print(f"CRITICAL: {ae} has >80% null PIV — gap query likely failed", file=sys.stderr)
            sys.exit(1)

    return accounts


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ae", nargs="+", required=True)
    parser.add_argument("--today", required=True)
    parser.add_argument("--allow_degraded_piv", action="store_true",
                         help="Don't hard-fail on >80% null PIV — use only when the gap query's "
                              "unavailability for this run has already been verified/logged, not "
                              "as a default way to skip fixing a broken gap query.")
    args = parser.parse_args()

    today = datetime.strptime(args.today, "%Y-%m-%d").date()
    WORK_DIR.mkdir(exist_ok=True)

    print("Ingest v4:", file=sys.stderr)
    for ae in args.ae:
        accounts = ingest_ae(ae.lower(), today, args.allow_degraded_piv)
        out_path = WORK_DIR / f"internal_{ae.lower()}.json"
        with open(out_path, "w") as f:
            json.dump(accounts, f, indent=2)
        print(f"  → {out_path} ({len(accounts)} accounts)", file=sys.stderr)


if __name__ == "__main__":
    main()
