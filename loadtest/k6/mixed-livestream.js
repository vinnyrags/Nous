/**
 * Mixed Livestream — realistic concurrent load simulation.
 *
 * Simulates a livestream scenario:
 * - 200 users browsing the shop and shipping pages
 * - 50 users attempting checkout simultaneously
 *
 * Verifies system stability under realistic mixed load.
 *
 * Run:
 *   k6 run --env PRICE_ID=price_xxx mixed-livestream.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { BASE_URL, PRICE_ID } from './helpers/config.js';

const checkoutSuccess = new Counter('checkout_success');
const checkoutFailed = new Counter('checkout_failed');

export const options = {
    scenarios: {
        browsers: {
            executor: 'constant-vus',
            vus: 200,
            duration: '60s',
            exec: 'browseShop',
        },
        buyers: {
            executor: 'constant-vus',
            vus: 50,
            duration: '60s',
            exec: 'checkout',
            startTime: '5s',
        },
    },
    thresholds: {
        http_req_duration: ['p(95)<5000'],
    },
};

export function browseShop() {
    const homeRes = http.get(`${BASE_URL}/`);
    check(homeRes, { 'homepage 200': (r) => r.status === 200 });
    sleep(Math.random() * 3 + 1);

    const shipRes = http.get(`${BASE_URL}/shipping`);
    check(shipRes, { 'shipping 200': (r) => r.status === 200 });
    sleep(Math.random() * 2);
}

export function checkout() {
    if (!PRICE_ID) {
        console.error('PRICE_ID env var required');
        sleep(5);
        return;
    }

    const email = `loadtest-buyer-${__VU}-${__ITER}@test.com`;

    // Shipping lookup
    http.get(`${BASE_URL}/api/shipping?email=${encodeURIComponent(email)}`);

    // Checkout
    const res = http.post(`${BASE_URL}/api/checkout`, JSON.stringify({
        items: [{ priceId: PRICE_ID, quantity: 1 }],
        email,
        international: false,
        shipping_covered: true,
        country_known: true,
        discord_linked: false,
    }), { headers: { 'Content-Type': 'application/json' } });

    if (res.status === 200) {
        checkoutSuccess.add(1);
    } else {
        checkoutFailed.add(1);
    }

    check(res, {
        'checkout ok or sold out': (r) => r.status === 200 || r.status === 409,
    });

    sleep(1);
}
