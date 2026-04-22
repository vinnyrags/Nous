/**
 * Shared config for k6 load test scenarios.
 *
 * Override via environment variables:
 *   k6 run --env BASE_URL=https://itzenzo.tv --env PRICE_ID=price_xxx scenario.js
 */

export const BASE_URL = __ENV.BASE_URL || 'https://itzenzo.tv';
export const BOT_URL = __ENV.BOT_URL || 'https://vincentragosta.io/bot';
export const PRICE_ID = __ENV.PRICE_ID || '';

export const THRESHOLDS = {
    checkout: {
        http_req_duration: ['p(95)<5000'],
        http_req_failed: ['rate<0.5'],
    },
    homepage: {
        http_req_duration: ['p(95)<2000'],
        http_req_failed: ['rate<0.01'],
    },
};
