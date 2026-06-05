#!/usr/bin/env node
/**
 * Register slash commands with Discord. Run after adding/changing any
 * slash command. Guild-scoped registrations propagate instantly; global
 * registrations take ~1 hour. We use guild-scoped against production.
 *
 * Usage:
 *   node scripts/register-slash-commands.mjs           — production guild
 *   GUILD_ID=<test-guild-id> node scripts/...          — override target
 */

import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const APPLICATION_ID = process.env.DISCORD_APPLICATION_ID || process.env.APPLICATION_ID;
const GUILD_ID = process.env.GUILD_ID || '862139045974638612'; // production

if (!TOKEN) { console.error('DISCORD_BOT_TOKEN missing'); process.exit(2); }
if (!APPLICATION_ID) {
    console.error('DISCORD_APPLICATION_ID missing — set in .env. Find it in the Discord Developer Portal under your bot application.');
    process.exit(2);
}

// All slash commands are Akivili-only. We restrict via Discord's
// default_member_permissions (admin) AND a runtime role check in each
// handler — defense in depth.
const ADMIN_ONLY = PermissionFlagsBits.Administrator;

// Whatnot-era active set (2026-06-05): commerce moved to Whatnot, Stripe
// retired — the Stripe-dependent commands (/hype /sell /list /sold /pull
// /coupon /refund /waive /link /sync), self-fulfilment shipping commands
// (/tracking /shipments /shipping /shipping-audit /intl /intl-ship
// /dropped-off), and queue-driven stream mechanics (/queue /duckrace
// /battle /snapshot /capture) are deregistered. Handlers remain in the
// codebase and are still reachable via /op if ever needed.
const commands = [
    // /op <command-string> — universal dispatcher
    new SlashCommandBuilder()
        .setName('op')
        .setDescription('Run a legacy ops command (universal dispatcher)')
        .setDefaultMemberPermissions(ADMIN_ONLY)
        .addStringOption((opt) => opt
            .setName('command')
            .setDescription('e.g. "giveaway status", "nous status"')
            .setRequired(true)
            .setAutocomplete(true)),

    // /reset (button confirmation in handler)
    new SlashCommandBuilder()
        .setName('reset')
        .setDescription('Wipe transactional state for next stream (with confirmation)')
        .setDefaultMemberPermissions(ADMIN_ONLY),

    // /live — go live
    new SlashCommandBuilder()
        .setName('live')
        .setDescription('Announce stream start; set live state')
        .setDefaultMemberPermissions(ADMIN_ONLY),

    // /offline — go offline
    new SlashCommandBuilder()
        .setName('offline')
        .setDescription('Announce stream end; clear live state')
        .setDefaultMemberPermissions(ADMIN_ONLY),

    // /spin — pick giveaway winner
    new SlashCommandBuilder()
        .setName('spin')
        .setDescription('Pick a giveaway winner')
        .setDefaultMemberPermissions(ADMIN_ONLY)
        .addSubcommand((s) => s.setName('random').setDescription('Random pick from giveaway entrants'))
        .addSubcommand((s) => s
            .setName('pick')
            .setDescription('Owner-only: pick a specific winner')
            .addUserOption((o) => o.setName('user').setDescription('User to pick').setRequired(true))),

    // ----- Phase C — mid/low frequency native commands -----

    // /giveaway — giveaway lifecycle
    new SlashCommandBuilder()
        .setName('giveaway')
        .setDescription('Giveaway lifecycle')
        .setDefaultMemberPermissions(ADMIN_ONLY)
        .addSubcommand((s) => s.setName('start').setDescription('Start a new giveaway')
            .addStringOption((o) => o.setName('args').setDescription('Title + optional duration')))
        .addSubcommand((s) => s.setName('close').setDescription('Close active giveaway'))
        .addSubcommand((s) => s.setName('cancel').setDescription('Cancel active giveaway'))
        .addSubcommand((s) => s.setName('status').setDescription('Show active giveaway state'))
        .addSubcommand((s) => s.setName('test').setDescription('Test giveaway flow')
            .addStringOption((o) => o.setName('args').setDescription('Optional test args')))
        .addSubcommand((s) => s.setName('clean').setDescription('Clean up old giveaways'))
        .addSubcommand((s) => s.setName('off').setDescription('Disable giveaway feature')),

    // /nous — bot self-management
    new SlashCommandBuilder()
        .setName('nous')
        .setDescription('Bot self-management')
        .setDefaultMemberPermissions(ADMIN_ONLY)
        .addStringOption((o) => o.setName('action').setDescription('Action to perform')),
].map((c) => c.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
    console.log(`Registering ${commands.length} slash command(s) to guild ${GUILD_ID}...`);
    try {
        const data = await rest.put(
            Routes.applicationGuildCommands(APPLICATION_ID, GUILD_ID),
            { body: commands },
        );
        console.log(`✓ Registered:`);
        for (const c of data) console.log(`  /${c.name}`);
    } catch (e) {
        console.error('✗ Registration failed:', e.message);
        process.exit(1);
    }
})();
