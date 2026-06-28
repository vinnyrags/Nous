/**
 * Phase C — native slash command bindings for the remaining mid/low
 * frequency commands. Uses defineSlashCommand() factory so each
 * command is a small declarative spec.
 *
 * For commands with subcommands, the factory pattern wraps a single
 * dispatch shape: argsBuilder reads interaction.options.getSubcommand()
 * + relevant options, returns args[] for handleX(message, args).
 */

import { defineSlashCommand } from './factory.js';
import { handleGiveaway } from '../giveaway.js';
import { handleDroppedOff } from '../dropped-off.js';
import { handleSnapshot } from '../snapshot.js';
import { handleCapture } from '../capture.js';
import { handleNous } from '../nous.js';
import { handleTracking } from '../tracking.js';
import { handleShipments } from '../shipments.js';

// /giveaway — subcommands: start, close, cancel, status, test, clean, off
export const handleGiveawaySlash = defineSlashCommand({
    name: 'giveaway',
    handler: handleGiveaway,
    argsBuilder: (i) => {
        const sub = i.options.getSubcommand();
        const extra = i.options.getString('args');
        return extra ? [sub, ...extra.split(/\s+/)] : [sub];
    },
});

// /tracking — subcommands: lookup ref:<string>, list, clear
export const handleTrackingSlash = defineSlashCommand({
    name: 'tracking',
    handler: handleTracking,
    argsBuilder: (i) => {
        const sub = i.options.getSubcommand();
        if (sub === 'lookup') {
            return [i.options.getString('reference', true)];
        }
        return [sub];
    },
});

// /shipments — subcommands: list (default), status, ready
export const handleShipmentsSlash = defineSlashCommand({
    name: 'shipments',
    handler: handleShipments,
    argsBuilder: (i) => {
        const sub = i.options.getSubcommand(false) || 'list';
        return sub === 'list' ? [] : [sub];
    },
});

// /snapshot — capture current state (free-form args)
export const handleSnapshotSlash = defineSlashCommand({
    name: 'snapshot',
    handler: handleSnapshot,
    argsBuilder: (i) => {
        const action = i.options.getString('action');
        return action ? action.split(/\s+/) : [];
    },
});

// /capture — capture moments (no args)
export const handleCaptureSlash = defineSlashCommand({
    name: 'capture',
    handler: handleCapture,
    argsBuilder: () => [],
});

// /nous — bot self-management (free-form args)
export const handleNousSlash = defineSlashCommand({
    name: 'nous',
    handler: handleNous,
    argsBuilder: (i) => {
        const action = i.options.getString('action');
        return action ? action.split(/\s+/) : [];
    },
});

// /dropped-off — mark batch dropped off
export const handleDroppedOffSlash = defineSlashCommand({
    name: 'dropped-off',
    handler: handleDroppedOff,
    argsBuilder: (i) => {
        const intl = i.options.getBoolean('intl');
        return intl ? ['intl'] : [];
    },
});
