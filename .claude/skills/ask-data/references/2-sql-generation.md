# SQL Generation Reference

Detailed guidance for Steps 4 (Generate SQL) and 5 (Validate).

## Generate SQL

Use fully qualified table names such as `core.fq_table_name`. Verify column names via `hubble_get_dataset`, saved query or widget SQL, Analytics Layer metadata, or supplied source context; never guess.

Default time range only when the user does not specify one:

- Monthly or weekly granularity: last 12 months.
- Daily or finer granularity: last 1 month.

Choose the SQL source in priority order:

1. Saved query or widget: reuse its verified SQL exactly when it answers the question.
2. Analytics Layer metric: use `hubble_get_metric` to verify dimensions, then use `hubble_analytics_layer_query`.
3. Source-table SQL: write from scratch only when saved query/widget and Analytics Layer paths do not apply. Ground all columns and partition keys in verified `hubble_get_dataset` schema.

## Column Discovery

Do not dump full schemas by default. If a verified widget, saved query, query example, Analytics Layer metric, or Lumen SQL pattern exactly answers the question, use that evidence first. Treat its SQL/metadata as source of truth for tables, joins, filters, grouping, and column names.

If field mapping is unclear while drafting source-table SQL, run a focused column-usage query before writing the final query:

```sql
SELECT
  column_name,
  COUNT(*) AS queried_count
FROM iceberg.data_quality.presto_column_usage_prod
CROSS JOIN UNNEST(columns_read) AS t(column_name)
WHERE hour BETWEEN format_datetime(current_date - INTERVAL '7' DAY, 'YYYYMMdd00')
    AND format_datetime(current_date - INTERVAL '1' DAY, 'YYYYMMdd23')
  AND table_name = '<schema.table>'
GROUP BY 1
ORDER BY queried_count DESC, column_name
LIMIT 100
```

Use `hubble_get_dataset` metadata for ownership, deprecation, docs, freshness, facets, metric context, and semantic checks on shortlisted fields. Avoid broad field search unless the user asks for schema inventory.

## General SQL Rules

- Prefix with `-- SUGGESTED BY ASK DATA AI`.
- Use 2-space indent and wrap at 120 characters.
- Always use `AS` for aliases.
- Use `current_date` and `current_timestamp`.
- Use `GROUP BY 1, 2` numeric positions.
- Use safe division: `CAST(x AS DECIMAL(18,2)) / y`.
- Do not use `INTERVAL 'x' WEEK`; use `INTERVAL 'x' DAY * 7`.
- Do not use `ILIKE`; use `LOWER(col) LIKE LOWER(pattern)`.
- Use `CROSS JOIN UNNEST(...)` for unnesting.
- Use `CAST(x AS VARCHAR)`, not `TO_CHAR()`.
- Use `TRY_CAST()` when casting may fail.
- Prefer `APPROX_DISTINCT(x)` over `COUNT(DISTINCT x)` for large data.
- Add a `WHERE` predicate on partition columns when the dataset has any.
- Monetary amounts are usually in cents; divide by 100 for dollars when verified.
- Use `schema.table` format; never the full three-part `catalog.schema.table` prefix.

## Analytics Layer SQL

```sql
SELECT <dim1>, [<dim2>, ...], MEASURE(<view.metric>) AS <alias>
FROM analytics_layer
[WHERE ...]
[ORDER BY ...]
GROUP BY 1, [2, ...]
```

`FROM analytics_layer` is always required. Analytics Layer SQL cannot `JOIN` directly; wrap it in a CTE. `MEASURE()` handles aggregation, so never wrap it in `SUM` or `COUNT`. Always reference measures with the fully qualified metric name anywhere they appear, including `MEASURE(<view.metric>)`, `ORDER BY`, and `WHERE`.

Dimensions must exist in the metric schema. Call `hubble_get_metric` to discover valid dimensions and measures before writing the query, then use `hubble_analytics_layer_query` to construct final SQL.

## Decimal Literals

Do not use bare decimal literals like `5.4`, `0.1`, or `100.0` when the result column should remain numeric. They may come back typed as `string` in Hubble results. Cast them explicitly:

- `CAST(5.4 AS double)`
- `amount * CAST(0.1 AS double)`
- `CAST(SUM(amount_col) AS double) / 100`

## Validate SQL

Validation is mandatory for every new or adapted SQL query. Use `run_hubble_query` for validation by submitting both non-result-producing checks, each prefixed with the high-priority session override:

```sql
SET SESSION tier=high_priority;
EXPLAIN (TYPE VALIDATE) <generated_sql>
```

```sql
SET SESSION tier=high_priority;
EXPLAIN <generated_sql>
```

Pass the validation SQL in the `query` argument. These EXPLAIN queries do not return result rows from the underlying analytical query; they check syntax, semantics, permissions, and resource-plan context.

### Interpreting EXPLAIN output

A successful `EXPLAIN` commonly returns a resource plan, including estimates such as `memory scanned`, peak memory, bytes scanned, input rows, or cost. Treat these estimates as informational context, not validation gates. Do not mark a query invalid, unsafe, or not ready to run solely because of `memory scanned` or another resource-plan estimate, and do not require any particular threshold or value for those fields.

Treat both validation checks as passed when they complete without a SQL syntax, semantic, permission, or execution-planning error. Surface resource-plan information only as a caveat when the plan itself contains an explicit error, a documented hard limit, or a clear indication that execution cannot be planned. Do not turn normal EXPLAIN plan output into a blocker.

On failure:

- SQL errors: fix and retry, max 3 attempts.
- Permission errors: report the permission error as-is and do not retry the same query or dataset. If the user did not explicitly require that exact dataset, use an accessible alternative from the supplied source recommendations or ask for another source.
- Timeout: stop. Do not retry. Return the generated SQL and explain that validation timed out.

Never speculate about errors; report verbatim. Skip validation only when reusing saved query or widget SQL that is already known to be validated.

## Value Probes

Use value probes only when sample values are needed to resolve a concrete ambiguity after schemas, docs, and examples are insufficient. Keep probes separate from the final query; validation is mandatory for both probe SQL and final SQL, but value probing is optional and targeted. Validate probe SQL with `run_hubble_query` EXPLAIN checks first. If a probe must be executed, use the data-analysis execution workflow so data usage warnings are handled before showing returned values.

Include a selective predicate, preferably on partition columns, and keep time windows tiny: one partition day by default, or one hour for timestamp-level predicates. Never sample across multiple months or broad historical ranges. Keep `LIMIT` small. Do not wrap the full generated query just to sample values.

## Execution Package

Return the validated SQL, both `run_hubble_query` EXPLAIN validation outcomes, the required `SET SESSION tier=high_priority;` execution prefix, and any resource-plan caveats. If validation failed or timed out, mark the SQL as not safe to execute and include the verbatim error or timeout note.
