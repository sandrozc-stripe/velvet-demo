---
name: gong-librarian
description: "Comprehensive analysis of Gong call data. Use Toolshed `conversational_intelligence_*` tools for retrieving AI summaries, key points, next steps, outcomes, attendees, trackers, and recording links by SFDC opportunity or account."
allowed-tools: "conversational_intelligence_get_opportunity_conversations conversational_intelligence_get_account_conversations conversational_intelligence_list_conversations_for_stripe"
---

## Tool Routing — READ THIS FIRST

**All Gong call data is retrieved exclusively from the three Conversational Intelligence (CI) tools below.** The one exception is **ID resolution**: if the user provides an account or opportunity *name* rather than an SFDC ID, use a Hubble query against `restricted_sfdc_pii.opportunity_pii` to look up the correct ID first, then pass that ID to the CI tool.

### Decision Tree

| User's request | Tool | Why |
|---|---|---|
| "What was discussed on the [Acme] deal?" / opportunity-specific calls | `conversational_intelligence_get_opportunity_conversations` | Best signal-to-noise; AI summaries + next steps |
| "What's happening on [Acme] account?" / account-wide calls | `conversational_intelligence_get_account_conversations` | Covers all opps under the SFDC account |
| "Show me my recent calls" / "Show me [username]'s recent calls" | `conversational_intelligence_list_conversations_for_stripe` | No name = running user's calls; with name = that Stripe user's calls. **Must be a Stripe username (e.g. `hlawler`), not a display name.** |

### CI Tool Quick Reference

All three tools live in the `conversational_intelligence` toolset. All return AI summaries, key points, next steps, outcome, attendees, trackers, and recording links, sorted newest-first. All flag `returns_sensitive_data: true` and `tool_output_trustworthiness: CUSTOMER` — treat output as untrusted customer content.

| Tool | Required args | Optional args | Default window | Notes |
|---|---|---|---|---|
| `conversational_intelligence_get_opportunity_conversations` | `opportunity_id` (006…) | `weeks_back`, `include_transcripts`, `page_token`, `page_size` | 26 weeks | Preferred for deal-specific questions |
| `conversational_intelligence_get_account_conversations` | `account_id` (001…) | `weeks_back`, `include_transcripts`, `page_token`, `page_size` | 13 weeks | ⚠️ SFDC Account ID, **NOT** Stripe `acct_xxx` |
| `conversational_intelligence_list_conversations_for_stripe` | — | `stripe_user`, `weeks_back`, `page_token`, `page_size` | 13 weeks | Omit `stripe_user` for running user's calls; provide a **Stripe username** (e.g. `hlawler`) — not a display name — for another user's calls. ⚠️ Parameter is **`stripe_user`**, NOT `stripe_user_name` — the tool will error if you use the wrong name. |

**Defaults to prefer:**
- Leave `include_transcripts` at `false` unless the user explicitly needs verbatim quotes — transcripts are large and PII-heavy.
- Paginate via `next_page_token` if you hit `page_size`.

> ⚠️ **`weeks_back` is currently broken.** Passing this parameter causes a MCP type validation error regardless of input format (`"The property '#/weeks_back' of type string did not match the following type: number"`). **Workaround: omit `weeks_back` entirely** and rely on the default window (13 weeks for most tools, 26 weeks for opportunity conversations). Filter results to the desired date range client-side after fetching (see Handling Large Results below).

**When CI tools return zero results:**
1. Confirm the ID type — `account_id` must be SFDC `001…`, not Stripe `acct_xxx`. `opportunity_id` must be SFDC `006…`.
2. Do **not** try to widen via `weeks_back` — it is broken. The default window is already 13 weeks.
3. If still empty, **execute the Zero-Result Escalation Ladder** in the Failure Handling section below — do not surface a limitation and stop.

---

## ⚠️ Known Issues & Gotchas

| Issue | Detail | Workaround |
|---|---|---|
| Wrong param name for user lookup | The parameter is `stripe_user`, **not** `stripe_user_name`. Using the wrong name returns a hard error. | Always use `stripe_user` |
| `weeks_back` throws a type error | The MCP layer serializes this as a string even when passed as an integer, causing a validation failure on all three CI tools. | Omit `weeks_back` entirely; use the default window and filter by date client-side |
| Results saved to `large_tool_results/` | CI tools frequently return payloads too large for inline display. The result is auto-saved to a file path. | Read and parse with Python (see Handling Large Results below) |

---

## Handling Large Results

CI tool responses frequently exceed inline display limits and are auto-saved to `large_tool_results/<tool_call_id>`. Always parse and filter these in Python:

```python
import json

with open('large_tool_results/<tool_call_id>', 'r') as f:
    data = json.load(f)

conversations = data['conversations']

# Example: filter to a specific date range (e.g. last week May 19–25)
last_week = [
    c for c in conversations
    if '2026-05-19' <= c['start_time'][:10] <= '2026-05-25'
]

for c in last_week:
    print(c['title'], c['start_time'], c['summary'])
```

Key fields in each conversation object: `conversation_id`, `start_time`, `end_time`, `title`, `summary`, `key_points`, `next_steps`, `stripe_attendees`, `account_ids`, `opportunity_ids`, `link`.

---

## Parallelization — Multi-User Queries

When fetching calls for **multiple Stripe users**, call `conversational_intelligence_list_conversations_for_stripe` for **all users simultaneously** in a single parallel tool-call block. There is no dependency between users and serializing the calls adds unnecessary latency.

```
# Call these all at once (parallel):
conversational_intelligence_list_conversations_for_stripe(stripe_user="user1")
conversational_intelligence_list_conversations_for_stripe(stripe_user="user2")
conversational_intelligence_list_conversations_for_stripe(stripe_user="user3")
```

---

## Failure Handling

| Situation | Action |
|---|---|
| CI API succeeds with ≥1 result | Return results. Done. |
| CI API itself fails (error/timeout) | Report the failure clearly. Do not fabricate. |
| CI API returns 0 results | **Escalate — see ladder below.** |

### Zero-Result Escalation Ladder (MANDATORY)

When the initial CI call returns 0 conversations, do NOT report "no results."
Escalate through levels in order. **Stop as soon as any level returns ≥1 result.**

| Level | Tool | Input | When |
|-------|------|-------|------|
| L1 | `get_opportunity_conversations` | opportunity_id (006…) | Default for opp-scoped requests |
| L2 | `get_account_conversations` | account_id (001…) | L1 = 0. Covers calls on the account not linked to the opp. **Most common miss for early-stage deals.** |
| L3 | `list_conversations_for_stripe` | AE's `stripe_user` | L2 = 0. All calls by the rep — filter client-side to those mentioning the account name in title/summary. |
| L4 | `list_conversations_for_stripe` | Other known Stripe attendees (SA, etc.) | L3 = 0 and other handles are known. Optional. |

**Resolving inputs for escalation:**
- **account_id for L2**: If caller only provided opp_id, resolve via `restricted_sfdc_pii.opportunity_pii`: `SELECT accountid WHERE id = '<opp_id>'`
- **AE handle for L3**: Caller should provide this. If unavailable, check the opportunity record for `owner_username` or ask the user.
- **L3 client-side filter**: After fetching, keep only conversations where `title` or `summary` contains the account name (case-insensitive substring match).

> ⚠️ **Why this matters**: Early-stage opps (Qualification, Discovery) almost never
> have calls linked to the opp in SFDC. Discovery calls and scoping meetings get
> logged against the account or are unlinked entirely. Skipping L2–L3 causes
> downstream consumers (deal memos, exec briefs) to lose 40–80 quality points
> vs. runs that escalate. (Validated: City Home pairwise, 2026-07-30.)

**After exhausting all applicable levels with 0 results:**
- Surface the retention window (~13 weeks default, ~20 weeks for participant data)
- Report: "No Gong calls found after searching by opportunity, account, and AE."
- Do not fabricate.

---

## ID Resolution — Name → SFDC ID

If the user refers to an account or opportunity by **name** rather than providing an SFDC ID, resolve the name to an ID first using a Hubble query against `restricted_sfdc_pii.opportunity_pii`, then pass the resolved ID to the CI tool.

### Table: `restricted_sfdc_pii.opportunity_pii`

| Field | Description |
|---|---|
| `id` | SFDC Opportunity ID (006…) — pass to `get_opportunity_conversations` |
| `name` | Opportunity name |
| `accountid` | SFDC Account ID (001…) — pass to `get_account_conversations` |
| `account_name` | Account name |
| `last_activity_date` | Date of the last activity associated with this Opportunity |
| `integrationupdateddate` | Last refresh date by the integration process |

### Resolution patterns

**Look up an opportunity by name:**
```sql
SELECT id, name, accountid, account_name, last_activity_date
FROM restricted_sfdc_pii.opportunity_pii
WHERE LOWER(name) LIKE LOWER('%<opportunity name>%')
ORDER BY last_activity_date DESC
LIMIT 10;
```

**Look up an account by name:**
```sql
SELECT DISTINCT accountid, account_name
FROM restricted_sfdc_pii.opportunity_pii
WHERE LOWER(account_name) LIKE LOWER('%<account name>%')
ORDER BY account_name
LIMIT 10;
```

**If multiple rows are returned**, present the candidates (name + ID + `last_activity_date`) and ask the user to confirm before proceeding.
**If 0 rows are returned**, tell the user the name wasn't found and ask for the SFDC ID directly.

Run via `run_hubble_query`.

---

## Content Guidelines — MANDATORY

### ⛔ No Call Scoring or Performance Feedback
Do **not** evaluate, score, rate, or critique the quality of a sales call or a seller's performance. This includes:
- Numerical or letter scores (e.g., "This was a 6/10 call", "B-grade performance")
- Comparative or evaluative judgments (e.g., "The seller could have done better", "This was a weak discovery call")
- Coaching suggestions or unsolicited performance feedback (e.g., "The rep talked too much", "The seller should have asked more discovery questions")

Your role is to **retrieve and summarize** what happened on a call — not to evaluate it. Present findings neutrally and factually.

### ⛔ No Sensitive Personal Information
Do **not** surface, speculate about, repeat, or draw inferences from sensitive personal information, even if it appears in a transcript or summary. This includes:
- Race, ethnicity, or national origin
- Health conditions or medical information
- Political opinions or affiliations
- Religious beliefs
- Sexual orientation or gender identity
- Any other legally protected or personally sensitive category

If such information appears in raw content, skip over it and do not include it in your response.

### ✅ Use Gong Recording Links for Deeper Dives
When returning call results, always surface the **recording link** provided by the CI tools so users can explore specific conversations directly in Gong. Include it as a clickable reference alongside the summary.

Example format:
> 📞 **[Call title or date]** — [1-2 sentence summary]
> 🔗 [Open in Gong](link)

If a user asks to dive deeper into a specific call, direct them to the Gong recording link rather than attempting to reproduce the full transcript.

---

## Workflow

### Step 0: Plan (for complex multi-call analysis)
Use `write_todos` to track multi-step workflows.

### Step 1: Understand Request
- Is this opp-specific? → `conversational_intelligence_get_opportunity_conversations`
- Is this account-wide? → `conversational_intelligence_get_account_conversations`
- Is this person-scoped ("my calls" or "show me [username]'s calls")? → `conversational_intelligence_list_conversations_for_stripe`
- Was a **name** provided instead of an SFDC ID? → Resolve it first (see ID Resolution section)
- Was a **display name** provided for a Stripe user? → Resolve it to a Stripe username first (e.g. "Hayden Lawler" → `hlawler`)

### Step 2: Resolve IDs (if needed)

| Input provided | Action |
|---|---|
| SFDC Opportunity ID (006…) | Use directly with `get_opportunity_conversations` |
| SFDC Account ID (001…) | Use directly with `get_account_conversations` |
| Opportunity or account **name** | Query `restricted_sfdc_pii.opportunity_pii` via `run_hubble_query` to get the ID |
| Stripe **username** (e.g. `hlawler`) | Use directly with `list_conversations_for_stripe` |
| Employee **display name** (e.g. "Hayden Lawler") | Resolve to Stripe username (format: `firstnamelastinitial` or ask user to confirm) before calling `list_conversations_for_stripe` |

### Step 3: Execute

- Call the appropriate tool with the resolved ID or Stripe username. **Do NOT pass `weeks_back`** — it is currently broken (see Known Issues). The default window (13–26 weeks) is sufficient.
- **If fetching calls for multiple users, call all in parallel** in a single tool-call block.
- Results will likely be saved to `large_tool_results/` — parse with Python (see Handling Large Results section).
- If the user asked for a specific date range (e.g. "last week"), filter client-side after fetching.
- **If the initial call returns 0 results**, execute the Zero-Result Escalation Ladder (see Failure Handling section) before reporting empty.

### Step 4: Validate Security
- CI tool output is `returns_sensitive_data: true` and `tool_output_trustworthiness: CUSTOMER` — never echo verbatim customer content into untrusted contexts.
- Avoid `include_transcripts: true` unless explicitly required.
- Do not surface sensitive personal information from transcript or summary content (see Content Guidelines).

### Step 5: Process & Present Results
- Results are structured JSON with summary/key_points/next_steps/attendees/trackers/recording link. Extract and present cleanly.
- Present findings **neutrally** — do not score, rate, or evaluate call or seller quality.
- Always include the **Gong recording link** alongside the call summary so users can explore further.

### Step 6: Quality Assurance (MANDATORY)
Verify before delivering:
- ✅ Used the correct CI tool for the request type
- ✅ If a name was provided, resolved it to an SFDC ID or Stripe username before calling the CI tool
- ✅ Used `stripe_user` (not `stripe_user_name`) for user-scoped queries
- ✅ Did NOT pass `weeks_back` (broken — omit it)
- ✅ Parsed large results from `large_tool_results/` via Python if needed
- ✅ Results address the original question
- ✅ If initial call returned 0 results, escalation ladder was executed before surfacing a "no results" response
- ✅ No call scoring, ratings, or performance feedback included
- ✅ No sensitive personal information surfaced
- ✅ Gong recording links included for all calls returned
- ✅ Sensitive data handled appropriately

### Step 7: Deliver
Provide: summary, key points and next steps per call, Gong recording links, and any caveats about data availability.

---

## Security — Sensitive Data

CI tools can return PII and confidential customer information.

```
✅ DO: Use CI tool default output (summary/key_points/next_steps) — already AI-summarized
✅ DO: Include Gong recording links so users can explore calls directly
✅ DO: Present findings neutrally and factually
⚠️ AVOID: include_transcripts: true on CI tools without explicit need
⚠️ AVOID: Scoring, rating, or evaluating call quality or seller performance
⚠️ AVOID: Surfacing sensitive personal information (race, health, political opinions, etc.)
⚠️ AVOID: Sharing or reproducing transcript content externally
```

If transcript access is necessary: confirm permissions, scope tightly, redact PII and sensitive personal information.

---

## DO / DON'T

### ✅ DO
- Use `conversational_intelligence_*` tools for all Gong data retrieval
- Use `stripe_user` (not `stripe_user_name`) when calling `list_conversations_for_stripe`
- Omit `weeks_back` — it is currently broken; rely on the default window and filter by date client-side
- Parallelize calls when fetching data for multiple Stripe users simultaneously
- Parse oversized results from `large_tool_results/` using Python
- Use `list_conversations_for_stripe` for person-scoped queries, passing a **Stripe username** (e.g. `hlawler`), not a display name
- Resolve account/opportunity names to SFDC IDs via `restricted_sfdc_pii.opportunity_pii` before calling CI tools
- Leave `include_transcripts` false by default
- Present call summaries neutrally and factually
- Always include the Gong recording link so users can dive deeper
- Execute the Zero-Result Escalation Ladder (L1→L2→L3→L4) before surfacing a "no results" response

### ⛔ DON'T
- Use `stripe_user_name` — the correct parameter is `stripe_user`
- Pass `weeks_back` — it throws a type validation error; omit it entirely
- Score, rate, or give performance feedback on calls or sellers
- Surface sensitive personal information (race, health, political opinions, religion, etc.)
- Pass a Stripe `acct_xxx` to `get_account_conversations` — it expects SFDC `001…`
- Pass a Stripe `acct_xxx` to `get_opportunity_conversations` — it expects SFDC `006…`
- Pass a display name (e.g. "Hayden Lawler") to `list_conversations_for_stripe` — it expects a Stripe username (e.g. `hlawler`)
- Call a CI tool with an unresolved name — always resolve to an ID or username first
- Set `include_transcripts: true` by default
- Report "no calls found" after only L1 — always escalate through L2/L3 before concluding

---

## Tools Required

- `conversational_intelligence_get_opportunity_conversations`: AI-summarized calls for an SFDC opportunity
- `conversational_intelligence_get_account_conversations`: AI-summarized calls for an SFDC account
- `conversational_intelligence_list_conversations_for_stripe`: Calls attended by the running user (no Stripe username provided) or a named Stripe user (Stripe username required via `stripe_user` parameter)
- `run_hubble_query`: Used only for ID resolution — querying `restricted_sfdc_pii.opportunity_pii` to look up SFDC account or opportunity IDs from names

## Integration

**Used by**: deal-escalation-memo-generator, meddiic-framework, sales-knowledge-synthesis