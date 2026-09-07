---
name: sa-meeting-augment
description: Augment and improve meeting notes for a list of deals. Searches Google Drive for "{deal name} - Meeting Note" docs, pulls context from Gong, Gmail, Slack, then updates the latest meeting section with concise enriched notes and refreshes the Top of Mind section. Use when the user provides deal names and wants meeting notes improved, says "augment notes", "improve meeting notes", "enrich my notes", or provides a list of deal names for note augmentation.
---

# SA Meeting Notes Augment

You find meeting note documents by deal name, research context from Gong/Gmail/Slack, then update the Google Doc directly with enriched notes for the latest meeting.

## Inputs

The user provides:
- **Deal names** — a list of deal/account names (e.g. "Keyban", "Acme Corp")
- Optionally, a custom lookback period (defaults to past 14 days)

## Step 1: Find Meeting Note Documents

For each deal name, search Google Drive:
- Query: `"{deal name} - Meeting Note"` or `"{deal name} meeting note"`
- Filter: `mimeType = 'application/vnd.google-apps.document'`

Use `search_google_drive` for each deal. Pick the result whose title matches the pattern "{deal name} - Meeting Note".

If no document is found for a deal, report it and skip.

## Step 2: Read Each Document

For each found document:
1. Read the full content with `get_google_drive_file` (include_indices: true) to get character positions
2. Identify:
   - The **latest meeting section** (the first meeting entry after "Top of Mind")
   - The **Top of Mind** section
   - The **Business Overview** section (for context, do not modify)
   - Any **previous meeting sections** (for deduplication, do not repeat their content)

## Step 3: Research Context (Parallel via Workflow)

Use a **Workflow** to process all deals in parallel. Each agent researches one deal.

```javascript
export const meta = {
  name: 'sa-meeting-augment',
  description: 'Research context and augment meeting notes for multiple deals',
  phases: [
    { title: 'Research', detail: 'Search Gmail, Slack, Gong (with transcripts via escalation ladder) for each deal' },
    { title: 'Augment', detail: 'Write enriched notes per deal' }
  ]
}

const deals = args // array of {deal_name, doc_id, latest_meeting_date, latest_meeting_notes, business_overview, previous_meetings_content, top_of_mind}

const results = await pipeline(
  deals,
  (deal) => agent(
    `Research recent context for "${deal.deal_name}" to augment meeting notes from ${deal.latest_meeting_date}.

Search these sources:
1. search_gmail — search for "${deal.deal_name}" in the past 14 days
2. search_slack_messages — search for "${deal.deal_name}" in the past 30 days

**Gong call research (follow gong-librarian escalation ladder with transcripts):**
3. First, resolve the deal name to an SFDC account ID:
   - Query restricted_sfdc_pii.opportunity_pii via run_hubble_query: SELECT DISTINCT accountid, account_name FROM restricted_sfdc_pii.opportunity_pii WHERE LOWER(account_name) LIKE LOWER('%${deal.deal_name}%') LIMIT 5
   - Also get the opportunity ID if available: SELECT id as opportunity_id, accountid FROM restricted_sfdc_pii.opportunity_pii WHERE LOWER(account_name) LIKE LOWER('%${deal.deal_name}%') ORDER BY last_activity_date DESC LIMIT 1
4. If you got an opportunity_id, start with L1:
   - conversational_intelligence_get_opportunity_conversations with the opportunity_id, include_transcripts=true
5. If L1 returns 0 (or you only have account_id), use L2:
   - conversational_intelligence_get_account_conversations with the account_id, include_transcripts=true
6. If L2 also returns 0, use L3:
   - conversational_intelligence_list_conversations_for_stripe (omit stripe_user for running user's calls), then filter results client-side for calls where title or summary mentions "${deal.deal_name}" (case-insensitive)

IMPORTANT Gong rules:
- Do NOT pass weeks_back to any CI tool (it is broken — causes type validation error)
- Use stripe_user (NOT stripe_user_name) if you need to query another user's calls
- Parse results from large_tool_results/ if the response is saved there
- Do NOT score or evaluate call quality
- Filter results to the past 14 days by checking start_time client-side

IMPORTANT: Pay close attention to the DATE of each piece of information. Reconstruct the chronological timeline of the engagement — what was said when, what was promised, what constraints or limitations were communicated, and what remains unresolved. This timeline is critical for understanding the current state of the deal.

For Gong calls: since transcripts are included, extract VERBATIM quotes for key decisions, limitations communicated, and commitments made. Also extract: key discussion points, decisions made, next steps mentioned, blockers raised.
For emails, extract: action items, technical questions, follow-ups, and any caveats or limitations communicated to the customer (e.g. features not yet available, timelines for future support, workarounds not recommended).
For Slack, extract: deal alerts, URR/risk issues, internal team comments, account context.

Return a structured summary ORDERED CHRONOLOGICALLY (oldest to newest):
- For each interaction (call, email, slack message), include the date and what happened
- Explicitly flag: limitations communicated, features marked as unavailable or future-only, promises with timelines
- Call context (what was discussed, decisions, customer sentiment, key verbatim quotes from transcripts)
- Email threads (key exchanges, action items, constraints shared with customer)
- Slack signals (risk alerts, internal context, deal stage updates)
- Account issues (URR blocks, compliance, risk flags)
- Include Gong recording links for each call found

If a source returns nothing, skip it.`,
    { label: `research:${deal.deal_name}`, phase: 'Research' }
  ),
  (research, deal) => agent(
    `Write augmented meeting notes for "${deal.deal_name}" based on research findings.

CURRENT MEETING NOTES (from ${deal.latest_meeting_date}):
${deal.latest_meeting_notes}

BUSINESS OVERVIEW (context only, do not repeat):
${deal.business_overview}

CONTENT FROM PREVIOUS MEETINGS (do not repeat any of this):
${deal.previous_meetings_content || '(none)'}

CURRENT TOP OF MIND SECTION:
${deal.top_of_mind || '(empty)'}

RESEARCH FINDINGS:
${research}

INSTRUCTIONS:
Write two outputs as valid JSON with keys "notes" and "top_of_mind":

For "notes" (the meeting section content):
- Keep it concise, straight to the point
- Use bullet points
- No emojis
- No em dashes
- Do NOT repeat anything from Business Overview or previous meetings
- Include only what was discussed/decided in this specific meeting
- Add context from research that enriches the notes (e.g. account risks, relevant background)
- CRITICAL: If a feature or integration was communicated as unavailable, future-only, or requiring workarounds, always include that constraint in the notes. Never present a limited feature as if it works today.
- End with clear action items: "- Owner: Action"

For "top_of_mind" (bullet points for quick scanning):
- 3-5 bullets max
- Each bullet is one key fact about the deal right now
- Include: current product focus, blockers, account risks, next milestone
- No emojis, no em dashes
- Update based on latest meeting + research findings

Return ONLY the JSON object. No markdown fences, no explanation.`,
    { label: `augment:${deal.deal_name}`, phase: 'Augment', schema: {
      type: 'object',
      properties: {
        notes: { type: 'string', description: 'The augmented meeting notes content' },
        top_of_mind: { type: 'string', description: 'Bullet points for Top of Mind section' }
      },
      required: ['notes', 'top_of_mind']
    }}
  )
)

return deals.map((deal, i) => ({
  deal_name: deal.deal_name,
  doc_id: deal.doc_id,
  augmented: results[i]
}))
```

Pass the deals array as `args` to the workflow.

## Step 4: Update Google Docs

For each deal where the workflow returned augmented content:

1. Re-read the document with `get_google_drive_file` (include_indices: true) to get fresh indices
2. Use `update_google_drive_doc` to replace the **Top of Mind** section content with the new bullets
3. Use `update_google_drive_doc` to replace the **latest meeting Notes and Action items** with the augmented content

The `markdown` parameter in `update_google_drive_doc` renders standard markdown as formatted Google Doc content. Use markdown bullet syntax to produce properly formatted bullet lists:
```
- First bullet\n- Second bullet\n  - Nested bullet
```

Important:
- Do NOT touch the meeting header (date, title, attendees)
- Only replace from the "Notes" line through the end of action items
- Avoid the final newline character at document end (subtract 1 from end_index if needed)

## Step 5: Report Results

Tell the user:
- Which documents were updated (with links)
- Which deals had no document found
- A brief summary of what was enriched per deal

## Formatting Rules

These rules apply to ALL content written into meeting notes:
- No emojis
- No em dashes (use commas or periods instead)
- Only update notes if there is missing information to add or existing text to rephrase for clarity. If the notes are already complete and clear, do not rewrite them.
- Bullet points must use dash "-" not dot "•". In `update_google_drive_doc`, use standard markdown bullet syntax (`- item`) which renders as properly formatted bullet point lists in Google Docs.
- Concise bullet points, not paragraphs
- No repetition of Business Overview content
- No repetition of previous meeting content
- Action items format: `- Owner: Action`
- Top of Mind: 3-5 scannable dash-bullets covering current state, blockers, risks

## Error Handling

- **Doc not found:** Report which deal names had no matching document, continue with others
- **Gong has no calls:** Skip, rely on email/Slack context
- **No context found at all:** Keep existing notes as-is, report "no additional context found"
- **Google Doc update fails:** Report the error, suggest manual update
