---
name: "hubble-query-optimizer"
description: "Use when the user asks to optimize a query, reduce query cost, fix a slow query, check query efficiency, or when you detect an inefficient pattern in SQL being generated or reviewed. Also use when a query fails with OOM or timeout errors."
---
# hubble-query-optimizer

## Overview

Proactively analyzes Trino/Hubble SQL for cost and performance inefficiencies, then
suggests optimized rewrites with estimated savings. Unlike manual EXPLAIN ANALYZE
workflows, this skill auto-detects common anti-patterns and produces ready-to-use
alternatives.

## Instructions

### 1. Obtain the SQL to optimize

Get the query from one of:
- The user's message (pasted SQL)
- A prior SQL generation step in this conversation
- A saved query the user references (ask the user to paste it)

### 2. Identify the datasets involved

For each table referenced in the query, call `search_dataset_documentation` with
`include_fields=true` to retrieve:
- **Partition columns** — critical for filter optimization
- **Table tier and size** — informs cost impact estimates
- **Column types** — identifies nested data that may cause explosions

Issue all dataset lookups in a **single parallel tool call**.

### 3. Detect inefficiencies

Scan the SQL for these anti-patterns (ordered by typical cost impact):

| Priority | Anti-pattern | Detection | Typical savings |
|----------|-------------|-----------|-----------------|
| 1 | Missing partition filter | Table has `partition_columns` but WHERE clause does not filter on them | 80-95% data reduction |
| 2 | Duplicate table scans | Same table appears in multiple CTEs or subqueries | 30-50% |
| 3 | Redundant aggregate expressions | Same aggregate (e.g., `count_if(x)`) computed multiple times in SELECT | Negligible (readability; optimizer may deduplicate) |
| 4 | SELECT * or excessive columns | Wide SELECT on large tables fed into JOINs | 10-25% on wide columnar tables |
| 5 | Late filtering / CTE + WHERE instead of HAVING | Post-aggregation filter in outer query instead of HAVING | Negligible in Trino (CTEs are inlined); readability win |
| 6 | Exact where approximate suffices | `COUNT(DISTINCT x)` on large data where approximate is acceptable | 40-60% time |
| 7 | Verbose type coercions | Multiple `CAST(x AS double)` where `1.0 * x` or single cast suffices | Negligible but cleaner |
| 8 | `count(column)` vs `count(*)` | `count(col)` adds per-row null check; use `count(*)` if nulls don't matter | Minor |
| 9 | Expensive array/map operations in JOINs | `contains()`, `array_join()` in ON clauses | 10-25% |
| 10 | Computed expressions preventing pushdown | `date_trunc()`, `from_unixtime()`, `dateadd()` UDFs in WHERE | 20-40% |
| 11 | Cartesian risk | JOIN without enough selectivity keys | Variable |

**For each anti-pattern, also check what is already done well** — report both
issues AND correct patterns so the user understands what not to change.

### 4. Generate optimized SQL

For each detected issue, rewrite the affected SQL section. Apply multiple
optimizations in a single rewrite when they don't conflict.

**Rewrite rules:**

**Missing partition filter:**
```sql
-- Before: full table scan
SELECT * FROM core.fact_payments WHERE merchant_id = 'acct_123'

-- After: partition-filtered
SELECT * FROM core.fact_payments
WHERE created_date >= date_add('day', -30, current_date)
  AND merchant_id = 'acct_123'
```
Ask the user what time range they need if not obvious from context.

**Duplicate table scans → consolidate:**
```sql
-- Before: 2 scans of same table
WITH cte_a AS (SELECT id FROM big_table WHERE cond_a),
     cte_b AS (SELECT id FROM big_table WHERE cond_b)

-- After: 1 scan
WITH combined AS (
    SELECT id,
        bool_or(cond_a) AS is_a,
        bool_or(cond_b) AS is_b
    FROM big_table
    WHERE cond_a OR cond_b
    GROUP BY id
)
```

**Redundant aggregates → compute once, reference by alias:**
```sql
-- Before: same aggregate computed twice
SELECT
  CAST(count_if(status >= 500) AS double) AS error_count,
  CAST(count_if(status >= 500) AS double) / count(*) AS error_rt

-- After: compute once (Trino may deduplicate, but explicit is safer)
SELECT
  error_count,
  error_count / total_count AS error_rt
FROM (
  SELECT 1.0 * count_if(status >= 500) AS error_count,
         count(*) AS total_count, ...
)
```

**CTE + outer WHERE → HAVING:**
```sql
-- Before: materializes all groups then filters
WITH raw AS (SELECT x, count(*) AS cnt FROM t GROUP BY 1)
SELECT * FROM raw WHERE cnt > 10

-- After: filters during aggregation
SELECT x, count(*) AS cnt FROM t GROUP BY 1 HAVING count(*) > 10
```

**Late filtering → filter early:**
```sql
-- Before: filter after join
SELECT f.* FROM fact_table f
JOIN dim_table d ON f.id = d.id
WHERE d.status = 'active'

-- After: filter before join
WITH active_dims AS (
    SELECT id FROM dim_table WHERE status = 'active'
)
SELECT f.* FROM fact_table f
JOIN active_dims d ON f.id = d.id
```

**count(column) → count(*) when nulls don't matter:**
```sql
-- Before: null-checks every row
SELECT count(action_id) FROM events

-- After: no null check needed if column is NOT NULL or nulls are irrelevant
SELECT count(*) FROM events
```
⚠️ Flag this as a semantic change — only safe if NULL values in that column
should NOT be excluded from the count. Always warn the user.

**Exact → approximate:**
```sql
-- Before
SELECT COUNT(DISTINCT user_id) FROM events

-- After
SELECT APPROX_DISTINCT(user_id) FROM events
```

**Verbose casts → idiomatic promotion:**
```sql
-- Before: verbose
CAST(count_if(x) AS double) / CAST(count(*) AS double)

-- After: multiply by 1.0 promotes to double implicitly
1.0 * count_if(x) / count(*)
```

**UDF date functions → native Trino interval:**
```sql
-- Before: Presto compatibility alias
dateadd('day', -90, current_date)

-- After: native Trino syntax
current_date - interval '90' day
```

**Computed expressions → direct comparison:**
```sql
-- Before: prevents predicate pushdown
WHERE date_trunc('day', event_time) = date('2024-01-15')

-- After: enables pushdown
WHERE event_time >= timestamp '2024-01-15 00:00:00'
  AND event_time < timestamp '2024-01-16 00:00:00'
```

### 5. Validate the optimized query

Call `validate_sql_query` on the rewritten SQL. If validation fails, fix and
retry (max 3 attempts). Never present invalid SQL to the user.

### 6. Measure and verify cost reduction via EXPLAIN (TYPE IO)

Use `run_hubble_query` to get real I/O estimates. Run **three** EXPLAIN queries
to verify that claimed savings are real:

```sql
EXPLAIN (TYPE IO) <original_query>
```
```sql
EXPLAIN (TYPE IO) <optimized_query_safe>        -- semantic-preserving changes only
```
```sql
EXPLAIN (TYPE IO) <optimized_query_full>        -- all changes including semantic ones
```

Issue all in a **single parallel tool call**.

**Why three queries?** To verify which changes actually reduce cost:
- If safe-only == original → those changes are cosmetic (readability only)
- If full < safe-only → the cost reduction requires a semantic change (flag it)
- Only report savings that are confirmed by EXPLAIN (TYPE IO) comparison

Parse `outputSizeInBytes` from the `estimate` field for each. Compute:

```
safe_savings_pct = (original_bytes - safe_bytes) / original_bytes * 100
full_savings_pct = (original_bytes - full_bytes) / original_bytes * 100
```

**Present the verified comparison as:**

| Version | Estimated data scanned | Reduction | Semantic change? |
|---------|----------------------|-----------|------------------|
| Original | X TB | — | — |
| Safe optimizations only | Y TB | Z% | No |
| All optimizations | W TB | V% | Yes (requires approval) |

**Verification rules:**
- If safe optimizations show 0% reduction, explicitly state: "These changes
  improve readability but do not reduce cost. Trino's optimizer produces the
  same execution plan."
- If cost reduction comes ONLY from semantic changes, clearly separate them
  and require user approval before recommending.
- NEVER claim a savings percentage that is not backed by EXPLAIN (TYPE IO)
  output. If the numbers don't match your expectation, trust the numbers.
- If a change you expected to help shows 0% improvement, acknowledge it —
  Trino's optimizer may already handle it internally.

**If EXPLAIN (TYPE IO) times out or fails** (possible on very complex queries),
fall back to directional estimates but clearly label them as unverified:

| Optimization applied | Directional estimate (unverified) |
|---------------------|---------------------|
| Added partition filter (was full scan) | Likely significant — eliminates unneeded partitions |
| Consolidated N duplicate scans into 1 | Likely moderate — removes redundant table reads |
| Pushed filters before JOIN | Likely moderate — reduces join input volume |
| Replaced COUNT(DISTINCT) with APPROX_DISTINCT | Likely moderate — reduces execution time, not data scanned |
| Column pruning (removed SELECT *) | Likely minor — reduces I/O on wide columnar tables |
| CTE → HAVING | Negligible — Trino inlines CTEs, same execution plan |
| Redundant aggregate dedup | Negligible — Trino optimizer typically handles this |

### 7. Present results

Structure the response in clearly separated sections:

**Section A — "Safe changes (readability, verified 0% cost impact)":**

| # | Change | Why |
|---|--------|-----|
| 1 | Description of change | Readability/style reason |
| ... | ... | ... |

State clearly: "These changes do not reduce cost (verified via EXPLAIN TYPE IO)
but improve readability and maintainability."

**Section A2 — "Cost-reducing changes (require approval)":**

| # | Change | Verified savings | ⚠️ Semantic impact |
|---|--------|-----------------|-------------------|
| 1 | Description | X% less data scanned | What changes in behavior |
| ... | ... | ... | ... |

For each semantic change, explain exactly when it's safe and when it's not.

**Section B — "What was NOT changed":**

Explicitly list patterns in the original query that are **already correct** and
should not be altered. This builds trust and prevents the user from
"optimizing" things that are already good. Examples:
- Partition filter placement
- Boolean null-handling patterns (e.g., `coalesce(col, default)`)
- Filter ordering
- Existing index-friendly predicates

**Section C — Optimized SQL:**

The full rewritten query prefixed with `-- OPTIMIZED BY HUBERT AI`.

**Section D — Estimated savings:**

Qualitative cost/time reduction for each change applied.

If the query is already well-optimized with only minor improvements available,
say so clearly — do not oversell negligible gains.

---

## When to Activate Proactively

Even when the user does not explicitly ask for optimization, flag issues when:
- A query being generated has no partition filter on a partitioned table
- A query scans the same large table (tier1/tier2) more than once
- A query uses `SELECT *` on a table with >50 columns

In these cases, mention the optimization opportunity briefly after presenting the
query. Do not block SQL generation — append the suggestion.

---

## Constraints

- **NEVER change query semantics without explicit user approval.** Optimizations
  must produce identical results unless the user agrees to an approximation.
- **ALWAYS validate optimized SQL** via `validate_sql_query` before presenting.
- **Do not optimize trivially small queries** — if a query scans <1GB or runs in
  <5 seconds, the optimization overhead isn't worth it.
- **Partition filter additions require user confirmation** on time range if not
  obvious from context — do not assume a default range silently.
- **Maximum 3 validation retries** — if the rewrite can't be made valid, present
  the original query with a note about what you tried.
- ONLY use column names and partition info confirmed by `search_dataset_documentation`.
  NEVER guess partition columns.