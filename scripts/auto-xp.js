const MODULE_ID = 'auto-xp';

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
        // PF2e System automatically calculates the XP award for the encounter.
        // We defer to the system's calculation to ensure it matches the UI.
        const systemXP = combat.metrics?.award?.xp;

        if (systemXP !== undefined) {
            return { xpPerCharacter: systemXP };
        }

        // Fallback or if metrics are missing (shouldn't happen in updated PF2e systems)
        console.warn('Auto XP | Could not find combat.metrics.award.xp, defaulting to 0');
        return { xpPerCharacter: 0 };
    }

    async updatePlayerXP(actor, amount) {
        const currentXP = actor.system.details.xp?.value || 0;
        const newXP = currentXP + amount;
        await actor.update({ 'system.details.xp.value': newXP });
        return { currentXP, newXP };
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

        // Standard 5e: Total XP divided by number of party members
        const xpPerCharacter = Math.floor(totalMonsterXP / players.length);

        return { xpPerCharacter };
    }

    async updatePlayerXP(actor, amount) {
        const currentXP = actor.system.details.xp?.value || 0;
        const newXP = currentXP + amount;
        await actor.update({ 'system.details.xp.value': newXP });
        return { currentXP, newXP };
    }
}

// --- Main Module Logic ---

let systemHandler = null;

Hooks.once('ready', () => {
    if (game.system.id === 'pf2e') {
        systemHandler = new PF2eHandler();
    } else if (game.system.id === 'dnd5e') {
        systemHandler = new DnD5eHandler();
    }

    if (systemHandler) {
        console.log(`Auto XP Calculator | Ready (${game.system.id})`);
    } else {
        console.warn('Auto XP Calculator | Unsupported system');
    }
});

Hooks.on('updateCombat', async (combat, update) => {
    if (!game.user.isGM) return;
    if (!systemHandler) return;
    if (!combatEnded(update)) return;
    await processCombatXP(combat);
});

Hooks.on('deleteCombat', async (combat) => {
    if (!game.user.isGM) return;
    if (!systemHandler) return;
    await processCombatXP(combat, { skipFlag: true });
});

Hooks.on('deleteCombatant', async (combatant, context, userId) => {
    if (!game.user.isGM) return;
    if (!systemHandler) return;

    const combat = combatant.combat;
    if (!combat) return;

    // Check if it's a valid enemy (NPC/Hazard)
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

async function processCombatXP(combat, { skipFlag = false } = {}) {
    if (combat.xpProcessing) return;
    combat.xpProcessing = true;

    try {
        if (combat.getFlag(MODULE_ID, 'xpAwarded')) {
            console.log('Auto XP Calculator | XP already awarded for this combat');
            return;
        }

        const { xpPerCharacter, players, defeatedCreatures } = calculateEncounterXP(combat);

        if (!players.length) {
            console.warn('Auto XP Calculator | No player characters found to award XP');
            if (!skipFlag) await markCombatProcessed(combat);
            return;
        }

        if (xpPerCharacter === 0) {
            console.log('Auto XP Calculator | No XP to award (calculated 0)');
            if (defeatedCreatures.length > 0) {
                // In PF2e with system metrics, 0 might be valid (trivial encounter), so we log but don't warn loudly
            }
            if (!skipFlag) await markCombatProcessed(combat);
            return;
        }

        console.log('Auto XP Calculator | Awarding XP:', {
            xpPerCharacter,
            playersLength: players.length
        });

        for (const player of players) {
            try {
                const { currentXP, newXP } = await systemHandler.updatePlayerXP(player.actor, xpPerCharacter);
                console.log(`Auto XP Calculator | Updated XP for ${player.name}`, { currentXP, xpPerCharacter, newXP });
            } catch (error) {
                console.error(`Auto XP Calculator | Failed to update XP for ${player.name}`, error);
            }
        }

        ui.notifications.info(`Auto XP: Awarded ${xpPerCharacter} XP to ${players.length} character(s).`);

        if (!skipFlag) {
            await markCombatProcessed(combat);
        }
    } catch (error) {
        console.error('Auto XP Calculator | Failed to process combat XP', error);
    } finally {
        combat.xpProcessing = false;
    }
}

function calculateEncounterXP(combat) {
    const combatants = Array.from(combat.combatants ?? []);
    const players = getUniquePlayerActors(combatants);

    // PF2e & 5e common logic: filter for defeated/dead NPCs/Hazards
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

    // Add banked creatures (deleted during combat)
    const bankedCreatures = combat.getFlag(MODULE_ID, 'banked-xp') || [];
    const allDefeatedCreatures = [...defeatedCreatures, ...bankedCreatures];

    return {
        ...systemHandler.calculateXP(combat, players, allDefeatedCreatures),
        players,
        defeatedCreatures: allDefeatedCreatures
    };
}

function getUniquePlayerActors(combatants) {
    const seenActors = new Set();
    const players = [];
    for (const combatant of combatants) {
        const actor = combatant.actor;
        // Fix: Check for player ownership to avoid awarding XP to NPC allies
        if (!actor || actor.type !== 'character' || !actor.hasPlayerOwner) continue;
        if (seenActors.has(actor.id)) continue;
        seenActors.add(actor.id);

        players.push({
            actor,
            name: actor.name ?? combatant.name,
            level: Number(actor.system.details.level?.value ?? 1)
        });
    }
    return players;
}

async function markCombatProcessed(combat) {
    try {
        await combat.setFlag(MODULE_ID, 'xpAwarded', true);
    } catch (error) {
        console.warn('Auto XP Calculator | Unable to store combat flag', error);
    }
}