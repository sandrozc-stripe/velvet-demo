---
name: draft-connect-email
description: Draft a customer-facing Stripe Connect (or Connect + Issuing) setup email in Sandro's SA style — states the target Accounts v2 config, explains the charge type and who is Merchant of Record, walks through the ordered API calls to build the setup end-to-end, and lists Stripe's risk-management tools whenever the platform (not Stripe) owns loss liability. Use when the user says "draft a connect email", "connect setup email", "/draft-connect-email", "write the Connect walkthrough", "draft the API setup email", or wants to turn a Connect / Connect+Issuing discovery call or thread into a customer email that needs the config, the API calls, and the charge-type explanation. Prefer this over the generic draft-email skill whenever Connect configuration, charge types, MOR, or Issuing setup are the actual subject of the email.
---

# Draft Connect Setup Email (Sandro's SA style)

Turn a Connect (or Connect + Issuing) discovery call, thread, or rough draft into a customer-ready setup walkthrough: the target configuration, an explanation of the charge type and who is Merchant of Record, the ordered API calls to build it, and (when the platform owns risk) the tools available to manage it. This is a specialized sibling of `draft-email` for the specific case where the email's job is to hand the customer a runnable technical spec, not just a recap or recommendation. Reference examples: `MERCHANT/Payflows/connect-issuing-setup-email.md` (Connect + Issuing, multi-region) and `connect-setup-emails/01-audun-yc-startup-connect-config.md` (Connect only, single flow).

**Request / context:** `$ARGUMENTS`

## Golden rules (do not violate)

Same rules as `draft-email`, they don't relax just because this email has more technical content:

- **Never fabricate a Stripe doc URL, and verify every link.** Every inline link must resolve via the Stripe docs tools (`mcp__plugin_bob_bob__search_stripe_docs_pages`, `get_stripe_doc_page`) before it goes in, no exceptions, even for links copied from a prior email or from this skill's reference files (docs move; confirm they still resolve). If a link can't be verified, name the concept in plain text instead of linking it.
- **Never invent config values, capabilities, API params, or numbers.** The `dashboard` / `fees_collector` / `losses_collector` values, the charge type, and whether Issuing is in scope all come from what was actually discussed or already configured, not from what's typical or what looks cleanest in an example. If the conversation didn't settle one of these, that's an open question to surface, not a default to assume.
- **Don't resolve open questions on the customer's behalf.**
- **No em-dashes (—).** Use commas, colons, parentheses, or a new sentence. En-dashes in ranges (£160k–£237k) are fine.
- **No filler.** No "I hope this finds you well", no throat-clearing.
- **Concise over thorough.** This email carries a lot of technical weight already (config, charge type, API calls); every extra sentence competes for the reader's attention. Default to the shortest version that's still accurate: one line where one line will do, a paragraph only where the concept genuinely needs it. If you can cut a sentence without losing information the customer needs, cut it.

## Step 1 — Gather context

Find and read the deal's material so every config value and API call is grounded in what was actually agreed, not a generic template:
- The deal folder under `MERCHANT/<company>/`, prior emails, thread PDFs, notes.
- The email thread or call recap for: what charge type was discussed, who bears fees, who bears losses, what dashboard experience the connected accounts get, and whether Issuing came up.
- Recalled memories (SA email/note style, Connect+Issuing KYB reuse, etc.) if surfaced.
- For deeper research across Gmail/Slack/Gong, follow the same Workflow approach as `draft-email` Step 1 / `sa-meeting-augment` Step 3. Reconstruct the timeline oldest to newest: what was decided, what superseded an earlier assumption, and what's still unresolved.

Confirm the recipient's name and company from the thread, not the filename.

## Step 2 — Decide the target configuration

From the gathered context, pin down each of these explicitly. If any is genuinely undetermined, list it under open questions in the email rather than guessing:

- **`dashboard`**: `full` (Standard-equivalent, connected account gets the full Stripe Dashboard), `express` (Express Dashboard), or `none` (no Stripe-hosted dashboard, platform builds its own via embedded components or API only).
- **`fees_collector`**: `application` (platform pays Stripe's processing fees) or `stripe` (connected account pays its own).
- **`losses_collector`**: `application` (platform is liable for negative balances, i.e. platform manages risk) or `stripe` (Stripe Managed Risk).
- **Charge type**: Direct, Destination, or Separate charges and transfers. Read `references/charge-types.md` for how to identify which one fits and what to say about Merchant of Record, statement name, and whose credentials Stripe routes through for each.
- **Issuing in scope?**: does the setup include `card_issuing`, cardholders, or cards. If yes, read the Issuing-specific notes in Step 4 below.

## Step 3 — Verify doc links (always)

Same as `draft-email`: confirm the real URL via the docs tools for every concept you'll link, including ones reused from a prior email or from this skill's reference files. Unverifiable links become plain text.

## Step 4 — Write the email

Structure (every section self-contained, adapt names to the topic but don't drop the required ones below):

1. **Subject** — `Company <> Stripe Connect setup: <what>` or similar. Concrete.
2. **Opener** — `Hi <Name>,` then state up front that this is the target configuration and the API calls to build it. Never bury the headline.
3. **Target configuration** — a short bulleted block, JSON-config style, naming `dashboard`, `fees_collector`, `losses_collector`, and the charge type, each with the relevant doc linked inline. This is the section the customer will screenshot and hand to their engineers, keep it scannable.
4. **Charge type** — explain which model applies (Direct / Destination / Separate charges and transfers), state plainly who is Merchant of Record, whose name shows on the statement/invoice, and whose credentials Stripe routes the call through. Pull the specifics from `references/charge-types.md`, but write it in your own words grounded in this customer's actual setup, don't paste the reference verbatim. Don't add FX by default, even if the platform and connected account are in different currencies. Only cover FX if the user explicitly asks for it in the request; when they do, use the "FX: how many conversions, and where" section of that same reference and keep it to one line.
5. **Setup: API calls** — ordered, numbered steps with real `curl` blocks using `sk_test_xxx:` / `sk_live_xxx:` placeholders, reflecting the *actual* target configuration decided in Step 2, not a generic template:
   - Create the connected account (Accounts v2 `POST /v2/core/accounts` or v1 `POST /v1/accounts` depending on which the customer is on) with the capabilities and `dashboard`/`fees_collector`/`losses_collector` values that match Step 2 exactly.
   - Create the account link / onboarding link (hosted or embedded, per what was discussed) and note what's Stripe-hosted vs. what the platform builds. Whenever this KYB/KYC step is described, mention inline (no separate header) that [Required verification information](https://docs.stripe.com/connect/required-verification-information) lists the exact required and optional fields/documents per country and account configuration.
   - If the customer runs more than one platform/entity and a client onboards to more than one (e.g. separate US and EU platforms), cover how KYB reuse works between them: only mention networked onboarding if it's actually usable for this setup (it requires `requirement_collection: stripe`); if it isn't usable, skip mentioning it entirely rather than explaining why it's unavailable, and go straight to describing the reuse mechanism that does apply, naming the specific fields/documents that carry over via API pre-fill (for example: legal name, address, DOB, phone, email, business profile) versus what has to be recollected on each additional account (tax/gov IDs return as booleans or last-4 only, identity documents can't be re-downloaded, so those plus any local/region-specific IDs and a fresh TOS acceptance need collecting again).
   - Execute one representative charge for the chosen charge type. `references/charge-types.md` has a ready `curl` block for each model (Checkout Session with `application_fee_amount` + `Stripe-Account` for Direct, Checkout Session with `payment_intent_data[transfer_data]` for Destination, Checkout Session followed by a separate `Transfer` for Separate charges and transfers); adapt the placeholders and amounts to this customer's setup rather than writing the call from scratch. If the charge type is separate charges and transfers, the Transfer call must include and explain `transfer_group` (ties the charge and its transfer(s) together for reconciliation) and `source_transaction` (guarantees the transfer draws from that specific charge's funds, not the general platform balance), these aren't optional flourishes for this charge type, they're how you avoid transfers silently drawing from the wrong funds. If the platform owns pricing (it sets the application fee / take rate on these transactions), mention the [Platform Pricing Tool](https://docs.stripe.com/connect/platform-pricing-tools) as the way to set that rate once instead of computing it per charge, see `references/charge-types.md` for when this does and doesn't apply.
   - If Issuing is in scope: fund the Issuing balance (per region, see Issuing notes below), create a cardholder with the [Cardholders API](https://docs.stripe.com/api/issuing/cardholders/create) (`POST /v1/issuing/cardholders`, run with the `Stripe-Account` header for the connected account), then create a card against that cardholder with spending controls.
   - Note inline, next to each block, whether params shown are for demonstration only or are load-bearing/required for the model to work (e.g. the four `controller` fields required for Issuing aren't boilerplate, say so).
6. **Risk management tools** — include only if `losses_collector` is `application` anywhere in scope. Read `references/risk-tools.md` and select the tools actually relevant to this customer's setup (don't dump the full list if half of it doesn't apply). Skip this section entirely if Stripe is the `losses_collector` everywhere; in that case Stripe Managed Risk is already linked once in the target configuration section, that's sufficient.
7. **Issuing notes** — include only if Issuing is in scope. Flag what's been true in practice: cross-region issuing isn't supported (a client active in more than one region needs a separate connected account, and separate balance, per region), Issuing geo availability is limited to specific countries (verify current list rather than assuming), and Issuing on Connect requires Custom connected accounts (`dashboard: none`, no Stripe-hosted dashboard for that account). Same rule as Step 4: don't add FX here unless the user explicitly asks. If asked, the short version is that each connected account normally funds its own Issuing balance from its own bank in its own currency, so FX doesn't apply to the funding step itself, only to any ordinary Connect payment charges the platform runs alongside it.
8. **Open questions** — anything from Step 2 that wasn't settled, or commercial/legal items (fees, fraud liability, 3DS) that sit with someone else on the deal team. Flag explicitly, don't gloss over.
9. **What I need from you** — short bulleted list of specific decisions or inputs still needed.
10. **Close** — offer a call as an alternative to more email, then `Best,\nSandro`.

## Voice checklist (run before returning)

- First person, direct, confident. States the configuration and steps, doesn't hedge on what's already decided.
- Target configuration, charge type + MOR, and API call steps are all present and reflect the same config values consistently (no drift between what section 3 says and what the `curl` calls in section 5 actually do).
- Risk management tools section present if and only if `losses_collector: application` is in scope somewhere; Issuing notes present if and only if Issuing is in scope.
- Every link resolves to a real page; every param in the API calls is either genuinely required for this model or marked as for demonstration only.
- No em-dashes; no filler; no fabricated params, config values, or URLs.
- Open items flagged, not assumed resolved.
- Ends with "What I need from you" + call offer + "Best, Sandro".

## Output

Write the email to `MERCHANT/<company>/<YYYY-MM-DD>-<slug>.md`. Use today's date. If restyling an existing draft, edit that file in place. After writing, give the user a two-line summary of what changed and flag anything they should verify (recipient name, config values that were inferred rather than explicitly confirmed, unresolved open questions).
