#!/usr/bin/env python3
"""
VC Breakout Agent v4.4 — Scoring Engine (5 dimensions)
======================================================
Scores accounts across 5 dimensions with stage-dependent weights.
Single flat ranking per AE. No SOW, no ARR proxy, no engagement health.

Usage:
    python3 score_compute_v4.py --input accounts.json [--prev_scores last_week.json] --output scored.json
"""

import json
import argparse
import sys
from typing import Optional


STAGE_WEIGHTS = {
    "pre_seed": {
        "piv_growth": 0.10, "funding_momentum": 0.15,
        "ext_momentum": 0.10, "vc_tier": 0.10, "founder_pedigree": 0.55,
    },
    "seed": {
        "piv_growth": 0.15, "funding_momentum": 0.20,
        "ext_momentum": 0.10, "vc_tier": 0.10, "founder_pedigree": 0.45,
    },
    "series_a": {
        "piv_growth": 0.25, "funding_momentum": 0.25,
        "ext_momentum": 0.10, "vc_tier": 0.10, "founder_pedigree": 0.30,
    },
    "series_b": {
        "piv_growth": 0.35, "funding_momentum": 0.30,
        "ext_momentum": 0.10, "vc_tier": 0.10, "founder_pedigree": 0.15,
    },
    "series_c_plus": {
        "piv_growth": 0.40, "funding_momentum": 0.30,
        "ext_momentum": 0.10, "vc_tier": 0.10, "founder_pedigree": 0.10,
    },
    "default": {
        "piv_growth": 0.25, "funding_momentum": 0.20,
        "ext_momentum": 0.10, "vc_tier": 0.10, "founder_pedigree": 0.35,
    },
}

for _stage, _w in STAGE_WEIGHTS.items():
    assert abs(sum(_w.values()) - 1.0) < 1e-9, f"Weights for {_stage} must sum to 1.0"


def get_weights(funding_stage: str | None) -> dict:
    s = (funding_stage or "").lower().replace("-", "_").replace(" ", "_")
    if "pre_seed" in s or "pre_series_a" in s:
        return STAGE_WEIGHTS["pre_seed"]
    elif "seed" in s:
        return STAGE_WEIGHTS["seed"]
    elif "series_a" in s:
        return STAGE_WEIGHTS["series_a"]
    elif "series_b" in s:
        return STAGE_WEIGHTS["series_b"]
    elif any(x in s for x in ["series_c", "post_series_c", "series_d", "series_e", "growth"]):
        return STAGE_WEIGHTS["series_c_plus"]
    else:
        return STAGE_WEIGHTS["default"]


def get_leaderboard(funding_stage: str | None) -> str:
    s = (funding_stage or "").lower().replace("-", "_").replace(" ", "_")
    if any(x in s for x in ["series_b", "series_c", "post_series_c", "series_d", "growth"]):
        return "Series A+"
    if "series_a" in s and "pre" not in s:
        return "Series A+"
    return "Pre-Series A"


# ─── DIMENSION SCORERS (each returns 0-10) ───

def score_piv_growth(acc: dict) -> float:
    growth = acc.get("piv_90d_growth_pct")
    if growth is None:
        return 0.0
    if growth >= 100:  base = 10
    elif growth >= 50: base = 8
    elif growth >= 25: base = 6
    elif growth >= 10: base = 4
    elif growth >= 0:  base = 2
    else:              base = 0
    bonus = 1 if acc.get("piv_mom_accelerating") else 0
    return min(10.0, base + bonus)


def score_funding_momentum(acc: dict) -> float:
    months = acc.get("months_since_round")
    if months is None:
        recency = 0
    elif months <= 3:  recency = 4
    elif months <= 6:  recency = 3
    elif months <= 12: recency = 2
    elif months <= 18: recency = 1
    else:              recency = 0

    # Exact match against the funding_stage enum, not substring — "series_a" is
    # a substring of "pre_series_a" and would otherwise wrongly award every
    # pre-Series-A account the Series A stage-progression bonus.
    stage = (acc.get("funding_stage") or "").lower()
    if stage in ("series_c", "post_series_c", "series_d", "series_e"):
        stage_pts = 3
    elif stage == "series_b":
        stage_pts = 2
    elif stage == "series_a":
        stage_pts = 1
    else:
        stage_pts = 0

    cap_eff = 0
    if acc.get("is_bootstrapped"):
        cap_eff += 2

    substage_adj = 0
    if acc.get("is_accelerator") or acc.get("is_acquired"):
        substage_adj -= 2
    elif (acc.get("startup_substage") or "").lower() == "seed round":
        substage_adj += 1

    return float(max(0, min(10, recency + stage_pts + cap_eff + substage_adj)))


def score_ext_momentum(acc: dict) -> float:
    pts = 0
    media = acc.get("media_coverage_count_90d", 0)
    if media >= 2:                              pts += 2
    elif media == 1:                            pts += 1
    if acc.get("key_enterprise_customer"):      pts += 2
    if acc.get("senior_geo_hire"):              pts += 1
    if acc.get("quality_headcount_growth"):     pts += 1

    headcount_trend = acc.get("headcount_trend")
    growth_pctile = acc.get("pitchbook_growth_percentile")
    if headcount_trend == "growing":            pts += 1
    elif growth_pctile is not None and growth_pctile >= 70:  pts += 1

    base = min(10, pts)

    if acc.get("layoffs_announced") or headcount_trend == "shrinking":
        base -= 2
    if acc.get("no_activity_90d"):
        base -= 1

    return float(max(0, base))


def score_vc_tier(acc: dict) -> float:
    tier = (acc.get("startup_type") or "").upper()
    base = {"P0": 10, "P1": 7, "P2": 4, "FUNDED": 2}.get(tier, 0)
    if base == 10 and acc.get("multi_investor_p0"):
        base = min(10, base * 1.2)
    return float(base)


def score_founder_pedigree(acc: dict) -> float:
    pts = 0
    if acc.get("founder_prior_exit"):        pts += 4
    if acc.get("founder_serial"):            pts += 2
    if acc.get("founder_top_ai_lab"):        pts += 4
    if acc.get("founder_top_tech_company"):  pts += 2
    if acc.get("founder_domain_expert"):     pts += 2
    return float(min(10, pts))


# ─── KEY SIGNAL ───

def generate_key_signal(acc: dict, dim_scores: dict, prev_dim_scores: Optional[dict]) -> str:
    events = acc.get("key_events_this_week", [])
    if events:
        return events[0]

    if prev_dim_scores:
        deltas = {d: dim_scores[d] - prev_dim_scores.get(d, dim_scores[d]) for d in dim_scores}
        top_dim = max(deltas, key=lambda d: deltas[d])
        if deltas[top_dim] > 0.5:
            labels = {
                "piv_growth": "PIV growth accelerated (90d)",
                "funding_momentum": "New funding round",
                "ext_momentum": "External momentum up",
                "vc_tier": "VC tier updated",
                "founder_pedigree": "Founder signal detected",
            }
            return labels.get(top_dim, top_dim)

    weights = get_weights(acc.get("funding_stage"))
    top_dim = max(dim_scores, key=lambda d: dim_scores[d] * weights[d])
    labels = {
        "piv_growth": f"PIV growth {acc.get('piv_90d_growth_pct', '—')}% (90d)",
        "funding_momentum": f"Last round {acc.get('months_since_round') if acc.get('months_since_round') is not None else '—'}mo ago ({acc.get('funding_stage') or '—'})",
        "ext_momentum": "Strong external momentum",
        "vc_tier": f"Startup Type: {acc.get('startup_type', '—')}" + (f" ({acc['startup_substage']})" if acc.get('startup_substage') else ""),
        "founder_pedigree": "Strong founder background",
    }
    return labels.get(top_dim, "—")


# ─── RECOMMENDED ACTION ───

def generate_recommended_action(acc: dict, dim_scores: dict) -> str:
    if acc.get("is_acquired"):
        return "Deprioritize — acquired, no longer independently VC-backed"
    if acc.get("is_accelerator"):
        return "Deprioritize — accelerator/incubator financing, not core VC-backed startup"

    months = acc.get("months_since_round")
    if months is not None and months <= 3:
        return "Reach out within 48h — post-funding window"

    if acc.get("piv_90d_growth_pct") and acc["piv_90d_growth_pct"] >= 50:
        return "Check if volume increase tied to new product/geo"

    if acc.get("senior_geo_hire"):
        return "New exec may be reviewing payment stack — timely to reconnect"

    if acc.get("quality_headcount_growth") or acc.get("headcount_trend") == "growing":
        return "Growing team — intro Stripe's scaling capabilities"

    if dim_scores.get("founder_pedigree", 0) >= 7:
        return "High-pedigree founder — build relationship early"

    return "Monitor — no urgent trigger"


# ─── MAIN SCORING ───

def score_account(acc: dict, prev_scores: dict) -> dict:
    dim_scores = {
        "piv_growth": score_piv_growth(acc),
        "funding_momentum": score_funding_momentum(acc),
        "ext_momentum": score_ext_momentum(acc),
        "vc_tier": score_vc_tier(acc),
        "founder_pedigree": score_founder_pedigree(acc),
    }

    weights = get_weights(acc.get("funding_stage"))
    breakout_score = sum(dim_scores[d] * weights[d] for d in dim_scores)
    breakout_score = round(breakout_score, 1)

    prev = prev_scores.get(acc["account_id"], {})
    prev_dim = prev.get("dim_scores")

    key_signal = generate_key_signal(acc, dim_scores, prev_dim)
    recommended_action = generate_recommended_action(acc, dim_scores)

    return {
        "account_id": acc["account_id"],
        "account_name": acc["account_name"],
        "ae": acc["ae"],
        "country": acc.get("country", "—"),
        "startup_type": acc.get("startup_type"),
        "funding_stage": acc.get("funding_stage"),
        "leaderboard": get_leaderboard(acc.get("funding_stage")),
        "ai_flag": bool(acc.get("ai_flag")),
        "breakout_score": breakout_score,
        "dimension_scores": dim_scores,
        "weights_used": weights,
        "piv_last_90d_eur": acc.get("piv_last_90d_eur"),
        "piv_90d_growth_pct": acc.get("piv_90d_growth_pct"),
        "months_since_round": acc.get("months_since_round"),
        "key_signal": key_signal,
        "recommended_action": recommended_action,
    }


def rank_accounts(scored: list, prev_scores: dict) -> list:
    ae_groups = {}
    for acc in scored:
        ae_groups.setdefault(acc["ae"], []).append(acc)

    for ae, accounts in ae_groups.items():
        accounts.sort(key=lambda a: (-a["breakout_score"], -(a.get("piv_last_90d_eur") or 0)))
        for rank, acc in enumerate(accounts, 1):
            acc["rank"] = rank
            prev = prev_scores.get(acc["account_id"], {})
            prev_rank = prev.get("rank")
            if prev_rank is None:
                acc["delta_rank"] = "NEW"
            else:
                acc["delta_rank"] = prev_rank - rank  # positive = improved

    return scored


def compute_weekly_movers(scored: list, prev_scores: dict) -> list:
    movers = []
    for acc in scored:
        if acc["delta_rank"] == "NEW":
            continue
        delta = acc["delta_rank"]
        prev = prev_scores.get(acc["account_id"], {})
        prev_score = prev.get("score", acc["breakout_score"])
        score_delta = round(acc["breakout_score"] - prev_score, 1)

        if abs(delta) >= 5 or abs(score_delta) >= 5:
            trigger = "📈 PIV spike" if acc["dimension_scores"]["piv_growth"] >= 8 else \
                      "🚀 New funding" if acc.get("months_since_round") and acc["months_since_round"] <= 3 else \
                      "🤝 Strategic hire" if acc.get("senior_geo_hire") else \
                      "🌍 Geo expansion" if acc.get("quality_headcount_growth") else \
                      "Score change"
            movers.append({
                "account_name": acc["account_name"],
                "ae": acc["ae"],
                "country": acc.get("country", "—"),
                "startup_type": acc.get("startup_type"),
                "trigger": trigger,
                "old_rank": acc["rank"] + delta,
                "new_rank": acc["rank"],
                "delta": delta,
                "score_delta": score_delta,
                "recommended_action": acc["recommended_action"],
            })

    movers.sort(key=lambda m: -abs(m["delta"]))
    return movers[:20]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--prev_scores", default=None)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    with open(args.input) as f:
        accounts = json.load(f)

    prev_scores = {}
    if args.prev_scores:
        try:
            with open(args.prev_scores) as f:
                prev_data = json.load(f)
            if isinstance(prev_data, list):
                prev_scores = {a["account_id"]: a for a in prev_data}
            else:
                prev_scores = prev_data
        except (FileNotFoundError, json.JSONDecodeError):
            print("Warning: prev_scores file not found or invalid, treating as first run", file=sys.stderr)

    scored = [score_account(acc, prev_scores) for acc in accounts]
    scored = rank_accounts(scored, prev_scores)
    weekly_movers = compute_weekly_movers(scored, prev_scores)

    output = {
        "scored_accounts": scored,
        "weekly_movers": weekly_movers,
        "summary": {
            "total_accounts": len(scored),
            "by_ae": {ae: len([a for a in scored if a["ae"] == ae])
                      for ae in set(a["ae"] for a in scored)},
        },
    }

    with open(args.output, "w") as f:
        json.dump(output, f, indent=2)

    print(f"Scored {len(scored)} accounts. Weekly movers: {len(weekly_movers)}.", file=sys.stderr)


if __name__ == "__main__":
    main()
