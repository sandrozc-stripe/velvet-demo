# Platform-managed risk toolkit

Include this section only when `losses_collector` is `application` somewhere in the target configuration, i.e. the platform (not Stripe) is on the hook for negative balances on at least one connected account. If Stripe is the `losses_collector` everywhere in scope, skip this section entirely and just link [Stripe Managed Risk](https://docs.stripe.com/connect/risk-management/managed-risk) once in the target configuration section instead, it covers the loss liability for you.

When the platform owns the risk, Stripe still gives it a toolkit rather than leaving it to build detection from scratch. Group the tools by where they act in the lifecycle, matching what's actually relevant to the customer's setup rather than dumping the full list every time:

**Prevention / onboarding**
- Capability requirements: gate `card_payments` / `transfers` / `card_issuing` behind the platform's own underwriting before enabling them on a connected account. Doc: [Connect account capabilities](https://docs.stripe.com/connect/account-capabilities)
- Requirement collection: how much KYC/KYB is collected upfront vs. progressively. Doc: [Required verification information](https://docs.stripe.com/connect/required-verification-information)

**Detection / monitoring**
- Radar: fraud rules, custom rules, and lists apply to charges on connected accounts, and Radar risk evaluations flag individual charge attempts. Doc: [Radar](https://docs.stripe.com/radar)
- Ongoing account monitoring: track negative-balance accounts and refund/chargeback rates via the Dashboard or API as part of platform risk best practices. Doc: [Connect risk management best practices](https://docs.stripe.com/connect/risk-management/best-practices)
- Webhooks for automated response instead of manual review: `charge.dispute.created`, `radar.early_fraud_warning`, `account.updated`. Doc: [Webhooks](https://docs.stripe.com/webhooks)

**Mitigation / containment**
- Reserved balance: Stripe automatically holds a `connect_reserved` balance on the platform account to offset negative balances on connected accounts under platform-managed risk. Doc: [Connect account balances](https://docs.stripe.com/connect/account-balances)
- Payout controls: delay payout schedules or switch to manual payouts so funds aren't out the door before a dispute window closes. Doc: [Manual payouts](https://docs.stripe.com/connect/manual-payouts)
- Pausing payments or payouts: block new charges or hold payouts on a specific connected account showing risk signals, without fully closing it (Accounts v1 only, not yet supported on Accounts v2). Doc: [Pausing payments and payouts](https://docs.stripe.com/connect/pausing-payments-or-payouts-on-connected-accounts)

**Recovery**
- Debiting the connected account balance: claw back funds from a connected account's current or future balance to cover a negative balance from a dispute/refund. Doc: [Account debits](https://stripe.com/docs/connect/account-debits)
- If the connected account can't cover it, the platform absorbs the loss, this is the actual mechanic behind `losses_collector: application`; say so plainly rather than leaving it implicit.

Verify each link against the live docs tools before it goes in the email (same Step 2 rule as the main skill). Only include the tools that are actually relevant to what the customer described (e.g. don't push reserves on a customer who explicitly said they don't want payout delays); a wall of every tool with no judgment reads as a docs dump, not advice.
