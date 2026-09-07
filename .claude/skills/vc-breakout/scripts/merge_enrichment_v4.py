#!/usr/bin/env python3
"""
VC Breakout v4.4 — Merge Enrichment
=====================================
Joins web enrichment data onto internal account data.
Validates enrichment records against schema. Drops malformed records.

Usage:
    python3 merge_enrichment_v4.py --ae jeanne fionn rami
"""

import json
import argparse
import sys
from pathlib import Path

WORK_DIR = Path(__file__).parent / "work"
SCHEMA_PATH = Path(__file__).parent / "enrichment_schema_v4.json"

VALID_FIELDS = None


def load_valid_fields():
    global VALID_FIELDS
    with open(SCHEMA_PATH) as f:
        schema = json.load(f)
    VALID_FIELDS = set(schema.get("properties", {}).keys())


def validate_record(record: dict) -> bool:
    if not isinstance(record, dict):
        return False
    if "account_id" not in record:
        return False
    extra = set(record.keys()) - VALID_FIELDS
    if extra:
        print(f"  WARNING: dropping record {record.get('account_id')} — extra fields: {extra}", file=sys.stderr)
        return False
    return True


def merge_ae(ae: str) -> list[dict]:
    internal_path = WORK_DIR / f"internal_{ae}.json"
    enriched_path = WORK_DIR / f"enriched_{ae}.json"

    if not internal_path.exists():
        print(f"ERROR: {internal_path} not found", file=sys.stderr)
        return []

    with open(internal_path) as f:
        internal = json.load(f)

    if not enriched_path.exists():
        print(f"  {ae}: no enrichment file — using internal-only scores", file=sys.stderr)
        return internal

    with open(enriched_path) as f:
        enriched_raw = json.load(f)

    if not isinstance(enriched_raw, list):
        print(f"  WARNING: {enriched_path} is not a list — skipping enrichment", file=sys.stderr)
        return internal

    # Validate and index enrichment
    enrichment_map = {}
    valid_count = 0
    for record in enriched_raw:
        if validate_record(record):
            enrichment_map[record["account_id"]] = record
            valid_count += 1

    dropped = len(enriched_raw) - valid_count
    if dropped > 0:
        print(f"  {ae}: dropped {dropped}/{len(enriched_raw)} malformed enrichment records", file=sys.stderr)

    # Merge: internal fields are authoritative for PIV/tier, enrichment fills external signals
    merged = []
    for acc in internal:
        enrichment = enrichment_map.get(acc["account_id"], {})
        # Enrichment fills external signal fields only
        for key, val in enrichment.items():
            if key == "account_id":
                continue
            # Enrichment can upgrade funding_stage if internal has none
            if key == "funding_stage" and acc.get("funding_stage"):
                continue  # internal (Hubble) is authoritative
            acc[key] = val
        merged.append(acc)

    # Stats
    enriched_count = sum(1 for a in merged if enrichment_map.get(a["account_id"]))
    founder_flags = sum(1 for a in merged if any(a.get(f) for f in [
        "founder_prior_exit", "founder_serial", "founder_top_ai_lab",
        "founder_top_tech_company", "founder_domain_expert"]))

    print(f"  {ae}: {len(merged)} accounts | enriched: {enriched_count} | founder flags: {founder_flags}", file=sys.stderr)

    # <5% is only a meaningful signal at real book scale — on a small test run
    # (e.g. 3 accounts) a legitimate zero-founder-data result triggers this
    # every time and just masks the real bug it's meant to catch.
    if len(merged) >= 10 and founder_flags < len(merged) * 0.05 and enriched_count > 0:
        print(f"  WARNING: {ae} has <5% founder flags — possible found-then-dropped bug", file=sys.stderr)

    return merged


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ae", nargs="+", required=True)
    args = parser.parse_args()

    load_valid_fields()
    WORK_DIR.mkdir(exist_ok=True)

    all_accounts = []
    print("Merge enrichment v4:", file=sys.stderr)
    for ae in args.ae:
        accounts = merge_ae(ae.lower())
        all_accounts.extend(accounts)

    out_path = WORK_DIR / "accounts.json"
    with open(out_path, "w") as f:
        json.dump(all_accounts, f, indent=2)

    print(f"  → {out_path} ({len(all_accounts)} total accounts)", file=sys.stderr)


if __name__ == "__main__":
    main()
