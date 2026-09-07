---
name: sa-setup-deal
description: Create SA meeting note documents from Salesforce opportunity URLs. For each opportunity, creates a Google Drive folder (named after the account), copies a meeting note template into it, fills in company details (SFDC link, business overview from web research), and leaves smart chips intact for manual completion. Use when the user provides one or more SFDC opportunity URLs and wants meeting prep documents created, says "create meeting notes", "prep for meeting", "set up meeting docs", or pastes Stripe Lightning opportunity URLs.
---

# SA Meeting Note Creator

Creates structured meeting note documents in Google Drive from Salesforce opportunity URLs. Each opportunity gets a folder and a pre-filled meeting note document with company research.

## Inputs

The user provides:
- **Opportunity URLs** — one or more Salesforce opportunity URLs in the format:
  `https://stripe.lightning.force.com/lightning/r/Opportunity/<OPPORTUNITY_ID>/view`

## Step 1: Extract Opportunity IDs

Parse each URL to extract the opportunity ID. The ID is the segment between `/Opportunity/` and `/view` (e.g., `006TQ00000a8pmzYAA`).

## Step 2: Fetch Opportunity Data from Hubble

Run this SQL query using `initiate_hubble_query_and_glimpse`:

```sql
SELECT
  opportunity_id,
  domain,
  suspect_owner_name
FROM communia_marketing.agg_marketing_sold_funnel
WHERE opportunity_id IN ('<id1>', '<id2>', ...)
LIMIT 100
```

Replace the `IN (...)` clause with the extracted IDs, each single-quoted and comma-separated.

> Note: this table has **no `opportunity_owner_name` column** — use `suspect_owner_name` as the AE / opportunity owner. Do not query `information_schema` (it is blocked); if you need to inspect columns, `SELECT *` with a small `LIMIT`.

### Deriving the account name

The **account name** is the primary input for the folder and document titles, so get it right. Do NOT derive it from the domain by default — a domain like `getaudun.com` yields "Getaudun" when the company is actually "Audun".

For each opportunity, call `sales_insight_get_account_intelligence_with_opportunity_id` with the opportunity ID and use the returned **`sfdc_account_name`** as the account name (e.g. `Audun`). This is the authoritative Salesforce account name.

Only if that tool fails or returns an empty `sfdc_account_name`, fall back to deriving the name from the `domain` field:
- Strip the TLD (everything after the last dot): `keyban.io` → `keyban`
- Capitalize the first letter: `keyban` → `Keyban`

This same call also returns `company_overview`, `business_model`, and `revenue_model`, which you can use in Step 5d instead of (or to corroborate) web research.

## Step 3: Create Folder (if needed)

For each opportunity, check if a folder with the account name already exists under the parent folder.

**Parent folder ID:** `1W4ZRhd_hg6DqidzFXImSCdKg1CrwCkVq`

1. Use `list_google_drive_folder` with the parent folder ID
2. Check if a folder with the account name already exists (case-insensitive match)
3. If it does NOT exist, use `create_google_drive_folder` with `new_title` set to the account name, then `move_google_drive_doc` to move it into the parent folder
4. If it already exists, use the existing folder's ID

## Step 4: Copy Template Document

**Template doc ID:** `1wmG3LD7JPI887UiMKApY7C2yT3v-LTm13L4WtSAizNo`

1. Use `copy_google_drive_doc` with:
   - `id`: the template doc ID
   - `new_title`: `"<Account Name> - Meeting Note"`
2. Use `move_google_drive_doc` to move the copied document into the account's folder

## Step 5: Edit the Document

Read the copied document with `get_google_drive_file` using `include_indices: true` to get character positions.

### 5a: Replace `<Client>`

Use `replace_text_in_google_drive_doc`:
- `find_text`: `<Client>`
- `replace_text`: the account name

### 5b: DO NOT touch the AE line

The AE line contains Google Docs smart chips (Person chip, Metronome dropdowns) that cannot be modified programmatically. Leave it untouched.

### 5c: Replace "SFDC OPP" with hyperlinked bullet point

Re-read the document with `include_indices: true` to get updated positions after the previous edit.

Find the index range for "SFDC OPP" text. Use `update_google_drive_doc` to replace it with a bulleted list of links — the company domain URL first (near the top of the doc), then the SFDC opportunity link:

```markdown
- [<domain>](https://www.<domain>)
- [SFDC OPP](<opportunity_url>) (<opportunity_id> - <owner_name>)
```

Where:
- `<domain>` is the `domain` field from Hubble (e.g. `getaudun.com`)
- `<opportunity_url>` is the original URL the user provided
- `<opportunity_id>` is the extracted ID
- `<owner_name>` is `suspect_owner_name` from Hubble

### 5d: Replace the `<prompt>...</prompt>` section with company research

Re-read the document with `include_indices: true` again to get updated positions.

Find the index range that starts with `<prompt>` and ends with `</prompt>` (inclusive of both tags).

**Research the company.** Prefer the `company_overview`, `business_model`, and `revenue_model` fields already returned by `sales_insight_get_account_intelligence_with_opportunity_id` in Step 2 — they are Stripe's own account intelligence and are usually sufficient.

To supplement or if those fields are empty, use `call_web_search` (the built-in `WebSearch` tool errors out on non-OpenAI models — use `call_web_search` instead). Search for:
- `"<domain> company what do they do"` — to understand their core business
- `"<domain> business model customers"` — to identify target users and monetization

Web search is more reliable than fetching the company website directly, as many sites block automated fetches or use heavy JavaScript rendering. If web search results are insufficient, supplement with `WebFetch` on `https://www.<domain>` as a fallback.

Combine the findings into this exact format:

```
Activity: [1-2 sentence summary of what the company does]
Target users: [their target customers]
Current monetization: [their business/revenue model]
```

Then use `update_google_drive_doc` to replace the full `<prompt>...</prompt>` block (using the start and end indices) with the research output.

## Step 6: Report to User

For each opportunity processed, report:
- Account name
- Link to the created folder
- Link to the created document
- Any errors encountered

## Processing Multiple Opportunities

If given multiple URLs, process them **in parallel** using the Agent tool. After Step 2 (fetching all opportunity data from Hubble in a single query) and listing the parent folder (one call to check existing folders), spawn one Agent per opportunity to handle Steps 3–5 concurrently. Each agent receives:
- The opportunity's data (ID, domain, owner name, URL)
- The account name (from `sfdc_account_name`; domain-derived only as fallback)
- The existing folder ID (if one was found) or instruction to create one
- The parent folder ID and template doc ID

Send all Agent tool calls in a **single message** so they run concurrently. Each agent independently creates the folder (if needed), copies the template, and performs all edits.

After all agents complete, collect their results and report to the user in Step 6.

## Error Handling

- **Hubble query fails or returns 0 rows:** Report the error, suggest checking the opportunity URL
- **`sales_insight_get_account_intelligence_with_opportunity_id` fails or returns empty `sfdc_account_name`:** Fall back to deriving the account name from the `domain` field
- **Domain not found in Hubble results:** Use the opportunity name (from the SFDC record) to derive the account name instead
- **WebFetch fails for company website:** Fill in "Activity: [Could not retrieve — please fill manually]" and inform the user
- **Folder creation fails:** Report and skip to next opportunity
- **Document copy or edit fails:** Report the specific step that failed

## Important Notes

- Always re-read the document with `include_indices: true` between edits, because character positions shift after each modification
- The template has smart chips on the AE line — never edit indices that overlap with that line
- The `<prompt>` block spans multiple lines — match from `<prompt>` at the start to `</prompt>` at the end to get the full range
