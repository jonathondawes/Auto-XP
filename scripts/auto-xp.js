const MODULE_ID = 'auto-xp';

// --- Deduplication guard ---
// A module-level Set is used instead of a plain property on the combat object.
// Plain properties are lost if the combat object is re-fetched from the server;
// a module-level Set persists for the lifetime of the session.
const _processingCombats = new Set();
let _awardQueue = Promise.resolve();

// --- D&D 5e XP Thresholds ---
// Index = current character level. Value = total XP required to reach the next level.
const DND5E_LEVEL_THRESHOLDS = [
    0,       // index 0: unused
    300,     // level 1  → 2
    900,     // level 2  → 3
    2700,    // level 3  → 4
    6500,    // level 4  → 5
    14000,   // level 5  → 6
    23000,   // level 6  → 7
    34000,   // level 7  → 8
    48000,   // level 8  → 9
    64000,   // level 9  → 10
    85000,   // level 10 → 11
    100000,  // level 11 → 12
    120000,  // level 12 → 13
    140000,  // level 13 → 14
    165000,  // level 14 → 15
    195000,  // level 15 → 16
    225000,  // level 16 → 17
    265000,  // level 17 → 18
    305000,  // level 18 → 19
    355000,  // level 19 → 20
];

// --- D&D 5e Encounter Difficulty Multiplier Table ---
// Source: D&D 5e Dungeon Master's Guide, "Encounter Multipliers" table.
const DND5E_ENCOUNTER_MULTIPLIERS = [
    { max: 1,        multiplier: 1   },
    { max: 2,        multiplier: 1.5 },
    { max: 6,        multiplier: 2   },
    { max: 10,       multiplier: 2.5 },
    { max: 14,       multiplier: 3   },
    { max: Infinity, multiplier: 4   },
];

// --- System Handlers ---

class SystemHandler {
    get isValid() { return false; }

    getCreatureData(combatant) {
        throw new Error('Not implemented');
    }

    /**
     * Calculates the XP to be awarded to EACH character.
     * @param {Combat} combat - The current combat encounter
     * @param {Array} players - List of player actors
     * @param {Array} defeatedCreatures - List of defeated enemies
     * @returns {Object} { xpPerCharacter: number }
     */
    calculateXP(combat, players, defeatedCreatures) {
        throw new Error('Not implemented');
    }

    /**
     * Updates a single actor's XP total.
     * @param {Actor} actor
     * @param {number} amount
     * @returns {Promise<{currentXP: number, newXP: number, leveledUp: boolean}>}
     */
    async updatePlayerXP(actor, amount, receipt = null) {
        throw new Error('Not implemented');
    }
}

class PF2eHandler extends SystemHandler {
    get isValid() { return game.system.id === 'pf2e'; }

    getCreatureData(combatant) {
        // PF2e uses combat.metrics for calculation, but we still track defeated for logging/bank
        return {
            id: combatant.id,
            name: combatant.name,
            level: Number(combatant.actor.system.details.level?.value ?? 0),
            type: combatant.actor.type
        };
    }

    calculateXP(combat, players, defeatedCreatures) {
        // PF2e automatically calculates the XP award for the encounter.
        // We defer to the system's calculation to ensure it matches the UI.
        const systemXP = combat.metrics?.award?.xp;

        if (systemXP !== undefined) {
            return { xpPerCharacter: systemXP };
        }

        // Surface the fallback as an in-game warning, not just a console message
        const msg = 'Auto XP | Could not retrieve XP from combat.metrics — XP was not awarded. Please award manually.';
        console.warn(msg);
        ui.notifications.warn(msg);
        return { xpPerCharacter: 0 };
    }

    async updatePlayerXP(actor, amount, receipt = null) {
        const currentXP = actor.system.details.xp?.value || 0;
        const newXP = currentXP + amount;
        if (!Number.isSafeInteger(newXP) || newXP < 0) throw new Error('XP total must be a non-negative safe integer.');
        const update = { 'system.details.xp.value': newXP };
        if (receipt) update[`flags.${MODULE_ID}.transactions.${receipt.id}`] = receipt.value;
        await actor.update(update);
        // PF2e handles level advancement automatically; no detection needed here.
        return { currentXP, newXP, leveledUp: false };
    }
}

class DnD5eHandler extends SystemHandler {
    get isValid() { return game.system.id === 'dnd5e'; }

    getCreatureData(combatant) {
        return {
            id: combatant.id,
            name: combatant.name,
            xp: Number(combatant.actor.system.details.xp?.value ?? 0),
            type: combatant.actor.type
        };
    }

    calculateXP(combat, players, defeatedCreatures) {
        if (!players.length) return { xpPerCharacter: 0 };

        const totalMonsterXP = defeatedCreatures.reduce((total, creature) => {
            return total + (creature.xp || 0);
        }, 0);

        // Apply the official 5e encounter difficulty multiplier (DMG p.82) if enabled
        const applyMultiplier = game.settings.get(MODULE_ID, 'dnd5e-encounter-multiplier');
        let adjustedXP = totalMonsterXP;

        if (applyMultiplier && defeatedCreatures.length > 0) {
            const monsterCount = defeatedCreatures.length;
            const entry = DND5E_ENCOUNTER_MULTIPLIERS.find(e => monsterCount <= e.max);
            const multiplier = entry ? entry.multiplier : 4;
            adjustedXP = Math.floor(totalMonsterXP * multiplier);
            console.log(`Auto XP Calculator | 5e encounter multiplier: ×${multiplier} (${monsterCount} monsters)`);
        }

        // Standard 5e: adjusted XP divided evenly among party members
        const xpPerCharacter = Math.floor(adjustedXP / players.length);
        return { xpPerCharacter };
    }

    async updatePlayerXP(actor, amount, receipt = null) {
        const currentXP = actor.system.details.xp?.value || 0;
        const newXP = currentXP + amount;
        if (!Number.isSafeInteger(newXP) || newXP < 0) throw new Error('XP total must be a non-negative safe integer.');
        const update = { 'system.details.xp.value': newXP };
        if (receipt) update[`flags.${MODULE_ID}.transactions.${receipt.id}`] = receipt.value;
        await actor.update(update);

        // Level-up detection: check if newXP crosses the threshold for the next level
        let leveledUp = false;
        const currentLevel = Number(actor.system.details.level ?? 1);
        if (currentLevel < 20) {
            const threshold = DND5E_LEVEL_THRESHOLDS[currentLevel];
            if (amount > 0 && threshold !== undefined && currentXP < threshold && newXP >= threshold) {
                leveledUp = true;
            }
        }

        return { currentXP, newXP, leveledUp };
    }
}

// --- Handler Registry ---

const _customHandlers = [];

/**
 * Global API exposed for third-party modules to register custom system handlers.
 * Handlers must extend SystemHandler and implement isValid, getCreatureData,
 * calculateXP, and updatePlayerXP. Custom handlers take priority over built-ins.
 *
 * @example
 * // In your module's 'init' hook:
 * AutoXP.registerHandler(new MySystemHandler());
 */
globalThis.AutoXP = {
    SystemHandler,
    registerHandler(handler) {
        if (!(handler instanceof SystemHandler)) {
            console.warn('Auto XP | registerHandler: handler must extend SystemHandler. Handler was not registered.');
            return;
        }
        // Custom handlers are prepended so they take priority over built-in handlers
        _customHandlers.unshift(handler);
        console.log(`Auto XP | Registered custom system handler: ${handler.constructor.name}`);
    }
};

// --- Settings ---

Hooks.once('init', () => {
    game.settings.register(MODULE_ID, 'enabled', {
        name: 'Enable Auto XP',
        hint: 'Automatically calculate and award XP to player characters at the end of combat encounters.',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true,
    });

    game.settings.register(MODULE_ID, 'award-mode', {
        name: 'XP Award Mode',
        hint: 'Automatic awards XP immediately. Review lets the active GM edit or discard the award first.',
        scope: 'world',
        config: true,
        type: String,
        choices: { automatic: 'Automatic', review: 'GM Review' },
        default: 'automatic',
    });

    game.settings.register(MODULE_ID, 'xp-multiplier', {
        name: 'XP Multiplier',
        hint: 'Multiply all XP awards by this value. Use values below 1.0 for slower progression, or above 1.0 for faster. (Default: 1.0)',
        scope: 'world',
        config: true,
        type: Number,
        default: 1.0,
    });

    game.settings.register(MODULE_ID, 'notify-players', {
        name: 'Notify Players',
        hint: 'Post the XP award to the public chat log so all players can see it. When disabled, the award card is whispered to the GM only.',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true,
    });

    game.settings.register(MODULE_ID, 'dnd5e-encounter-multiplier', {
        name: 'D&D 5e: Apply Encounter Multiplier',
        hint: 'Apply the official D&D 5e encounter difficulty multiplier (DMG p.82) based on the number of monsters defeated.',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true,
    });
});

// --- Main Module Logic ---

let systemHandler = null;

Hooks.once('ready', () => {
    // Custom handlers (registered via AutoXP.registerHandler) take priority over built-ins
    const allHandlers = [..._customHandlers, new PF2eHandler(), new DnD5eHandler()];
    systemHandler = allHandlers.find(h => h.isValid) ?? null;

    if (systemHandler) {
        console.log(`Auto XP Calculator | Ready (${game.system.id}) using ${systemHandler.constructor.name}`);
    } else {
        console.warn('Auto XP Calculator | Unsupported game system. XP will not be awarded automatically.');
    }

    // Socket listener for player-side level-up popup notifications
    game.socket.on(`module.${MODULE_ID}`, (data) => {
        // Validate payload structure before use
        if (!data || typeof data !== 'object') return;

        if (data.type === 'level-up') {
            if (!Array.isArray(data.actorIds)) return;
            if (game.user.isGM) return; // GM sees the level-up badge on the chat card

            const myActors = data.actorIds
                .map(id => game.actors.get(id))
                .filter(actor => actor && actor.isOwner);

            if (myActors.length > 0) {
                const names = myActors.map(a => a.name).join(', ');
                ui.notifications.info(`🎉 Auto XP: ${names} has enough XP to level up!`);
            }
        }
    });
});

Hooks.on('updateCombat', async (combat, update) => {
    if (!isAwardAuthority()) return;
    if (!systemHandler) return;
    if (!game.settings.get(MODULE_ID, 'enabled')) return;
    if (!combatEnded(update)) return;
    await processCombatXP(combat);
});

Hooks.on('deleteCombat', async (combat) => {
    if (!isAwardAuthority()) return;
    if (!systemHandler) return;
    if (!game.settings.get(MODULE_ID, 'enabled')) return;
    // The module-level Set in processCombatXP ensures that if updateCombat already
    // handled this combat (active → false), deleteCombat will bail out immediately.
    await processCombatXP(combat);
});

Hooks.on('deleteCombatant', async (combatant, context, userId) => {
    if (!isAwardAuthority()) return;
    if (!systemHandler) return;

    const combat = combatant.combat;
    if (!combat) return;

    // Only bank valid enemy types
    const validTypes = ['npc', 'hazard'];
    if (!validTypes.includes(combatant.actor?.type)) return;

    // Check if it was defeated or dead
    const isDefeated = combatant.defeated;
    const hp = combatant.actor?.system?.attributes?.hp?.value;
    const isDead = hp !== undefined && hp <= 0;

    if (isDefeated || isDead) {
        const bankedCreature = systemHandler.getCreatureData(combatant);

        const existingBank = combat.getFlag(MODULE_ID, 'banked-xp') || [];
        existingBank.push(bankedCreature);

        await combat.setFlag(MODULE_ID, 'banked-xp', existingBank);
        console.log(`Auto XP Calculator | Banked XP for deleted combatant: ${combatant.name}`);
    }
});

function combatEnded(update) {
    if (!update) return false;
    const becameInactive = Object.prototype.hasOwnProperty.call(update, 'active') && update.active === false;
    const resetRound = Object.prototype.hasOwnProperty.call(update, 'round') && update.round === 0;
    const resetTurn = Object.prototype.hasOwnProperty.call(update, 'turn') && update.turn === 0;
    // Exclude the case where combat is just becoming active (i.e. starting), which also
    // resets round and turn to 0 and would otherwise trigger a false-positive.
    const becomingActive = Object.prototype.hasOwnProperty.call(update, 'active') && update.active === true;
    return becameInactive || (!becomingActive && resetRound && resetTurn);
}

// One active GM handles combat hooks and card actions. This avoids independent
// browser-local locks awarding the same encounter on multiple GM clients.
function isAwardAuthority() {
    const gm = game.users.activeGM ?? game.users.filter(u => u.active && u.isGM)
        .sort((a, b) => a.id.localeCompare(b.id))[0];
    return game.user.isGM && gm?.id === game.user.id;
}

function queueAwardAction(action) {
    const result = _awardQueue.then(action);
    _awardQueue = result.catch(() => {});
    return result;
}

function findCombatAward(combatId) {
    return game.messages.find(message => message.getFlag(MODULE_ID, 'award')?.combatId === combatId);
}

async function processCombatXP(combat) {
    if (!isAwardAuthority() || _processingCombats.has(combat.id)) return;
    _processingCombats.add(combat.id);
    try {
        await queueAwardAction(async () => {
            // The message is a durable encounter record, including after deletion.
            if (combat.getFlag(MODULE_ID, 'xpAwarded') || findCombatAward(combat.id)) return;
            const { xpPerCharacter: rawXP, players } = calculateEncounterXP(combat);
            const multiplier = Number(game.settings.get(MODULE_ID, 'xp-multiplier') ?? 1);
            const amount = Math.floor(rawXP * multiplier);
            if (!Number.isFinite(rawXP) || !Number.isFinite(multiplier) || multiplier < 0 ||
                !Number.isSafeInteger(amount) || amount < 0) {
                throw new Error('Calculated XP and multiplier must be valid non-negative numbers.');
            }
            if (!players.length || amount === 0) return;
            const award = {
                combatId: combat.id,
                systemId: game.system.id,
                status: 'pending',
                amount,
                notifyPlayers: game.settings.get(MODULE_ID, 'notify-players'),
                entries: players.map(player => ({
                    uuid: player.actor.uuid,
                    name: player.name,
                    img: player.actor.prototypeToken?.texture?.src ?? player.actor.img ?? 'icons/svg/mystery-man.svg',
                    amount: 0,
                    state: 'pending',
                    leveledUp: false,
                })),
            };
            // Save the ledger BEFORE changing any actor. Pending cards are GM-only.
            const message = await ChatMessage.create({
                content: renderAwardCard(award),
                speaker: { alias: 'Auto XP' },
                whisper: game.users.filter(u => u.isGM).map(u => u.id),
                flags: { [MODULE_ID]: { award } },
            });
            await markCombatProcessed(combat);
            if (game.settings.get(MODULE_ID, 'award-mode') !== 'review') {
                await performAwardAction(message, 'award', amount);
            }
        });
    } catch (error) {
        console.error('Auto XP | Could not process encounter', error);
        ui.notifications.error(`Auto XP: ${error.message}`);
    } finally {
        _processingCombats.delete(combat.id);
    }
}

function calculateEncounterXP(combat) {
    const combatants = Array.from(combat.combatants ?? []);
    const players = getUniquePlayerActors(combatants);

    // Filter for defeated/dead NPCs and hazards still on the tracker
    const defeatedCreatures = combatants
        .filter(c => {
            const validTypes = ['npc', 'hazard'];
            if (!validTypes.includes(c.actor?.type)) return false;
            const isDefeated = c.defeated;
            const hp = c.actor?.system?.attributes?.hp?.value;
            const isDead = hp !== undefined && hp <= 0;
            return isDefeated || isDead;
        })
        .map(c => systemHandler.getCreatureData(c));

    // Merge in banked creatures (those deleted from the tracker before combat ended).
    // Deduplicate by ID to prevent double-counting creatures that were both banked and
    // are still present on the tracker (e.g. when Foundry bulk-deletes combatants on
    // combat end, firing deleteCombatant before processCombatXP has run).
    const bankedCreatures = combat.getFlag(MODULE_ID, 'banked-xp') || [];
    const seenIds = new Set(defeatedCreatures.map(c => c.id));
    const allDefeatedCreatures = [
        ...defeatedCreatures,
        ...bankedCreatures.filter(c => !seenIds.has(c.id)),
    ];

    return {
        ...systemHandler.calculateXP(combat, players, allDefeatedCreatures),
        players,
        defeatedCreatures: allDefeatedCreatures,
    };
}

function getUniquePlayerActors(combatants) {
    const seenActors = new Set();
    const players = [];
    for (const combatant of combatants) {
        const actor = combatant.actor;
        // Only include characters with a player owner; excludes NPC allies
        if (!actor || actor.type !== 'character' || !actor.hasPlayerOwner) continue;
        if (seenActors.has(actor.id)) continue;
        seenActors.add(actor.id);

        players.push({
            actor,
            name: actor.name ?? combatant.name,
            // PF2e stores level as { value: number }; D&D 5e stores it as a plain number.
            level: Number(actor.system.details.level?.value ?? actor.system.details.level ?? 1),
        });
    }
    return players;
}

// All interpolated character data is escaped before entering chat HTML.
function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
}

function renderAwardCard(award) {
    const titles = { pending: 'Review XP', applying: 'XP award needs attention', awarded: 'XP Awarded',
        discarded: 'XP Discarded', undoing: 'Undo needs attention', undone: 'XP Undone' };
    const rows = award.entries.map(entry => `
        <div class="auto-xp-char-row">
            <img class="auto-xp-token" src="${escapeHTML(entry.img)}" alt="" />
            <span class="auto-xp-name">${escapeHTML(entry.name)}</span>
            <span class="auto-xp-amount">${entry.state === 'applied' ? '+' + entry.amount + ' XP' : escapeHTML(entry.state)}</span>
            ${entry.leveledUp && entry.state === 'applied' ? '<span class="auto-xp-levelup-badge">🎉 Level Up!</span>' : ''}
            ${entry.error ? `<span class="auto-xp-error">${escapeHTML(entry.error)}</span>` : ''}
        </div>`).join('');
    let controls = '';
    if (award.status === 'pending') {
        controls = `<label>XP per character <input class="auto-xp-review-amount" type="number" min="0" step="1" value="${award.amount}" /></label>
            <button type="button" data-auto-xp-action="award">Award XP</button>
            <button type="button" data-auto-xp-action="discard">Discard</button>`;
    } else if (award.status === 'applying') {
        controls = '<button type="button" data-auto-xp-action="award">Retry remaining awards</button>';
    }
    if (['awarded', 'applying', 'undoing'].includes(award.status)) {
        controls += `<button type="button" data-auto-xp-action="undo">${award.status === 'undoing' ? 'Retry undo' : 'Undo award'}</button>`;
    }
    return `<div class="auto-xp-award-card">
        <div class="auto-xp-header"><span class="auto-xp-title">${titles[award.status]}</span>
        <span class="auto-xp-total">${award.amount} XP each</span></div>
        <div class="auto-xp-chars">${rows}</div>
        <div class="auto-xp-gm-controls" hidden>${controls}<small>Controls are available to the active GM.</small></div>
        </div>`;
}

async function saveAward(message, award) {
    const showPlayers = award.notifyPlayers && award.status !== 'pending' && award.status !== 'discarded';
    await message.update({
        [`flags.${MODULE_ID}.award`]: award,
        content: renderAwardCard(award),
        whisper: showPlayers ? [] : game.users.filter(u => u.isGM).map(u => u.id),
    });
}

async function performAwardAction(message, action, requestedAmount) {
    // Check here as well as in the render hook: hidden buttons are not authorization.
    if (!isAwardAuthority() || !systemHandler) return;
    const stored = message.getFlag(MODULE_ID, 'award');
    if (!stored || stored.systemId !== game.system.id) return;
    const award = JSON.parse(JSON.stringify(stored));
    if (action === 'discard') {
        if (award.status !== 'pending') return;
        award.status = 'discarded';
        await saveAward(message, award);
        return;
    }
    const undo = action === 'undo';
    if (undo) {
        if (!['awarded', 'applying', 'undoing'].includes(award.status)) return;
        award.status = 'undoing';
    } else {
        if (action !== 'award' || !['pending', 'applying'].includes(award.status)) return;
        if (award.status === 'pending') {
            if (String(requestedAmount).trim() === '') throw new Error('Enter an XP amount.');
            const amount = Number(requestedAmount);
            if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('XP must be a non-negative whole number.');
            award.amount = amount;
        }
        award.status = 'applying';
    }
    // Persist intent before the first actor update, so refreshes can be recovered.
    await saveAward(message, award);
    const leveledUpActorIds = [];
    for (const entry of award.entries) {
        delete entry.error;
        try {
            const actor = await fromUuid(entry.uuid);
            if (!actor) throw new Error('Character no longer exists. Restore it to retry.');
            const receipt = actor.getFlag(MODULE_ID, 'transactions')?.[message.id];
            if (undo) {
                if (receipt?.state === 'applied') {
                    await systemHandler.updatePlayerXP(actor, -receipt.amount, {
                        id: message.id, value: { state: 'undone', amount: receipt.amount },
                    });
                } else if (!receipt && entry.state === 'applied') {
                    throw new Error('Award receipt missing; check this character manually.');
                }
                entry.state = 'undone';
                entry.leveledUp = false;
            } else {
                if (receipt?.state === 'undone') throw new Error('This award has already been undone.');
                if (receipt?.state !== 'applied') {
                    const result = await systemHandler.updatePlayerXP(actor, award.amount, {
                        id: message.id, value: { state: 'applied', amount: award.amount },
                    });
                    entry.leveledUp = result.leveledUp;
                    if (result.leveledUp) leveledUpActorIds.push(actor.id);
                }
                entry.amount = receipt?.amount ?? award.amount;
                entry.state = 'applied';
            }
        } catch (error) {
            entry.error = error.message;
            console.error(`Auto XP | ${entry.name}`, error);
        }
        // Actor XP and its receipt are written atomically by built-in handlers.
        // If this message save fails, retry reads the receipt and skips that actor.
        await saveAward(message, award);
    }
    if (!award.entries.some(entry => entry.error)) award.status = undo ? 'undone' : 'awarded';
    await saveAward(message, award);
    if (award.entries.some(entry => entry.error)) {
        ui.notifications.warn('Auto XP: Some characters could not be updated. See the award card to retry.');
    }
    if (!undo && award.notifyPlayers && leveledUpActorIds.length) {
        game.socket.emit(`module.${MODULE_ID}`, { type: 'level-up', actorIds: leveledUpActorIds });
    }
}

function activateAwardControls(message, html) {
    if (!game.user.isGM || !message.getFlag(MODULE_ID, 'award')) return;
    // v10–12 renderChatMessage supplies jQuery; newer versions supply HTMLElement.
    const root = html instanceof HTMLElement ? html : html?.[0];
    const controls = root?.querySelector('.auto-xp-gm-controls');
    if (!controls || controls.dataset.bound) return;
    controls.dataset.bound = 'true';
    controls.hidden = false;
    const authority = isAwardAuthority();
    controls.querySelectorAll('button, input').forEach(element => { element.disabled = !authority; });
    controls.addEventListener('click', event => {
        const button = event.target.closest('[data-auto-xp-action]');
        if (!button || button.disabled || !isAwardAuthority()) return;
        const amount = controls.querySelector('.auto-xp-review-amount')?.value;
        controls.querySelectorAll('button, input').forEach(element => { element.disabled = true; });
        queueAwardAction(() => performAwardAction(message, button.dataset.autoXpAction, amount))
            .catch(error => {
                console.error('Auto XP | Award action failed', error);
                ui.notifications.error(`Auto XP: ${error.message}`);
            }).finally(() => {
                controls.querySelectorAll('button, input').forEach(element => { element.disabled = !isAwardAuthority(); });
            });
    });
}

Hooks.on('renderChatMessage', activateAwardControls);
Hooks.on('renderChatMessageHTML', activateAwardControls);

async function markCombatProcessed(combat) {
    try {
        await combat.setFlag(MODULE_ID, 'xpAwarded', true);
    } catch (error) {
        // The durable message ledger remains usable after the combat is deleted.
        console.warn('Auto XP | Combat deleted; award is tracked on its chat message.', error);
    }
}
