/**
 * ShippingEasy Webhook Handler
 *
 * Receives label.purchased events when shipping labels are created.
 * Extracts tracking info, fetches recipient email from the order,
 * and stores it in the tracking table for inclusion in !dropped-off DMs.
 */

import crypto from 'node:crypto';
import config from '../config.js';
import { tracking, purchases } from '../db.js';
import { sendEmbed } from '../discord.js';

/**
 * Verify the ShippingEasy webhook signature.
 * HMAC SHA256 of: METHOD&PATH&sorted_query_params&body
 */
function verifySignature(req) {
    if (!config.SHIPPINGEASY_API_SECRET) return true; // skip if no secret configured

    const signature = req.headers['x-se-api-signature'] || req.query.api_signature;
    if (!signature) return false;

    const method = req.method.toUpperCase();
    const path = req.originalUrl.split('?')[0];
    const params = { ...req.query };
    delete params.api_signature; // signature itself is not part of the signed string
    const sortedParams = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
    const body = JSON.stringify(req.body) || '';

    const parts = [method, path, sortedParams, body].filter(Boolean);
    const stringToSign = parts.join('&');

    const expected = crypto
        .createHmac('sha256', config.SHIPPINGEASY_API_SECRET)
        .update(stringToSign)
        .digest('hex');

    return signature === expected;
}

/**
 * Fetch order details from ShippingEasy API to get recipient email.
 */
async function fetchOrderRecipientEmail(orderNumber) {
    if (!config.SHIPPINGEASY_API_KEY || !config.SHIPPINGEASY_API_SECRET) {
        console.error('ShippingEasy API credentials not configured');
        return null;
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const path = '/api/orders';
    const params = {
        api_key: config.SHIPPINGEASY_API_KEY,
        api_timestamp: timestamp,
        page: '1',
        per_page: '25',
    };

    const sortedParams = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
    const stringToSign = `GET&${path}&${sortedParams}`;
    const signature = crypto
        .createHmac('sha256', config.SHIPPINGEASY_API_SECRET)
        .update(stringToSign)
        .digest('hex');

    try {
        const url = `https://app.shippingeasy.com${path}?${sortedParams}&api_signature=${signature}`;
        const response = await fetch(url);
        if (!response.ok) {
            console.error(`ShippingEasy API error: ${response.status} ${response.statusText}`);
            return null;
        }

        const data = await response.json();
        const orders = data.orders || [];

        // Find the order by order_number
        for (const order of orders) {
            const orderData = order.order || order;
            if (orderData.external_order_identifier === orderNumber || String(orderData.id) === orderNumber) {
                const recipients = orderData.recipients || [];
                if (recipients.length > 0) {
                    return recipients[0].email || null;
                }
            }
        }

        return null;
    } catch (e) {
        console.error('ShippingEasy order fetch failed:', e.message);
        return null;
    }
}

/**
 * Handle incoming ShippingEasy webhook.
 */
async function handleShippingEasyWebhook(req, res) {
    // Verify signature
    if (!verifySignature(req)) {
        console.error('Invalid ShippingEasy webhook signature');
        return res.status(401).send('Invalid signature');
    }

    const event = req.body?.event;
    if (!event || event.event_type !== 'label.purchased') {
        return res.status(200).send('OK'); // ignore non-label events
    }

    const shipment = event.data?.shipment;
    if (!shipment) {
        return res.status(200).send('OK');
    }

    const {
        tracking_number: trackingNumber,
        tracking_url: trackingUrl,
        carrier,
        carrier_service: carrierService,
        order_number: orderNumber,
    } = shipment;

    if (!trackingNumber) {
        console.log('ShippingEasy webhook: no tracking number in payload');
        return res.status(200).send('OK');
    }

    console.log(`ShippingEasy label.purchased: ${trackingNumber} (${carrier}) for order ${orderNumber}`);

    // Try to match buyer — first by external_order_identifier (Stripe session ID), then by API
    let customerEmail = null;
    let discordUserId = null;

    if (orderNumber) {
        // Orders created via our integration use stripe_session_id as external_order_identifier
        const purchase = purchases.getBySessionId.get(orderNumber);
        if (purchase) {
            customerEmail = purchase.customer_email;
            discordUserId = purchase.discord_user_id;
        } else {
            // Fallback to API lookup for orders not created through our integration
            customerEmail = await fetchOrderRecipientEmail(orderNumber);
            if (customerEmail) {
                const link = purchases.getDiscordIdByEmail.get(customerEmail);
                if (link) discordUserId = link.discord_user_id;
            }
        }
    }

    // Store tracking info
    tracking.add.run(
        customerEmail || 'unknown',
        discordUserId || null,
        trackingNumber,
        carrier || null,
        carrierService || null,
        trackingUrl || null,
    );

    console.log(`Tracking stored: ${trackingNumber} → ${customerEmail || 'no email'} (${discordUserId || 'no Discord link'})`);

    // Post to #shipping-labels
    await sendEmbed('SHIPPING_LABELS', {
        title: '📦 Label Purchased',
        description: [
            `**Tracking:** ${trackingNumber}`,
            trackingUrl ? `**Track:** [Click here](${trackingUrl})` : null,
            `**Carrier:** ${carrier || 'Unknown'}${carrierService ? ` (${carrierService})` : ''}`,
            customerEmail ? `**Email:** ${customerEmail}` : null,
            discordUserId ? `**Buyer:** <@${discordUserId}>` : null,
        ].filter(Boolean).join('\n'),
        color: 0x3498db,
    }).catch(e => console.error('Failed to post to #shipping-labels:', e.message));

    res.status(200).send('OK');
}

export { handleShippingEasyWebhook };
