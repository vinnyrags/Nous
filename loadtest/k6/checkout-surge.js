/**
 * Checkout Surge — stock integrity under concurrent load.
 *
 * Simulates 100-500 concurrent users buying the same product.
 * Verifies atomic stock decrement prevents overselling.
 *
 * Pre-test: set a test product to known stock (e.g., 10).
 * Post-test: compare successful_checkouts counter against initial stock.
 *
 * Run:
 *   k6 run --env PRICE_ID=price_xxx checkout-surge.js
 *   k6 run --vus 500 --env PRICE_ID=price_xxx checkout-surge.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { BASE_URL, PRICE_ID, THRESHOLDS } from './helpers/config.js';

const successCount = new Counter('successful_checkouts');
const stockErrorCount = new Counter('stock_errors');
const otherErrorCount = new Counter('other_errors');

export const options = {
    scenarios: {
        surge: {
            executor: 'shared-iterations',
            vus: 100,
            iterations: 200,
            maxDuration: '60s',
        },
    },
    thresholds: THRESHOLDS.checkout,
};

export default function () {
    if (!PRICE_ID) {
        console.error('PRICE_ID env var required. Run: k6 run --env PRICE_ID=price_xxx checkout-surge.js');
        return;
    }

    const email = `loadtest-${__VU}-${__ITER}@test.com`;

    // Shipping lookup (same as real buyer flow)
    http.get(`${BASE_URL}/api/shipping?email=${encodeURIComponent(email)}`);

    // Checkout attempt
    const res = http.post(`${BASE_URL}/api/checkout`, JSON.stringify({
        items: [{ priceId: PRICE_ID, quantity: 1 }],
        email,
        international: false,
        shipping_covered: true,
        country_known: true,
        discord_linked: false,
    }), { headers: { 'Content-Type': 'application/json' } });

    if (res.status === 200) {
        successCount.add(1);
    } else if (res.status === 409) {
        stockErrorCount.add(1);
    } else {
        otherErrorCount.add(1);
    }

    check(res, {
        'status is 200 or 409': (r) => r.status === 200 || r.status === 409,
        'response has body': (r) => r.body.length > 0,
    });

    sleep(0.1);
}
