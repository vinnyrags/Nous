/**
 * Discord Server Audit — read-only snapshot of current state.
 *
 * Usage: node scripts/shop/discord-audit.js
 */

const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

/**
 * Read a PHP define() value from wp-config-env.php as a fallback
 * when the environment variable isn't set.
 */
function getConfigToken() {
    if (process.env.DISCORD_BOT_TOKEN) return process.env.DISCORD_BOT_TOKEN;

    const configPath = path.resolve(__dirname, '../../wp-config-env.php');
    try {
        const contents = fs.readFileSync(configPath, 'utf8');
        const match = contents.match(/define\(\s*'DISCORD_BOT_TOKEN'\s*,\s*'([^']*)'\s*\)/);
        if (match && match[1]) return match[1];
    } catch { /* file not found */ }

    return null;
}

const TOKEN = getConfigToken();
if (!TOKEN) { console.error('Set DISCORD_BOT_TOKEN in wp-config-env.php or as an env var.'); process.exit(1); }

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
    ],
});

client.once('ready', async () => {
    const guild = client.guilds.cache.first();
    if (!guild) {
        console.log('No guild found.');
        process.exit(1);
    }

    console.log(`\nServer: ${guild.name}`);
    console.log(`Members: ${guild.memberCount}`);
    console.log(`ID: ${guild.id}\n`);

    // Categories and channels
    console.log('=== CHANNELS ===\n');
    const categories = guild.channels.cache
        .filter((c) => c.type === 4) // CategoryChannel
        .sort((a, b) => a.position - b.position);

    const uncategorized = guild.channels.cache
        .filter((c) => !c.parentId && c.type !== 4)
        .sort((a, b) => a.position - b.position);

    if (uncategorized.size) {
        console.log('(No Category)');
        uncategorized.forEach((c) => {
            const type = c.type === 0 ? '#' : c.type === 2 ? '🔊' : c.type === 5 ? '📢' : '?';
            console.log(`  ${type} ${c.name} (ID: ${c.id})`);
        });
        console.log();
    }

    categories.forEach((cat) => {
        console.log(`${cat.name} (ID: ${cat.id})`);
        const children = guild.channels.cache
            .filter((c) => c.parentId === cat.id)
            .sort((a, b) => a.position - b.position);
        children.forEach((c) => {
            const type = c.type === 0 ? '#' : c.type === 2 ? '🔊' : c.type === 5 ? '📢' : '?';
            const nsfw = c.nsfw ? ' [NSFW]' : '';
            console.log(`  ${type} ${c.name} (ID: ${c.id})${nsfw}`);
        });
        console.log();
    });

    // Roles
    console.log('=== ROLES ===\n');
    const roles = guild.roles.cache
        .sort((a, b) => b.position - a.position);
    roles.forEach((r) => {
        if (r.name === '@everyone') return;
        const color = r.hexColor !== '#000000' ? ` [${r.hexColor}]` : '';
        const managed = r.managed ? ' (bot)' : '';
        console.log(`  ${r.name} — ${r.members.size} members${color}${managed} (ID: ${r.id})`);
    });

    console.log(`\nTotal: ${roles.size} roles, ${guild.channels.cache.size} channels`);

    client.destroy();
});

client.login(TOKEN);
