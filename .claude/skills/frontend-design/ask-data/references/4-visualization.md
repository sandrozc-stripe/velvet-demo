# Visualization Reference

Guidance for the visualization decision in Step 8 (Present).

Create the chart before writing the text answer so the two can be presented together cohesively.

## When to Visualize

- The user explicitly asks for a chart, graph, or visualization
- The data shows a trend over time (line chart)
- You are comparing values across categories (bar chart)
- You are surfacing a single key metric (KPI tile)
- A table would have more than ~10 rows and visual scanning would help

## When to Skip

- The answer is a single scalar value or short list
- The user asked for raw numbers or a table specifically

## Chart Options

| Use case | Skill |
|----------|-------|
| Standard charts (line, bar, KPI, table) backed by a Hubble query | `create-hubble-widget` |
| Advanced visualizations (heatmaps, box plots, layered compositions, non-standard chart types) | `vega-lite-charts` |
| Publishing a local widget to Hubble | `publish-hubble-widget` |
| Adding a published widget to a dashboard | `hubble-dashboard` |

## Workflow

1. Complete the Python analysis and save results to `workspace/data.csv`
2. For standard charts: invoke the `create-hubble-widget` skill
3. For advanced charts: invoke the `vega-lite-charts` skill — it generates a `.vl.json` spec from the CSV
4. Embed or link the chart at the top of the Answer section
5. To publish and share: invoke `publish-hubble-widget`, then optionally `hubble-dashboard` to add it to a dashboard
