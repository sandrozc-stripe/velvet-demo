# Gong Schema — Complete Field Reference

**Verified against live Hubble: 2026-04-30**
**Catalog**: `hive.gong_raw`
**Universal FK**: All child tables join to `calls` via `conversation_key`

---

## Hub Tables

### `gong_raw.calls` — Primary call metadata (start here)

| Field | Type | Notes |
|-------|------|-------|
| `conversation_id` | varchar | **Primary key** |
| `conversation_key` | varchar | **Universal FK** — all child tables join here |
| `title` | varchar | Call title / meeting subject |
| `browser_duration_sec` | double | Browser-based call duration in seconds |
| `presentation_duration_sec` | double | Screen-share / presentation duration |
| `webcam_owner_duration_sec` | double | Owner webcam on-time |
| `webcam_non_company_duration_sec` | double | Non-company webcam on-time |
| `direction` | varchar | `'INBOUND'` / `'OUTBOUND'` |
| `status` | varchar | `'COMPLETED'`, `'IN_PROGRESS'`, `'CANCELLED'`, `'SCHEDULED'`, `'ABORTED'` |
| `effective_start_datetime` | timestamp(3) | Native — compare directly, no `FROM_UNIXTIME()` |
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
| `question_company_count` | decimal(38,19) | Questions asked by company side |
| `question_non_company_count` | decimal(38,19) | Questions asked by non-company side |
| `disposition` | varchar | Call disposition |
| `scope` | varchar | |
| `source_system` | varchar | |
| `skip_reason` | varchar | |
| `phone_number` | varchar | |
| `provider_unique_id` | varchar | |
| `is_private` | boolean | |
| `dt` | varchar | **Partition key** — YYYY-MM-DD with dashes |

⚠️ **No `id` column.** ⚠️ **No `duration_sec` column.** For total call duration, join `call_recordings`.

### `gong_raw.conversations` — Higher-level conversation entity

| Field | Type | Notes |
|-------|------|-------|
| `id` | varchar | Primary key (covers calls, emails, meetings) |
| `is_deleted` | boolean | |
| `dt` | varchar | Partition — YYYY-MM-DD |

⚠️ Does **NOT** have `title`, `duration`, or AI spotlights — those are on `calls`.

### `gong_raw.users` — User profiles & hierarchy

| Field | Type | Notes |
|-------|------|-------|
| `user_id` | varchar | **Primary key** |
| `email_address` | varchar | Stripe email (e.g. `rep@stripe.com`) |
| `first_name` | varchar | |
| `last_name` | varchar | |
| `title` | varchar | Job title |
| `manager_id` | varchar | FK → `users.user_id` (for manager hierarchy) |
| `active` | boolean | Is user active |
| `licensed` | boolean | Is user licensed in Gong |
| `home_workspace_id` | varchar | |
| `locale` | varchar | |
| `time_zone` | varchar | |
| `should_import_telephony_calls` | boolean | |
| `should_record_web_conference_calls` | boolean | |
| `should_sync_emails` | boolean | |
| `valid_from_datetime` | timestamp(3) | SCD validity start |
| `valid_to_datetime` | timestamp(3) | SCD validity end |
| `dt` | varchar | Partition — YYYY-MM-DD |

---

## Content Tables

### `gong_raw.call_recordings` — Duration & recording metadata

| Field | Type | Notes |
|-------|------|-------|
| `conversation_key` | varchar | **FK** → `calls.conversation_key` |
| `duration` | decimal(38,19) | **Duration in seconds — best source for total call duration** |
| `language` | varchar | e.g. `'en-US'` |
| `media_type` | varchar | `'audio'` / `'video'` |
| `start_datetime` | timestamp(3) | Recording start |
| `end_datetime` | timestamp(3) | Recording end |
| `end_timetime` | timestamp(3) | (typo in source — duplicate of end_datetime) |
| `dt` | varchar | Partition — YYYY-MM-DD |

⚠️ FK is `conversation_key`, **NOT** `call_id` (no such column).

### `gong_raw.call_transcripts` — ⚠️ SENSITIVE

| Field | Type | Notes |
|-------|------|-------|
| `conversation_key` | varchar | **FK** → `calls.conversation_key` |
| `transcript` | varchar | Full transcript as JSON — **PII, confidential** |
| `workspace_id` | varchar | |
| `dt` | varchar | Partition — YYYY-MM-DD |

### `gong_raw.meetings` — Meeting metadata

| Field | Type | Notes |
|-------|------|-------|
| `conversation_key` | varchar | **FK** → `calls.conversation_key` |
| `conversation_id` | varchar | Meeting-level ID |
| `call_id` | varchar | |
| `call_conversation_key` | varchar | |
| `title` | varchar | Calendar event title |
| `start_datetime` | timestamp(3) | |
| `end_datetime` | timestamp(3) | |
| `created_datetime` | timestamp(3) | |
| `modified_datetime` | timestamp(3) | |
| `is_internal` | boolean | No external participants |
| `is_recurring` | boolean | |
| `is_canceled` | boolean | |
| `is_all_day` | boolean | |
| `type` | varchar | |
| `organizer_user_id` | decimal(38,19) | |
| `workspace_ids` | varchar | |
| `dt` | varchar | Partition — YYYY-MM-DD |

### `gong_raw.comments` — Coaching comments on calls

| Field | Type | Notes |
|-------|------|-------|
| `conversation_key` | varchar | **FK** → `calls.conversation_key` |
| `comment_id` | varchar | |
| `comment` | varchar | Comment content — ⚠️ NOT `comment_text` |
| `user_id` | varchar | Who wrote the comment |
| `time_in_call_sec` | decimal(38,19) | Position within the call (seconds) |
| `created_datetime` | timestamp(3) | When created — ⚠️ NOT `created_at` |
| `reply_to_comment_id` | varchar | For threaded comments |
| `mentions` | varchar | |
| `tags` | varchar | |
| `dt` | varchar | Partition — YYYY-MM-DD |

---

## Participant & Context Tables

### `gong_raw.conversation_participants` — Who was on the call

| Field | Type | Notes |
|-------|------|-------|
| `conversation_key` | varchar | **FK** → `calls.conversation_key` |
| `email_address` | varchar | ✅ **Use for person filtering — reliable** |
| `user_id` | varchar | Values in scientific notation (e.g. `7.8e+17`) — **unreliable for joins** |
| `speaker_id` | decimal(38,19) | Speaker identifier |
| `speaker_id__next` | bigint | |
| `affiliation` | varchar | `'company'` = Stripe internal; `'non_company'` = external |
| `name` | varchar | Display name — ⚠️ PII for external participants |
| `type` | varchar | Participant type |
| `phone_number` | varchar | ⚠️ PII |
| `invitee_status` | varchar | Calendar invite status |
| `associated_object_id` | varchar | |
| `associated_object_type` | varchar | |
| `fields_snapshot` | varchar | |
| `mapped_fields_snapshot` | varchar | |
| `dt` | varchar | Partition — YYYY-MM-DD. ⚠️ **Rolling ~5-month retention** |

⚠️ **Retention**: Only ~5 months of history. Earliest dt ≈ 2025-12-17 as of April 2026.

### `gong_raw.conversation_contexts` — SFDC object links

| Field | Type | Notes |
|-------|------|-------|
| `conversation_key` | varchar | **FK** → `calls.conversation_key` |
| `object_type` | varchar | `'opportunity'`, `'account'`, `'contact'` |
| `object_id` | varchar | SFDC ID — `001…` = account, `006…` = opportunity, `003…` = contact |
| `real_run_time` | timestamp(3) | |
| `fields_snapshot` | varchar | |
| `mapped_fields_snapshot` | varchar | |
| `dt` | varchar | Partition — YYYY-MM-DD. **No retention limit** — full history available |

### `gong_raw.user_crm_ids` — Gong ↔ SFDC user mapping

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

## Analytics Tables

### `gong_raw.interaction_stats` — Call quality metrics

| Field | Type | Notes |
|-------|------|-------|
| `conversation_key` | varchar | **FK** → `calls.conversation_key` |
| `call_id` | varchar | Equals `calls.conversation_id` — alternative join key |
| `call_owner` | varchar | |
| `user_id` | varchar | |
| `talk_ratio` | decimal(38,19) | 0–1. Ideal: 0.40–0.60. Cast to double for AVG. |
| `interactivity` | double | 0–100. Higher = better back-and-forth |
| `patience` | double | Listening behavior. Higher = better |
| `question_rate` | decimal(38,19) | Questions/min. Ideal: 3–5. Cast to double for AVG. |
| `longest_monologue` | double | Seconds. Ideal: <120 |
| `longest_customer_story` | double | Longest customer uninterrupted speech |
| `dt` | varchar | Partition — YYYY-MM-DD |

### `gong_raw.gong_usage` — Platform adoption (60+ metrics)

| Field | Type | Notes |
|-------|------|-------|
| `user_id` | varchar | FK → `users.user_id` |
| `user_name` | varchar | |
| `usage_date` | varchar | |
| `had_gong_activity` | boolean | Any activity flag |
| `recorded_calls` | decimal | |
| `calls_listened_to` | decimal | |
| `minutes_listened_to_calls` | double | |
| `shared_calls` | decimal | |
| `commented_on_calls` | decimal | (NOT `comments_added`) |
| `reviewed_calls` | decimal | (NOT `calls_reviewed`) |
| `call_scorecards_given` | decimal | (NOT `scorecards_submitted`) |
| `viewed_call_spotlight` | decimal | |
| `interacted_with_call_spotlight` | decimal | |
| `asked_anything_about_a_call` | decimal | |
| `asked_anything_about_a_deal_or_account` | decimal | |
| `ai_emails_generated` | decimal | |
| `sent_emails_via_gong` | decimal | |
| `submitted_forecasts` | decimal | |
| `reviewed_forecast` | decimal | |
| `inspected_deals` | decimal | |
| ... | ... | 40+ additional metrics |
| `dt` | varchar | Partition — YYYY-MM-DD |

### `gong_raw.scorecard_answers` — Scorecard evaluations (denormalized)

| Field | Type | Notes |
|-------|------|-------|
| `conversation_key` | varchar | **FK** → `calls.conversation_key` |
| `scorecard_id` | varchar | |
| `scorecard_name` | varchar | |
| `question_id` | varchar | FK → `scorecard_questions.question_id` |
| `question_text` | varchar | **Denormalized** — no need to join `scorecard_questions` for text |
| `question_type` | varchar | |
| `question_is_overall_score` | boolean | |
| `question_response_options` | varchar | |
| `question_max_range` | decimal | |
| `question_min_range` | decimal | |
| `answer_id` | varchar | |
| `answer_score` | decimal(38,19) | Score value. Cast to double for AVG. |
| `answer_text` | varchar | |
| `answer_not_applicable` | boolean | |
| `answer_selected_options` | varchar | |
| `answer_created_datetime` | timestamp(3) | |
| `gave_scorecard_user_id` | varchar | Who submitted the scorecard — ⚠️ NOT `answered_by` |
| `received_scorecard_user_id` | varchar | Who was scored |
| `is_auto_scorecard` | boolean | |
| `accessible_to` | varchar | |
| `last_published_datetime` | timestamp(3) | |
| `workspace_id` | varchar | |
| `dt` | varchar | Partition — YYYY-MM-DD |

### `gong_raw.scorecard_questions` — Question definitions

| Field | Type | Notes |
|-------|------|-------|
| `question_id` | varchar | **PK** |
| `question_text` | varchar | |
| `question_type` | varchar | |
| `question_is_overall_score` | boolean | |
| `question_response_options` | varchar | |
| `question_max_range` | decimal | |
| `question_min_range` | decimal | |
| `scorecard_id` | varchar | |
| `scorecard_name` | varchar | |
| `scorecard_is_enabled` | boolean | |
| `source` | varchar | |
| `workspace_id` | varchar | |
| `dt` | varchar | Partition — YYYY-MM-DD |

### `gong_raw.trackers` — Topic/keyword tracker definitions

| Field | Type | Notes |
|-------|------|-------|
| `tracker_id` | varchar | **PK** — ⚠️ NOT `id` |
| `name` | varchar | Tracker name (e.g. `'competitor_mention'`) |
| `keywords` | varchar | Keywords that trigger this tracker |
| `tracker_type` | varchar | `'keyword'` / `'smart_tracker'` |
| `workspace_id` | varchar | |
| `dt` | varchar | Partition — YYYY-MM-DD |

### `gong_raw.conversation_trackers` — Tracker mentions per call

| Field | Type | Notes |
|-------|------|-------|
| `conversation_key` | varchar | **FK** → `calls.conversation_key` |
| `tracker_id` | varchar | **FK** → `trackers.tracker_id` |
| `count` | decimal(38,19) | Times tracker fired in the call |
| `count__next` | bigint | |
| `workspace_id` | varchar | |
| `dt` | varchar | Partition — YYYY-MM-DD |

### `gong_raw.user_conversation_gong_activities` — Per-call user activity

| Field | Type | Notes |
|-------|------|-------|
| `conversation_key` | varchar | **FK** → `calls.conversation_key` |
| `user_id` | varchar | |
| `gong_activity_type` | varchar | Activity type (single column — not individual booleans) |
| `gong_activity_datetime` | timestamp(3) | |
| `dt` | varchar | Partition — YYYY-MM-DD |
