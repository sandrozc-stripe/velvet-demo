---
name: feedback
description: "Help write effective peer feedback for Stripe's go/give-feedback using the SBIN framework (Situation-Behavior-Impact-Next Steps). Use this skill whenever the user mentions writing feedback, peer feedback, giving feedback, SBIN, go/give-feedback, go/get-feedback, midyear feedback, annual review feedback, strengths and development areas, or wants help structuring observations about a colleague into actionable feedback. Also trigger when the user says 'write feedback for X', 'help me with feedback', 'peer review', or mentions they need to submit feedback for someone."
---

# Stripe Peer Feedback Writer

Help Stripe employees write clear, specific, behavior-based peer feedback using the SBIN framework. The output should be polished and ready to paste directly into go/give-feedback.

## Why this matters

Good feedback is specific and grounded in observable behavior — not vibes or personality judgments. Stripe's feedback culture relies on the SBIN framework (Situation, Behavior, Impact, Next Steps) to ensure feedback is actionable and fair. Vague feedback like "they're a great communicator" doesn't help anyone grow; "During the Q3 pricing review, they restructured the deck to lead with customer data, which convinced the exec team to approve the pilot" does.

## Step 1: Gather context

Ask the user (skip questions they've already answered in their message):

1. **Who is the feedback for?** (name or role)
2. **What's the context?** (project wrap-up, milestone, presentation, day-to-day collaboration, spin-up, etc.)
3. **Strengths, development opportunities, or both?** (Stripe's format asks for 1-2 of each)
4. **What did you observe?** Ask for specific moments, behaviors, or outcomes. Probe with questions like:
   - "What specifically did they do or say?"
   - "When and where did this happen?"
   - "What was the result or impact on the team/project/customer?"

If the user gives you raw notes or bullet points, that's great — you'll structure them in the next step.

## Step 2: Structure using SBIN

For each piece of feedback (strength or development area), map the user's observations into:

| Component | What it means | Camera test |
|-----------|--------------|-------------|
| **Situation** | When/where this happened — be specific | Would a bystander recognize the moment? |
| **Behavior** | What the person observably did or said | Would a camera/mic capture this? |
| **Impact** | What happened as a result | Can you point to a concrete outcome? |
| **Next Steps** | What to keep doing (strength) or try differently (development) | Is this actionable? |

### Quality checks

Before finalizing, verify each piece of feedback passes these tests:

- **Observable, not assumed**: "They restructured the proposal" not "They cared about the outcome"
- **Specific, not vague**: Avoid words like "professional", "timely", "warm", "always", "never" — these mean different things to different people
- **Behavioral, not personality-based**: Describe actions, not character traits
- **Impactful**: The "so what" is clear — why does this behavior matter?
- **Actionable next steps**: The person knows what to do with this feedback

### Connecting to Operating Principles

Feedback should, whenever relevant, demonstrate that the peer follows (or should develop toward) Stripe's operating principles. This grounds the feedback in shared values and makes it more meaningful for calibration. Reference the principle by name when it genuinely fits — don't force it.

**Stripe's Operating Principles:**

- **Users first** — We serve millions of businesses and a meaningful fraction of global GDP. We work backwards from our users' needs, indexing especially on feedback from the most innovative. Everyone at Stripe talks to users.
- **Create with craft and beauty** — With careful thought, anything can be made surprisingly great. Well-crafted work indicates care for the user, and beautiful work indicates care for the world.
- **Move with urgency and focus** — We move with speed on what matters most and take the time to invest in what will make us faster tomorrow. We aspire to become the world's fastest company.
- **Collaborate egolessly** — We work as one team: no fiefdoms, no hoarding information, no "not my problem." We question assumptions, debate energetically, and abandon ideas when better ones emerge. We're generous with credit and stingy with blame.
- **Obsess over talent** — It's every Stripe's responsibility to help hire the best and to push for excellence everywhere. Managers must relentlessly uphold our high talent bar and support Stripes in accomplishing the best work of their careers.
- **Stay curious** — Stripe is an applied exercise in learning. We are always seeking to learn. We're energized by the unfamiliar, preferring the joy of discovery to the comfort of certainty.

## Step 3: Output polished feedback

Format the final output clearly with headers so the user can copy/paste into go/give-feedback:

```
## Strengths

**[Strength 1 title]**

[Situation]: ...
[Behavior]: ...
[Impact]: ...
[Recommendation]: Keep doing X / lean into Y

---

## Opportunities for Development

**[Development area 1 title]**

[Situation]: ...
[Behavior]: ...
[Impact]: ...
[Recommendation]: Next time, try X / consider Y
```

Aim for 2-4 sentences per SBIN component — enough to be specific, short enough to respect the reader's time.

## Important notes

- **This skill is for drafting and structuring** — it helps the user organize their observations into the SBIN format. The user should review and personalize before submitting.
- **Confidentiality context**: During midyear (June 15 - July 2) and annual review windows, all feedback is confidential (manager sees it, recipient does not). Outside those windows, the feedback provider chooses visible or confidential.
- **1-2 strengths + 1-2 development areas** is the standard format. Don't overload with too many points.
- If the user's notes are too thin to write specific feedback, say so and ask for more detail rather than generating generic filler.

## Example

**User input**: "I want to write feedback for Maria. We worked on the Acme onboarding together. She was great at stakeholder management but sometimes missed deadlines on her deliverables."

**Good output**:

### Strengths

**Proactive stakeholder alignment**

During the Acme enterprise onboarding (Q2 2026), Maria scheduled weekly syncs with both the Acme engineering lead and our internal risk team before blockers emerged. She created a shared tracker that gave all parties visibility into dependencies. This prevented two potential escalations — the risk review and API credential exchange both completed ahead of schedule because stakeholders were already aligned. I'd encourage her to keep bringing this proactive coordination to future complex onboardings.

### Opportunities for Development

**Delivery predictability on individual workstreams**

During the same Acme onboarding, there were two instances where Maria's deliverables (the integration spec and the test environment setup) landed 3-4 days past the agreed dates without advance notice to the team. This created downstream pressure on engineering who were waiting on those artifacts to begin their implementation sprint. Going forward, flagging risks to timelines earlier — even a quick "heads up, this might slip by X days because Y" — would help the team plan around delays and maintain trust in the schedule.
