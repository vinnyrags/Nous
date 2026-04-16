/**
 * Discord Security Setup — verification gate + spam prevention.
 *
 * What this script does:
 *
 * 1. Creates a #verify channel in 📢 INFO
 * 2. Uses existing #mod-log for AutoMod/bot alerts (no new channel)
 * 3. Locks down ALL public categories so @everyone CANNOT see them
 * 4. Grants Xipe (verified member) VIEW access to public categories
 * 5. Keeps #rules and #verify visible to @everyone (so new members can verify)
 * 6. Keeps mod channels restricted to Nanook
 * 7. Keeps After Dark restricted to Ena
 * 8. Keeps Archive restricted to IX
 * 9. Bulk-assigns Xipe to all existing non-bot members
 *
 * After running:
 * - Existing members keep full access (Xipe bulk-assigned)
 * - New members see ONLY #rules, #roles, #verify, #announcements, #welcome
 * - They react in #verify (Carl-bot reaction role) to get Xipe
 * - Xipe unlocks the full server immediately (no wait time)
 * - Bots/spam accounts that don't verify can't post anywhere
 *
 * Usage: node scripts/shop/discord-security.js [--yes]
 */

const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits } = require('discord.js');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

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

const GUILD_ID = '862139045974638612';
const AUTO_YES = process.argv.includes('--yes');
const rl = AUTO_YES ? null : readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl ? rl.question(q, resolve) : resolve('y'));

async function confirm(action) {
    if (AUTO_YES) {
        console.log(`\n→ ${action}`);
        console.log('  Auto-confirmed (--yes)');
        return true;
    }
    const answer = await ask(`\n→ ${action}\n  Proceed? (y/n): `);
    return answer.toLowerCase().trim() === 'y';
}

// =========================================================================
// IDs from audit
// =========================================================================
const CATEGORY_IDS = {
    INFO:       '1488041088001380523',
    SHOP:       '1488041090044137702',
    CARDS:      '1488041090966880336',
    GAMING:     '1488041091700887662',
    COMMUNITY:  '1488041092682219580',
    AFTER_DARK: '1488041093734858882',
    ARCHIVE:    '1488041094888292533',
};

const ROLE_IDS = {
    XIPE:    '898717442803642429',
    NANOOK:  '1488046525899739148',
    AKIVILI: '1488046525065072670',
    ENA:     '1488046532358967297',
    IX:      '1488046531000008710',
    LAN:     '1488046529049661470',
};

const CHANNEL_IDS = {
    RULES:         '1488041095991660634',
    ROLES:         '1488041097153347704',
    ANNOUNCEMENTS: '862806276639293510',
    MOD_LOG:       '862800551476854825',
    MOD_CHAT:      '863469658178060328',
    CARLBOT:       '974443978839695392',
    WELCOME:       '898715514086498324',
};

// Categories that verified members (Xipe) can access
const PUBLIC_CATEGORIES = ['SHOP', 'CARDS', 'GAMING', 'COMMUNITY'];

// Categories with special role gating
const GATED_CATEGORIES = {
    AFTER_DARK: ROLE_IDS.ENA,
    ARCHIVE: ROLE_IDS.IX,
};

// Mod-only channels (inside INFO, hidden from everyone except Nanook/Akivili)
const MOD_CHANNELS = [
    CHANNEL_IDS.MOD_LOG,
    CHANNEL_IDS.MOD_CHAT,
    CHANNEL_IDS.CARLBOT,
];

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.once('ready', async () => {
    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        await guild.channels.fetch();
        await guild.roles.fetch();

        const everyone = guild.roles.everyone;

        console.log('\n=== DISCORD SECURITY SETUP ===\n');
        console.log(`Server: ${guild.name} (${guild.memberCount} members)\n`);

        // =====================================================================
        // Step 1: Create #verify channel
        // =====================================================================
        let verifyChannel = guild.channels.cache.find(
            (c) => c.name === 'verify' && c.type === ChannelType.GuildText
        );

        if (verifyChannel) {
            console.log('  #verify already exists — skipping creation.');
        } else if (await confirm('Create #verify channel in 📢 INFO')) {
            verifyChannel = await guild.channels.create({
                name: 'verify',
                type: ChannelType.GuildText,
                parent: CATEGORY_IDS.INFO,
                topic: 'React below to verify and unlock the server.',
            });
            console.log(`  ✓ Created #verify (ID: ${verifyChannel.id})`);
        }

        // =====================================================================
        // Step 2: Lock down 📢 INFO category — @everyone can't see it
        // =====================================================================
        if (await confirm('Lock 📢 INFO category — hide from @everyone by default')) {
            const infoCat = guild.channels.cache.get(CATEGORY_IDS.INFO);
            await infoCat.permissionOverwrites.edit(everyone, {
                ViewChannel: false,
            });
            // Nanook can see everything in INFO
            await infoCat.permissionOverwrites.edit(ROLE_IDS.NANOOK, {
                ViewChannel: true,
                SendMessages: true,
            });
            // Akivili too
            await infoCat.permissionOverwrites.edit(ROLE_IDS.AKIVILI, {
                ViewChannel: true,
                SendMessages: true,
            });
            console.log('  ✓ INFO category hidden from @everyone, visible to Nanook/Akivili');
        }

        // =====================================================================
        // Step 3: Make #rules, #roles, #verify, #announcements, #welcome
        //         visible to @everyone (override category deny)
        // =====================================================================
        const publicInfoChannels = [
            { id: CHANNEL_IDS.RULES, name: 'rules', readOnly: true },
            { id: CHANNEL_IDS.ROLES, name: 'roles', readOnly: true },
            { id: CHANNEL_IDS.ANNOUNCEMENTS, name: 'announcements', readOnly: true },
            { id: CHANNEL_IDS.WELCOME, name: 'welcome', readOnly: true },
        ];

        // Add verify channel if it was created or already exists
        if (verifyChannel) {
            publicInfoChannels.push({ id: verifyChannel.id, name: 'verify', readOnly: true });
        }

        if (await confirm('Make #rules, #roles, #verify, #announcements, #welcome visible to @everyone (read-only)')) {
            for (const ch of publicInfoChannels) {
                const channel = guild.channels.cache.get(ch.id);
                if (!channel) {
                    console.log(`  ⚠ #${ch.name} not found — skipping.`);
                    continue;
                }
                const perms = { ViewChannel: true };
                if (ch.readOnly) {
                    perms.SendMessages = false;
                    perms.AddReactions = ch.name === 'verify' || ch.name === 'roles'; // Allow reactions in verify + roles
                }
                await channel.permissionOverwrites.edit(everyone, perms);
                console.log(`  ✓ #${ch.name} — visible to @everyone${ch.readOnly ? ' (read-only)' : ''}`);
            }
        }

        // Allow reactions specifically in #verify and #roles for @everyone
        if (verifyChannel) {
            await verifyChannel.permissionOverwrites.edit(everyone, {
                ViewChannel: true,
                SendMessages: false,
                AddReactions: true,
            });
        }
        const rolesChannel = guild.channels.cache.get(CHANNEL_IDS.ROLES);
        if (rolesChannel) {
            await rolesChannel.permissionOverwrites.edit(everyone, {
                ViewChannel: true,
                SendMessages: false,
                AddReactions: true,
            });
        }

        // =====================================================================
        // Step 4: Lock mod channels to Nanook/Akivili only
        // =====================================================================
        if (await confirm('Restrict mod channels (mod-log, mod-chat, carlbot) to Nanook/Akivili only')) {
            for (const chId of MOD_CHANNELS) {
                const channel = guild.channels.cache.get(chId);
                if (!channel) continue;

                // Explicitly deny @everyone (redundant with category but explicit is safer)
                await channel.permissionOverwrites.edit(everyone, {
                    ViewChannel: false,
                });
                await channel.permissionOverwrites.edit(ROLE_IDS.NANOOK, {
                    ViewChannel: true,
                    SendMessages: true,
                });
                await channel.permissionOverwrites.edit(ROLE_IDS.AKIVILI, {
                    ViewChannel: true,
                    SendMessages: true,
                });
                console.log(`  ✓ #${channel.name} — Nanook/Akivili only`);
            }
        }

        // =====================================================================
        // Step 5: Lock public categories — @everyone denied, Xipe granted
        // =====================================================================
        if (await confirm('Lock public categories (SHOP, CARDS, GAMING, COMMUNITY) — @everyone denied, Xipe granted')) {
            for (const catKey of PUBLIC_CATEGORIES) {
                const cat = guild.channels.cache.get(CATEGORY_IDS[catKey]);
                if (!cat) {
                    console.log(`  ⚠ ${catKey} category not found — skipping.`);
                    continue;
                }

                await cat.permissionOverwrites.edit(everyone, {
                    ViewChannel: false,
                });
                await cat.permissionOverwrites.edit(ROLE_IDS.XIPE, {
                    ViewChannel: true,
                    SendMessages: true,
                });
                // Nanook and Akivili always have access
                await cat.permissionOverwrites.edit(ROLE_IDS.NANOOK, {
                    ViewChannel: true,
                    SendMessages: true,
                });
                await cat.permissionOverwrites.edit(ROLE_IDS.AKIVILI, {
                    ViewChannel: true,
                    SendMessages: true,
                });
                console.log(`  ✓ ${cat.name} — locked to Xipe/Nanook/Akivili`);
            }
        }

        // =====================================================================
        // Step 6: Gate After Dark behind Ena (+ deny @everyone and Xipe)
        // =====================================================================
        if (await confirm('Gate 🔞 AFTER DARK — Ena role required (Xipe alone is not enough)')) {
            const afterDarkCat = guild.channels.cache.get(CATEGORY_IDS.AFTER_DARK);
            if (afterDarkCat) {
                await afterDarkCat.permissionOverwrites.edit(everyone, { ViewChannel: false });
                await afterDarkCat.permissionOverwrites.edit(ROLE_IDS.XIPE, { ViewChannel: false });
                await afterDarkCat.permissionOverwrites.edit(ROLE_IDS.ENA, {
                    ViewChannel: true,
                    SendMessages: true,
                });
                await afterDarkCat.permissionOverwrites.edit(ROLE_IDS.NANOOK, {
                    ViewChannel: true, SendMessages: true,
                });
                await afterDarkCat.permissionOverwrites.edit(ROLE_IDS.AKIVILI, {
                    ViewChannel: true, SendMessages: true,
                });
                console.log('  ✓ 🔞 AFTER DARK — Ena only (Xipe denied)');
            }
        }

        // =====================================================================
        // Step 7: Gate Archive behind IX
        // =====================================================================
        if (await confirm('Gate 📦 ARCHIVE — IX role required')) {
            const archiveCat = guild.channels.cache.get(CATEGORY_IDS.ARCHIVE);
            if (archiveCat) {
                await archiveCat.permissionOverwrites.edit(everyone, { ViewChannel: false });
                await archiveCat.permissionOverwrites.edit(ROLE_IDS.XIPE, { ViewChannel: false });
                await archiveCat.permissionOverwrites.edit(ROLE_IDS.IX, {
                    ViewChannel: true,
                    SendMessages: false, // read-only archive
                });
                await archiveCat.permissionOverwrites.edit(ROLE_IDS.NANOOK, {
                    ViewChannel: true, SendMessages: true,
                });
                await archiveCat.permissionOverwrites.edit(ROLE_IDS.AKIVILI, {
                    ViewChannel: true, SendMessages: true,
                });
                console.log('  ✓ 📦 ARCHIVE — IX only (read-only for members)');
            }
        }

        // =====================================================================
        // Step 8: Bulk-assign Xipe to all current non-bot members
        // =====================================================================
        const xipeRole = guild.roles.cache.get(ROLE_IDS.XIPE);
        if (xipeRole) {
            await guild.members.fetch();
            const nonBotMembers = guild.members.cache.filter((m) => !m.user.bot);
            const needsXipe = nonBotMembers.filter((m) => !m.roles.cache.has(ROLE_IDS.XIPE));

            if (needsXipe.size === 0) {
                console.log('  All non-bot members already have Xipe — skipping.');
            } else if (await confirm(`Bulk-assign Xipe to ${needsXipe.size} existing members (${nonBotMembers.size} total non-bot)`)) {
                let assigned = 0;
                for (const [, member] of needsXipe) {
                    try {
                        await member.roles.add(xipeRole);
                        assigned++;
                        if (assigned % 50 === 0) {
                            console.log(`  ... ${assigned}/${needsXipe.size} assigned`);
                        }
                    } catch (e) {
                        console.log(`  ⚠ Could not assign Xipe to ${member.user.tag}: ${e.message}`);
                    }
                }
                console.log(`  ✓ Assigned Xipe to ${assigned} existing members`);
            }
        }

        // =====================================================================
        // Summary
        // =====================================================================
        console.log('\n=== SETUP COMPLETE ===\n');
        console.log('New member flow:');
        console.log('  1. Join server → sees only #rules, #roles, #verify, #announcements, #welcome');
        console.log('  2. Reacts in #verify → Carl-bot assigns Xipe role');
        console.log('  3. Xipe unlocks SHOP, CARDS, GAMING, COMMUNITY');
        console.log('  4. Optional: grab Ena in #roles for After Dark access');
        console.log('  5. Optional: grab IX in #roles for Archive access');
        console.log('\nManual steps remaining:');
        console.log('  1. Set up Carl-bot reaction role in #verify (assign Xipe on react)');
        console.log('  2. Add a verification message to #verify (e.g., "React ✅ to verify")');
        console.log('  3. Configure Discord AutoMod in Server Settings → Safety Setup:');
        console.log('     - Enable "Block Spam Content"');
        console.log('     - Enable "Block Mention Spam" (5+ mentions)');
        console.log('     - Set alert channel to #mod-log');
        console.log('  4. Configure Carl-bot automod (dashboard):');
        console.log('     - Anti-spam: 5 messages in 5s → mute + alert');
        console.log('     - Anti-raid: 10 joins in 10s → lockdown + alert');
        console.log('     - Duplicate message detection: on');
        console.log('     - Set log channel to #mod-log');

    } catch (e) {
        console.error('\nError:', e.message);
        if (e.code) console.error('Discord error code:', e.code);
    }

    if (rl) rl.close();
    client.destroy();
});

client.login(TOKEN);
