# Connect charge types — which one, and who's the Merchant of Record

Three fund-flow models cover almost every Connect setup. Pick the one that matches what was actually discussed (never default to Direct just because it's most common); if the thread doesn't make it clear, that's an open question to flag, not a guess to make.

For each, the email needs to state plainly: who is the Merchant of Record (MOR), whose name shows on the customer's statement/invoice, and whose credentials Stripe routes the API call through. These three facts are usually what the customer actually cares about (it determines whose brand the customer sees, who owns the customer relationship, and who's on the hook for chargebacks as MOR).

## Direct charges

The charge is created directly on the connected account (via the `Stripe-Account` header or, in Accounts v2, executing the call in the context of that account).

- **MOR:** the connected account.
- **Statement / invoice name:** the connected account's business name.
- **Credentials:** Stripe routes through the connected account's credentials; the platform's API key initiates the call but the resulting objects (Charge, Customer, PaymentIntent) live on the connected account.
- **Platform's cut:** an [application fee](https://docs.stripe.com/connect/direct-charges#collect-fees) on top of the charge.
- Doc: [Direct charges](https://docs.stripe.com/connect/direct-charges)

Typical fit: connected accounts are the ones actually selling to the end customer and should look like it (their brand, their statement descriptor).

**Creating the charge**, a Checkout Session run in the connected account's context via `Stripe-Account`, with the platform's cut set via `application_fee_amount`:

```bash
curl https://api.stripe.com/v1/checkout/sessions \
  -u "sk_test_...:" \
  -H "Stripe-Account: {{CONNECTED_ACCOUNT_ID}}" \
  -d "line_items[0][price_data][currency]"=usd \
  -d "line_items[0][price_data][product_data][name]"="{{PRODUCT_NAME}}" \
  -d "line_items[0][price_data][unit_amount]"=1099 \
  -d "line_items[0][quantity]"=1 \
  -d mode=payment \
  -d success_url="https://example.com/success" \
  -d "payment_intent_data[application_fee_amount]"=110
```

`application_fee_amount` is the only Connect-specific param here; everything else is a plain Checkout Session. The Session, PaymentIntent, and Charge all live on the connected account.

## Destination charges

The charge is created on the platform account; funds are then routed to the connected account via `transfer_data.destination`.

- **MOR (default, no `on_behalf_of`):** the platform. Platform's name on statement, platform's credentials.
- **MOR (with `on_behalf_of` set to the connected account):** the connected account takes over MOR, even though the charge object lives on the platform. This is the "best of both" option worth flagging when a customer wants platform-side control but connected-account branding.
- **Platform's cut:** the difference between the charge amount and `transfer_data.amount`, or an explicit `application_fee_amount`.
- Doc: [Destination charges](https://docs.stripe.com/connect/destination-charges)

Typical fit: platform wants to control the checkout experience and own the primary customer relationship, but still wants to attribute payment methods / statement appearance to the connected account for local relevance (e.g. local payment methods tied to the connected account's country).

**Creating the charge**, a Checkout Session run on the platform (no `Stripe-Account` header), with `payment_intent_data[transfer_data]` routing the destination account's cut:

```bash
curl https://api.stripe.com/v1/checkout/sessions \
  -u "sk_test_...:" \
  -d "line_items[0][price_data][currency]"=usd \
  -d "line_items[0][price_data][product_data][name]"="{{PRODUCT_NAME}}" \
  -d "line_items[0][price_data][unit_amount]"=1500 \
  -d "line_items[0][quantity]"=1 \
  -d mode=payment \
  -d success_url="https://example.com/success" \
  -d "payment_intent_data[transfer_data][destination]"="{{CONNECTED_ACCOUNT_ID}}" \
  -d "payment_intent_data[transfer_data][amount]"=1400
```

Add `-d "payment_intent_data[on_behalf_of]"="{{CONNECTED_ACCOUNT_ID}}"` if the connected account is taking over MOR (see above). `transfer_data[amount]` is what reaches the connected account; the difference between it and the charge total is the platform's cut (or use `application_fee_amount` instead, same effect, opposite framing).

## Separate charges and transfers

The charge is created on the platform account with no `transfer_data` at all; a separate [Transfer](https://docs.stripe.com/connect/separate-charges-and-transfers) moves funds to the connected account later, decoupled in time and amount from the original charge.

- **MOR:** the platform, always. The platform owns the entire customer relationship, refunds, and disputes.
- **Statement / invoice name:** the platform's.
- **Credentials:** platform's throughout; the connected account is never in the funds-flow API call, only in the later Transfer.
- **Always cover these two params when this charge type is in play:**
  - `transfer_group`: a shared string set on the charge and on each [Transfer](https://docs.stripe.com/api/transfers/create) that pays out against it, so you can reconcile which transfers came from which charge later.
  - `source_transaction`: pass the originating charge ID on the Transfer to guarantee it draws only from that charge's funds, rather than from the platform's general balance. Matters most when the platform balance could otherwise be short (e.g. the charge hasn't settled yet), since it prevents the transfer from silently pulling unrelated funds.
- Doc: [Separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers)

Typical fit: the platform doesn't know at charge time which connected account (if any) the funds are ultimately owed to, e.g. marketplace escrow, holding funds pending an assignment decision, or splitting one charge across multiple connected accounts.

**Creating the charge and the later transfer**, three calls since the two are decoupled in time:

1. Checkout Session on the platform, no `transfer_data` and no `Stripe-Account` header at all, this is what makes it "separate" rather than "destination":
   ```bash
   curl https://api.stripe.com/v1/checkout/sessions \
     -u "sk_test_...:" \
     -d "line_items[0][price_data][currency]"=usd \
     -d "line_items[0][price_data][product_data][name]"="{{PRODUCT_NAME}}" \
     -d "line_items[0][price_data][unit_amount]"=1500 \
     -d "line_items[0][quantity]"=1 \
     -d mode=payment \
     -d success_url="https://example.com/success" \
     -d "expand[0]"=payment_intent
   ```
2. Once the Session completes, retrieve it to get the charge ID off the expanded PaymentIntent (needed for `source_transaction` below):
   ```bash
   curl -G https://api.stripe.com/v1/checkout/sessions/{{CHECKOUT_SESSION_ID}} \
     -u "sk_test_...:" \
     -d "expand[]"=payment_intent
   ```
3. When the assignment decision is made, usually later, the Transfer itself:
   ```bash
   curl https://api.stripe.com/v1/transfers \
     -u "sk_test_...:" \
     -d destination="{{CONNECTED_ACCOUNT_ID}}" \
     -d amount=1400 \
     -d currency=usd \
     -d transfer_group="{{ORDER_OR_GROUP_ID}}" \
     -d source_transaction="{{CHARGE_ID}}"
   ```
   `transfer_group` and `source_transaction` are both load-bearing here, not demonstration params, see above for why.

## When the platform owns pricing: mention the Platform Pricing Tool

Whenever the platform sets the take rate (the application fee / commission it collects from connected account transactions), that's platform-owned pricing, and the [Platform Pricing Tool](https://docs.stripe.com/connect/platform-pricing-tools) belongs in the email. It lets the platform define the fee rule once (Dashboard → Settings → Connect → Platform pricing) instead of computing and passing an amount on every charge. Say it as the alternative to a per-charge `application_fee_amount`/`transfer_data[amount]`, not as a replacement, both are valid, but most platforms prefer setting the rate once over doing the math on every request.

This doesn't apply when the connected account sets its own pricing, or when there's no application fee at all (e.g. separate charges and transfers where the platform decides the transfer amount directly rather than taking a fee off a charge).

## FX: how many conversions, and where

Only bring this up if the platform and connected account (or the buyer's presentment currency) are actually in different settlement currencies. If everything is one country, one currency, say plainly that FX doesn't apply here and move on, don't force the explanation in.

When it does apply, the charge type decides how many times money gets converted, not just who's liable for it:

- **Direct charges:** the charge settles straight into the connected account's currency. FX happens once, on the transfer of the platform's application fee back into the platform's currency.
- **Destination charges, no `on_behalf_of`:** two conversions. The charge first converts into the platform's settlement currency, then the transfer to the connected account converts again into the connected account's currency.
- **Destination charges with `on_behalf_of`:** one conversion, straight into the connected account's currency, since the connected account is the settlement merchant. Cheaper than the no-`on_behalf_of` version if cross-border FX cost matters to them.
- **Separate charges and transfers, no `on_behalf_of`:** same two-conversion pattern as destination charges without `on_behalf_of`, except the transfer is a separate, later action rather than automatic.
- **Separate charges and transfers with `on_behalf_of`:** one conversion, same logic as destination charges with `on_behalf_of`.

Rule of thumb worth stating simply: **`on_behalf_of` set to the connected account means one FX conversion; leaving it off means two.**

Who eats the FX cost is a separate, business-level decision, not a technical default: Stripe's default is that the connected account absorbs it (deducted from the transfer amount, and not refunded on a later refund unless the account has an exemption). The alternatives are passing the cost to the buyer at checkout, or having the platform absorb it. Flag this as an open question if cross-border is in scope and it hasn't been decided, don't pick one on the customer's behalf. Source: [FX fund flows for Connect charge types](https://trailhead.corp.stripe.com/docs/connect-tfc/fund-flows/fx-fund-flows-for-connect-charge-types) (internal).

## Quick decision cues from the conversation

- "Our platform is merchant of record, we own refunds/disputes" and "we don't know who gets paid yet" → separate charges and transfers.
- "Connected account is the seller, should look like it, connected account owns chargebacks" → direct charges.
- "We want to run checkout ourselves but pass through connected-account context" → destination charges (check for `on_behalf_of`).

Always verify the doc link for whichever charge type is used against the live docs tools (same Step 2 rule as the main skill) before it goes in the email; this reference file only tells you which concept to reach for, not that the link above is still current.
