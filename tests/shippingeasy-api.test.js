/**
 * Tests for ShippingEasy API client — signing, name splitting, and DB queries.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';
import { createTestDb, buildStmts } from './setup.js';

// Mock config before importing signRequest
vi.mock('../config.js', () => ({
    default: {
        SHIPPINGEASY_API_SECRET: 'test_secret_key_for_signing',
    },
}));

vi.mock('../discord.js', () => ({
    sendEmbed: vi.fn().mockResolvedValue(null),
}));

import { signRequest, splitName } from '../shippingeasy-api.js';

describe('signRequest', () => {
    it('generates HMAC for GET without body', () => {
        const sig = signRequest('GET', '/api/stores/abc/orders', { api_key: 'k', api_timestamp: '123' });
        expect(sig).toMatch(/^[0-9a-f]{64}$/);
    });

    it('generates different HMAC for POST with body', () => {
        const params = { api_key: 'k', api_timestamp: '123' };
        const getSig = signRequest('GET', '/api/orders', params);
        const postSig = signRequest('POST', '/api/orders', params, '{"order":{}}');
        expect(getSig).not.toBe(postSig);
    });

    it('includes body in POST signature', () => {
        const params = { api_key: 'k', api_timestamp: '123' };
        const sig1 = signRequest('POST', '/api/orders', params, '{"a":1}');
        const sig2 = signRequest('POST', '/api/orders', params, '{"a":2}');
        expect(sig1).not.toBe(sig2);
    });

    it('sorts params alphabetically', () => {
        const sig1 = signRequest('GET', '/api/orders', { b: '2', a: '1' });
        const sig2 = signRequest('GET', '/api/orders', { a: '1', b: '2' });
        expect(sig1).toBe(sig2);
    });
});

describe('splitName', () => {
    it('splits "John Smith" into first and last', () => {
        expect(splitName('John Smith')).toEqual({ first_name: 'John', last_name: 'Smith' });
    });

    it('handles single name', () => {
        expect(splitName('John')).toEqual({ first_name: 'John', last_name: '' });
    });

    it('handles multi-part last name', () => {
        expect(splitName('John Paul Smith')).toEqual({ first_name: 'John', last_name: 'Paul Smith' });
    });

    it('handles empty/null name', () => {
        expect(splitName(null)).toEqual({ first_name: 'Customer', last_name: '' });
        expect(splitName('')).toEqual({ first_name: 'Customer', last_name: '' });
    });

    it('trims whitespace', () => {
        expect(splitName('  John   Smith  ')).toEqual({ first_name: 'John', last_name: 'Smith' });
    });
});

describe('shipping address DB queries', () => {
    let db, stmts;

    beforeEach(() => {
        db = createTestDb();
        stmts = buildStmts(db);
    });

    it('stores and retrieves shipping address', () => {
        stmts.purchases.insertPurchase.run('sess_1', 'user_1', 'test@example.com', 'Test Product', 1000);
        stmts.purchases.updateShippingAddress.run('John Smith', '123 Main St', 'Brooklyn', 'NY', '11201', 'US', 'sess_1');

        const purchase = stmts.purchases.getBySessionId.get('sess_1');
        expect(purchase.shipping_name).toBe('John Smith');
        expect(purchase.shipping_address).toBe('123 Main St');
        expect(purchase.shipping_city).toBe('Brooklyn');
        expect(purchase.shipping_state).toBe('NY');
        expect(purchase.shipping_postal_code).toBe('11201');
        expect(purchase.shipping_country).toBe('US');
    });

    it('stores ShippingEasy order ID', () => {
        stmts.purchases.insertPurchase.run('sess_2', 'user_1', 'test@example.com', 'Test Product', 1000);
        stmts.purchases.setShippingEasyOrderId.run('se_order_123', 'sess_2');

        const purchase = stmts.purchases.getBySessionId.get('sess_2');
        expect(purchase.shippingeasy_order_id).toBe('se_order_123');
    });

    it('getPendingShipments returns orders with SE ID but no tracking', () => {
        stmts.purchases.insertPurchase.run('sess_3', 'user_1', 'test@example.com', 'Product A', 1000);
        stmts.purchases.updateShippingAddress.run('John', '123 Main', 'NYC', 'NY', '10001', 'US', 'sess_3');
        stmts.purchases.setShippingEasyOrderId.run('se_100', 'sess_3');

        const pending = stmts.purchases.getPendingShipments.all();
        expect(pending).toHaveLength(1);
        expect(pending[0].stripe_session_id).toBe('sess_3');
    });

    it('getPendingShipments excludes orders with tracking', () => {
        stmts.purchases.insertPurchase.run('sess_4', 'user_1', 'buyer@example.com', 'Product B', 2000);
        stmts.purchases.updateShippingAddress.run('Jane', '456 Oak', 'LA', 'CA', '90001', 'US', 'sess_4');
        stmts.purchases.setShippingEasyOrderId.run('se_200', 'sess_4');

        // Add tracking for this buyer
        db.prepare(`INSERT INTO tracking (customer_email, tracking_number, carrier, created_at) VALUES (?, ?, ?, datetime('now'))`).run('buyer@example.com', 'TRACK123', 'USPS');

        const pending = stmts.purchases.getPendingShipments.all();
        expect(pending).toHaveLength(0);
    });

    it('getReadyShipments returns orders with tracking', () => {
        stmts.purchases.insertPurchase.run('sess_5', 'user_1', 'buyer2@example.com', 'Product C', 3000);
        stmts.purchases.updateShippingAddress.run('Bob', '789 Pine', 'SF', 'CA', '94101', 'US', 'sess_5');
        stmts.purchases.setShippingEasyOrderId.run('se_300', 'sess_5');

        db.prepare(`INSERT INTO tracking (customer_email, tracking_number, carrier, tracking_url, created_at) VALUES (?, ?, ?, ?, datetime('now'))`).run('buyer2@example.com', 'TRACK456', 'UPS', 'https://ups.com/track');

        const ready = stmts.purchases.getReadyShipments.all();
        expect(ready).toHaveLength(1);
        expect(ready[0].tracking_number).toBe('TRACK456');
        expect(ready[0].carrier).toBe('UPS');
    });

    it('excludes orders without shipping address (battle buy-ins)', () => {
        stmts.purchases.insertPurchase.run('sess_battle', 'user_1', 'test@example.com', 'Battle Pack', 1000);
        // No shipping address set — simulates a battle buy-in

        const pending = stmts.purchases.getPendingShipments.all();
        expect(pending).toHaveLength(0);
    });

    it('getShipmentsByDiscordId returns user shipments with tracking status', () => {
        stmts.purchases.insertPurchase.run('sess_6', 'user_2', 'alice@example.com', 'Product D', 1500);
        stmts.purchases.updateShippingAddress.run('Alice', '100 Elm', 'Boston', 'MA', '02101', 'US', 'sess_6');
        stmts.purchases.setShippingEasyOrderId.run('se_400', 'sess_6');

        const shipments = stmts.purchases.getShipmentsByDiscordId.all('user_2');
        expect(shipments).toHaveLength(1);
        expect(shipments[0].product_name).toBe('Product D');
        expect(shipments[0].tracking_number).toBeNull(); // no tracking yet
    });
});
