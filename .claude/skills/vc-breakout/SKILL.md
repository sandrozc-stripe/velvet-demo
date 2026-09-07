---
name: vc-breakout
description: 'Run the VC Breakout v4.4 weekly scoring. Scores startup accounts across 5 dimensions (PIV Growth, Funding Momentum, External Momentum, VC Tier, Founder Pedigree) with stage-dependent weights, producing a ranked Excel leaderboard per AE. Use when asked to: run breakout scoring, generate the startup leaderboard, rank AE accounts by breakout potential, refresh the VC breakout xlsx, run the Monday scoring, or score startup accounts.'
---

# VC Breakout Agent v4.4

Weekly scoring → ranked .xlsx leaderboard per AE. 5 dimensions, stage-dependent weights, no cache (every run fresh).

> Respond terse like smart caveman. All technical substance stay. Only fluff die.
> Drop: articles, filler, pleasantries, hedging. Fragments OK. Short synonyms.
> Technical terms, numbers, dates, company names, citations — byte-exact always.
> Pattern: [thing] [action] [reason]. [next step].

---

## Data Integrity Rules

Apply to every data point, every run, every worker. Non-negotiable.

1. **Source tag on every external claim.** No source found → `—`. Never fill with plausible-sounding content.
2. **Never fabricate funding round.** No data → `funding_stage: null`, `months_since_round: null`.
3. **Never infer founder background without evidence.** No data → `false` / `"— [no data found]"`.
4. **PIV from Stripe data only.** Never use web traffic or press to infer payment volume.
5. **Score strictly per rubric.** No rounding up. When in doubt, round down.
6. **A `—` is always correct. A guess is never correct.**
7. **PitchBook (`pitchbook.raw_companies`/`raw_deals`) is licensed 3P data.** Internal use only — this skill's leaderboard output. Never surface raw PitchBook fields in customer-facing material, external comms, or redistribute outside the sheet. See [go/3p-data-usage](http://go/3p-data-usage). Prefer `cdm.domains_core`/Rosalind for anything that isn't the funding-subtype granularity PitchBook uniquely provides.
8. **Use `call_web_search` (toolshed_extras), never the generic `WebSearch` tool.** `WebSearch` errors with `Web search is only supported for OpenAI models` on non-OpenAI models (verified 2026-08-11 on claude-sonnet-5) — all Phase 2 web enrichment must go through `call_web_search`.

---

## Architecture — Map→Reduce

```
Phase 0: Setup (load prev scores from GSheet, verify Panorama access)
Phase 1: Internal data (territory + gap + cdm.mapping_sfdc_account_to_domain + cdm.domains_core + hub.investor_funding_events + top_startups.top_investors_2026 + dna.domain_segment_panel + pitchbook.raw_companies)
Phase 2: Web enrichment (3 parallel workers, tiered by startup_type — reduced scope thanks to CDM/DNA data)
Phase 3: Score + rank (Python — score_compute_v4.py)
Phase 4: Build .xlsx (Python — build_xlsx.py)
Phase 5: Write scores baseline to GSheet for next week's delta
```

---

## AE Roster

| AE | ldap_handle | Region |
|----|-------------|--------|
| Jeanne Malrieu | `jeannemalrieu` | France |
| Fionn O Colmain | `fionnocolmain` | UK |
| Rami Haddad | `ramihaddad` | DACH |

---

## Phase 0 — Setup

1. Load prior week scores from GSheet `1PMFUAG6b0Uxy9UVou7TGBJllhLdNNsAJ7O9DrGR1q84` tab `📊 Scores v4`. Save to `scripts/work/last_week_scores.json`. If tab has only headers → first run, all deltas `NEW`.
2. Load the `🗄️ Cache` tab into `scripts/work/cache.json`. This contains enrichment data (D3+D5 inputs) per account with a `last_researched` date.
3. Ensure `scripts/raw/` and `scripts/work/` are clean.

---

## Phase 1 — Internal Data Pull

Per AE, run data pulls (fan out all 3 AEs in one message). Join order follows the recommended pattern: SFDC account → domain mapping → CDM enrichment → funding events → investor tiers → DNA history.

### 1a. Territory query
`run_hubble_query_template(query_template_id="29178", inputs='{"LDAP": "<HANDLE>", "identifier": "<HANDLE>"}')`
→ save to `scripts/raw/territory_<ae>.json`

**Response is oversized — expect a file redirect.** This template returns ~150 columns per row (a full AE book, e.g. 385 rows for one AE) and routinely exceeds the tool's max-token response. When that happens the result is written to a file instead of returned inline; that file's lines are too long for `Read`'s offset/limit chunking, so parse it with a script (e.g. `python3 -c "import json; ..."`) rather than a text-reading tool. Only ~15 of the ~150 columns are actually used (account id/name, domain, startup type, employee count, `Top 5 VC Funding`) — extract just those instead of holding the full row set in context.

### 1b. Gap query
Per-account PIV query, run once per AE. **No saved "gap query" exists** — `hubble_list_saved_queries` (global) turns up nothing for "PIV gap"/"gap query"/"piv_last_90d", and the old `data-sources.md` reference (`fdx.payments_aggregates_actuals`, joined directly on `account_id`) is stale/wrong: that table is org-keyed, not account-keyed, and has no `payment_intent_volume_usd`/`created_date` columns (verified 2026-08-11 via `hubble_get_dataset`). Use this reconstruction instead — validated 2026-08-11 against a real 10-account batch from Jeanne's book (query_id `e8a9bef4`), output shape matches exactly:

```sql
WITH target_orgs AS (
  SELECT org_id, sfdc_account_id
  FROM cdm.mapping_org_to_sfdc_account_latest
  WHERE sfdc_account_id IN (<account_ids_from_territory>)
),
piv_windows AS (
  SELECT o.sfdc_account_id AS account_id,
    SUM(CASE WHEN v.reporting_date_ts >= CAST(current_date - INTERVAL '90' DAY AS timestamp)
         THEN v.pay_ins_volume_usd_fixed ELSE 0 END) / 1e6 AS piv_last_90d_usd_m,
    SUM(CASE WHEN v.reporting_date_ts >= CAST(current_date - INTERVAL '180' DAY AS timestamp)
              AND v.reporting_date_ts <  CAST(current_date - INTERVAL '90' DAY AS timestamp)
         THEN v.pay_ins_volume_usd_fixed ELSE 0 END) / 1e6 AS piv_prior_90d_usd_m,
    SUM(CASE WHEN v.reporting_date_ts >= CAST(current_date - INTERVAL '365' DAY AS timestamp)
         THEN v.pay_ins_volume_usd_fixed ELSE 0 END) / 1e6 AS piv_ttm_usd_m
  FROM fdx.bva_volume_actuals v
  JOIN target_orgs o ON v.facilitating_org_id = o.org_id
  WHERE v.reporting_date_ts >= CAST(current_date - INTERVAL '365' DAY AS timestamp)
    AND v.reporting_date_ts <  CAST(current_date AS timestamp)
  GROUP BY 1
),
latest_account AS (
  SELECT account_id, account_decision_country, current_last_activity_date,
         ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY data_as_of_date DESC) AS rn
  FROM communia_sales.dim_account_hourly
  WHERE account_id IN (<account_ids_from_territory>)
)
SELECT
  a.account_id,
  COALESCE(p.piv_last_90d_usd_m, 0)  AS piv_last_90d_usd_m,
  COALESCE(p.piv_prior_90d_usd_m, 0) AS piv_prior_90d_usd_m,
  COALESCE(p.piv_ttm_usd_m, 0)       AS piv_ttm_usd_m,
  CASE WHEN p.piv_prior_90d_usd_m > 0
       THEN ROUND(100.0 * (p.piv_last_90d_usd_m - p.piv_prior_90d_usd_m) / p.piv_prior_90d_usd_m, 1)
       ELSE NULL END AS piv_90d_growth_pct,
  a.account_decision_country AS decision_country,
  date_diff('day', CAST(a.current_last_activity_date AS date), current_date) AS ae_activity_recency_days
FROM latest_account a
LEFT JOIN piv_windows p ON a.account_id = p.account_id
WHERE a.rn = 1
```
Output shape (verified against real prior run):
```json
{"account_id": "...", "piv_last_90d_usd_m": 0.027, "piv_prior_90d_usd_m": 0, "piv_ttm_usd_m": 0.029, "piv_90d_growth_pct": null, "decision_country": "France", "ae_activity_recency_days": 0}
```
→ save to `scripts/raw/gap_<ae>.json`. `ingest_v4.py::merge_gap_data` reads `piv_last_90d_usd_m`/`piv_prior_90d_usd_m` directly and converts to raw USD internally — save this query's native USD-millions output as-is, no manual unit conversion needed.

**Caveats:**
- **Filter `target_orgs`/`latest_account` to the AE's account list *before* the join**, not after — an unrestricted 365-day scan of `fdx.bva_volume_actuals` without narrowing to target org_ids first times out (>224s in testing).
- **`communia_sales.dim_account_hourly` is an hourly SCD snapshot table with multiple rows per `account_id`** — the `ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY data_as_of_date DESC)` dedup is required, or the join fans out 100x+.
- **`ae_activity_recency_days` is account-level ("last activity by anyone"), not AE-LDAP-scoped.** No accessible table joins activity directly to seller LDAP — `gtm_insights_observability.outreach_tasks_all` and the Anaplan seller tables are LDAP-gated (one is explicitly documented as off-limits to agent tools). Fine in practice since the account list is already scoped to the AE's book via the territory query (1a), but it won't distinguish this AE's activity from another rep's on a shared/managed account.
- **A better source may exist but is inaccessible:** `cdm.sfdc_accounts_volume` has ready-made `over_90d__volume/previous_period/growth` and `over_365d__volume` fields — cleaner than this manual reconstruction — but requires `access-redshift-cdm-volume`, denied twice (soft-retried via `justify_hubble_query_access` per the rule below, denied again identically). If whoever runs this has that access, prefer it over the query above.

If `RedshiftCiaAccessDenied` → `justify_hubble_query_access`, retry once. **Retry only helps for soft/transient denials.** For a genuinely LDAP-group-gated table, `justify_hubble_query_access` only logs the justification (it says "try an alternative dataset or a less sensitive view") — the identical query will fail again with the same error. Treat a second identical denial as permanent for this run: write `—` for the affected fields and move on, don't retry further.

**`decision_country` has no Hubble fallback when this query is unavailable.** Territory query template 29178 (1a) carries no country/geography column at all (checked full ~150-column output). If 1b is degraded, `country` for the AE tab (col D) and scoring schema has zero internal source. Workaround: add HQ-location to the Phase 2 web search scope for each account (e.g. `"[domain] OR [company] headquarters location country office"`) rather than leaving it `—` — this is a real search call, budget it alongside the funding/press calls below. **The worker's returned JSON record must include this as a `country` field** (added to `enrichment_schema_v4.json` — verified 2026-08-11 that without it, `merge_enrichment_v4.py::validate_record`'s strict `additionalProperties: false` check silently drops the *entire* enrichment record for any account whose worker output included an undeclared `country` key, not just that one field).

**For accounts with a `Merger/Acquisition` PitchBook substage, the HQ-country search returns the acquirer's country, not the original startup's.** Verified 2026-08-11: a French startup acquired by a US company returned "United States" from the generic HQ-location search — correct for the acquirer, misleading for the AE tab (which tracks the original account under its home territory). When `startup_substage` is `Merger/Acquisition`, add "original HQ before acquisition" to the search query and prefer that country; fall back to the acquirer's country only if the original can't be determined.

### 1c. Account-to-domain mapping
```sql
SELECT sfdc_account_id AS account_id, domain
FROM cdm.mapping_sfdc_account_to_domain
WHERE sfdc_account_id IN (<account_ids_from_territory>)
  AND day = (SELECT MAX(day) FROM cdm.mapping_sfdc_account_to_domain)
```
→ save to `scripts/raw/account_domains_<ae>.json`. The table's account-id column is `sfdc_account_id`, not `account_id` — verified against the real table schema (a query using bare `account_id` fails with `COLUMN_NOT_FOUND`).

### 1d. Domain enrichment (CDM)
Join domains from 1c to get current company traits:
```sql
SELECT
  d.domain,
  d.canonical_name,
  d.employees__count,
  d.funding__total_amount_usd,
  d.funding__last_funding_stage,
  d.segmentation__company_segment_details__startup_type,
  d.segmentation__company_segment_details__top_startup_type
FROM cdm.domains_core d
WHERE d.domain IN (<domains_from_1c>)
```
→ save to `scripts/raw/domains_core_<ae>.json`

### 1e. Funding events (with dedup)
```sql
SELECT domain, funding_type, funding_month,
       MAX(funding_amount) AS funding_amount,
       date_format(funding_month, '%Y-%m-%d') AS announced_date,
       array_join(array_agg(DISTINCT investor_domain_or_name), ' | ') AS investor_names
FROM hub.investor_funding_events
WHERE domain IN (<domains_from_1c>)
GROUP BY domain, funding_type, funding_month
ORDER BY funding_month DESC
```
→ save to `scripts/raw/funding_events_<ae>.json`

Note: the table has one row per participating investor (`investor_domain_or_name`), a `funding_month` timestamp column, and no `announced_date`/`investor_names` columns — those must be derived (`date_format`, `array_agg`) as above. Verified against the real table schema; an earlier version of this query referenced `announced_date`/`investor_names` directly and failed with `COLUMN_NOT_FOUND`. Dedup by domain+funding_month+funding_type using MAX(funding_amount) per round — a funding round can appear once per participating investor.

### 1f. Investor tier
```sql
SELECT investor_domain, tier
FROM top_startups.top_investors_2026
```
→ save to `scripts/raw/investor_tiers.json` (run once, shared across AEs). Requires `access-redshift-read-hive-top_startups-top_investors_2026` — LDAP-gated. If `RedshiftCiaAccessDenied` persists after one `justify_hubble_query_access` + retry (see Phase 1b note on gated tables), write `—`/`null` for `investor_tier` and `multi_investor_p0` for this run and continue — D4 VC Tier (`score_vc_tier` in `score_compute_v4.py`) is driven by `startup_type` (P0/P1/P2/FUNDED) regardless, so scoring degrades gracefully without this table.

Join investor names from 1e against this table to determine `investor_tier`/`multi_investor_p0` per account (feeds a minor P0 bonus in `score_vc_tier`, not the primary D4 score). Deduplicate by investor_domain before joining. **Unverified:** `ingest_v4.py`'s `tier_rank = {"P0": 3, "P1": 2, "P2": 1}` assumes this table's `tier` column holds the strings "P0"/"P1"/"P2" — this has never been confirmed against real data (blocked by the access gate above). Confirm the actual `tier` value format next time access is available, and fix `tier_rank`'s keys if they don't match.

### 1g. Historical trends (optional — only when delta detection needed)
```sql
SELECT domain, month, features__employee_count,
       segmentation__company_segment_details__startup_type,
       segmentation__company_segment_details__top_startup_type
FROM dna.domain_segment_panel
WHERE domain IN (<domains_from_1c>)
  AND month >= DATE_ADD('month', -6, CURRENT_DATE)
ORDER BY domain, month
```
→ save to `scripts/raw/domain_history_<ae>.json`

Use for headcount trend detection (growing/flat/shrinking) to feed D3 External Momentum without web search. Compare latest month vs 3 months prior.

### 1h. PitchBook funding granularity (raw)
Requires `access-redshift-pitchbook` (LDAP-gated 3P broker data — see Data Integrity Rule 7). Rosalind/`hub.investor_funding_events` collapses Seed, Angel, and Accelerator/Incubator rounds into the same coarse `pre_series_a` enum — AEs need the split (top seed vs. accelerator vs. angel) to prioritize correctly. `pitchbook.raw_companies` carries that granularity natively and joins on `website`, not `account_id`, so match by normalized domain (strip `http(s)://`, `www.`, trailing slash) against the domains from 1c.

```sql
SELECT
  website,
  financing_status_note,
  first_financing_date, first_financing_size, first_financing_deal_type, first_financing_deal_type2,
  last_financing_date, last_financing_size, last_financing_deal_type, last_financing_deal_type2,
  business_status, company_financing_status,
  employees,
  growth_rate, growth_rate_percentile
FROM pitchbook.raw_companies
WHERE LOWER(REGEXP_REPLACE(website, '^(https?://)?(www\.)?|/$', '')) IN (<domains_from_1c, lowercased>)
```
→ save to `scripts/raw/pitchbook_<ae>.json`

Notes:
- `last_financing_deal_type` (top-level: Seed Round, Accelerator/Incubator, Angel (individual), Early Stage VC, Later Stage VC, …) + `last_financing_deal_type2` (sub-classification: Equity-Based Accelerator, Non-Equity Accelerator, Series A1, Series BB, …) together give the granularity Rosalind's `funding_type` enum can't.
- `business_status` / `company_financing_status` values of "Accelerator/Incubator" flag accounts to deprioritize (per AE ask — see `ingest_v4.py::is_accelerator`).
- Never let PitchBook override `funding_stage` (still Hubble-only per Phase 2 rule below) — it feeds a separate `startup_substage` field used for display and D2/D3 nuance only.
- Some EMEA startups (esp. very early-stage France/DACH accounts) won't have a PitchBook row — Dealroom/Clearbit coverage gaps are expected there. Missing row → all `pitchbook_*` fields stay `—`, no web-search fallback needed since Phase 2 already covers funding via search.
- **`website` inconsistently includes the `www.` prefix within the same table** — some rows `www.delpha.io`, others bare `actionable.live`. The normalize regex MUST make the scheme optional too (`^(https?://)?(www\.)?`), not just the `www.` part — a version that requires `https?://` before matching `(www\.)?` silently fails to strip `www.` off scheme-less values, which is most of them. This exact bug caused a real false "no PitchBook coverage" conclusion for Delpha, Tengo, and Rippletide before it was caught — always verify a genuine-looking miss with `LOWER(website) LIKE '%<company>%'` before writing `—`.
- **A no-equity accelerator *program* (e.g. Station F, Snowflake Startup Accelerator) can show up as `last_financing_deal_type` with `last_financing_size: null`** — that's program participation, not a financing round, and will misclassify a real VC-backed company as accelerator-financed if taken at face value. `ingest_v4.py::classify_pitchbook_substage` falls back to `first_financing_deal_type(2)` when the last "financing" event has no size.
- **`growth_rate_percentile` is 0–100, not 0–1** (scoring threshold is `>= 70`, see D3 below). Also, `15` is a disproportionately common value (~1.4M rows) — almost certainly PitchBook's default bucket for `growth_rate = 0`/no-data companies, not a real percentile. Don't treat `15` as a meaningful signal.

### 1i. Run ingest
```bash
python3 scripts/ingest_v4.py --ae <ae_list> --today <YYYY-MM-DD>
```
Produces `scripts/work/internal_<ae>.json` per AE with:
- `funding_stage` from hub.investor_funding_events (primary) or cdm.domains_core (fallback) — PitchBook never overrides this
- `startup_type` / `top_startup_type` from cdm.domains_core (overrides territory if present)
- `employees_count` from cdm.domains_core
- `headcount_trend` from dna.domain_segment_panel (growing/flat/shrinking)
- `investor_tier` (best tier among round investors, from top_startups.top_investors_2026)
- `domain` (from cdm.mapping_sfdc_account_to_domain — needed for web search and cache key)
- `startup_substage` from pitchbook.raw_companies (e.g. "Seed Round", "Accelerator/Incubator", "Series A1") — informational granularity, feeds Key Signal + D2/D3 scoring nuance, never the stage-weight selector
- `is_accelerator` (bool) from PitchBook `business_status`/deal type — drives the D2 deprioritization penalty
- `months_since_round` / `funding_round_amount_eur` fallback from PitchBook `last_financing_date`/`last_financing_size` when `hub.investor_funding_events` has no row
- `pitchbook_growth_percentile` from PitchBook `growth_rate_percentile` (web+social composite) — feeds D3 as a non-PIV external signal, reducing reliance on web search for headcount/traction momentum

---

## Phase 2 — Web Enrichment (7-Day Cache)

### Cache check (before any web search)

Load cache from `scripts/work/cache.json` (populated from `🗄️ Cache` tab in Phase 0). For each account:
- If `last_researched` is **≤7 days ago** → **skip web search**, use cached enrichment values for D3+D5 scoring.
- If `last_researched` is **>7 days ago** or account is **not in cache** → include in web search batch.

This means a full weekly run only re-researches accounts whose cache expired. A mid-week re-run on the same book does zero web searches (all <7 days old).

### Cache schema (`🗄️ Cache` tab)

| Col | Field | Description |
|-----|-------|-------------|
| A | account_id | Primary key for merge |
| B | account_name | Display |
| C | domain | For web search |
| D | ae | Owner |
| E | last_researched | ISO date (YYYY-MM-DD) |
| F | headcount_trend | growing/flat/shrinking |
| G | headcount_number | int |
| H | press_mentions_90d | int |
| I | senior_hire | true/false |
| J | geo_expansion_signal | string |
| K | founder_prior_exit | true/false |
| L | founder_serial | true/false |
| M | founder_top_ai_lab | true/false |
| N | founder_top_tech_company | true/false |
| O | founder_domain_expert | true/false |
| P | founder_pedigree_source | string |

**⚠️ Row-padding on read.** The Sheets API drops trailing empty cells, so an existing row where col P (`founder_pedigree_source`) is blank will come back with only 15 elements instead of 16. Always pad short rows to the full 16 columns (`row + [""] * (16 - len(row))`) before indexing by column or merging — do not assert a fixed row length.

### Web search (only for cache-miss accounts)

Fan out workers for accounts that need fresh research (cache miss or >7 days stale).

### Worker input format

Each worker receives a JSON list of accounts with **`account_id` and `domain`** included. The orchestrator builds this from `internal_<ae>.json`:

```json
[
  {"account_id": "001TQ00000P0bNdYAJ", "account_name": "Leadbay", "domain": "leadbay.ai", "startup_type": "P0", "funding_stage": "pre_series_a"},
  ...
]
```

### Search strategy: use domain, not name

**Always search by domain** (more reliable than account names, which are often garbage like `https://conteller.com/campaigns` or `www.qlower.com`). Format search queries as:

- Call 1: `"site:[domain] OR [domain] funding round headcount 2025 2026"`
- Call 2: `"site:[domain] OR [domain] founder CEO CTO background"`

If domain is null or generic, fall back to `"[account_name] [industry context]"`.

### Worker brief (paste into each, fill `<AE>` / `<HANDLE>`):**

> Enrichment worker **<AE>**. Input: JSON list with `account_id`, `account_name`, `domain`, `startup_type`, `funding_stage`.
>
> Tiered search per account. Use `call_web_search` with `fast_mode: true` on every call. **Search by domain** (e.g. `"site:leadbay.ai OR leadbay.ai funding"`) — do NOT rely on account_name for search queries as many are malformed.
>
> **If the account has a PitchBook row (`pitchbook_last_financing_date` is set)** — funding amount/date/subtype are already known from Phase 1h. Skip the funding half of Call 1 and search press/headcount only: `"site:[domain] OR [domain] press mention news hiring 2025 2026"`. This is the common case now — only run the full funding search below for PitchBook cache-misses.
>
> **P0 + P1 accounts — 2 calls:**
> - Call 1: `"site:[domain] OR [domain] funding round raised 2025 2026 headcount hiring"`. Output constraint: "bullet facts only — funding amount, date, investors, press mentions, headcount. No summaries, no headers, no source analysis. Exclude pitchbook.com."
> - Call 2 (ONLY if funding_stage is pre_series_a or series_a): `"site:[domain] OR [domain] founder CEO CTO prior exit acquired background"`. Site priority: linkedin.com, crunchbase.com. Output constraint: "bullet facts only — name, prior companies, exits, titles. No summaries. Exclude pitchbook.com."
> - For Series B+: extract any founder/CTO mentions opportunistically from Call 1 results. No dedicated Call 2.
>
> **P2 accounts — 1 call only:**
> - `"site:[domain] OR [domain] funding round OR raised OR Series 2025 2026"`. Output constraint: "bullet facts only. If nothing found say 'no results'. Exclude pitchbook.com."
>
> **Extract→field immediately.** After each search, pull values into schema fields. Drop raw result text. Never accumulate raw results across accounts.
>
> **Telegraphic source strings.** `"Series B $18M Jan2026, Sequoia+a16z [TechCrunch]"` not `"It appears that the company raised..."`. Numbers/dates/names exact. Only filler dies.
>
> **⚠️ funding_stage comes ONLY from Hubble (Phase 1).** Web enrichment must NOT override `funding_stage`. The enrichment schema includes `months_since_round` (for D2 recency scoring) but the stage classification itself is sourced exclusively from the `Top 5 VC Funding` field in the territory template. This avoids mismatches where web search returns a different label (e.g. "Seed" vs the Hubble-classified "pre_series_a"). During merge, skip any `funding_stage` value returned by enrichment workers.
>
> **Return:** JSON list with **`account_id` as the key field** in each record (for deterministic merge — no fuzzy name matching). One record per account. No files. No prose. JSON only.

### Merge strategy: by account_id, not name

**After workers return**, the orchestrator merges enrichment into `internal_<ae>.json` by **joining on `account_id`** (exact match). This eliminates the fuzzy-name-matching failures that caused 60%+ miss rates in earlier runs. Never match by account_name — names in the territory template are unreliable.

Save merged result to `scripts/work/enriched_<ae>.json`, then:
```bash
python3 scripts/merge_enrichment_v4.py --ae jeanne fionn rami
```
→ produces `scripts/work/accounts.json`

---

## Phase 3 — Score + Rank

```bash
python3 scripts/score_compute_v4.py \
  --input scripts/work/accounts.json \
  --prev_scores scripts/work/last_week_scores.json \
  --output scripts/work/scored.json
```

Single flat rank per AE. Stage-dependent weights auto-selected from `funding_stage`. If Hubble + enrichment both returned no stage → "Default" weights (25/20/10/10/35).

---

## Phase 4 — Write to Google Sheet

**Mandatory sheet:** `https://docs.google.com/spreadsheets/d/1PMFUAG6b0Uxy9UVou7TGBJllhLdNNsAJ7O9DrGR1q84/edit`
Spreadsheet ID: `1PMFUAG6b0Uxy9UVou7TGBJllhLdNNsAJ7O9DrGR1q84`

**Pre-populated tabs (headers already in place — write data starting row 2):**
- `🇫🇷 Jeanne` — 18 columns (AE leaderboard)
- `🇬🇧 Fionn` — 18 columns (AE leaderboard)
- `🇩🇪 Rami` — 18 columns (AE leaderboard)
- `⚡ Weekly Movers` — 10 columns
- `📊 Scores v4` — 10 columns (score baseline for weekly deltas)

**AE tab column order (must match pre-existing headers in row 1):**
```
A=Rank, B=Δ Rank, C=Account Name, D=Decision Country, E=Top Type,
F=Funding Stage, G=Breakout Score, H=D1 PIV, I=D2 Funding,
J=D3 External, K=D4 VC Tier, L=D5 Founder, M=PIV 90d €,
N=PIV Growth %, O=AI Flag, P=Months Since Round, Q=Key Signal,
R=Recommended Action
```

**Write strategy: incremental update (not full clear+rewrite)**

The AE tab is the **single source of truth for rankings**. When running on a subset of accounts (e.g. re-scoring only accounts that got fresh web enrichment), do NOT clear the whole tab. Instead:

1. **Read the existing AE tab** to get current rows. **Never key the match on Account Name (col C)** — display names are unstable (e.g. a domain-derived placeholder like `formality.co` gets replaced by the real name `Formality` between runs), and matching by name will silently create a duplicate row for the same company. Instead, build a `account_id → account_name` lookup from `scripts/work/accounts.json` (or the `🗄️ Cache` tab, col A) and match existing rows to newly-scored accounts via that lookup.
2. **For each newly-scored account:** find its row in the existing sheet data by `account_id` (via the lookup above) and replace that row with the updated values (new score, new rank, new D3/D5 if enrichment changed). Before writing, scan the merged dataset for two rows sharing the same `account_id` — if found, drop the stale one (older `last_researched` / lower-fidelity name) and keep the fresh one.
3. **Re-rank all accounts** (existing + updated) by Breakout Score descending. Assign new sequential ranks 1→N.
4. **Write the full re-ranked dataset** back to the sheet starting at A2. This is a single `update_google_drive_sheet` call — not a clear+write, just an overwrite of A2:R<N> with the complete sorted data.

This means:
- Accounts that weren't in this run's scope **keep their existing enrichment data** (from cache) and get re-ranked based on fresh D1/D2 from Hubble.
- Only accounts with new web searches get updated D3/D5 values.
- The ranking is always globally correct (all accounts sorted together).

**Full clear+rewrite** is only used on the very first run (no prior data in the tab) or when explicitly requested.

**Column K (D4 VC Tier)** must be a plain integer (e.g. "7", "10") — never put strings with "+" prefix there or Sheets will interpret as a formula error.

**Write Weekly Movers:** Clear A2:J, write movers sorted by abs(delta) descending.

**Write Cache:** After scoring, update the `🗄️ Cache` tab with enrichment data for all accounts that were web-searched this run. For each account: find its row by `account_id` (col A) and overwrite, or append if new. Set `last_researched` to today's date.

Never create a new sheet. Never overwrite row 1 (headers). If write fails, retry once — writes are idempotent.

---

## Phase 5 — Write Score Baseline

Append current week's scores to `📊 Scores v4` tab in the same sheet (`1PMFUAG6b0Uxy9UVou7TGBJllhLdNNsAJ7O9DrGR1q84`).
Columns: `[account_id, ae, week_date, rank, score, d1, d2, d3, d4, d5]`.
Append rows (don't overwrite prior weeks). This becomes next week's `prev_scores`.

---

## Weekly Movers Triggers

After scoring (Phase 3), for P0+P1 accounts NOT in top-15 per AE, run one additional web search:
```
"[Company] funding round OR Series OR raised OR CTO OR CFO OR VP 2025 2026"
```
Flag if trigger fires: 🚀 New funding | 📈 PIV spike (>50% vs prior) | 🌍 Geo expansion | 🤝 Strategic hire.

---

## Test Mode

When <20 accounts provided by name, run in test mode:
- Single agent, no fan-out
- Skip GSheet read/write
- Print scored table inline (do not generate xlsx)
- Always output full table, never summarize as narrative

---

## Error Handling

| Issue | Response |
|-------|----------|
| Hubble query fails after retry | Write `—` for affected fields, continue |
| Web search returns nothing | Write `—` with `[no results]` tag |
| Worker fails/times out | Proceed — those accounts keep internal-only scores |
| First run (no prev scores) | All Δ = `NEW`, Weekly Movers = triggers only |
| `ingest_v4.py` exits non-zero | Fix raw query before scoring — do NOT score degraded data. Exception: if the gap query's unavailability was already verified this run (Phase 1b — no saved query found, or a confirmed permanent access gate), re-run with `--allow_degraded_piv` rather than treating the exit as a broken query to chase indefinitely. |

**Partial results always better than empty results.**

---

## Scoring Reference

Full rubric (weight table + all 5 dimension point tables + penalties): [`references/scoring-rubric-v4.md`](references/scoring-rubric-v4.md). Source of truth for scoring logic is `scripts/score_compute_v4.py` — keep both in sync if either changes.
