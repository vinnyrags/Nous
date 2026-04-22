# Load Testing — k6

Repeatable load tests to verify system performance under concurrent load. Tests run against production with Stripe in test mode.

## Install k6

```bash
brew install k6
```

## Scenarios

| Script | What it tests | VUs | Duration |
|--------|--------------|-----|----------|
| `checkout-surge.js` | Stock integrity under concurrent checkout | 100 | 60s |
| `homepage-load.js` | ISR + WPGraphQL under page load | 100→500→0 | 50s |
| `webhook-flood.js` | Bot health under concurrent requests | 50 | 60s |
| `mixed-livestream.js` | Realistic livestream (200 browsing + 50 buying) | 250 | 60s |

## Running

```bash
# Homepage load (no setup needed)
k6 run loadtest/k6/homepage-load.js

# Bot health flood
k6 run loadtest/k6/webhook-flood.js

# Checkout surge (requires a Stripe test price ID)
k6 run --env PRICE_ID=price_xxx loadtest/k6/checkout-surge.js

# Mixed livestream
k6 run --env PRICE_ID=price_xxx loadtest/k6/mixed-livestream.js

# Override VU count
k6 run --vus 500 --env PRICE_ID=price_xxx loadtest/k6/checkout-surge.js
```

## Pre-Test Setup (checkout tests)

1. Set a test product to known stock (e.g., 10) via WordPress admin
2. Note the Stripe test price ID for that product
3. Verify Stripe is in test mode (`STRIPE_SECRET_KEY` starts with `sk_test_`)

## Post-Test Cleanup

1. Run `!reset` in Discord — wipes all purchases, shipping, queues, battles
2. Run `!sync` — restores stock from Google Sheets → Stripe → WordPress
3. Run `!test` — confirms system is back to clean state

## Interpreting Results

- **successful_checkouts** counter should never exceed initial stock
- **stock_errors** counter should account for all excess attempts
- **p95 response time** should stay under thresholds (5s checkout, 2s homepage)
- **http_req_failed rate** should be near 0 (409s are expected, not failures)

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `https://itzenzo.tv` | Frontend URL |
| `BOT_URL` | `https://vincentragosta.io/bot` | Nous bot URL |
| `PRICE_ID` | (required for checkout tests) | Stripe test price ID |
