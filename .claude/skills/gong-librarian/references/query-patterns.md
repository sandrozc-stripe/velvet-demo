# Gong Query Patterns — Authoritative Schema Reference

**Verified against live Hubble schema: 2026-04-30**

Canonical, proven SQL patterns for `hive.gong_raw` tables.
Each pattern includes: question shape, base SQL, parameterization points, and gotchas.

---

## Critical Schema Rules (Read Before Writing Any Query)

| Rule | Correct | Wrong |
|------|---------|-------|
| **Table prefix** | `hive.gong_raw.<table>` | `iceberg.gong_raw.<table>` — catalog doesn't exist |
| **Primary key for calls** | `c.conversation_id` | `c.id` — column does not exist |
| **Universal FK (all child tables)** | `c.conversation_key = child.conversation_key` | `c.id = child.conversation_id` — neither column exists on child tables |
| **Partition format** | `c.dt >= '2026-01-01'` (YYYY-MM-DD with dashes) | `c.dt >= '20260101'` — no dashes, won't match |
| **Partition type** | String comparison: `c.dt >= '2026-01-01'` | `c.dt >= DATE '2026-01-01'` — type mismatch |
| **Timestamps** | Native `timestamp(3)`: `c.effective_start_datetime >= TIMESTAMP '2026-01-01 00:00:00'` | `FROM_UNIXTIME(c.effective_start_datetime)` — TYPE_MISMATCH |
| **Call duration** | No `duration_sec` on calls. Use `call_recordings.duration` via join, or `calls.browser_duration_sec` | `c.duration_sec` — column does not exist |
| **AI spotlight fields** | `c.call_spotlight_brief`, `c.call_spotlight_key_points`, `c.call_spotlight_next_steps` | `c.key_points`, `c.next_steps` — don't exist |
| **Tracker PK** | `t.tracker_id` | `t.id` — column does not exist |
| **Person filtering** | `cp.email_address = 'user@stripe.com'` on participants | `cp.user_id` join — user_id stored as float string, unreliable |
| **Deleted records** | Always filter: `(c.is_deleted = false OR c.is_deleted IS NULL)` | Omitting filter |
| **Starting table** | `hive.gong_raw.calls c` | Joining through `gong_raw.conversations` first |

---

## Table Field Reference

### `gong_raw.calls` — Primary call metadata table

| Field | Type | Notes |
|-------|------|-------|
| `conversation_id` | varchar | **Primary key** |
| `conversation_key` | varchar | **Universal FK** — all child tables join here |
| `title` | varchar | Call title / meeting subject |
| `browser_duration_sec` | double | Browser-based duration in seconds |
| `presentation_duration_sec` | double | Presentation/screenshare duration |
| `direction` | varchar | `'INBOUND'` or `'OUTBOUND'` |
| `status` | varchar | `'COMPLETED'`, `'IN_PROGRESS'`, `'CANCELLED'`, `'SCHEDULED'`, `'ABORTED'` |
| `effective_start_datetime` | timestamp(3) | Native timestamp — compare directly |
| `planned_start_datetime` | timestamp(3) | Native timestamp |
| `planned_end_datetime` | timestamp(3) | Native timestamp |
| `is_deleted` | boolean | Always filter: `(is_deleted = false OR is_deleted IS NULL)` |
| `call_spotlight_brief` | varchar | AI-generated call summary |
| `call_spotlight_key_points` | varchar | AI-generated key points |
| `call_spotlight_next_steps` | varchar | AI-generated next steps |
| `call_spotlight` | varchar | Full AI spotlight text |
| `call_spotlight_outcome` | varchar | AI-detected outcome |
| `call_spotlight_automatic_disposition` | varchar | AI disposition |
| `call_spotlight_type` | varchar | Spotlight type |
| `call_url` | varchar | Gong URL for the call |
| `owner_id` | varchar | Call owner user ID |
| `workspace_id` | varchar | FK → `workspaces.workspace_id` |
| `question_company_count` | decimal | Number of questions asked by company |
| `question_non_company_count` | decimal | Number of questions asked by non-company |
| `scope` | varchar | |
| `source_system` | varchar | |
| `disposition` | varchar | |
| `dt` | varchar | Partition key — YYYY-MM-DD format with dashes |

### `gong_raw.conversation_participants`

| Field | Type | Notes |
|-------|------|-------|
| `conversation_key` | varchar | **FK** → `gong_raw.calls.conversation_key` |
| `email_address` | varchar | ✅ Use for person filtering — reliable |
| `user_id` | varchar | Values stored as float/scientific notation — unreliable for joins |
| `speaker_id` | decimal(38,19) | Speaker identifier |
| `affiliation` | varchar | `'company'` = Stripe internal; `'non_company'` = customer |
| `name` | varchar | Display name — ⚠️ PII for external participants |
| `type` | varchar | Participant type |
| `phone_number` | varchar | ⚠️ PII |
| `invitee_status` | varchar | Calendar invite status |
| `associated_object_id` | varchar | |
| `associated_object_type` | varchar | |
| `dt` | varchar | Partition — YYYY-MM-DD. ⚠️ **Rolling ~5-month retention** (earliest: ~2025-12-17) |

### `gong_raw.interaction_stats`

| Field | Type | Notes |
|-------|------|-------|
| `conversation_key` | varchar | **FK** → `gong_raw.calls.conversation_key` |
| `call_id` | varchar | Equals `calls.conversation_id` — alternative join key |
| `call_owner` | varchar | |
| `user_id` | varchar | |
| `talk_ratio` | decimal(38,19) | % time rep speaks (0–1). Ideal: 0.40–0.60 |
| `interactivity` | double | Back-and-forth score (0–100). Higher = better |
| `patience` | double | Listening behavior. Higher = better |
| `question_rate` | decimal(38,19) | Questions per minute. Ideal: 3–5 |
| `longest_monologue` | double | Longest uninterrupted speech (seconds). Ideal: <120 |
| `longest_customer_story` | double | Longest customer uninterrupted speech |
| `dt` | varchar | Partition — YYYY-MM-DD |

### `gong_raw.conversation_contexts`

| Field | Type | Notes |
|-------|------|-------|
| `conversation_key` | varchar | **FK** → `gong_raw.calls.conversation_key` |
| `object_type` | varchar | `'opportunity'`, `'account'`, `'contact'` |
| `object_id` | varchar | SFDC ID — `001…` = account, `006…` = opportunity, `003…` = contact |
| `real_run_time` | timestamp(3) | |
| `dt` | varchar | Partition — YYYY-MM-DD |

### `gong_raw.conversation_trackers`

| Field | Type | Notes |
|-------|------|-------|
| `conversation_key` | varchar | **FK** → `gong_raw.calls.conversation_key` |
| `tracker_id` | varchar | **FK** → `gong_raw.trackers.tracker_id` |
| `count` | decimal(38,19) | Number of times tracker fired in the call |
| `workspace_id` | varchar | |
| `dt` | varchar | Partition — YYYY-MM-DD |

### `gong_raw.trackers`

| Field | Type | Notes |
|-------|------|-------|
| `tracker_id` | varchar | **Primary key** — NOT `id` |
| `name` | varchar | Tracker name (e.g. `'competitor_mention'`) |
| `keywords` | varchar | Keywords that trigger this tracker |
| `tracker_type` | varchar | `'keyword'` or `'smart_tracker'` |
| `workspace_id` | varchar | |
| `dt` | varchar | Partition — YYYY-MM-DD |

### `gong_raw.users`

| Field | Type | Notes |
|-------|------|-------|
| `user_id` | varchar | **Primary key** |
| `email_address` | varchar | Stripe email (e.g. `rep@stripe.com`) |
| `first_name` | varchar | |
| `last_name` | varchar | |
| `title` | varchar | Job title |
| `manager_id` | varchar | FK → `gong_raw.users.user_id` (for hierarchy) |
| `active` | boolean | Is user active |
| `licensed` | boolean | Is user licensed |
| `home_workspace_id` | varchar | |
| `dt` | varchar | Partition — YYYY-MM-DD |

### `gong_raw.scorecard_answers`

| Field | Type | Notes |
|-------|------|-------|
| `conversation_key` | varchar | **FK** → `gong_raw.calls.conversation_key` |
| `scorecard_id` | varchar | |
| `scorecard_name` | varchar | Name of the scorecard |
| `question_id` | varchar | FK → `scorecard_questions.question_id` |
| `question_text` | varchar | Denormalized — question text directly available |
| `question_type` | varchar | |
| `question_is_overall_score` | boolean | |
| `answer_id` | varchar | |
| `answer_score` | decimal(38,19) | Score value |
| `answer_text` | varchar | |
| `answer_not_applicable` | boolean | |
| `answer_created_datetime` | timestamp(3) | |
| `gave_scorecard_user_id` | varchar | Who submitted the scorecard |
| `received_scorecard_user_id` | varchar | Who was scored |
| `is_auto_scorecard` | boolean | |
| `last_published_datetime` | timestamp(3) | |
| `dt` | varchar | Partition — YYYY-MM-DD |

### `gong_raw.comments`

| Field | Type | Notes |
|-------|------|-------|
| `conversation_key` | varchar | **FK** → `gong_raw.calls.conversation_key` |
| `comment_id` | varchar | |
| `comment` | varchar | Comment content (NOT `comment_text`) |
| `user_id` | varchar | Who wrote the comment |
| `time_in_call_sec` | decimal(38,19) | Timestamp within the call |
| `created_datetime` | timestamp(3) | When comment was made (NOT `created_at`) |
| `reply_to_comment_id` | varchar | For threaded comments |
| `mentions` | varchar | |
| `tags` | varchar | |
| `dt` | varchar | Partition — YYYY-MM-DD |

### `gong_raw.call_recordings`

| Field | Type | Notes |
|-------|------|-------|
| `conversation_key` | varchar | **FK** → `gong_raw.calls.conversation_key` (NOT `call_id`) |
| `duration` | decimal(38,19) | Duration in seconds — **best source for total call duration** |
| `language` | varchar | e.g. `'en-US'` |
| `media_type` | varchar | `'audio'` or `'video'` |
| `start_datetime` | timestamp(3) | |
| `end_datetime` | timestamp(3) | |
| `dt` | varchar | Partition — YYYY-MM-DD |

### `gong_raw.call_transcripts`

| Field | Type | Notes |
|-------|------|-------|
| `conversation_key` | varchar | **FK** → `gong_raw.calls.conversation_key` |
| `transcript` | varchar | Full transcript JSON — ⚠️ SENSITIVE PII |
| `workspace_id` | varchar | |
| `dt` | varchar | Partition — YYYY-MM-DD |

### `gong_raw.meetings`

| Field | Type | Notes |
|-------|------|-------|
| `conversation_key` | varchar | **FK** → `gong_raw.calls.conversation_key` |
| `conversation_id` | varchar | Meeting-level ID |
| `call_id` | varchar | |
| `call_conversation_key` | varchar | |
| `title` | varchar | |
| `start_datetime` | timestamp(3) | |
| `end_datetime` | timestamp(3) | |
| `is_internal` | boolean | |
| `is_recurring` | boolean | |
| `is_canceled` | boolean | |
| `is_all_day` | boolean | |
| `type` | varchar | |
| `organizer_user_id` | decimal(38,19) | |
| `dt` | varchar | Partition — YYYY-MM-DD |

### `gong_raw.user_conversation_gong_activities`

| Field | Type | Notes |
|-------|------|-------|
| `conversation_key` | varchar | **FK** → `gong_raw.calls.conversation_key` |
| `user_id` | varchar | |
| `gong_activity_type` | varchar | Activity type (single column, not individual booleans) |
| `gong_activity_datetime` | timestamp(3) | |
| `dt` | varchar | Partition — YYYY-MM-DD |

### `gong_raw.gong_usage`

| Field | Type | Notes |
|-------|------|-------|
| `user_id` | varchar | FK → `users.user_id` |
| `user_name` | varchar | |
| `usage_date` | varchar | |
| `recorded_calls` | decimal | |
| `calls_listened_to` | decimal | |
| `minutes_listened_to_calls` | double | |
| `shared_calls` | decimal | |
| `commented_on_calls` | decimal | (NOT `comments_added`) |
| `reviewed_calls` | decimal | (NOT `calls_reviewed`) |
| `call_scorecards_given` | decimal | (NOT `scorecards_submitted`) |
| `had_gong_activity` | boolean | |
| ... | ... | 60+ additional usage metrics |
| `dt` | varchar | Partition — YYYY-MM-DD |

### `gong_raw.user_crm_ids`

| Field | Type | Notes |
|-------|------|-------|
| `user_id` | varchar | FK → `users.user_id` |
| `crm_user_id` | varchar | SFDC user ID |
| `dt` | varchar | Partition — YYYY-MM-DD |

### `gong_raw.workspaces`

| Field | Type | Notes |
|-------|------|-------|
| `workspace_id` | varchar | **PK** |
| `name` | varchar | Workspace name |
| `dt` | varchar | Partition — YYYY-MM-DD |

---

## Common Mistakes Quick Reference

| Broken | Correct | Why |
|--------|---------|-----|
| `iceberg.gong_raw.<table>` | `hive.gong_raw.<table>` | Iceberg catalog doesn't exist for gong_raw |
| `c.id` | `c.conversation_id` | `id` column doesn't exist on calls |
| `c.duration_sec` | Join `call_recordings.duration` via `conversation_key` | No `duration_sec` on calls |
| `c.id = cp.conversation_id` | `c.conversation_key = cp.conversation_key` | Participants only has `conversation_key` |
| `c.id = ist.conversation_id` | `c.conversation_key = ist.conversation_key` | interaction_stats uses `conversation_key` |
| `c.id = ctx.conversation_id` | `c.conversation_key = ctx.conversation_key` | contexts uses `conversation_key` |
| `c.id = ct.conversation_id` | `c.conversation_key = ct.conversation_key` | trackers uses `conversation_key` |
| `c.id = sa.conversation_id` | `c.conversation_key = sa.conversation_key` | scorecard_answers uses `conversation_key` |
| `c.id = cm.conversation_id` | `c.conversation_key = cm.conversation_key` | comments uses `conversation_key` |
| `ON ct.tracker_id = t.id` | `ON ct.tracker_id = t.tracker_id` | trackers PK is `tracker_id`, not `id` |
| `c.dt >= '20260101'` | `c.dt >= '2026-01-01'` | dt is YYYY-MM-DD with dashes |
| `c.dt >= DATE '2026-01-01'` | `c.dt >= '2026-01-01'` | dt is VARCHAR, not DATE |
| `FROM_UNIXTIME(c.effective_start_datetime)` | Direct comparison: `c.effective_start_datetime >= TIMESTAMP '2026-01-01 00:00:00'` | Already timestamp(3) |
| `c.key_points`, `c.next_steps` | `c.call_spotlight_key_points`, `c.call_spotlight_next_steps` | Full prefixed names |
| `cp.user_id = u.user_id` for person filter | `cp.email_address = 'user@stripe.com'` | user_id stored as float string |
| `c.conversation_id = r.call_id` for recordings | `c.conversation_key = r.conversation_key` | call_recordings has no `call_id` |
| `sa.answered_by` | `sa.gave_scorecard_user_id` | Field name differs |
| `cm.comment_text` | `cm.comment` | Field name differs |
| `cm.created_at` | `cm.created_datetime` | Field name differs |

---

## Pattern 1: Recent Calls by Account Name or Rep Email

**Question shape**: "Show me calls for [company] or by [rep] in [period]"

```sql
SELECT
  c.conversation_id                              AS call_id,
  c.title,
  c.effective_start_datetime                     AS call_date,
  cr.duration                                    AS duration_sec,
  c.direction,
  c.status,
  cp.email_address                               AS rep_email
FROM hive.gong_raw.calls c
JOIN hive.gong_raw.conversation_participants cp
  ON c.conversation_key = cp.conversation_key
LEFT JOIN hive.gong_raw.call_recordings cr
  ON c.conversation_key = cr.conversation_key
WHERE (c.is_deleted = false OR c.is_deleted IS NULL)
  AND c.dt >= '2026-01-01'                       -- PARAMETERIZE: YYYY-MM-DD
  AND cp.affiliation = 'company'
  AND (
    LOWER(c.title) LIKE '%nike%'                 -- PARAMETERIZE: account keyword
    OR LOWER(cp.email_address) = LOWER('rep@stripe.com')  -- PARAMETERIZE: rep email
  )
ORDER BY c.effective_start_datetime DESC
LIMIT 20
```

**Parameterization points**:
- Date range: `c.dt >= 'YYYY-MM-DD'`
- Account: `LOWER(c.title) LIKE '%<account>%'`
- Rep: `LOWER(cp.email_address) = LOWER('<email@stripe.com>')`

**Gotchas**:
- No `duration_sec` on calls — join `call_recordings` for duration
- `dt` uses dashes: `'2026-01-01'` not `'20260101'`
- Title/duration/spotlights are on `calls`, NOT on `conversations`
- `conversation_participants` only has ~5 months of history — for older calls, use Pattern 2 (title search) or Pattern 3 (SFDC context)

---

## Pattern 2: Calls Linked to a SFDC Opportunity or Account

**Question shape**: "Show calls for SFDC opp [ID] or account [ID]"
Prefer this over title-matching when you have a SFDC ID — it's authoritative.
**Not subject to the 5-month participant retention limitation.**

```sql
SELECT DISTINCT
  c.conversation_id                              AS call_id,
  c.title,
  c.effective_start_datetime                     AS call_date,
  c.call_spotlight_brief,
  c.call_spotlight_key_points,
  c.call_spotlight_next_steps,
  ctx.object_type,
  ctx.object_id
FROM hive.gong_raw.calls c
JOIN hive.gong_raw.conversation_contexts ctx
  ON c.conversation_key = ctx.conversation_key
WHERE (c.is_deleted = false OR c.is_deleted IS NULL)
  AND c.dt >= '2025-01-01'
  AND ctx.object_type IN ('opportunity', 'account')
  AND ctx.object_id IN ('<sfdc_opp_id>', '<sfdc_account_id>')  -- PARAMETERIZE
ORDER BY c.effective_start_datetime DESC
LIMIT 20
```

---

## Pattern 3: Resolve User Identity (Run BEFORE Any Person-Specific Query)

**Rule**: NEVER hardcode a `user_id`. Always resolve from `gong_raw.users` first.

```sql
-- Exact email match
SELECT user_id, email_address, title, first_name, last_name
FROM hive.gong_raw.users
WHERE LOWER(email_address) = LOWER('rep@stripe.com')
LIMIT 5;

-- Partial name match (when only a name was provided)
SELECT user_id, email_address, title, first_name, last_name
FROM hive.gong_raw.users
WHERE LOWER(email_address) LIKE '%lastname%'
LIMIT 10;
```

| Result | Action |
|--------|--------|
| 0 rows | Person not in Gong — tell user, do not proceed |
| Multiple rows | Present candidates (email + title), ask user to confirm |
| 1 row | Use that email for participant filtering, or `user_id` for usage/scorecard tables |

---

## Pattern 4: Rep Performance — Interaction Stats

**Question shape**: "How is [rep / team] performing on calls?"

```sql
SELECT
  cp.email_address                       AS rep_email,
  COUNT(DISTINCT c.conversation_id)      AS total_calls,
  ROUND(AVG(CAST(ist.talk_ratio AS double)), 3)    AS avg_talk_ratio,
  ROUND(AVG(ist.interactivity), 1)       AS avg_interactivity,
  ROUND(AVG(CAST(ist.question_rate AS double)), 2) AS avg_question_rate,
  ROUND(AVG(ist.patience), 1)            AS avg_patience,
  ROUND(AVG(ist.longest_monologue))      AS avg_longest_monologue_sec
FROM hive.gong_raw.calls c
JOIN hive.gong_raw.conversation_participants cp
  ON c.conversation_key = cp.conversation_key
JOIN hive.gong_raw.interaction_stats ist
  ON c.conversation_key = ist.conversation_key
WHERE (c.is_deleted = false OR c.is_deleted IS NULL)
  AND c.dt >= '2026-01-01'                        -- PARAMETERIZE
  AND cp.affiliation = 'company'
  -- AND LOWER(cp.email_address) = LOWER('rep@stripe.com')  -- PARAMETERIZE: optional
GROUP BY cp.email_address
HAVING COUNT(DISTINCT c.conversation_id) >= 5
ORDER BY total_calls DESC
LIMIT 100
```

---

## Pattern 5: Manager Team Rollup

**Question shape**: "Aggregate performance for [manager]'s team"

```sql
SELECT
  mgr.email_address                      AS manager_email,
  rep.email_address                      AS rep_email,
  COUNT(DISTINCT c.conversation_id)      AS total_calls,
  ROUND(AVG(CAST(ist.talk_ratio AS double)), 3)    AS avg_talk_ratio,
  ROUND(AVG(ist.interactivity), 1)       AS avg_interactivity
FROM hive.gong_raw.users rep
JOIN hive.gong_raw.users mgr
  ON rep.manager_id = mgr.user_id
JOIN hive.gong_raw.conversation_participants cp
  ON LOWER(rep.email_address) = LOWER(cp.email_address)
JOIN hive.gong_raw.calls c
  ON cp.conversation_key = c.conversation_key
JOIN hive.gong_raw.interaction_stats ist
  ON c.conversation_key = ist.conversation_key
WHERE (c.is_deleted = false OR c.is_deleted IS NULL)
  AND c.dt >= '2026-01-01'
  AND cp.affiliation = 'company'
  AND LOWER(mgr.email_address) = LOWER('manager@stripe.com')  -- PARAMETERIZE
GROUP BY mgr.email_address, rep.email_address
ORDER BY total_calls DESC
LIMIT 50
```

---

## Pattern 6: Scorecard Analysis

**Question shape**: "What are scorecard scores for [rep / team / period]?"

Note: `scorecard_answers` is denormalized — it already contains `question_text`, `scorecard_name`, etc. No need to join `scorecard_questions` unless you need question metadata not on the answers table.

```sql
SELECT
  sa.scorecard_name,
  sa.question_text,
  cp.email_address                               AS rep_email,
  ROUND(AVG(CAST(sa.answer_score AS double)), 2) AS avg_score,
  COUNT(*)                                       AS response_count
FROM hive.gong_raw.scorecard_answers sa
JOIN hive.gong_raw.calls c
  ON sa.conversation_key = c.conversation_key
JOIN hive.gong_raw.conversation_participants cp
  ON c.conversation_key = cp.conversation_key
WHERE sa.dt >= '2026-01-01'
  AND cp.affiliation = 'company'
  AND (c.is_deleted = false OR c.is_deleted IS NULL)
GROUP BY sa.scorecard_name, sa.question_text, cp.email_address
ORDER BY avg_score DESC
LIMIT 100
```

---

## Pattern 7: Keyword / Tracker Mentions

**Question shape**: "How often is [topic] mentioned across calls?"

```sql
SELECT
  t.name                                         AS tracker_name,
  COUNT(DISTINCT ct.conversation_key)            AS conversations_with_mention,
  SUM(CAST(ct.count AS bigint))                  AS total_mentions
FROM hive.gong_raw.conversation_trackers ct
JOIN hive.gong_raw.trackers t
  ON ct.tracker_id = t.tracker_id                -- trackers PK is tracker_id
JOIN hive.gong_raw.calls c
  ON ct.conversation_key = c.conversation_key
WHERE (c.is_deleted = false OR c.is_deleted IS NULL)
  AND c.dt >= '2026-01-01'
  -- AND LOWER(t.name) LIKE '%competitor%'       -- PARAMETERIZE
GROUP BY t.name
ORDER BY total_mentions DESC
LIMIT 50
```

---

## Pattern 8: Call Duration Analysis (via call_recordings)

**Question shape**: "What is the average call length for [rep / period]?"

```sql
SELECT
  cp.email_address                               AS rep_email,
  COUNT(DISTINCT c.conversation_id)              AS total_calls,
  ROUND(AVG(CAST(cr.duration AS double)), 0)     AS avg_duration_sec,
  ROUND(AVG(CAST(cr.duration AS double)) / 60, 1) AS avg_duration_min
FROM hive.gong_raw.calls c
JOIN hive.gong_raw.conversation_participants cp
  ON c.conversation_key = cp.conversation_key
JOIN hive.gong_raw.call_recordings cr
  ON c.conversation_key = cr.conversation_key
WHERE (c.is_deleted = false OR c.is_deleted IS NULL)
  AND c.dt >= '2026-01-01'
  AND c.status = 'COMPLETED'
  AND cp.affiliation = 'company'
GROUP BY cp.email_address
ORDER BY total_calls DESC
LIMIT 50
```

---

## Pattern 9: Coaching Activity (Comments)

**Question shape**: "Who is leaving the most coaching comments?"

```sql
SELECT
  cm.user_id,
  u.email_address                                AS commenter_email,
  COUNT(DISTINCT cm.comment_id)                  AS total_comments,
  COUNT(DISTINCT cm.conversation_key)            AS calls_commented_on,
  MIN(cm.created_datetime)                       AS first_comment,
  MAX(cm.created_datetime)                       AS last_comment
FROM hive.gong_raw.comments cm
JOIN hive.gong_raw.users u
  ON cm.user_id = u.user_id
WHERE cm.dt >= '2026-01-01'
  AND (cm.is_deleted = false OR cm.is_deleted IS NULL)
GROUP BY cm.user_id, u.email_address
ORDER BY total_comments DESC
LIMIT 50
```
