# Data Discovery Reference

Detailed guidance for Step 2: Read, Verify, and Enrich.

## Extraction Checklist

From the Deep Hubert response, extract all of the following before building the pointer plan:

- Recommended datasets, metrics, dashboards, widgets, saved queries, query links, and their intended grain and use.
- Distinct solution paths: Analytics Layer metrics, dashboards/widgets, saved queries, source tables.
- Recommended SQL blocks and their provenance.
- Pointers: widget deep links, dashboards, saved queries, query permalinks, datasets, Trailhead docs, and go/ links.
- Caveats, ambiguity, data freshness warnings, and permission information.
- **Knowledge base sources:** any KB articles, Trailhead docs, saved query examples, or team guidance that Deep Hubert cited as the basis for its recommendations. Preserve these verbatim — they are the grounding evidence for the answer.
- **Confidence score:** the confidence level Deep Hubert assigned to its recommendation (if explicitly stated), or synthesize one based on: how precisely the recommended sources match the question, whether a canonical AL metric or saved query was found vs. a raw source table, and how many corroborating KB sources were cited. Express as High / Medium / Low with a one-sentence rationale.

Preserve every Hubble artifact in an inventory, even if it will not be verified or recommended. Record its type, direct link, stated relationship to the question, Deep Hubert confidence where available, permission state, and eventual status: `Verified`, `Deep Hubert grounding — not independently verified`, or `Access-restricted`.

## Artifact Relevance and Final-Answer Selection

An artifact is relevant when it supports one or more of the user’s requested metric or business concept, entity/grain, dimensions, time window, decision, or recommended execution path. Prefer artifacts that directly answer the question over merely related domain artifacts.

Select one to five artifacts for `Recommended Hubble Artifacts`. Rank them in this order when relevance is otherwise equal:

1. A verified Analytics Layer metric that directly answers the request;
2. A directly relevant widget when it is necessary to preserve material scope, grain, filters, or a calculation the metric cannot express;
3. Its underlying saved query or query permalink when it is necessary for the same reason;
4. A directly relevant dashboard containing that widget or query;
5. A verified dataset/source table.

Do not rank a widget, saved query, or dashboard ahead of a matching verified Analytics Layer metric solely because the artifact exists or is more directly navigable. Use it as supporting evidence unless it captures material business logic, scope, grain, filters, or a calculation that the metric cannot express.

Use the most specific navigable link available. Prefer a widget deep link over its dashboard, a saved query or query permalink over a dashboard-only link, and a dashboard over a generic dataset only when the dashboard supplies material decision context.

Do not include a dashboard in Recommended Hubble Artifacts when a directly relevant widget or query is available, unless the dashboard adds material context such as adjacent comparison widgets, an important filter state, or decision framing. Every recommended item must state why it is relevant and identify material differences in definition, grain, dimension, scope, or period.

Place every artifact that was not selected for the recommended section in `Additional Grounded Artifacts`, grouped by widget, dashboard, saved query/query permalink, metric, and dataset. Do not repeat recommended artifacts. This section is a complete evidence inventory, not a second ranked recommendation list.

## Pointer Plan

Extract the strongest dataset, metric, saved-query, widget, and dashboard pointers from the extraction. Build a pointer plan before fetching:

```markdown
Pointer plan
- Primary source: <Analytics Layer metric | saved query | widget | dashboard | dataset>
- Relevant artifacts to verify: <up to four high-value pointers>
- Complete inventory: <all discovered Hubble artifacts, retained for final answer>
- Resolve: <saved queries, dashboards/widgets, datasets, Trailhead docs, Slack threads, Sourcegraph files, go/ links>
- Column discovery: <known columns to verify | run column usage for likely fields | none>
```

If discovery includes concrete pointers, make follow-up verification calls before presenting the answer. If no follow-up verification is possible, mark the answer as discovery-only and state what was not verified.

## Dataset Ranking Rule

Deep Hubert returns datasets and sources in ranked order. Always start with the top-ranked source. Do not skip a higher-ranked source because a lower-ranked one appears simpler, more familiar, or easier to query.

For access restrictions, follow the Permission Handling section below. Do not freely re-rank or substitute alternatives.

## AL vs Source-Table Ranking

Prefer a verified Analytics Layer metric as the primary recommendation and execution path when it directly answers the user’s question at the requested definition, grain, dimensions, filters, and time window. A matching metric should rank above a dashboard, widget, saved query, or raw dataset because its definition is intended to be canonical and reusable.

Saved queries and widgets remain valuable supporting evidence. Use them to confirm common filters, business context, expected breakdowns, or a material definition difference. Recommend or execute a saved query ahead of a metric only when the metric cannot express the requested calculation, scope, grain, filter semantics, or time semantics, and state that reason explicitly.

If discovery gives both an Analytics Layer path and a source-table path, present the verified Analytics Layer metric first when it matches the requested business concept and supports the requested dimensions and time fields. Rank a source-table path first only when:

- The user explicitly asked for it.
- AL cannot support the required definition or grain.
- The AL metric is not the right business definition.

Label source-table paths as alternatives by use case and state grain differences.

For every selected Analytics Layer metric, verify dashboard/widget usage via KGS before presenting it as a governed path. Search `hubble/dashboard_widget` by `referenced_al_metrics` and `hubble/saved_query` SQL for `MEASURE(<metric>)` using the exact metric identifier and confirmed aliases from `hubble_get_metric`. Exclude staging, template, hidden, test, and archive dashboards from verification. If a widget or saved query references the metric, use its SQL as supporting evidence for tables, joins, filters, grouping, and column names; do not switch away from the metric solely because that artifact exists.

## Column Discovery Exception

- Keep KGS as the default metadata layer for dashboards, widgets, saved queries, Analytics Layer metrics, ownership, docs, freshness, and other non-column-discovery context.
- If a verified widget, saved query, or AL metric exactly answers the question, use that evidence first — do not run column usage just to reconfirm it. Treat its SQL/metadata as the source of truth for tables, joins, filters, grouping, and column names.
- If the field mapping is unclear or drafting new source-table SQL rather than adapting exact verified SQL, run the column usage recipe before proceeding.
- Use KGS dataset metadata only for ownership, deprecation, docs, facets, or semantic checks on shortlisted fields. Avoid full-schema dumps unless the user asked for schema inventory and column usage is insufficient.

## Permission Handling

When the top recommendation is a high-confidence Lumen/Deep Hubert answer, source, metric, dashboard, saved query, or dataset and it returns an access or permission error:

1. Stop. Do not run or recommend a lower-fidelity fallback unless the user explicitly approves one after seeing the restriction.
2. Put the restricted high-confidence artifact first in `Recommended Hubble Artifacts` with status `Access-restricted`.
3. Preserve all evidence and every discovery-grounded Hubble link in the final answer.
4. Explain that the recommended source could not be independently verified or executed with the user’s access, and identify the access request or owner only when discovery provides one.

For a restricted candidate that is not the high-confidence top recommendation, or when the user has explicitly approved fallback behavior, use the next-ranked candidate from Deep Hubert’s original list. Do not re-rank or substitute freely. State the restricted artifact and the alternative’s material differences in the answer and Caveats.

## Minimum Enrichment Checklist

- If discovery surfaces dashboards: use KGS `hubble/dashboard` with outbound `has_widget` relationships, then inspect relevant `hubble/dashboard_widget` entities before citing the dashboard. Prefer widget links over dashboard-only links.
- If discovery surfaces widgets: inspect title, description, deep link, query provenance, referenced datasets, AL metrics, visibility, and dashboard context. Skip hidden, test, template, staging, and archive widgets when selecting recommended artifacts, but retain them in the inventory if Deep Hubert grounded them.
- If discovery surfaces saved queries: use KGS `hubble/saved_query` to read name, description, and SQL. Call `get_hubble_query_metadata` only when KGS lacks exact SQL or the latest result schema.
- If discovery surfaces datasets: follow the Column Discovery Exception above. Use KGS `data_catalog/dataset` facets only for ownership, deprecation, docs, freshness, or metric metadata.
- If discovery surfaces AL metrics: extract the exact metric identifier, verify via KGS `data_catalog/dataset` metric entities and widget `referenced_al_metrics`, then call `hubble_get_metric` to validate dimensions before `build_analytics_layer_query`. Do not shorten, normalize, or infer a different identifier.
- If discovery surfaces Trailhead docs or likely team spaces: use `get_trailhead_spaces_by_team` to resolve the space slug, then read targeted docs from `docs_in_space` by label and description.
- If enrichment cannot be completed, state what was not verified and do not present that source as canonical.

## KGS Guidance

Use KGS as the default metadata layer for dashboards, widgets, saved queries, and dataset context. Prefer KGS entity lookups over direct Hubble helper tools wherever KGS has the data.
