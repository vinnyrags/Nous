/**
 * Homepage Load — ISR + WPGraphQL under concurrent page loads.
 *
 * Ramps from 0 to 500 concurrent users over 50 seconds.
 * Verifies ISR cache serves stale-while-revalidating (no 500s)
 * and response times stay under 2 seconds at p95.
 *
 * Run:
 *   k6 run homepage-load.js
 *   k6 run --env BASE_URL=https://itzenzo.tv homepage-load.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, THRESHOLDS } from './helpers/config.js';

export const options = {
    stages: [
        { duration: '10s', target: 100 },
        { duration: '30s', target: 500 },
        { duration: '10s', target: 0 },
    ],
    thresholds: THRESHOLDS.homepage,
};

export default function () {
    const res = http.get(`${BASE_URL}/`);

    check(res, {
        'status is 200': (r) => r.status === 200,
        'has content': (r) => r.body.length > 1000,
    });

    sleep(Math.random() * 2);
}
