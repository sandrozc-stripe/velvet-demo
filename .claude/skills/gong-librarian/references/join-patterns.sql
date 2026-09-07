-- ============================================================
-- gong-librarian: Standard Join Patterns
-- Verified against live Hubble schema: 2026-04-30
--
-- CRITICAL SCHEMA RULES:
--
--  1. Table prefix: hive.gong_raw.<table> (NOT iceberg)
--
--  2. Primary key for calls: conversation_id
--     Universal FK for ALL child tables: conversation_key
--
--  3. No duration_sec on calls — use call_recordings.duration
--
--  4. dt is VARCHAR YYYY-MM-DD with dashes
--     CORRECT:  AND c.dt >= '2026-01-01'
--     WRONG:    AND c.dt >= '20260101'
--
--  5. Timestamps are native timestamp(3) — compare directly
--     CORRECT:  c.effective_start_datetime >= TIMESTAMP '2026-01-01'
--     WRONG:    FROM_UNIXTIME(c.effective_start_datetime)
--
--  6. Person filtering: cp.email_address (not cp.user_id)
--
--  7. Trackers PK: tracker_id (NOT id)
--
-- Table index:
--   HUB          calls · conversations · users
--   CONTENT      call_transcripts · call_recordings · meetings · comments
--   PARTICIPANT  conversation_participants · conversation_contexts
--                user_crm_ids · workspaces
--   ANALYTICS    interaction_stats · gong_usage · scorecard_answers
--                scorecard_questions · trackers · conversation_trackers
--                user_conversation_gong_activities
-- ============================================================


-- ============================================================
-- SECTION A: HUB + CONTENT JOINS
-- ============================================================

-- ------------------------------------------------------------
-- A1. Core Call + Rep Participants (by email)
--     Use for any call-level query that needs rep identity.
--     This is the canonical starting pattern.
-- ------------------------------------------------------------
FROM hive.gong_raw.calls c
JOIN hive.gong_raw.conversation_participants cp
  ON c.conversation_key = cp.conversation_key   -- universal FK
WHERE (c.is_deleted = false OR c.is_deleted IS NULL)
  AND c.dt >= '2026-01-01'                      -- YYYY-MM-DD with dashes
  AND cp.affiliation = 'company'                -- 'company' = Stripe internal rep
  AND cp.email_address = 'rep@stripe.com'       -- filter by email, not user_id

-- calls key fields:
--   c.conversation_id              VARCHAR  primary key
--   c.conversation_key             VARCHAR  universal FK for all child tables
--   c.title                        VARCHAR  call title
--   c.direction                    VARCHAR  'INBOUND' | 'OUTBOUND'
--   c.status                       VARCHAR  'COMPLETED' | 'IN_PROGRESS' | 'CANCELLED' | ...
--   c.effective_start_datetime     TIMESTAMP(3)  native — compare directly
--   c.call_spotlight_brief         VARCHAR  AI summary
--   c.call_spotlight_key_points    VARCHAR  AI key points
--   c.call_spotlight_next_steps    VARCHAR  AI next steps
--   c.workspace_id                 VARCHAR  FK → workspaces
--   c.browser_duration_sec         DOUBLE   browser-based duration
--
-- ⚠️ NO c.id, NO c.duration_sec columns exist


-- ------------------------------------------------------------
-- A2. Call + Meeting Metadata
-- ------------------------------------------------------------
FROM hive.gong_raw.calls c
JOIN hive.gong_raw.meetings m
  ON c.conversation_key = m.conversation_key
WHERE (c.is_deleted = false OR c.is_deleted IS NULL)
  AND c.dt >= '2026-01-01'

-- meetings key fields:
--   m.title              VARCHAR
--   m.start_datetime     TIMESTAMP(3)
--   m.end_datetime       TIMESTAMP(3)
--   m.is_internal        BOOLEAN
--   m.is_recurring       BOOLEAN
--   m.is_canceled        BOOLEAN


-- ------------------------------------------------------------
-- A3. Call + Recording Details (for duration)
--     call_recordings.duration is the best source for total
--     call duration in seconds.
-- ------------------------------------------------------------
FROM hive.gong_raw.calls c
JOIN hive.gong_raw.call_recordings cr
  ON c.conversation_key = cr.conversation_key   -- NOT c.id = cr.call_id
WHERE (c.is_deleted = false OR c.is_deleted IS NULL)
  AND c.dt >= '2026-01-01'

-- call_recordings key fields:
--   cr.conversation_key  VARCHAR  FK → calls.conversation_key
--   cr.duration          DECIMAL  seconds — best source for call duration
--   cr.language          VARCHAR  (e.g. 'en-US')
--   cr.media_type        VARCHAR  (e.g. 'audio', 'video')


-- ------------------------------------------------------------
-- A4. Call + Transcripts (SENSITIVE — verify permissions)
-- ------------------------------------------------------------
FROM hive.gong_raw.calls c
JOIN hive.gong_raw.call_transcripts ct
  ON c.conversation_key = ct.conversation_key
WHERE (c.is_deleted = false OR c.is_deleted IS NULL)
  AND c.dt >= '2026-01-01'

-- call_transcripts key fields:
--   ct.conversation_key  VARCHAR  FK → calls.conversation_key
--   ct.transcript        VARCHAR  JSON transcript content — ⚠️ PII


-- ------------------------------------------------------------
-- A5. Call + Comments (coaching notes)
-- ------------------------------------------------------------
FROM hive.gong_raw.calls c
JOIN hive.gong_raw.comments cm
  ON c.conversation_key = cm.conversation_key
WHERE (c.is_deleted = false OR c.is_deleted IS NULL)
  AND c.dt >= '2026-01-01'

-- comments key fields:
--   cm.conversation_key     VARCHAR  FK → calls.conversation_key
--   cm.comment              VARCHAR  comment content (NOT comment_text)
--   cm.user_id              VARCHAR  who wrote the comment
--   cm.time_in_call_sec     DECIMAL  timestamp within call
--   cm.created_datetime     TIMESTAMP(3)  (NOT created_at)


-- ============================================================
-- SECTION B: PARTICIPANT + CONTEXT JOINS
-- ============================================================

-- ------------------------------------------------------------
-- B1. Call + SFDC Context (opportunity / account lookup)
--     Not subject to the 5-month participant retention limit.
-- ------------------------------------------------------------
FROM hive.gong_raw.calls c
JOIN hive.gong_raw.conversation_contexts ctx
  ON c.conversation_key = ctx.conversation_key  -- NOT conversation_id
WHERE (c.is_deleted = false OR c.is_deleted IS NULL)
  AND c.dt >= '2025-01-01'
  AND ctx.object_type IN ('opportunity', 'account')
  AND ctx.object_id = '<sfdc_id>'               -- PARAMETERIZE

-- conversation_contexts key fields:
--   ctx.conversation_key  VARCHAR  FK → calls.conversation_key
--   ctx.object_type       VARCHAR  'opportunity' | 'account' | 'contact'
--   ctx.object_id         VARCHAR  SFDC ID (001... = account, 006... = opp)


-- ============================================================
-- SECTION C: ANALYTICS JOINS
-- ============================================================

-- ------------------------------------------------------------
-- C1. Call + Interaction Stats
-- ------------------------------------------------------------
FROM hive.gong_raw.calls c
JOIN hive.gong_raw.interaction_stats ist
  ON c.conversation_key = ist.conversation_key  -- NOT conversation_id
WHERE (c.is_deleted = false OR c.is_deleted IS NULL)
  AND c.dt >= '2026-01-01'

-- interaction_stats key fields:
--   ist.conversation_key    VARCHAR  FK → calls.conversation_key
--   ist.call_id             VARCHAR  equals calls.conversation_id (alt join key)
--   ist.talk_ratio          DECIMAL  0–1. Ideal: 0.40–0.60
--   ist.interactivity       DOUBLE   0–100. Higher = better
--   ist.patience            DOUBLE   Higher = better
--   ist.question_rate       DECIMAL  Questions/min. Ideal: 3–5
--   ist.longest_monologue   DOUBLE   Seconds. Ideal: <120


-- ------------------------------------------------------------
-- C2. Call + Scorecard Answers
--     Denormalized — question_text is directly on scorecard_answers.
-- ------------------------------------------------------------
FROM hive.gong_raw.calls c
JOIN hive.gong_raw.scorecard_answers sa
  ON c.conversation_key = sa.conversation_key   -- NOT conversation_id
WHERE (c.is_deleted = false OR c.is_deleted IS NULL)
  AND c.dt >= '2026-01-01'

-- scorecard_answers key fields:
--   sa.conversation_key           VARCHAR  FK → calls.conversation_key
--   sa.scorecard_name             VARCHAR
--   sa.question_text              VARCHAR  (denormalized from scorecard_questions)
--   sa.answer_score               DECIMAL
--   sa.gave_scorecard_user_id     VARCHAR  who scored (NOT answered_by)
--   sa.received_scorecard_user_id VARCHAR  who was scored


-- ------------------------------------------------------------
-- C3. Call + Tracker Mentions
-- ------------------------------------------------------------
FROM hive.gong_raw.calls c
JOIN hive.gong_raw.conversation_trackers ctr
  ON c.conversation_key = ctr.conversation_key  -- NOT conversation_id
JOIN hive.gong_raw.trackers t
  ON ctr.tracker_id = t.tracker_id              -- trackers PK is tracker_id, NOT id
WHERE (c.is_deleted = false OR c.is_deleted IS NULL)
  AND c.dt >= '2026-01-01'

-- conversation_trackers key fields:
--   ctr.conversation_key  VARCHAR  FK → calls.conversation_key
--   ctr.tracker_id        VARCHAR  FK → trackers.tracker_id
--   ctr.count             DECIMAL  times tracker fired

-- trackers key fields:
--   t.tracker_id          VARCHAR  PK (NOT id)
--   t.name                VARCHAR  tracker name
--   t.keywords            VARCHAR  trigger keywords


-- ------------------------------------------------------------
-- C4. User Adoption (gong_usage — no call join needed)
-- ------------------------------------------------------------
FROM hive.gong_raw.users u
JOIN hive.gong_raw.gong_usage gu
  ON u.user_id = gu.user_id
WHERE gu.dt >= '2026-01-01'

-- gong_usage key fields:
--   gu.user_id                 VARCHAR
--   gu.recorded_calls          DECIMAL
--   gu.calls_listened_to       DECIMAL
--   gu.minutes_listened_to_calls  DOUBLE
--   gu.shared_calls            DECIMAL
--   gu.commented_on_calls      DECIMAL  (NOT comments_added)
--   gu.reviewed_calls          DECIMAL  (NOT calls_reviewed)
--   gu.call_scorecards_given   DECIMAL  (NOT scorecards_submitted)


-- ------------------------------------------------------------
-- C5. Manager Hierarchy
-- ------------------------------------------------------------
FROM hive.gong_raw.users rep
JOIN hive.gong_raw.users mgr
  ON rep.manager_id = mgr.user_id


-- ------------------------------------------------------------
-- C6. Per-Call User Activity
-- ------------------------------------------------------------
FROM hive.gong_raw.calls c
JOIN hive.gong_raw.user_conversation_gong_activities ucga
  ON c.conversation_key = ucga.conversation_key
WHERE (c.is_deleted = false OR c.is_deleted IS NULL)
  AND c.dt >= '2026-01-01'

-- user_conversation_gong_activities key fields:
--   ucga.conversation_key       VARCHAR  FK → calls.conversation_key
--   ucga.user_id                VARCHAR
--   ucga.gong_activity_type     VARCHAR  activity type (single column)
--   ucga.gong_activity_datetime TIMESTAMP(3)


-- ------------------------------------------------------------
-- C7. CRM User ID Mapping
-- ------------------------------------------------------------
FROM hive.gong_raw.users u
JOIN hive.gong_raw.user_crm_ids uci
  ON u.user_id = uci.user_id

-- user_crm_ids key fields:
--   uci.user_id       VARCHAR  FK → users.user_id
--   uci.crm_user_id   VARCHAR  SFDC user ID
