-- ============================================================
-- gong-librarian: End-to-End Worked Examples
-- Verified against live Hubble schema: 2026-04-30
--
-- Example 1: Rep performance deep-dive for Q1 2026
-- Example 2: SFDC deal activity for open opportunities
-- Example 3: Coaching gap identification (low stats + low scorecards)
--
-- SCHEMA RULES (see join-patterns.sql for full details):
--   • Table prefix: hive.gong_raw.<table>
--   • Calls PK: conversation_id
--   • Universal FK: conversation_key (ALL child tables)
--   • dt: YYYY-MM-DD with dashes
--   • Timestamps: native timestamp(3) — compare directly
--   • Person filter: cp.email_address (not cp.user_id)
--   • Duration: call_recordings.duration (no duration_sec on calls)
--   • Trackers PK: tracker_id (not id)
-- ============================================================


-- ============================================================
-- EXAMPLE 1: Sales Rep Performance — Q1 2026
-- Business question: "How did each rep perform in Q1 2026?
--   Surface top performers and flag coaching targets."
-- Tables: calls, interaction_stats, conversation_participants
-- ============================================================

-- Step 1 — Understand: Q1 = Jan 1–Mar 31 2026. Rep-level.
--           Need interaction stats + call volume. No PII needed. ✅
-- Step 2 — Validate: No transcript access. Aggregated only. ✅
-- Step 3 — Query

SELECT
  cp.email_address                               AS rep_email,
  COUNT(DISTINCT c.conversation_id)              AS total_calls,
  ROUND(AVG(CAST(ist.talk_ratio AS double)), 2)  AS avg_talk_ratio,
  ROUND(AVG(ist.interactivity), 2)               AS avg_interactivity,
  ROUND(AVG(CAST(ist.question_rate AS double)), 2) AS avg_question_rate,
  ROUND(AVG(ist.patience), 2)                    AS avg_patience,
  ROUND(AVG(ist.longest_monologue), 1)           AS avg_longest_monologue_sec,
  -- Coaching flags
  CASE
    WHEN AVG(CAST(ist.talk_ratio AS double)) > 0.60 THEN 'talking too much'
    WHEN AVG(CAST(ist.talk_ratio AS double)) < 0.40 THEN 'not engaging enough'
    ELSE 'healthy'
  END                                            AS talk_ratio_flag,
  CASE
    WHEN AVG(CAST(ist.question_rate AS double)) < 3 THEN 'low discovery'
    WHEN AVG(CAST(ist.question_rate AS double)) > 5 THEN 'interrogation risk'
    ELSE 'healthy'
  END                                            AS question_rate_flag,
  CASE
    WHEN AVG(ist.longest_monologue) > 120 THEN 'monologue risk'
    ELSE 'ok'
  END                                            AS monologue_flag
FROM hive.gong_raw.calls c
JOIN hive.gong_raw.conversation_participants cp
  ON c.conversation_key = cp.conversation_key
JOIN hive.gong_raw.interaction_stats ist
  ON c.conversation_key = ist.conversation_key
WHERE (c.is_deleted = false OR c.is_deleted IS NULL)
  AND c.dt >= '2026-01-01'
  AND c.dt <  '2026-04-01'          -- Q1 upper bound (exclusive)
  AND cp.affiliation = 'company'     -- internal reps only
GROUP BY cp.email_address
HAVING COUNT(DISTINCT c.conversation_id) >= 5   -- exclude low-call outliers
ORDER BY total_calls DESC
LIMIT 100;

-- Step 4 — Interpret results:
--   • Sort by total_calls DESC to see most active reps
--   • Filter talk_ratio_flag != 'healthy' for coaching targets
--   • Filter question_rate_flag = 'low discovery' for discovery coaching
--   • Filter monologue_flag = 'monologue risk' for listening coaching
--   • Benchmark: compare each rep vs company avg across all metrics


-- ============================================================
-- EXAMPLE 2: SFDC Deal Activity Audit
-- Business question: "For a list of open opportunities, how many
--   calls have happened? What is the call quality? Are multi-
--   stakeholder calls happening?"
-- Tables: conversation_contexts, calls, call_recordings,
--         interaction_stats, conversation_participants
-- ============================================================

-- Step 1 — Understand: Need deal-level rollup. Join via
--           conversation_contexts (object_type = 'opportunity').
--           Need call volume, quality stats, and stakeholder count.
--           conversation_contexts has NO retention limit — full history.
-- Step 2 — Validate: No transcript access needed. ✅

-- Sub-query: How many external participants per call?
WITH external_participant_counts AS (
  SELECT
    conversation_key,
    COUNT(*) AS external_count
  FROM hive.gong_raw.conversation_participants
  WHERE affiliation = 'non_company'
    AND dt >= '2025-06-01'           -- within retention window
  GROUP BY conversation_key
)

SELECT
  ctx.object_id                                  AS sfdc_opportunity_id,
  COUNT(DISTINCT c.conversation_id)              AS total_calls,
  MIN(c.effective_start_datetime)                AS first_call_at,
  MAX(c.effective_start_datetime)                AS last_call_at,
  ROUND(SUM(CAST(cr.duration AS double)) / 3600.0, 1) AS total_call_hours,
  ROUND(AVG(CAST(cr.duration AS double)) / 60.0, 1)   AS avg_call_duration_min,
  -- Quality metrics
  ROUND(AVG(CAST(ist.talk_ratio AS double)), 2)  AS avg_talk_ratio,
  ROUND(AVG(ist.interactivity), 2)               AS avg_interactivity,
  ROUND(AVG(CAST(ist.question_rate AS double)), 2) AS avg_question_rate,
  -- Stakeholder engagement
  MAX(epc.external_count)                        AS max_external_on_single_call,
  COUNT(DISTINCT CASE WHEN epc.external_count > 2
    THEN c.conversation_id END)                  AS multi_stakeholder_calls,
  -- Recency signal
  DATE_DIFF('day', MAX(c.effective_start_datetime), CURRENT_TIMESTAMP) AS days_since_last_call
FROM hive.gong_raw.conversation_contexts ctx
JOIN hive.gong_raw.calls c
  ON ctx.conversation_key = c.conversation_key
LEFT JOIN hive.gong_raw.call_recordings cr
  ON c.conversation_key = cr.conversation_key
LEFT JOIN hive.gong_raw.interaction_stats ist
  ON c.conversation_key = ist.conversation_key
LEFT JOIN external_participant_counts epc
  ON c.conversation_key = epc.conversation_key
WHERE (c.is_deleted = false OR c.is_deleted IS NULL)
  AND c.dt >= '2025-01-01'
  AND ctx.object_type = 'opportunity'
  AND ctx.object_id IN (
    '<sfdc_opp_id_1>',                -- PARAMETERIZE
    '<sfdc_opp_id_2>',
    '<sfdc_opp_id_3>'
  )
GROUP BY ctx.object_id
ORDER BY days_since_last_call ASC;   -- most recently active deals first

-- Step 4 — Interpret results:
--   • total_calls = 0 → no Gong calls linked; check CRM sync (see T13)
--   • days_since_last_call > 14 → deal going dark, needs follow-up
--   • multi_stakeholder_calls = 0 → only single contact engaged; risk
--   • avg_talk_ratio > 0.60 → rep monologuing on this deal; coaching flag
--   • avg_question_rate < 3 → insufficient discovery on this deal


-- ============================================================
-- EXAMPLE 3: Coaching Gap Identification
-- Business question: "Which reps have both poor interaction stats
--   AND low scorecard scores? Surface the top coaching targets."
-- Tables: calls, interaction_stats, conversation_participants,
--         scorecard_answers
-- ============================================================

-- Step 1 — Understand: Need to JOIN stats + scorecards to find
--           reps underperforming on both dimensions simultaneously.
-- Step 2 — Validate: No transcript access. Aggregated metrics only. ✅

WITH rep_stats AS (
  SELECT
    cp.email_address,
    COUNT(DISTINCT c.conversation_id)              AS total_calls,
    ROUND(AVG(CAST(ist.talk_ratio AS double)), 2)  AS avg_talk_ratio,
    ROUND(AVG(ist.interactivity), 2)               AS avg_interactivity,
    ROUND(AVG(CAST(ist.question_rate AS double)), 2) AS avg_question_rate,
    ROUND(AVG(ist.longest_monologue), 1)           AS avg_monologue_sec
  FROM hive.gong_raw.calls c
  JOIN hive.gong_raw.conversation_participants cp
    ON c.conversation_key = cp.conversation_key
  JOIN hive.gong_raw.interaction_stats ist
    ON c.conversation_key = ist.conversation_key
  WHERE (c.is_deleted = false OR c.is_deleted IS NULL)
    AND c.dt >= '2026-01-01'
    AND cp.affiliation = 'company'
  GROUP BY cp.email_address
  HAVING COUNT(DISTINCT c.conversation_id) >= 5
),

rep_scores AS (
  SELECT
    cp.email_address,
    ROUND(AVG(CAST(sa.answer_score AS double)), 2) AS avg_scorecard_score,
    COUNT(*)                                       AS scored_calls
  FROM hive.gong_raw.scorecard_answers sa
  JOIN hive.gong_raw.calls c
    ON sa.conversation_key = c.conversation_key
  JOIN hive.gong_raw.conversation_participants cp
    ON c.conversation_key = cp.conversation_key
  WHERE sa.dt >= '2026-01-01'
    AND cp.affiliation = 'company'
    AND (c.is_deleted = false OR c.is_deleted IS NULL)
  GROUP BY cp.email_address
  HAVING COUNT(*) >= 3
),

-- Company-wide benchmarks for flagging
benchmarks AS (
  SELECT
    AVG(avg_talk_ratio)     AS co_avg_talk_ratio,
    AVG(avg_interactivity)  AS co_avg_interactivity,
    AVG(avg_question_rate)  AS co_avg_question_rate
  FROM rep_stats
)

SELECT
  rs.email_address,
  rs.total_calls,
  rs.avg_talk_ratio,
  rs.avg_interactivity,
  rs.avg_question_rate,
  rs.avg_monologue_sec,
  sc.avg_scorecard_score,
  sc.scored_calls,
  -- Coaching priority score: lower = more urgent
  ROUND(
    (rs.avg_interactivity / 100.0)               -- higher is better
    + COALESCE(sc.avg_scorecard_score, 0)        -- higher is better
    - ABS(rs.avg_talk_ratio - 0.50) / 0.50      -- penalty for deviation from ideal 50%
    , 3
  )                                              AS coaching_priority_score
FROM rep_stats rs
LEFT JOIN rep_scores sc ON rs.email_address = sc.email_address
CROSS JOIN benchmarks b
WHERE
  -- Flag reps with at least two weak signals
  (
    (rs.avg_talk_ratio > 0.60 OR rs.avg_talk_ratio < 0.40)
    OR rs.avg_interactivity < b.co_avg_interactivity * 0.8
    OR rs.avg_question_rate < b.co_avg_question_rate * 0.8
    OR rs.avg_monologue_sec > 150
  )
  AND (sc.avg_scorecard_score IS NULL OR sc.avg_scorecard_score < 0.6)
ORDER BY coaching_priority_score ASC   -- most urgent first
LIMIT 50;

-- Step 4 — Interpret results:
--   • coaching_priority_score near 0 or negative = highest priority
--   • avg_scorecard_score IS NULL = never scored → flag for manager
--   • avg_monologue_sec > 150 + low question_rate = classic "pitching" pattern
--   • Cross-reference T11 (comments) to see if coaching is already happening
