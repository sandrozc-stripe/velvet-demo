# Scoring Rubric v4.4 — 5 Dimensions

## Weight Table

| Stage | D1 PIV Growth | D2 Funding Momentum | D3 External Momentum | D4 VC Tier | D5 Founder Pedigree |
|-------|:---:|:---:|:---:|:---:|:---:|
| Pre-Seed | 10% | 15% | 10% | 10% | 55% |
| Seed | 15% | 20% | 10% | 10% | 45% |
| Series A | 25% | 25% | 10% | 10% | 30% |
| Series B | 35% | 30% | 10% | 10% | 15% |
| Series C+ | 40% | 30% | 10% | 10% | 10% |
| Default | 25% | 20% | 10% | 10% | 35% |

"Default" applies when funding_stage is null/Unknown after both Hubble and web enrichment.

## D1 — PIV Growth (rolling 90d vs prior 90d)

| Growth % | Points |
|----------|--------|
| >100% | 10 |
| 50-100% | 8 |
| 25-50% | 6 |
| 10-25% | 4 |
| 0-10% | 2 |
| Negative / No data | 0 |

Bonus: +1 if MoM trend accelerating. Capped at 10.

## D2 — Funding Momentum (capped at 10)

**Recency:**
| Recency | Points |
|---------|--------|
| ≤3 months | 4 |
| 3-6 months | 3 |
| 6-12 months | 2 |
| 12-18 months | 1 |
| >18 months / unknown | 0 |

**Stage progression bonus:** Series C+ = +3, Series B = +2, Series A = +1, Seed/Pre-A = +0.

**Bootstrapped with growth:** +2.

**PitchBook substage nuance** (splits the coarse pre_series_a bucket — see [go/3p-data-usage](http://go/3p-data-usage), `pitchbook.raw_companies`):
| Signal | Points |
|--------|--------|
| `startup_substage` = "Seed Round" (true seed, VC-backed) | +1 |
| `is_accelerator` = true (Accelerator/Incubator financing) | -2 |

Floor at 0 after this adjustment.

## D3 — External Momentum (capped at 10)

| Signal | Points |
|--------|--------|
| Press coverage 2+ outlets in 90d | +2 |
| Press coverage 1 outlet | +1 |
| Named enterprise case study | +2 |
| Senior GTM/geo hire | +1 |
| Headcount growing | +1 |
| Headcount trend "growing" (DNA panel) | +1 |
| PitchBook `growth_rate_percentile` ≥70 (0-100 scale; web+social composite, substitute when web coverage thin) | +1 |

Don't double-count: headcount-growing and the PitchBook growth-percentile bonus represent the same underlying trend — apply whichever fired first, not both.

Caveat: `growth_rate_percentile = 15` is disproportionately common (~1.4M rows share it vs. ~20k for every other value) — almost certainly a default bucket for `growth_rate = 0`/no-data companies, not a real percentile rank. Below the ≥70 threshold either way, so it doesn't cause false positives, but don't treat 15 as meaningful signal elsewhere.

**Penalties:**
| Red flag | Points |
|----------|--------|
| Layoffs announced OR headcount shrinking | -2 |
| No activity 90d | -1 |

Floor at 0.

## D4 — VC Tier & Conviction

| Tier | Points |
|------|--------|
| P0 | 10 |
| P1 | 7 |
| P2 | 4 |
| Funded (no tier) | 2 |

Multiplier: 2+ P0-tier investors in round → ×1.2 (capped at 10).

## D5 — Founder & Research Pedigree

| Signal | Points |
|--------|--------|
| Prior exit (any amount) | +4 |
| Serial entrepreneur (2+ companies) | +2 |
| Top AI lab background (DeepMind, OpenAI, Meta AI, etc.) | +4 |
| Top tech company (FAANG, Stripe, etc.) | +2 |
| Deep domain expertise (cited) | +2 |

Capped at 10.

**Stage calibration for what to evaluate:**
- Pre-seed/Seed: original founding team pedigree
- Series A: founding team + key C-suite hires
- Series B+: quality of hired C-suite (CRO, CFO, VP Eng) — bench quality over founders

## Final Score

`breakout_score = sum(dimension_score[i] * weight[i]) * 10` → 0-100 scale.

Tie-break: higher PIV, then more recent funding.
