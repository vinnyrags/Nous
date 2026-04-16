/**
 * Discord Server Migration — interactive, step-by-step.
 * Each action requires confirmation before executing.
 *
 * Usage: node scripts/shop/discord-migrate.js [phase]
 *
 * Phases:
 *   1 — Rebrand (rename server, update description)
 *   2 — Create new categories and channels
 *   3 — Move/rename existing channels to new categories
 *   4 — Archive old channels + delete voice channels
 *   5 — Create Aeon roles
 *   6 — Send mod-chat message
 *
 * Run without a phase to see the menu.
 */

const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const readline = require('readline');
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

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
    ],
});

// =========================================================================
// Phase 1: Rebrand
// =========================================================================
async function phase1(guild) {
    console.log('\n=== PHASE 1: REBRAND ===\n');

    if (await confirm('Rename server from "The DevAnime Community" to "itzenzoTTV"')) {
        await guild.setName('itzenzoTTV');
        console.log('  ✓ Server renamed to "itzenzoTTV"');
    }

    if (await confirm('Update server description to "Cards. Games. After Dark. Welcome to the family."')) {
        try {
            await guild.setDescription('Cards. Games. After Dark. Welcome to the family.');
            console.log('  ✓ Description updated');
        } catch (e) {
            console.log('  ⚠ Could not update description (may require Community features enabled)');
        }
    }

    console.log('\nPhase 1 complete.');
}

// =========================================================================
// Phase 2: Create new categories and channels
// =========================================================================
async function phase2(guild) {
    console.log('\n=== PHASE 2: CREATE NEW CATEGORIES & CHANNELS ===\n');

    const newCategories = [
        { name: '📢 INFO' },
        { name: '🛒 SHOP' },
        { name: '🃏 CARDS' },
        { name: '🎮 GAMING' },
        { name: '💬 COMMUNITY' },
        { name: '🔞 AFTER DARK' },
        { name: '📦 ARCHIVE' },
    ];

    const createdCategories = {};

    for (const cat of newCategories) {
        const existing = guild.channels.cache.find(
            (c) => c.type === ChannelType.GuildCategory && c.name === cat.name
        );

        if (existing) {
            console.log(`  Category "${cat.name}" already exists — skipping.`);
            createdCategories[cat.name] = existing;
            continue;
        }

        if (await confirm(`Create category "${cat.name}"`)) {
            const created = await guild.channels.create({
                name: cat.name,
                type: ChannelType.GuildCategory,
            });
            createdCategories[cat.name] = created;
            console.log(`  ✓ Created category "${cat.name}" (ID: ${created.id})`);
        }
    }

    // New channels that don't exist yet
    const newChannels = [
        { name: 'rules', category: '📢 INFO' },
        { name: 'roles', category: '📢 INFO' },
        { name: 'deals', category: '🛒 SHOP' },
        { name: 'order-feed', category: '🛒 SHOP' },
        { name: 'pack-battles', category: '🛒 SHOP' },
        { name: 'pokemon', category: '🃏 CARDS' },
        { name: 'card-night-queue', category: '🛒 SHOP' },
        { name: 'looking-for-group', category: '🎮 GAMING' },
        { name: 'memes', category: '💬 COMMUNITY' },
        { name: 'murphy-tax', category: '💬 COMMUNITY' },
        { name: 'life', category: '💬 COMMUNITY' },
        { name: 'mature-drops', category: '🔞 AFTER DARK', nsfw: true },
    ];

    for (const ch of newChannels) {
        const existing = guild.channels.cache.find(
            (c) => c.type === ChannelType.GuildText && c.name === ch.name
        );

        if (existing) {
            console.log(`  Channel "#${ch.name}" already exists — skipping.`);
            continue;
        }

        const parentCat = createdCategories[ch.category];
        if (!parentCat) {
            console.log(`  ⚠ Category "${ch.category}" not found — skipping #${ch.name}`);
            continue;
        }

        if (await confirm(`Create channel "#${ch.name}" in "${ch.category}"${ch.nsfw ? ' [NSFW]' : ''}`)) {
            await guild.channels.create({
                name: ch.name,
                type: ChannelType.GuildText,
                parent: parentCat.id,
                nsfw: ch.nsfw || false,
            });
            console.log(`  ✓ Created #${ch.name}`);
        }
    }

    console.log('\nPhase 2 complete.');
}

// =========================================================================
// Phase 3: Move/rename existing channels to new categories
// =========================================================================
async function phase3(guild) {
    console.log('\n=== PHASE 3: MOVE & RENAME EXISTING CHANNELS ===\n');

    await guild.channels.fetch();

    // Renames (preserve history)
    const renames = [
        { id: '866726650526957598', from: 'all-things-anime', to: 'anime' },
        { id: '969042183841787945', from: 'game-chat', to: 'general-gaming' },
    ];

    for (const rename of renames) {
        const channel = guild.channels.cache.get(rename.id);
        if (!channel) {
            console.log(`  ⚠ #${rename.from} not found — skipping.`);
            continue;
        }
        if (channel.name === rename.to) {
            console.log(`  #${rename.from} already renamed to #${rename.to} — skipping.`);
            continue;
        }
        if (await confirm(`Rename #${rename.from} → #${rename.to} (preserves history)`)) {
            await channel.setName(rename.to);
            console.log(`  ✓ Renamed #${rename.from} → #${rename.to}`);
        }
    }

    // Moves
    const moves = [
        // INFO
        { id: '862806276639293510', name: 'announcements', to: '📢 INFO' },
        { id: '862800551476854825', name: 'mod-log', to: '📢 INFO' },
        { id: '863469658178060328', name: 'mod-chat', to: '📢 INFO' },
        { id: '974443978839695392', name: 'carlbot', to: '📢 INFO' },

        // CARDS
        { id: '866726650526957598', name: 'anime', to: '🃏 CARDS' },  // renamed from all-things-anime
        { id: '966884791603585044', name: 'buy-trade-sell', to: '🃏 CARDS' },

        // GAMING
        { id: '969042183841787945', name: 'general-gaming', to: '🎮 GAMING' },  // renamed from game-chat
        { id: '862822719942426644', name: 'minecraft', to: '🎮 GAMING' },
        { id: '1104925403648368720', name: 'azur-lane', to: '🎮 GAMING' },
        { id: '1074074510149554307', name: 'fortnite', to: '🎮 GAMING' },
        { id: '1104925459029970954', name: 'star-rail', to: '🎮 GAMING' },
        { id: '1304929364466733139', name: 'zenless-zone-zero', to: '🎮 GAMING' },
        { id: '1005211845042380850', name: 'pokemon-slots', to: '🎮 GAMING' },
        { id: '1310847649519370260', name: 'karuta-drops-grabs', to: '🎮 GAMING' },
        { id: '1316106009240145920', name: 'karuta-commands', to: '🎮 GAMING' },
        { id: '1321336304990162984', name: 'karuta-commands-2', to: '🎮 GAMING' },
        { id: '865403760993108008', name: 'mudae', to: '🎮 GAMING' },
        // Voice channels
        { id: '966437840244338728', name: 'game-chat (voice)', to: '🎮 GAMING' },
        { id: '1115512054699270214', name: 'minecraft (voice)', to: '🎮 GAMING' },
        { id: '1005243495675613234', name: 'AFK (voice)', to: '🎮 GAMING' },

        // COMMUNITY
        { id: '862139045974638615', name: 'general', to: '💬 COMMUNITY' },
        { id: '864568030864736297', name: 'introductions', to: '💬 COMMUNITY' },
        { id: '898715514086498324', name: 'welcome', to: '💬 COMMUNITY' },
        { id: '862825014515335210', name: 'and-in-the-back', to: '💬 COMMUNITY' },

        // AFTER DARK
        { id: '975642671211225109', name: 'nsfw', to: '🔞 AFTER DARK' },
    ];

    for (const move of moves) {
        const channel = guild.channels.cache.get(move.id);
        const targetCat = guild.channels.cache.find(
            (c) => c.type === ChannelType.GuildCategory && c.name === move.to
        );

        if (!channel) {
            console.log(`  ⚠ #${move.name} (${move.id}) not found — skipping.`);
            continue;
        }
        if (!targetCat) {
            console.log(`  ⚠ Category "${move.to}" not found — skipping.`);
            continue;
        }
        if (channel.parentId === targetCat.id) {
            console.log(`  #${move.name} already in "${move.to}" — skipping.`);
            continue;
        }

        if (await confirm(`Move #${channel.name} → "${move.to}"`)) {
            await channel.setParent(targetCat.id, { lockPermissions: false });
            console.log(`  ✓ Moved #${channel.name} to "${move.to}"`);
        }
    }

    console.log('\nPhase 3 complete.');
}

// =========================================================================
// Phase 4: Archive old channels + delete voice channels
// =========================================================================
async function phase4(guild) {
    console.log('\n=== PHASE 4: ARCHIVE OLD CHANNELS ===\n');

    await guild.channels.fetch();

    const archiveCat = guild.channels.cache.find(
        (c) => c.type === ChannelType.GuildCategory && c.name === '📦 ARCHIVE'
    );

    if (!archiveCat) {
        console.log('  ⚠ Archive category not found. Run Phase 2 first.');
        return;
    }

    // Categories to archive entirely (all remaining children)
    const categoriesToArchive = [
        'Real Life District',
        'Entertainment District',
        'OPT-IN',
    ];

    for (const catName of categoriesToArchive) {
        const cat = guild.channels.cache.find(
            (c) => c.type === ChannelType.GuildCategory && c.name === catName
        );
        if (!cat) continue;

        const children = guild.channels.cache.filter((c) => c.parentId === cat.id);
        if (!children.size) {
            console.log(`  "${catName}" is empty — deleting category.`);
            if (await confirm(`Delete empty category "${catName}"`)) {
                await cat.delete();
                console.log(`  ✓ Deleted "${catName}"`);
            }
            continue;
        }

        if (await confirm(`Archive entire "${catName}" category (${children.size} channels) → ARCHIVE`)) {
            for (const [, ch] of children) {
                await ch.setParent(archiveCat.id, { lockPermissions: false });
                console.log(`    ✓ Archived #${ch.name}`);
            }
            await cat.delete();
            console.log(`  ✓ Deleted empty category "${catName}"`);
        }
    }

    // Individual channels to archive
    const channelsToArchive = [
        { id: '1000088731342082158', name: 'devanimecards-io' },
        { id: '1175616538112425994', name: 'secret-santa' },
        { id: '1120543889665826987', name: 'diablo' },
        { id: '862822564937334814', name: 'call-of-duty' },
        { id: '962222616918253600', name: 'genshin-impact' },
        { id: '967812652711702579', name: 'pokemon-unite' },
        { id: '869997749133774878', name: 'pokemon-go' },
        { id: '1202001711565385768', name: 'palworld' },
        { id: '865128396824248330', name: 'hidden-fates' },
        { id: '1304916399218757753', name: 'nikke-goddess-of-victory' },
        { id: '1138514208858841198', name: 'music' },
        { id: '995054060384301256', name: 'world-of-warcraft' },
        { id: '967057771109421116', name: 'how-to-order' },
        { id: '1117947637145030767', name: 'giveaways' },
        { id: '967800706943819806', name: 'restock' },
        { id: '964010489216639067', name: 'order-dropoffs' },
        { id: '967138995748372520', name: 'live-event-queue' },
        { id: '1143593084131741786', name: 'flash-sales' },
        { id: '1106223051642769471', name: 'hololive' },
        { id: '999748276075102268', name: 'chat (Entertainment)' },
    ];

    for (const ch of channelsToArchive) {
        const channel = guild.channels.cache.get(ch.id);
        if (!channel) continue;
        if (channel.parentId === archiveCat.id) {
            console.log(`  #${ch.name} already archived — skipping.`);
            continue;
        }

        if (await confirm(`Archive #${ch.name} → ARCHIVE`)) {
            await channel.setParent(archiveCat.id, { lockPermissions: false });
            console.log(`  ✓ Archived #${ch.name}`);
        }
    }

    // Delete voice channels
    const voiceToDelete = [
        { id: '1315881966033174588', name: 'game-chat2' },
        { id: '1320934476221513851', name: 'Secret Santa' },
    ];

    for (const vc of voiceToDelete) {
        const channel = guild.channels.cache.get(vc.id);
        if (!channel) continue;

        if (await confirm(`DELETE voice channel 🔊 ${vc.name} (permanent)`)) {
            await channel.delete();
            console.log(`  ✓ Deleted 🔊 ${vc.name}`);
        }
    }

    // Clean up now-empty old categories
    await guild.channels.fetch();
    const oldCategories = ['HOME', 'Welcome', 'Rip N Ship', 'BUY-TRADE-SELL', 'Community',
        'Gaming District', 'Anime District'];

    for (const catName of oldCategories) {
        const cat = guild.channels.cache.find(
            (c) => c.type === ChannelType.GuildCategory && c.name === catName
        );
        if (!cat) continue;
        const remaining = guild.channels.cache.filter((c) => c.parentId === cat.id);
        if (remaining.size === 0) {
            if (await confirm(`Delete empty category "${catName}"`)) {
                await cat.delete();
                console.log(`  ✓ Deleted "${catName}"`);
            }
        } else {
            console.log(`  "${catName}" still has ${remaining.size} channel(s):`);
            remaining.forEach((c) => console.log(`    - #${c.name}`));
        }
    }

    console.log('\nPhase 4 complete.');
}

// =========================================================================
// Phase 5: Create Aeon roles
// =========================================================================
async function phase5(guild) {
    console.log('\n=== PHASE 5: CREATE AEON ROLES ===\n');

    // Rename DevSquad → Xipe (preserves 635 member assignments)
    const devSquad = guild.roles.cache.find((r) => r.name === 'DevSquad');
    if (devSquad) {
        if (await confirm('Rename "DevSquad" → "Xipe" [#2ECC71] (635 members keep the role)')) {
            await devSquad.edit({
                name: 'Xipe',
                color: '#2ECC71',
                mentionable: true,
            });
            console.log('  ✓ Renamed DevSquad → Xipe (635 members preserved)');
        }
    }

    const aeonRoles = [
        { name: 'Akivili', color: '#FFD700', hoist: true },
        { name: 'Nanook', color: '#E74C3C', hoist: true },
        { name: 'Nous', color: '#3498DB', hoist: true },
        { name: 'Aha', color: '#E91E8C', hoist: false },
        { name: 'Lan', color: '#95A5A6', hoist: false },
        { name: 'Yaoshi', color: '#9B59B6', hoist: false },
        { name: 'IX', color: '#546E7A', hoist: false },
        { name: 'Ena', color: '#C0392B', hoist: false },
    ];

    for (const role of aeonRoles) {
        const existing = guild.roles.cache.find((r) => r.name === role.name);
        if (existing) {
            console.log(`  Role "${role.name}" already exists — skipping.`);
            continue;
        }

        if (await confirm(`Create role "${role.name}" [${role.color}]${role.hoist ? ' (hoisted)' : ''}`)) {
            await guild.roles.create({
                name: role.name,
                color: role.color,
                hoist: role.hoist,
                mentionable: true,
            });
            console.log(`  ✓ Created role "${role.name}"`);
        }
    }

    console.log('\nPhase 5 complete.');
}

// =========================================================================
// Phase 5b: Clean up old roles + assign Nanook to mods
// =========================================================================
async function phase5b(guild) {
    console.log('\n=== PHASE 5B: ROLE CLEANUP & NANOOK ASSIGNMENT ===\n');

    await guild.members.fetch();

    // Assign Nanook to current Moderator role members
    const moderatorRole = guild.roles.cache.find((r) => r.name === 'Moderator');
    const nanookRole = guild.roles.cache.find((r) => r.name === 'Nanook');

    if (moderatorRole && nanookRole) {
        const mods = moderatorRole.members;
        if (mods.size > 0) {
            if (await confirm(`Assign Nanook to ${mods.size} current Moderator(s)`)) {
                for (const [, member] of mods) {
                    await member.roles.add(nanookRole);
                    console.log(`  ✓ Assigned Nanook to ${member.user.tag}`);
                }
            }
        } else {
            console.log('  No members with Moderator role found.');
        }
    }

    // Roles to remove
    const rolesToRemove = [
        'Officer',
        'Moderator',
        'ADMIN',
        'Access: Entertainment District',
        'Access: Gaming District',
        'Access: Anime District',
    ];

    for (const roleName of rolesToRemove) {
        const role = guild.roles.cache.find((r) => r.name === roleName);
        if (!role) {
            console.log(`  Role "${roleName}" not found — skipping.`);
            continue;
        }

        const memberCount = role.members.size;
        if (await confirm(`Delete role "${roleName}" (${memberCount} members will lose it)`)) {
            await role.delete();
            console.log(`  ✓ Deleted role "${roleName}"`);
        }
    }

    console.log('\nPhase 5b complete.');
}

// =========================================================================
// Phase 6: Send mod-chat message
// =========================================================================
async function phase6(guild) {
    console.log('\n=== PHASE 6: MOD-CHAT MESSAGE ===\n');

    const modChat = guild.channels.cache.get('863469658178060328');
    if (!modChat) {
        console.log('  ⚠ #mod-chat not found.');
        return;
    }

    const message = `Hey team — the server just got a facelift. Here's the rundown:

**CHANNEL BREAKDOWN:**

📢 **INFO**
> #announcements — going live, new drops, flash sales (read-only)
> #rules — server rules, role info
> #roles — self-assign roles via reaction
> #mod-log — audit log
> #mod-chat — mod discussion
> #carlbot — bot config

🛒 **SHOP**
> #deals — flash sales, discord-exclusive deals
> #order-feed — automated order notifications (bot)
> #pack-battles — pack battle matchmaking
> #card-night-queue — queue archives from each card night

🃏 **CARDS**
> #pokemon — Pokemon discussion and deals
> #anime — Anime cards, Weiss Schwarz (renamed from #all-things-anime, history preserved)
> #buy-trade-sell — Community marketplace

🎮 **GAMING**
> #general-gaming — All game talk (renamed from #game-chat, history preserved)
> #minecraft — Server IP, coords, builds
> #fortnite, #azur-lane, #star-rail, #zenless-zone-zero — Game channels
> #looking-for-group — Find people to play with
> #mudae, #pokemon-slots, #karuta-drops-grabs, #karuta-commands, #karuta-commands-2 — Bot games

💬 **COMMUNITY**
> #general — Main chat
> #welcome — Welcome channel
> #introductions — New members
> #and-in-the-back — You know what this is
> #life — General life chat (new, replaces the old Real Life District channels)
> #memes — Fun stuff
> #murphy-tax — Dog (and pet) photos

🔞 **AFTER DARK** (age-verified only)
> #nsfw — Mature discussion (same channel, moved here)
> #mature-drops — Goddess Story, mature product drops

📦 **ARCHIVE** (opt-in via IX role)
> All old Real Life District channels, old bot channels, inactive game channels — nothing deleted, just tucked away.

---

**ROLE SYSTEM (Aeon-themed, Honkai Star Rail):**

> **Akivili** (gold) — Server owner
> **Nanook** (red) — That's you. Moderators. The fearless.
> **Nous** (blue) — Active buyers (5+ purchases)
> **Aha** (pink) — Event winners (duck races, pack battles)
> **Xipe** (green) — Verified community members
> **Lan** (grey) — New members (default)
> **Yaoshi** (purple) — Twitch subscribers
> **IX** (dark grey) — Archive access (opt-in)
> **Ena** (dark red) — 18+ verified (After Dark access)

You all have Nanook already. If you want IX (archive access), let me know and I'll add it.

**Heads up:** The old NSFW access role was replaced by the Ena role. Members who had access before will need to grab the Ena role in #roles to regain access to After Dark channels. This applies to the community too — when we set up the reaction roles, we'll want to mention this.

Thanks for holding this community down. We're coming back. More details soon. ❤️`;

    console.log('  Message preview:\n');
    console.log(message.split('\n').map((l) => `  | ${l}`).join('\n'));

    // Split into two messages at the --- divider
    const parts = message.split('\n---\n');

    if (await confirm('Send this message to #mod-chat (2 parts)')) {
        await modChat.send(parts[0].trim());
        console.log('  ✓ Part 1 sent (channel breakdown)');
        await modChat.send('---\n' + parts[1].trim());
        console.log('  ✓ Part 2 sent (role system)');
    }

    console.log('\nPhase 6 complete.');
}

// =========================================================================
// Main
// =========================================================================
async function main() {
    const phase = parseInt(process.argv[2], 10);

    client.once('ready', async () => {
        const guild = await client.guilds.fetch(GUILD_ID);

        if (!phase) {
            console.log('\nDiscord Migration Tool');
            console.log('=====================\n');
            console.log(`Server: ${guild.name} (${guild.memberCount} members)\n`);
            console.log('Available phases:');
            console.log('  1 — Rebrand (rename server, update description)');
            console.log('  2 — Create new categories and channels');
            console.log('  3 — Move/rename existing channels to new categories');
            console.log('  4 — Archive old channels + delete voice channels');
            console.log('  5 — Create Aeon roles');
            console.log('  6 — Send mod-chat message');
            console.log('\nUsage: node scripts/shop/discord-migrate.js [phase]\n');
            if (rl) rl.close();
            client.destroy();
            return;
        }

        try {
            switch (phase) {
                case 1: await phase1(guild); break;
                case 2: await phase2(guild); break;
                case 3: await phase3(guild); break;
                case 4: await phase4(guild); break;
                case 5: await phase5(guild); break;
                case 55: await phase5b(guild); break;
                case 6: await phase6(guild); break;
                default: console.log(`Unknown phase: ${phase}`);
            }
        } catch (e) {
            console.error('\nError:', e.message);
        }

        if (rl) rl.close();
        client.destroy();
    });

    client.login(TOKEN);
}

main();
