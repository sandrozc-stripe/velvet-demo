# Execution and Analysis Reference

Detailed guidance for Steps 6 (Execute) and 7 (Analyze).

## Execution

Use `run_hubble_query` for new or adapted SQL that has passed both EXPLAIN steps. Use `run_hubble_query_permalink` only for saved queries that were already validated in a prior turn.

**Data usage warning rule:** After every execution, check `data_usage_warnings` before rendering anything. If non-empty, show only the warning text, ask for explicit user confirmation, and display results only after confirmation.

**Result handling:** Persist raw results immediately after execution so analysis can be re-run without re-querying Hubble.

```python
import json
with open('workspace/results.json', 'w') as f:
    json.dump(result['results'], f, default=str)
```

## Python Analysis Workflow

Use Python when the answer requires reshaping, pivoting, period comparisons (WoW/MoM), rolling averages, percentiles, or filtering already-pulled data by a different dimension. Do not re-query Hubble for data you already have.

```python
# In execute() sandbox — after run_hubble_query returns `result`:
exec(open('skills/namespace/data/ask-data/scripts/hubble_to_df.py').read())
df = hubble_to_df(result['results'])
df.to_csv('workspace/data.csv', index=False)

# Further analysis without re-querying Hubble
top_10 = df.groupby('country')['volume_usd'].sum().nlargest(10)
print(top_10.to_string())
```

To reload from a saved file on a follow-up turn:

```python
exec(open('skills/namespace/data/ask-data/scripts/hubble_to_df.py').read())
df = hubble_to_df_from_file('workspace/results.json')
```

## Key Gotchas

| Issue | Fix |
|-------|-----|
| Timestamp columns may come back as Unix epoch integers | `pd.to_datetime(df['ts_col'], unit='s')` in Python, or `date(from_unixtime(ts_col))` in SQL |
| Amount/currency columns are often stored in the smallest unit (e.g. cents) | Divide by the appropriate factor in SQL: `CAST(SUM(amount_col) AS double) / 100`; or in Python: `df['amount_col'] / 100` |
| Bare decimal literals in SQL (e.g. `0.1`, `100.0`) come back typed as `string` | `CAST(value AS double)` or `CAST(100.0 AS double)` in the SQL |
| Never use the full catalog prefix | Use `schema.table`, not `catalog.schema.table` |
| Re-slicing already-pulled data | Use Python — no Hubble round-trip needed |

## `hubble_to_df` Helper Utilities

Available after `exec(open('skills/namespace/data/ask-data/scripts/hubble_to_df.py').read())`:

| Function | Description |
|----------|--------------|
| `hubble_to_df(results)` | Load Hubble results into a typed pandas DataFrame |
| `hubble_to_df_from_file(filepath)` | Reload previously saved results from a JSON file |
| `fmt_usd(n)` | Format a number as `$12.3M`, `$456K`, etc. |
| `fmt_pct(n)` | Format as `+1.2%` |
| `fmt_count(n)` | Format as `1.2M`, `456K`, etc. |
| `add_period_comparisons(df, value_col)` | Add WoW and MoM growth columns to a daily time series |
| `add_rolling_avg(df, value_col, windows=[7, 28])` | Add rolling average columns |
| `save_results_json(results, filepath)` | Save raw results for later reuse |
