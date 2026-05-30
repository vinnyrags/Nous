import { describe, it, expect } from 'vitest';
import { BRIDGE_VERSION } from '@itzenzottv/stripe-bridge';

describe('@itzenzottv/stripe-bridge wiring', () => {
    it('resolves as a workspace package and exports its version', () => {
        expect(BRIDGE_VERSION).toBe('0.1.0');
    });
});
