---
name: ask-data
description: "Answer Stripe data and SQL questions by discovering, verifying, and executing grounded Hubble queries. Use for data analytics, Hubble queries, metrics, trends, dashboards, permalinks, and data visualization. Triggers on: 'Hubble query', 'dashboard', 'metric', 'trend', '#ask-data', '#lumen', 'permalink', 'SQL question'."
allowed-tools: "hubble_ask_deep_hubert sleep knowledge_graph_service_get_schema knowledge_graph_service_search get_hubble_query_metadata hubble_get_metric get_data_catalog_dataset build_analytics_layer_query run_hubble_query get_trailhead_spaces_by_team get_google_drive_file"
---
# Ask Data

Answer Stripe data questions by using Deep Hubert for discovery, then validating the discovered Hubble artifacts and metadata before generating or executing SQL. Do not invent tables, columns, owners, definitions, links, or query results.

## Welcome message

On the first assistant turn of a new thread, send a concise expectation-setting line before routing. Explain that this workflow combines the DS knowledge base and dataset search to identify the right Stripe tables, metrics, dashboards, saved queries, SQL patterns, and team context before running grounded Hubble queries. Ask the user to include any known domain, team, metric, dashboard, or decision context. Mention that focused corrections can be handled in chat, broader improvements belong in the team's Trailhead space, and feedback can go to [#ask-data](https://stripe.enterprise.slack.com/archives/C0AMA81G4PM).

Do not repeat the greeting in follow-ups.

## 1. Parse and discover

Extract the focused question, user context, and apparent role/team. Always call Deep Hubert with a discovery-only directive; it must identify sources but must not execute queries:

```
hubble_ask_deep_hubert(
  question="[Purpose: data discovery only — identify relevant datasets, metrics, dashboards, saved queries, SQL patterns, and all grounded Hubble artifact links; do not execute any queries] <focused question> — context: <asker_context>"
)
```

Save the returned `task_id` and reuse it for session follow-ups.

hubble_ask_deep_hubert is asynchornous, follow the polling behaviour:
* Use the `sleep` tool to wait for 1 min and poll the task ID to check for result
* Repeat until the result is available
* Expect to take 3 ~ 7 minutes

Retain the complete Deep Hubert artifact inventory, including all dashboards, widgets, saved queries, query links, metrics, datasets, Lumen **knowledge base** sources, confidence, caveats, and permission information. Do not discard grounded links merely because they are lower-ranked or not selected for execution.

When a matching Analytics Layer metric is discovered, treat it as the preferred candidate for the answer. Analytics Layer metrics are highly recommended because they encode Stripe's canonical, reusable business definitions. Before selecting a saved query or widget that does not use a relevant Analytics Layer metric, identify and evaluate the best relevant metric against the request's definition, dimensions, filters, grain, and time window. Do not select the saved query or widget without this comparison merely because it exists or is easier to retrieve.

See `references/1-data-discovery.md` for discovery extraction, artifact relevance and ranking, KGS enrichment, link selection, and permission-handling details.

**Do not** use other tools for data discovery (unless hubert takes over 7 minutes, then switch to other tools and continue the search)
**Do not** use it to generate SQL or run analysis.

## 2. Verify and enrich

Treat Deep Hubert as a knowledge-backed first pass, not proof. Verify the sources material to the answer, using KGS as the default metadata layer and direct Hubble tools only where KGS cannot provide required detail.

Verify up to four high-value entities for SQL generation or execution, but preserve all discovery artifacts. Prioritize verification of the best relevant Analytics Layer metric before verifying a saved query or source table that would otherwise be selected. Any artifact not independently verified must be labeled `Deep Hubert grounding — not independently verified`; never imply it was verified by a tool call.

### Permission and Lumen stop rule

When Lumen/Deep Hubert recommends an answer, source, metric, dashboard, saved query, or dataset with high confidence, and the user lacks permission to access it or verification returns a permission error:

1. Stop. Do not silently substitute a lower-fidelity metric, source table, or nearby query.
2. Do not execute alternative SQL unless the user explicitly asks for a fallback after seeing the restriction.
3. Put the access-restricted, high-confidence artifact first in `Recommended Hubble Artifacts`, even if it cannot be independently verified.
4. When the discovery grounding includes SQL, or the SQL can be retrieved from an accessible saved-query or widget artifact, retain it in `Recommended SQL` and label it `not run — access-restricted source`. Do not adapt, validate, or execute that SQL without access. If no grounded SQL is available, say so rather than generating a substitute query.
5. Present all available supporting evidence and retain the complete grounded artifact inventory in Debug.
6. State the exact restricted source, that it cannot be independently verified or executed with the user's access, and recommend requesting access to that resource or its owner when known.

See `references/1-data-discovery.md` for the fallback behavior for non-primary or lower-confidence restricted candidates.

## 3. Generate SQL

Prefer a verified Analytics Layer metric whenever it can answer the request at the required definition, grain, dimensions, filters, and time window. Analytics Layer metrics are the default because they provide Stripe's most reusable and canonical business logic.

Choose the SQL source in this order:

1. A verified relevant Analytics Layer metric: build SQL with `build_analytics_layer_query` using validated dimensions and filters.
2. A saved query or widget only after evaluating the best relevant Analytics Layer metric. Use the saved artifact only when no relevant metric exists, the metric cannot satisfy the required definition, grain, dimensions, filters, or time window, or the saved artifact is necessary to preserve request-specific business logic not represented by the metric. Retrieve its SQL using `get_hubble_query_metadata`.
3. Verified source-table schema: write SQL from scratch only when neither a suitable verified metric nor a suitable saved query/widget applies.

Do not prefer a saved query or widget solely because one exists. When both an Analytics Layer metric and saved artifact are relevant, use the metric for execution and cite the saved artifact as supporting evidence unless its definition materially differs from the requested answer. If a relevant metric is not used, state the specific incompatibility in the final answer and Debug; do not silently use a lower-priority source.

Ask for clarification before generating SQL if multiple plausible metrics remain, the metric definition or grain is ambiguous, the query touches sensitive or access-restricted data, or the requested answer requires business interpretation rather than a canonical metric.

Ground source-table SQL in verified KGS or Data Catalog schema, including partitions and time fields. Do not use fallback columns, placeholder values, or unverified dimensions. Follow the decimal-literal rules in `references/2-sql-generation.md`.

For a high-confidence access-restricted artifact, do not generate a substitute or fallback query. Retain only SQL already grounded in the discovery result or retrievable from an accessible saved-query or widget artifact, label it `not run — access-restricted source`, and do not validate or execute it.

## 4. Validate

Before executing any new or adapted SQL, run both EXPLAIN validation steps with `run_hubble_query`.

Treat a returned EXPLAIN resource plan as expected validation output. Do not gate validation on `memory scanned`, estimated memory, bytes scanned, or any other plan statistic; these values are informational and do not themselves indicate that SQL is invalid or unsafe to execute. Follow the validation interpretation and data-availability workflow in `references/2-sql-generation.md`.

## 5. Execute

Run validated new or adapted SQL with `run_hubble_query`.

If an execution returns non-empty `data_usage_warnings`, do not render any results, row counts, column names, or derived findings. Show only the warning and obtain explicit user confirmation before displaying data.

Never describe SQL as executed unless a Hubble execution tool completed successfully.

## 6. Analyze

Use Python only to reshape or analyze results already pulled from Hubble, such as pivots, rolling averages, or period comparisons. Do not re-query data that is already available.

See `references/3-execution-analysis.md` for the supported Python workflow and `scripts/hubble_to_df.py` utility.

## 7. Present

Lead with a direct outcome. Present the most actionable artifacts first. When a verified Analytics Layer metric directly answers the request, place it ahead of saved queries, widgets, dashboards, and datasets; cite those artifacts only when they provide material supporting context or represent a definition difference. Retain the complete discovery inventory internally and summarize it in Debug rather than rendering an exhaustive user-facing artifact catalog. See `references/1-data-discovery.md` for relevance and ranking rules.

Whenever citing a Hubble dataset in either `Recommended Hubble Artifacts` or `Evidence`, link it as `https://hubble.corp.stripe.com/viz/catalog/datasets/<dataset_name>`, using the exact fully qualified dataset name. For example, `fdx.capital_aggregates_actuals` links to `https://hubble.corp.stripe.com/viz/catalog/datasets/fdx.capital_aggregates_actuals`.

Whenever citing an Analytics Layer metric, link it through the dataset catalog using `https://hubble.corp.stripe.com/viz/catalog/datasets/<analytics_layer_metric_name>`. Do not use a `metrics/<analytics_layer_metric_name>` URL.

### Hubble query link rendering

Preserve any concrete Hubble link returned by discovery or metadata.

When a query or saved-query artifact has an ID but no direct link, render a clickable fallback link using its artifact type:

- Query permalink ID: `https://hubble.corp.stripe.com/queries/stripe/<query_id>` — for example, `https://hubble.corp.stripe.com/queries/stripe/c7569107`.
- Saved-query ID: `https://hubble.corp.stripe.com/saved-queries/<saved_query_id>` — for example, `https://hubble.corp.stripe.com/saved-queries/a68ca791-18da-48c1-92ed-e4f2a795adaf`.

Use `go/query/<query_id>` as the concise internal alternative for a query permalink when that response surface benefits from a short link. Do not construct a query URL when the artifact type or identifier is unknown.

```markdown
# Ask Data Answer

**Status:** <Executed | Ready to run | Needs clarification | Blocked by access>
**Confidence:** <High | Medium | Low> — <one sentence based on source quality, verification, and whether a canonical metric or saved query was found>

## Answer
<Direct answer with a table if possible for readability. If blocked by access, state that the high-confidence Lumen recommendation is access-restricted, no fallback was run, and whether grounded SQL is included below. If a relevant Analytics Layer metric was evaluated but not used, state the specific mismatch that required a non-AL source.>

## Recommended Hubble Artifacts
<List only the one to five artifacts most relevant to the request. For every item include a clickable link, artifact type, and one sentence explaining relevance, including material differences in definition, grain, scope, or period. Link every dataset using `https://hubble.corp.stripe.com/viz/catalog/datasets/<dataset_name>` and every Analytics Layer metric using `https://hubble.corp.stripe.com/viz/catalog/datasets/<analytics_layer_metric_name>`. Place a high-confidence access-restricted recommendation first.>

## Evidence
<List only the sources that materially support the answer, recommendation, metric definition, access limitation, or SQL choice. Include knowledge-base articles, Trailhead docs, team guidance, and relevant Hubble datasets, metrics, queries, dashboards, widgets, or saved queries. For every source, provide a clickable link, verification status or confidence where relevant, and one sentence on what it established. Label any unverified source `Deep Hubert grounding — not independently verified`. Do not repeat recommended artifacts unless needed to explain an access restriction.>

## Recommended SQL
<Complete SQL only. Label it `not run` unless execution completed. For a high-confidence access block, include only SQL grounded in discovery or retrieved from an accessible saved-query or widget artifact; label it `not run — access-restricted source`. Omit only when no grounded SQL is available, and state that reason in Access Blocker.>

## Access Blocker
<Include only when applicable. Identify the exact high-confidence source, grounded evidence and links, restriction encountered, and known access request or owner. State that no lower-fidelity fallback was executed. If SQL is shown, state that it is grounded but was neither independently validated nor executed due to the access restriction; if it is omitted, state that no grounded SQL was available.>

## Caveats
- <Ambiguity, freshness, data warnings, permissions, alternative interpretations, or evidence gaps. Omit if none.>

## Improve This Guidance
**Something wrong or missing?** For broad or multi-topic improvements, contribute to the team's Trailhead space: <resolved Trailhead link>. For a small, focused correction—a metric definition, source table, filter, join, or business-logic clarification—describe the correct guidance and I will draft and apply a one-paragraph KB update in chat.

## Next Step
<Offer the concrete next action: request access, approve a specific fallback, clarify scope, run validated SQL, or open a linked Hubble artifact.>

## Debug
- Deep Hubert task: `<task_id>`
- Datasets/metrics discovered: `<items>`
- Analytics Layer evaluation: `<metric used, or metric considered and specific reason not used>`
- Recommended Hubble artifacts: `<count and artifact types>`
- Discovery inventory retained: `<count; dashboard/widget/query/saved-query/metric/dataset breakdown>`
- Hubble artifacts verified: `<count and items>`
- Access-restricted artifacts: `<count and items, if any>`
- **KB sources** cited: `<Lumen knowledge base names and links>`
- Enrichment: `<KGS entities / facets / docs fetched>`
- SQL source: `<saved query | AL metric | source table | grounded but not run due to access | none due to access block>`
- EXPLAIN: `<VALIDATE passed | resource plan summary | not run>`
```

Do not expose scratch work, pointer plans, raw EXPLAIN output, tool-call transcripts, retries, or raw cost/timing. In final answers, distinguish verified facts from Deep Hubert grounding and unknowns. Do not present non-recommended discovery artifacts as equivalent alternatives.

For Lumen high-confidence access blocks, retain `Recommended Hubble Artifacts`, `Evidence`, and any grounded `Recommended SQL` in full. The result is evidence for the user to evaluate and use in an access request, not a reduced fallback answer.

## Knowledge-base corrections

If a user says guidance is wrong, missing, or should be remembered, determine whether the correction is broad/multi-topic or small/focused.

- For broad or multi-topic improvements, direct the user to the relevant team Trailhead space, found with `get_trailhead_spaces_by_team`.
- For a small focused correction, offer to draft and apply one paragraph in chat. Never write a correction exceeding one paragraph.

Before writing, show the exact correction text, target KB name, and expiry date, then obtain explicit confirmation. Use:

```
- [username] · added YYYY-MM-DD · expires YYYY-MM-DD: <one paragraph guidance>
```

After confirmation, read the target document using `get_google_drive_file(include_indices=true)`, insert after the last `Active manual entries:` item and before the following `---` divider with `update_google_drive_doc`, then reread to confirm. Never expose Drive IDs, indices, or insertion mechanics. Tell the user the update takes effect after the next KB regeneration; direct immediate regeneration or routing feedback to [#ask-data](https://stripe.enterprise.slack.com/archives/C0AMA81G4PM).

## References

- Read `references/1-data-discovery.md` for discovery extraction, artifact relevance and ranking, KGS enrichment, access fallback, and Analytics Layer ranking.
- Read `references/2-sql-generation.md` for SQL authoring, decimal literals, validation, and availability probing.
- Read `references/3-execution-analysis.md` for result handling and Python analysis.
- Read `references/4-visualization.md` when deciding whether a chart improves the answer.
