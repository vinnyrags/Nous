/**
 * Webhook Flood — bot health under concurrent requests.
 *
 * Verifies the Nous bot stays responsive under high concurrent load.
 * Tests the health endpoint as a proxy for overall bot responsiveness.
 *
 * For full webhook testing, use Stripe CLI:
 *   stripe trigger checkout.session.completed --repeat=100
 *
 * Or run !test in Discord which exercises all webhook code paths.
 *
 * Run:
 *   k6 run webhook-flood.js
 *   k6 run --env BOT_URL=https://vincentragosta.io/bot webhook-flood.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { BOT_URL } from './helpers/config.js';

export const options = {
    scenarios: {
        flood: {
            executor: 'shared-iterations',
            vus: 50,
            iterations: 500,
            maxDuration: '60s',
        },
    },
    thresholds: {
        http_req_duration: ['p(95)<1000'],
        http_req_failed: ['rate<0.01'],
    },
};

export default function () {
    const res = http.get(`${BOT_URL}/health`);

    check(res, {
        'bot healthy': (r) => r.status === 200,
        'response has status ok': (r) => {
            try {
                return JSON.parse(r.body).status === 'ok';
            } catch {
                return false;
            }
        },
    });

    sleep(0.05);
}
