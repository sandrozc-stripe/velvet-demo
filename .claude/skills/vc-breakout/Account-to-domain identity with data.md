## **Recommended sources**

Request \- [https://stripe.slack.com/archives/C0AHG44U9C2/p1785431343428709?thread\_ts=1785428592.123359\&cid=C0AHG44U9C2](https://stripe.slack.com/archives/C0AHG44U9C2/p1785431343428709?thread_ts=1785428592.123359&cid=C0AHG44U9C2) 

### **Salesforce account-to-domain mapping**

Use `cdm.mapping_sfdc_account_to_domain`.

- Start here when the input is a Salesforce account ID.  
- Filter to the latest `day`.  
- Join other datasets using `domain`.

### **Current company and startup traits**

Use `cdm.domains_core`.

Use it for:

- Canonical company name: `canonical_name`  
- Employee count: `employees__count`  
- Total funding: `funding__total_amount_usd`  
- Latest funding stage: `funding__last_funding_stage`  
- Startup classification: `segmentation__company_segment_details__startup_type`  
- P0/P1/P2 tier: `segmentation__company_segment_details__top_startup_type`  
- Geography, operational status, industry, and other current company traits

### **Historical segmentation and trends**

Use `dna.domain_segment_panel` when monthly history is required.

Use it for:

- Historical startup classification  
- Historical P0/P1/P2 tier  
- Employee-count trends: `features__employee_count`  
- Stripe-volume trends  
- Monthly company segmentation

For a current snapshot, filter with `is_latest_month = TRUE`.

Although DNA contains approximately 308.6M domains compared with CDM’s 130.2M, this does not provide additional current startup coverage. All 964,923 domains that DNA currently classifies as `top` or `funded` exist in CDM. Most DNA-only domains are default `small_business` records without startup type, investor tier, or funding data.

Therefore, use CDM for current enrichment and DNA for monthly history.

### **Funding rounds and investors**

Use `hub.investor_funding_events`.

Use it for:

- Funding dates  
- Normalized funding stages  
- Round amounts  
- Valuations  
- Investors participating in each round  
- Historical equity-stage analysis

This dataset combines PitchBook, Crunchbase, Dealroom, ZoomInfo, and Salesforce data.

A funding round can appear once for every participating investor. Do not sum `funding_amount` directly across rows. First deduplicate by `domain`, `funding_month`, and `funding_type`, using `MAX(funding_amount)` for each round.

### **Latest funding milestone**

Use `hub.funding_milestones` when only a consolidated latest funding date, stage, or amount is needed.

For equity-stage scoring, use `hub.investor_funding_events` instead of relying exclusively on `cdm.domains_core.funding__last_funding_stage`, which can contain broad values such as `other` or `unknown`.

### **Canonical investor tiers**

Use `top_startups.top_investors_2026` for the maintained P0/P1/P2 investor classification.

Deduplicate by investor domain before joining it to `hub.investor_funding_events`.

### **Recommended join order**

1. Start with `cdm.mapping_sfdc_account_to_domain` for Salesforce accounts or `hub.investor_funding_events` for funded-company analysis.  
2. Join `cdm.domains_core` on `domain` for current company traits and startup classification.  
3. Join `top_startups.top_investors_2026` when investor tier is required.  
4. Join `dna.domain_segment_panel` only when monthly segmentation, employee, or Stripe-volume history is required.  
5. Use `hub.funding_milestones` when a simple latest-funding summary is sufficient.

- 