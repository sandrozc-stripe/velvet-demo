-- ============================================================
-- gong-librarian: Query Templates
-- Verified against live Hubble schema: 2026-04-30
--
-- SCHEMA RULES REMINDER:
--   • Table prefix: hive.gong_raw.<table>
--   • Calls PK: conversation_id
--   • Universal FK: conversation_key (ALL child tables)
--   • No duration_sec on calls — join call_recordings for duration
--   • Trackers PK: tracker_id (NOT id)
--   • dt format: YYYY-MM-DD with dashes (e.g. '2026-01-01')
--   • Timestamps: native timestamp(3) — compare directly
--   • Person filter: cp.email_address (not cp.user_id)
--
-- Index:
--   T01  Rep Call Performance (interaction_stats per rep)
--   T02  Team / Manager Rollup (manager hierarchy + stats)
--   T03  User Adoption Summary (gong_usage)
--   T04  Per-Call Engagement Detail (user_conversation_gong_activities)
--   T05  Scorecard Health by Rep (scorecard_answers — denormalized)
--   T06  Scorecard Team Rollup (scorecard by manager)
--   T07  Tracker / Topic Frequency (trackers + conversation_trackers)
--   T08  Tracker Trend Over Time (week-over-week topic mentions)
--   T09  Meeting Metadata Analysis (meetings table)
--   T10  Call Duration Audit (call_recordings)
--   T11  Coaching Activity Analysis (comments)
--   T12  SFDC Deal Activity (conversation_contexts)
--   T13  CRM Sync Coverage (user_crm_ids)
--   T14  Workspace Usage Breakdown (workspaces)
--   T15  Transcript Keyword Search (call_transcripts — SENSITIVE)
-- ============================================================


-- ============================================================
-- T01: Rep Call Performance
-- Tables: calls, interaction_stats, conversation_participants
-- ============================================================
SELECT
  cp.email_address                                AS rep_email,
  COUNT(DISTINCT c.conversation_id)              AS total_calls,
  ROUND(AVG(CAST(ist.talk_ratio AS double)), 2)  AS avg_talk_ratio,
  ROUND(AVG(ist.interactivity), 2)               AS avg_interactivity,
  ROUND(AVG(CAST(ist.question_rate AS double)), 2) AS avg_question_rate,
  ROUND(AVG(ist.patience), 2)                    AS avg_patience,
  ROUND(AVG(ist.longest_monologue), 1)           AS avg_longest_monologue_sec,
  MIN(c.dt)                                      AS first_call_date,
  MAX(c.dt)                                      AS last_call_date
FROM hive.gong_raw.calls c
JOIN hive.gong_raw.conversation_participants cp
  ON c.conversation_key = cp.conversation_key
JOIN hive.gong_raw.interaction_stats ist
  ON c.conversation_key = ist.conversation_key
WHERE (c.is_deleted = false OR c.is_deleted IS NULL)
  AND c.dt >= '2026-01-01'
  AND c.dt <  '2026-04-01'
  AND cp.affiliation = 'company'
GROUP BY cp.email_address
HAVING COUNT(DISTINCT c.conversation_id) >= 5
ORDER BY total_calls DESC
LIMIT 200;


-- ============================================================
-- T02: Team / Manager Rollup
-- Tables: calls, interaction_stats, conversation_participants, users
-- ============================================================
SELECT
  mgr.email_address                              AS manager_email,
  mgr.title                                      AS manager_title,
  COUNT(DISTINCT rep.user_id)                    AS team_size,
  COUNT(DISTINCT c.conversation_id)              AS total_team_calls,
  ROUND(AVG(CAST(ist.talk_ratio AS double)), 2)  AS avg_talk_ratio,
  ROUND(AVG(ist.interactivity), 2)               AS avg_interactivity,
  ROUND(AVG(CAST(ist.question_rate AS double)), 2) AS avg_question_rate,
  ROUND(AVG(ist.patience), 2)                    AS avg_patience,
  ROUND(AVG(ist.longest_monologue), 1)           AS avg_longest_monologue_sec
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
GROUP BY mgr.email_address, mgr.title
ORDER BY total_team_calls DESC
LIMIT 100;


-- ============================================================
-- T03: User Adoption Summary
-- Tables: users, gong_usage
-- ============================================================
SELECT
  u.email_address,
  u.title,
  gu.recorded_calls,
  gu.calls_listened_to,
  gu.minutes_listened_to_calls,
  gu.shared_calls,
  gu.commented_on_calls,
  gu.reviewed_calls,
  gu.call_scorecards_given,
  (
    COALESCE(CAST(gu.recorded_calls AS bigint), 0)        * 3 +
    COALESCE(CAST(gu.calls_listened_to AS bigint), 0)     * 2 +
    COALESCE(CAST(gu.commented_on_calls AS bigint), 0)    * 2 +
    COALESCE(CAST(gu.call_scorecards_given AS bigint), 0) * 3 +
    COALESCE(CAST(gu.shared_calls AS bigint), 0)          * 1
  )                                                AS composite_adoption_score,
  gu.dt                                            AS period
FROM hive.gong_raw.users u
JOIN hive.gong_raw.gong_usage gu
  ON u.user_id = gu.user_id
WHERE gu.dt >= '2026-01-01'
ORDER BY composite_adoption_score DESC
LIMIT 200;


-- ============================================================
-- T04: Per-Call Engagement Detail
-- Tables: calls, user_conversation_gong_activities, users
-- ============================================================
SELECT
  c.conversation_id                              AS call_id,
  c.title                                        AS call_title,
  c.effective_start_datetime                     AS call_date,
  ucga.user_id,
  u.email_address,
  ucga.gong_activity_type,
  ucga.gong_activity_datetime
FROM hive.gong_raw.calls c
JOIN hive.gong_raw.user_conversation_gong_activities ucga
  ON c.conversation_key = ucga.conversation_key
JOIN hive.gong_raw.users u
  ON ucga.user_id = u.user_id
WHERE (c.is_deleted = false OR c.is_deleted IS NULL)
  AND c.dt >= '2026-01-01'
ORDER BY c.effective_start_datetime DESC
LIMIT 200;


-- ============================================================
-- T05: Scorecard Health by Rep
-- Tables: scorecard_answers, calls, conversation_participants
-- Note: scorecard_answers is denormalized — has question_text directly
-- ============================================================
SELECT
  cp.email_address                               AS rep_email,
  sa.scorecard_name,
  sa.question_text,
  ROUND(AVG(CAST(sa.answer_score AS double)), 2) AS avg_score,
  COUNT(*)                                       AS times_scored,
  COUNT(DISTINCT sa.conversation_key)            AS calls_scored
FROM hive.gong_raw.scorecard_answers sa
JOIN hive.gong_raw.calls c
  ON sa.conversation_key = c.conversation_key
JOIN hive.gong_raw.conversation_participants cp
  ON c.conversation_key = cp.conversation_key
WHERE sa.dt >= '2026-01-01'
  AND cp.affiliation = 'company'
  AND (c.is_deleted = false OR c.is_deleted IS NULL)
GROUP BY cp.email_address, sa.scorecard_name, sa.question_text
ORDER BY avg_score ASC
LIMIT 200;


-- ============================================================
-- T06: Scorecard Team Rollup (by manager)
-- ============================================================
SELECT
  mgr.email_address                              AS manager_email,
  sa.scorecard_name,
  ROUND(AVG(CAST(sa.answer_score AS double)), 2) AS avg_team_score,
  COUNT(*)                                       AS total_evaluations,
  COUNT(DISTINCT rep.email_address)              AS reps_evaluated
FROM hive.gong_raw.scorecard_answers sa
JOIN hive.gong_raw.calls c
  ON sa.conversation_key = c.conversation_key
JOIN hive.gong_raw.conversation_participants cp
  ON c.conversation_key = cp.conversation_key
JOIN hive.gong_raw.users rep
  ON LOWER(cp.email_address) = LOWER(rep.email_address)
JOIN hive.gong_raw.users mgr
  ON rep.manager_id = mgr.user_id
WHERE sa.dt >= '2026-01-01'
  AND cp.affiliation = 'company'
  AND (c.is_deleted = false OR c.is_deleted IS NULL)
GROUP BY mgr.email_address, sa.scorecard_name
ORDER BY avg_team_score ASC
LIMIT 100;


-- ============================================================
-- T07: Tracker / Topic Frequency
-- Tables: conversation_trackers, trackers, calls
-- ============================================================
SELECT
  t.name                                         AS tracker_name,
  t.tracker_type,
  COUNT(DISTINCT ctr.conversation_key)           AS conversations_with_mention,
  SUM(CAST(ctr.count AS bigint))                 AS total_mentions,
  ROUND(AVG(CAST(ctr.count AS double)), 1)       AS avg_mentions_per_call
FROM hive.gong_raw.conversation_trackers ctr
JOIN hive.gong_raw.trackers t
  ON ctr.tracker_id = t.tracker_id               -- PK is tracker_id, NOT id
JOIN hive.gong_raw.calls c
  ON ctr.conversation_key = c.conversation_key
WHERE (c.is_deleted = false OR c.is_deleted IS NULL)
  AND c.dt >= '2026-01-01'
GROUP BY t.name, t.tracker_type
ORDER BY total_mentions DESC
LIMIT 100;


-- ============================================================
-- T08: Tracker Trend Over Time (weekly)
-- ============================================================
SELECT
  DATE_TRUNC('week', c.effective_start_datetime) AS week_start,
  t.name                                         AS tracker_name,
  COUNT(DISTINCT ctr.conversation_key)           AS conversations_with_mention,
  SUM(CAST(ctr.count AS bigint))                 AS total_mentions
FROM hive.gong_raw.conversation_trackers ctr
JOIN hive.gong_raw.trackers t
  ON ctr.tracker_id = t.tracker_id
JOIN hive.gong_raw.calls c
  ON ctr.conversation_key = c.conversation_key
WHERE (c.is_deleted = false OR c.is_deleted IS NULL)
  AND c.dt >= '2026-01-01'
  AND LOWER(t.name) LIKE '%competitor%'          -- PARAMETERIZE
GROUP BY DATE_TRUNC('week', c.effective_start_datetime), t.name
ORDER BY week_start DESC, total_mentions DESC
LIMIT 200;


-- ============================================================
-- T09: Meeting Metadata Analysis
-- Tables: meetings, calls
-- ============================================================
SELECT
  m.title,
  m.start_datetime,
  m.end_datetime,
  m.is_internal,
  m.is_recurring,
  m.type,
  c.status                                       AS call_status,
  c.call_spotlight_brief
FROM hive.gong_raw.calls c
JOIN hive.gong_raw.meetings m
  ON c.conversation_key = m.conversation_key
WHERE (c.is_deleted = false OR c.is_deleted IS NULL)
  AND c.dt >= '2026-01-01'
ORDER BY m.start_datetime DESC
LIMIT 100;


-- ============================================================
-- T10: Call Duration Audit (via call_recordings)
-- ============================================================
SELECT
  c.conversation_id,
  c.title,
  c.effective_start_datetime,
  c.status,
  CAST(cr.duration AS bigint)                    AS duration_sec,
  ROUND(CAST(cr.duration AS double) / 60, 1)    AS duration_min,
  cr.language,
  cr.media_type
FROM hive.gong_raw.calls c
JOIN hive.gong_raw.call_recordings cr
  ON c.conversation_key = cr.conversation_key
WHERE (c.is_deleted = false OR c.is_deleted IS NULL)
  AND c.dt >= '2026-01-01'
  AND c.status = 'COMPLETED'
ORDER BY cr.duration DESC
LIMIT 100;


-- ============================================================
-- T11: Coaching Activity Analysis (comments)
-- Tables: comments, users, calls
-- ============================================================
SELECT
  u.email_address                                AS commenter,
  u.title,
  COUNT(DISTINCT cm.comment_id)                  AS total_comments,
  COUNT(DISTINCT cm.conversation_key)            AS unique_calls_commented,
  MIN(cm.created_datetime)                       AS first_comment_date,
  MAX(cm.created_datetime)                       AS latest_comment_date
FROM hive.gong_raw.comments cm
JOIN hive.gong_raw.users u
  ON cm.user_id = u.user_id
WHERE cm.dt >= '2026-01-01'
  AND (cm.is_deleted = false OR cm.is_deleted IS NULL)
GROUP BY u.email_address, u.title
ORDER BY total_comments DESC
LIMIT 100;


-- ============================================================
-- T12: SFDC Deal Activity (conversation_contexts)
-- Tables: conversation_contexts, calls
-- Not subject to 5-month participant retention limitation.
-- ============================================================
SELECT
  ctx.object_type,
  ctx.object_id                                  AS sfdc_id,
  COUNT(DISTINCT c.conversation_id)              AS total_calls,
  MIN(c.effective_start_datetime)                AS first_call,
  MAX(c.effective_start_datetime)                AS last_call,
  ARRAY_AGG(DISTINCT c.title)                    AS call_titles
FROM hive.gong_raw.calls c
JOIN hive.gong_raw.conversation_contexts ctx
  ON c.conversation_key = ctx.conversation_key
WHERE (c.is_deleted = false OR c.is_deleted IS NULL)
  AND c.dt >= '2025-01-01'
  AND ctx.object_type IN ('opportunity', 'account')
GROUP BY ctx.object_type, ctx.object_id
ORDER BY total_calls DESC
LIMIT 100;


-- ============================================================
-- T13: CRM Sync Coverage (user_crm_ids)
-- Tables: users, user_crm_ids
-- Find users missing SFDC mapping.
-- ============================================================
SELECT
  u.email_address,
  u.title,
  u.active,
  uci.crm_user_id                               AS sfdc_user_id,
  CASE WHEN uci.crm_user_id IS NULL THEN 'MISSING' ELSE 'MAPPED' END AS crm_status
FROM hive.gong_raw.users u
LEFT JOIN hive.gong_raw.user_crm_ids uci
  ON u.user_id = uci.user_id
WHERE u.active = true
ORDER BY crm_status ASC, u.email_address
LIMIT 200;


-- ============================================================
-- T14: Workspace Usage Breakdown
-- Tables: workspaces, calls
-- ============================================================
SELECT
  w.workspace_id,
  w.name                                         AS workspace_name,
  COUNT(DISTINCT c.conversation_id)              AS total_calls
FROM hive.gong_raw.workspaces w
JOIN hive.gong_raw.calls c
  ON w.workspace_id = c.workspace_id
WHERE (c.is_deleted = false OR c.is_deleted IS NULL)
  AND c.dt >= '2026-01-01'
GROUP BY w.workspace_id, w.name
ORDER BY total_calls DESC
LIMIT 50;


-- ============================================================
-- T15: Transcript Keyword Search
-- ⚠️ SENSITIVE — PII and confidential customer information
-- Verify user permissions before executing.
-- ============================================================
SELECT
  c.conversation_id,
  c.title,
  c.effective_start_datetime,
  ct.transcript
FROM hive.gong_raw.calls c
JOIN hive.gong_raw.call_transcripts ct
  ON c.conversation_key = ct.conversation_key
WHERE (c.is_deleted = false OR c.is_deleted IS NULL)
  AND c.dt >= '2026-01-01'
  AND LOWER(ct.transcript) LIKE '%keyword%'      -- PARAMETERIZE
ORDER BY c.effective_start_datetime DESC
LIMIT 10;
