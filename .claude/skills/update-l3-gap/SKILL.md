---
name: update-l3-gap
description: >
  Update the L3 gap analysis tables with new promotion evidence. Use this skill whenever the user
  mentions new achievements, data points, deal wins, shoutouts, kudos, events, or any accomplishment
  they want to add to their L3 promotion case. Also trigger when the user says "update my gap analysis",
  "new data point", "update l3 gap", "add to my career plan", "new achievement", "log this for my promo",
  or references updating their promotion evidence. If the user shares a Google Doc link, Slack message,
  email, or any source of new career evidence, this skill should activate to map it into the gap tables.
---

# Update L3 Gap Analysis

You are helping Sandro Zangiacomi (SA at Stripe, targeting L2 → L3 promotion) keep his gap analysis tables up to date as new evidence comes in.

## Context

Sandro has three gap analysis files that map his accomplishments to L3 ladder expectations. Each file is a markdown table with two columns: **Impact Quality** (the L3 description bullet point) and **Example Contributions** (numbered data points proving he operates at L3 level).

The three scopes are:
- **User Impact** — Critical Thinking & Getting Things Done
- **Community Impact** — Working With Others
- **Company Impact** — Company Building & Acting Like an Owner

## Step 1: Understand the new information

Read what the user has shared. This could be:
- A verbal description of a new achievement, deal, event, shoutout
- A Google Doc/Slides link (extract the doc ID and use `mcp__toolshed_extras__get_google_drive_file` to read it)
- A reference to an email (use `mcp__toolshed_extras__search_gmail` to find it, then `mcp__toolshed_extras__get_gmail_message` to read it)
- A Slack message or screenshot
- A metric update (e.g., new deal won, new cloner count)

If the user provides a Google Doc URL, extract the document ID from it (the long alphanumeric string in the URL) and read the document to pull out relevant data points.

## Step 2: Read the current state

Read these files to understand what's already documented:

1. `career_plan/sa_level_l3_ladder.md` — The L3 ladder expectations (the bullet points that form the rows)
2. `career_plan/l3_gap_user_impact.md` — Current User Impact table
3. `career_plan/l3_gap_community_impact.md` — Current Community Impact table
4. `career_plan/l3_gap_company_impact.md` — Current Company Impact table

## Step 3: Map the new data point(s)

For each new piece of evidence, determine:

1. **Which scope(s)** does it map to? (User, Community, Company — it can map to multiple)
2. **Which specific row(s)** within that scope? Match to the Impact Quality description text.

Here are the rows in each file for reference:

### User Impact (7 rows)
1. Good understanding of market / portfolio strategy
2. Identify and implement solutions independently, reusable patterns
3. Engage user-facing teams, solution plans, project scoping
4. Proactively lead opportunities with senior stakeholders
5. Lead discovery sessions, qualify opportunities
6. Work with customer project team to scope implementation plans
7. Key part of negotiation team, demos, credibility

### Community Impact (8 rows)
1. Articulate high-level business problems, facilitate change
2. Data-driven business case to persuade stakeholders
3. Valued perspective and peer support
4. Work with technical teams for product feedback / roadmap
5. Regularly mentor and coach others
6. Cross-functional projects with measurable impact
7. Efficient, persistent, dispatches roadblocks
8. Recognized as example of operating principles

### Company Impact (4 rows)
1. Team/Stripe goals before personal goals
2. Actively contribute outside your goals
3. Act in best interest of Stripe, model ownership
4. Increase inclusivity and diversity

## Step 4: Write the new entry

Format each new entry following the existing concise numbered style:

```
N) Short description with key metric, customer name, or quote — attribution if applicable
```

Examples of good entries:
- `6) Won Acme Corp deal ($500K ONR) — designed custom Billing architecture for hybrid pricing model`
- `5) Jeanne Malrieu kudos: "well done to our AI hero!" after enabling Linkup for Machine Payments`
- `4) Presented at London Developer Meetup (60+ attendees) on Stripe Connect for platforms`

The entry number should be the next number after the last existing entry in that row.

## Step 5: Update the files

Use the Edit tool to add the new numbered entry to the correct row(s) in the correct file(s). Each row's content is a single table cell with entries separated by spaces. Append the new entry at the end of the existing entries in the cell.

For example, if a row currently ends with `...3) Some thing 4) Another thing |`, and you're adding entry 5, the cell should become `...3) Some thing 4) Another thing 5) Your new entry |`.

## Step 6: Optionally update the career plan

If the new data point includes:
- New metrics (deal values, attendance numbers, satisfaction scores)
- New document links (Google Docs, slides, SFDC links)
- New initiative details

Then also update `career_plan/Sandro - 2026 Career Plan.md` in the relevant section.

## Step 7: Show the user what changed

After updating, display a clear summary:

```
Updated gap analysis:

**User Impact** — Row "You proactively lead opportunities..."
  → Added: 6) Won Acme Corp ($500K ONR) — custom Billing architecture

**Community Impact** — Row "You regularly mentor and coach..."
  → Added: 6) Coached 3 new AEs during Q2 onboarding sprint

No updates to Company Impact.
```

This makes it easy for the user to verify the changes are correct and in the right place.
