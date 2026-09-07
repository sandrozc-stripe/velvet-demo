---
name: sa-note-weekly
description: Batch-update SA notes for a list of Salesforce opportunity IDs. Fetches opportunity details and existing SA notes from Hubble, researches recent activity across Gmail/Slack/Drive for each deal in parallel via a Workflow, and produces a consolidated weekly update file. Use when the user provides opportunity IDs and wants weekly SA notes, says "weekly update", "batch SA notes", "update these opportunities", or pastes a list of opp IDs for note generation.
---

# SA Weekly Batch Update

You fetch opportunity details and existing SA notes from Hubble, research recent activity for each deal in parallel, and produce updated SA notes in a consolidated file.

## Inputs

The user provides:
- **Opportunity IDs** — a list of Salesforce opportunity IDs (format: `006...`)
- Optionally, a custom lookback period (defaults to past 7 days)

## Step 1: Fetch Opportunity Data from Hubble

Run this SQL query using `initiate_hubble_query_and_glimpse`:

```sql
SELECT
  o.opportunity_id,
  o.opportunity_name,
  o.account_name,
  o.opportunity_stage,
  coalesce(p.sa_notes, p.sa_notes_history) as sa_notes
FROM communia_sales.agg_sales_opportunities_v3_fast o
LEFT JOIN communia_sales.rpt_opportunity_deal_history_proserv_v3 p
  ON p.opportunity_id = o.opportunity_id AND p.is_current
WHERE o.is_current
  AND o.is_st_reportable
  AND o.split_type LIKE 'Revenue'
  AND o.ds_reporting = (SELECT MAX(ds_reporting) FROM communia_sales.agg_sales_opportunities_v3_fast)
  AND o.opportunity_id IN ('<id1>', '<id2>', ...)
GROUP BY 1, 2, 3, 4, 5
```

Replace the `IN (...)` clause with the user's provided IDs, each single-quoted and comma-separated.

If the glimpse result is truncated, use `run_hubble_query` with the query ID to fetch all rows.

Parse results into a list: `[{opportunity_id, opportunity_name, account_name, opportunity_stage, sa_notes}]`

## Step 2: Research Recent Activity (Parallel via Workflow)

Use a **Workflow** to process all opportunities in parallel. Each agent independently researches one deal.

Author this workflow inline:

```javascript
export const meta = {
  name: 'sa-weekly-research',
  description: 'Research and update SA notes for multiple deals in parallel',
  phases: [
    { title: 'Research', detail: 'Search Gmail, Slack, Drive, Gong (with transcripts via escalation ladder) for each deal' },
    { title: 'Write Notes', detail: 'Generate updated SA notes per deal' }
  ]
}

const deals = args // array of {opportunity_id, opportunity_name, account_name, opportunity_stage, sa_notes}

const results = await pipeline(
  deals,
  (deal) => agent(
    `Research recent activity for "${deal.account_name}" (opportunity: "${deal.opportunity_name}").

Search these sources for activity in the past 7 days:
1. search_gmail — search for "${deal.account_name}"
2. search_google_drive — search for "${deal.account_name}"
3. search_slack_messages — search for "${deal.account_name}"
4. execute_internal_search — search for "${deal.account_name}"

**Gong call research (follow gong-librarian escalation ladder):**
5. conversational_intelligence_get_opportunity_conversations — use opportunity_id "${deal.opportunity_id}" with include_transcripts=true.
   - Do NOT pass weeks_back (it is broken). Rely on the default 26-week window.
   - If this returns 0 results, escalate to L2:
6. conversational_intelligence_get_account_conversations — resolve the account_id from the opportunity record (query restricted_sfdc_pii.opportunity_pii: SELECT accountid WHERE id = '${deal.opportunity_id}') and call with include_transcripts=true.
   - If L2 also returns 0, escalate to L3:
7. conversational_intelligence_list_conversations_for_stripe — omit stripe_user to get the running user's calls. Filter results client-side for calls where title or summary mentions "${deal.account_name}" (case-insensitive).

For Gong results: parse from large_tool_results/ if needed (results are often saved there). Filter to calls from the past 7 days by checking start_time. Extract key discussion points, decisions, next steps, customer questions, and blockers from the transcript or summary.

IMPORTANT Gong rules:
- Use stripe_user (NOT stripe_user_name) for L3
- Do NOT pass weeks_back to any CI tool
- Do NOT score or evaluate call quality

Return a structured summary of findings:
- Technical discussions (questions asked, answers given, architecture decisions)
- Commercial updates (pricing, contracts, forecasts, timelines)
- Blockers (raised or resolved)
- Meeting notes or action items
- Gong call highlights (key topics discussed, decisions made, customer sentiment, verbatim quotes if transcripts available)
- New stakeholders

If a search returns nothing useful, skip it. If ALL searches return nothing, say "No new activity found."`,
    { label: `research:${deal.account_name}`, phase: 'Research' }
  ),
  (research, deal) => agent(
    `Write an updated SA note for ${deal.account_name}.

EXISTING SA NOTE (baseline — do not repeat what's already here):
${deal.sa_notes || '(No previous note exists — write fresh)'}

RESEARCH FINDINGS FROM THIS WEEK:
${research}

SFDC OPPORTUNITY STAGE (AE-managed pipeline field — do NOT open the note with this): ${deal.opportunity_stage}

INSTRUCTIONS:
- Write a single paragraph, 3-5 sentences max. Sandro's notes are terse — just enough for someone to pick up the thread, not a recap for someone unfamiliar with the deal.
- Open with an SA technical status label, NOT the SFDC opportunity stage above. Valid labels: "Tech Win", "Path to Tech Win", "Reason For Concern", "Won", "Lost", "SA Not Needed", "Technical Validation". Determine this from the leading phrase of the existing SA note if one exists (carry it forward by default) — only change it if the research clearly shows technical progress or a new blocker. If no existing note, infer conservatively from the findings; never invent a more advanced status than the evidence supports (no status inflation).
- Write in first person ("I pushed back", "I recommended"). Never refer to Sandro in the third person.
- Only include genuinely NEW information not already in the existing note
- If no new activity was found, respond with exactly: "NO_CHANGE"
- Name the customer/account once for context, but refer to their stakeholders generically ("the prospect", "their team") rather than by full name — use a first name only if a specific person's input matters for the next step. Do the same for internal Stripe colleagues: first names only, no titles.
- Cut filler: no company/product descriptions, deal-size recaps, pricing quotes, commercial incentives (credits, ONR, close dates) unless directly technically relevant to a blocker or decision.
- Do NOT use " — " (em dash) between stage and body
- End with "Next Steps: 1) [action]" — one or two items max, concise, no elaboration of what's obvious
- Be specific about the actual technical finding — name Stripe products, APIs, features, or architecture decisions discussed
- Don't hallucinate numbers, names, or dates — if a figure or attribution isn't explicitly confirmed in the research, omit it rather than guess
- Match the tone of the existing note

Return ONLY the SA note paragraph (or "NO_CHANGE"). No headers, no explanation.`,
    { label: `write:${deal.account_name}`, phase: 'Write Notes' }
  )
)

return deals.map((deal, i) => ({
  ...deal,
  updated_note: results[i],
  status: results[i] === 'NO_CHANGE' ? 'No new activity' : 'Updated'
}))
```

Pass the deals array (from Step 1) as `args` to the workflow.

## Step 3: Assemble Output

After the workflow completes, build the consolidated markdown file.

For deals where the note is "NO_CHANGE", carry forward the existing SA note and mark status as "No new activity".

### Output file format:

```markdown
# SA Weekly Update — <YYYY-MM-DD>

| Account | Stage | Status |
|---------|-------|--------|
| <account_name> | <opportunity_stage> | <Updated / No new activity> |
| ... | ... | ... |

---

## <Account Name>
**Opportunity:** <opportunity_name>
**Stage:** <opportunity_stage>

<SA note paragraph>

---
```

## Step 4: Save Files

1. **Consolidated file:** `sa-notes/weekly-update-<YYYY-MM-DD>.md`
2. **Individual files:** One folder per opportunity, with date-prefixed filenames:
   - Path: `sa-notes/<account-name-lowercase-dashes>/<YYYY-MM-DD>-<account-name-lowercase-dashes>.md`
   - Example: `sa-notes/acme-corp/2026-06-26-acme-corp.md`
   - Create the per-opportunity folder if it doesn't exist
   - Save for each deal that was updated (skip "No new activity" deals)

Create directories as needed.

Tell the user:
- Where the consolidated file was saved
- How many notes were updated vs. unchanged
- A brief summary table

## Error Handling

- **Hubble query fails:** Report the error, suggest checking opportunity IDs
- **Hubble returns 0 rows:** Tell the user none of the IDs matched current opportunities
- **One deal's research fails:** Continue with remaining deals, note the failure in output
- **All searches empty for a deal:** Mark as "No new activity", carry forward previous note

## Formatting Rules Reference

These match the `sa-update` skill for consistency:
- Open with an SA technical status label (Tech Win / Path to Tech Win / Reason For Concern / Won / Lost / SA Not Needed / Technical Validation) — NOT the SFDC opportunity stage. Carry forward the prior note's status unless the research clearly supports a change; never inflate status on aspirational next steps.
- First person voice ("I recommended", "I pushed back"); never third-person Sandro.
- No em dash separator between stage and body
- Terse: 3-5 sentences, no company/deal recaps, no pricing/credits/ONR/close-date filler
- Customer stakeholders referred to generically ("the prospect") unless naming one matters; first names only for anyone named, internal or external
- End with concrete "Next Steps:" action items — 1-2 max
- Be specific about Stripe products/APIs/features and the actual technical finding or blocker
- Never invent numbers, names, or dates not explicitly in the research
- Match tone of existing note where one exists

Note: the `**Stage:**` field in the per-deal header and the summary table still use the SFDC `opportunity_stage` — that's the AE-managed pipeline stage and is a separate concept from the SA status label that opens the note body.
