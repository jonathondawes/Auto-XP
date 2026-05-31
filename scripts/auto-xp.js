const MODULE_ID = 'auto-xp';

// --- Deduplication guard ---
// A module-level Set is used instead of a plain property on the combat object.
// Plain properties are lost if the combat object is re-fetched from the server;
// a module-level Set persists for the lifetime of the session.
const _processingCombats = new Set();

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
    async updatePlayerXP(actor, amount) {
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

    async updatePlayerXP(actor, amount) {
        const currentXP = actor.system.details.xp?.value || 0;
        const newXP = currentXP + amount;
        await actor.update({ 'system.details.xp.value': newXP });
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

    async updatePlayerXP(actor, amount) {
        const currentXP = actor.system.details.xp?.value || 0;
        const newXP = currentXP + amount;
        await actor.update({ 'system.details.xp.value': newXP });

        // Level-up detection: check if newXP crosses the threshold for the next level
        let leveledUp = false;
        const currentLevel = Number(actor.system.details.level ?? 1);
        if (currentLevel < 20) {
            const threshold = DND5E_LEVEL_THRESHOLDS[currentLevel];
            if (threshold !== undefined && newXP >= threshold) {
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
        hint: 'Send an in-game notification to each player when XP is awarded to their characters.',
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

});

Hooks.on('updateCombat', async (combat, update) => {
    if (!game.user.isGM) return;
    if (!systemHandler) return;
    if (!game.settings.get(MODULE_ID, 'enabled')) return;
    if (!combatEnded(update)) return;
    await processCombatXP(combat);
});

Hooks.on('deleteCombat', async (combat) => {
    if (!game.user.isGM) return;
    if (!systemHandler) return;
    if (!game.settings.get(MODULE_ID, 'enabled')) return;
    // The module-level Set in processCombatXP ensures that if updateCombat already
    // handled this combat (active → false), deleteCombat will bail out immediately.
    await processCombatXP(combat);
});

Hooks.on('deleteCombatant', async (combatant, context, userId) => {
    if (!game.user.isGM) return;
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
    return becameInactive || (resetRound && resetTurn);
}

async function processCombatXP(combat) {
    // Guard against concurrent invocations for the same combat (e.g. updateCombat + deleteCombat firing together)
    if (_processingCombats.has(combat.id)) return;
    _processingCombats.add(combat.id);

    try {
        if (combat.getFlag(MODULE_ID, 'xpAwarded')) {
            console.log('Auto XP Calculator | XP already awarded for this combat, skipping.');
            return;
        }

        const { xpPerCharacter: rawXP, players, defeatedCreatures } = calculateEncounterXP(combat);

        if (!players.length) {
            console.warn('Auto XP Calculator | No player characters found to award XP.');
            await markCombatProcessed(combat);
            return;
        }

        // Apply the global XP multiplier setting
        const multiplier = game.settings.get(MODULE_ID, 'xp-multiplier') ?? 1;
        const xpPerCharacter = Math.floor(rawXP * multiplier);

        if (xpPerCharacter === 0) {
            console.log('Auto XP Calculator | No XP to award (calculated 0).');
            await markCombatProcessed(combat);
            return;
        }

        console.log('Auto XP Calculator | Awarding XP:', { xpPerCharacter, players: players.length });

        const leveledUpActorIds = [];

        for (const player of players) {
            try {
                const { currentXP, newXP, leveledUp } = await systemHandler.updatePlayerXP(player.actor, xpPerCharacter);
                console.log(`Auto XP Calculator | Updated XP for ${player.name}`, { currentXP, xpPerCharacter, newXP });

                if (leveledUp) {
                    leveledUpActorIds.push(player.actor.id);
                    ui.notifications.info(`🎉 Auto XP: ${player.name} has enough XP to level up!`);
                }
            } catch (error) {
                console.error(`Auto XP Calculator | Failed to update XP for ${player.name}`, error);
            }
        }

        ui.notifications.info(`Auto XP: Awarded ${xpPerCharacter} XP to ${players.length} character(s).`);

        // Whisper notifications to each player (if enabled)
        if (game.settings.get(MODULE_ID, 'notify-players')) {
            await notifyPlayersViaWhisper(players, xpPerCharacter, leveledUpActorIds);
        }

        await markCombatProcessed(combat);
    } catch (error) {
        console.error('Auto XP Calculator | Failed to process combat XP', error);
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

    // Merge in banked creatures (those deleted from the tracker before combat ended)
    const bankedCreatures = combat.getFlag(MODULE_ID, 'banked-xp') || [];
    const allDefeatedCreatures = [...defeatedCreatures, ...bankedCreatures];

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
            level: Number(actor.system.details.level?.value ?? 1),
        });
    }
    return players;
}

async function markCombatProcessed(combat) {
    try {
        await combat.setFlag(MODULE_ID, 'xpAwarded', true);
    } catch (error) {
        // This can legitimately fail when called on a combat being deleted; log only
        console.warn('Auto XP Calculator | Unable to store xpAwarded flag (combat may have been deleted)', error);
    }
}

/**
 * Sends a whispered ChatMessage to each player informing them of their XP award.
 * Chat whispers are server-routed and reliably delivered without needing socket configuration.
 *
 * @param {Array} players - List of { actor, name } player objects
 * @param {number} xpPerCharacter - Amount of XP awarded to each character
 * @param {string[]} leveledUpActorIds - Actor IDs of characters who have enough XP to level up
 */
async function notifyPlayersViaWhisper(players, xpPerCharacter, leveledUpActorIds) {
    // Build a map from actorId -> [userId] for all non-GM users who own the actor
    const actorUserMap = new Map();
    for (const user of game.users) {
        if (user.isGM) continue;
        for (const player of players) {
            if (player.actor.testUserPermission(user, 'OWNER')) {
                if (!actorUserMap.has(player.actor.id)) actorUserMap.set(player.actor.id, []);
                actorUserMap.get(player.actor.id).push(user.id);
            }
        }
    }

    // Group actors by their whisper target set so we can batch messages where possible
    const userActorMap = new Map(); // userId -> [actor]
    for (const player of players) {
        const userIds = actorUserMap.get(player.actor.id) ?? [];
        for (const userId of userIds) {
            if (!userActorMap.has(userId)) userActorMap.set(userId, []);
            userActorMap.get(userId).push(player);
        }
    }

    for (const [userId, userPlayers] of userActorMap) {
        const names = userPlayers.map(p => p.name).join(', ');
        const leveled = userPlayers.filter(p => leveledUpActorIds.includes(p.actor.id));
        let content = `<strong>Auto XP:</strong> ${names} received <strong>${xpPerCharacter} XP</strong>.`;
        if (leveled.length > 0) {
            const leveledNames = leveled.map(p => p.name).join(', ');
            content += `<br>🎉 <strong>${leveledNames}</strong> has enough XP to level up!`;
        }
        await ChatMessage.create({
            content,
            whisper: [userId],
            speaker: { alias: 'Auto XP' },
        });
    }
}