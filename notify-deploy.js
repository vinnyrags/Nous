#!/usr/bin/env node
/**
 * Deploy notification — posts to #dev-log via Discord REST API.
 *
 * Called by the post-receive hook. Uses the bot token directly (not the
 * bot process, which may be restarting).
 *
 * Usage:
 *   node notify-deploy.js --status=push --branch=main --summary="commit info"
 *   node notify-deploy.js --status=success --branch=main --env=production --summary="commit info"
 *   node notify-deploy.js --status=tests-failed --branch=main --env=production --output="failure details"
 *   node notify-deploy.js --status=failed --branch=main --env=production --error="build error"
 */

import 'dotenv/config';

// Parse args
const args = Object.fromEntries(
    process.argv.slice(2)
        .filter((a) => a.startsWith('--'))
        .map((a) => {
            const [key, ...rest] = a.slice(2).split('=');
            return [key, rest.join('=') || 'true'];
        })
);

const { status, branch, env, summary, output, error } = args;

const botToken = process.env.DISCORD_BOT_TOKEN;

if (!botToken) {
    console.error('No bot token found — skipping deploy notification');
    process.exit(0);
}

const CHANNEL_ID = '1489513907025346630'; // #dev-log

// Build embed
let title, description, color;

switch (status) {
    case 'push':
        title = `📥 Push to ${branch}`;
        description = summary || '';
        color = 0x95a5a6; // grey
        break;

    case 'success':
        title = `✅ Deployed to ${env}`;
        description = summary || 'Deployment complete.';
        color = 0xceff00; // green
        break;

    case 'tests-failed':
        title = `❌ Deploy blocked — tests failed`;
        description = [
            `**${branch} → ${env}** — bot NOT restarted, previous version still running.`,
            '',
            output ? `\`\`\`\n${output.slice(0, 1500)}\n\`\`\`` : '',
        ].filter(Boolean).join('\n');
        color = 0xe74c3c; // red
        break;

    case 'failed':
        title = `❌ Deploy failed — ${branch} to ${env}`;
        description = error || 'Unknown error.';
        color = 0xe74c3c; // red
        break;

    default:
        title = `📋 ${status}`;
        description = summary || output || error || '';
        color = 0x95a5a6;
}

const embed = {
    title,
    description,
    color,
    timestamp: new Date().toISOString(),
};

// Post via Discord REST API
try {
    const res = await fetch(`https://discord.com/api/v10/channels/${CHANNEL_ID}/messages`, {
        method: 'POST',
        headers: {
            Authorization: `Bot ${botToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ embeds: [embed] }),
    });

    if (!res.ok) {
        const text = await res.text();
        console.error(`Discord API error (${res.status}): ${text}`);
    }
} catch (e) {
    console.error('Failed to send deploy notification:', e.message);
}
