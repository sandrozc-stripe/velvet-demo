---
name: draft-email
description: Draft a customer-facing follow-up email in Sandro's SA style — concise, direct, first-person, with a recap opener, bold self-contained sections, real inline Stripe doc links, flagged open questions, and a "What I need from you" close. Use when the user says "draft an email", "write the follow-up", "/draft-email", or asks to turn a call/analysis/thread into a customer email. Also use to restyle or tighten an existing draft to match this voice.
---

# Draft Email (Sandro's SA style)

Turn a call, analysis, thread, or rough draft into a customer-ready follow-up email in Sandro's voice. Reference examples live in `MERCHANT/*/` (e.g. Makea pricing recommendation, Audun Connect setup).

**Request / context:** `$ARGUMENTS`

## Golden rules (do not violate)

- **Never fabricate a Stripe doc URL, and verify every link.** Every inline link must be confirmed to resolve to a real page via the Stripe docs tools (`mcp__plugin_bob_bob__search_stripe_docs_pages`, `get_stripe_doc_page`) before it goes in — no exceptions, even for links copied from a prior email (confirm they still resolve). If a link can't be verified, name the concept in plain text instead of linking it.
- **Never invent numbers, people, dates, or actions.** Pull every figure from a real source (spreadsheet, thread, prior note). If a number comes from a model/forecast, say it's an estimate from a simulation, not a quote. When unsure, omit or flag — under-state rather than over-state. (See `memory/feedback_sa-note-accuracy.md`.)
- **Don't resolve open questions on the customer's behalf.** Surface them for the customer to answer.
- **No em-dashes (—).** Use commas, colons, parentheses, or a new sentence. En-dashes in number ranges (£160k–£237k) are fine.
- **No filler.** No "I hope this finds you well", no throat-clearing, no restating the obvious.

## Step 1 — Gather context (before writing a word)

Find and read the deal's material so the email is grounded in fact:
- The deal folder under `MERCHANT/<company>/` — prior emails (`.md`), thread PDFs, analysis spreadsheets, CSVs.
- Any spreadsheet the user links: read the actual tabs/cells (`mcp__toolshed_extras__batch_get_google_drive_sheet`) and use real figures.
- The email thread for names, the exact ask, who is DRI on each next step, and what's already been agreed.
- Recalled memories (SA email/note style) if surfaced.

Confirm the recipient's name and company from the thread, not from the filename. Flag any mismatch rather than guessing.

For extensive research across all information about the deal, follow the same approach as `## Step 3: Research Context (Parallel via Workflow)` in `.claude/skills/sa-meeting-augment/SKILL.md`: use a Workflow to search Gmail, Slack, and Gong (via the escalation ladder, with transcripts) for the deal. Information is not flat, it is successive, so pay close attention to the DATE of each piece of information and reconstruct the chronological timeline (oldest to newest): what was said when, what was promised, what constraints or limitations were communicated, and what remains unresolved or superseded by a later update. Ground the email in the latest state of the deal, not an earlier one contradicted by later context.

## Step 2 — Verify doc links (always)

For each concept you'll link, confirm the real URL via the docs tools — always, including links reused from earlier emails in the folder (use those as first candidates, but still confirm they resolve). Any link you can't verify becomes plain text. Reserve `code` formatting for API params only in technical setup emails where the param genuinely matters; in recommendation/recap emails, link plain terms instead.

## Step 3 — Write the email

Structure (adapt section names to the topic; keep every section self-contained):

1. **Subject** — `Company <> Stripe <topic>: <what>` or `<Topic>: <recommendation>`. Concrete, not generic.
2. **Opener** — `Hi <Name>,` then one or two sentences: recap the call/context and state the recommendation or setup up front. Never bury the headline.
3. **Body** — bold section headers (numbered when they're a ranked argument, named when they're topics). Each section is one decision or one topic, a few tight sentences, with the key term inline-linked to a real doc. For technical setup emails, include real `curl`/API code blocks step by step. Don't write sections header, flat text every time.
4. **Numbers** (if any) — present as a short comparison; add one line stating figures are estimates from the simulation, not a quote.
5. **Next Steps** — Next steps.
7. **Close** — offer a quick call as an alternative to more email, then `Best,\nSandro`.


## Voice checklist (run before returning)

- First person, direct, confident. States a recommendation, doesn't hedge.
- Every section earns its place; cut anything that restates or over-explains.
- Every link resolves to a real page; every number traces to a source.
- No em-dashes; no filler; no fabricated params or URLs.
- Open items flagged, not assumed resolved.
- Ends with "What I need from you" + call offer + "Best, Sandro".

## Output

Write the email to `MERCHANT/<company>/<YYYY-MM-DD>-<slug>.md`. Use today's date. If restyling an existing draft, edit that file in place. After writing, give the user a two-line summary of what changed and flag anything they should verify (recipient name, unconfirmed figures).
