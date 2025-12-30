const MODULE_ID = 'auto-xp';

const XP_BY_LEVEL_DIFF = new Map([
    [-4, 10],
    [-3, 15],
    [-2, 20],
    [-1, 30],
    [0, 40],
    [1, 60],
    [2, 80],
    [3, 120],
    [4, 160],
    [5, 240],
    [6, 320],
    [7, 480],
    [8, 640],
    [9, 960],
    [10, 1280]
]);

Hooks.once('ready', () => {
    console.log('Auto XP Calculator | Ready');
});

Hooks.on('updateCombat', async (combat, update) => {
    if (!game.user.isGM) return;
    if (!shouldHandleCombat()) return;
    if (!combatEnded(update)) return;
    await processCombatXP(combat);
});

Hooks.on('deleteCombat', async (combat) => {
    if (!game.user.isGM) return;
    if (!shouldHandleCombat()) return;
    await processCombatXP(combat, { skipFlag: true });
});

Hooks.on('deleteCombatant', async (combatant, context, userId) => {
    if (!game.user.isGM) return;
    if (!shouldHandleCombat()) return;

    const combat = combatant.combat;
    if (!combat) return;

    // Check if it's a valid enemy (NPC/Hazard)
    if (!['npc', 'hazard'].includes(combatant.actor?.type)) return;

    // Check if it was defeated or dead
    const isDefeated = combatant.defeated;
    const hp = combatant.actor?.system?.attributes?.hp?.value;
    const isDead = hp !== undefined && hp <= 0;

    if (isDefeated || isDead) {
        const bankedCreature = {
            id: combatant.id,
            name: combatant.name,
            level: Number(combatant.actor.system.details.level?.value ?? 0),
            type: combatant.actor.type
        };

        const existingBank = combat.getFlag(MODULE_ID, 'banked-xp') || [];
        existingBank.push(bankedCreature);

        await combat.setFlag(MODULE_ID, 'banked-xp', existingBank);
        console.log(`Auto XP Calculator | Banked XP for deleted combatant: ${combatant.name}`);
    }
});

function shouldHandleCombat() {
    return game.system.id === 'pf2e';
}

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

        const { xpPerCharacter, players, defeatedCreatures, partyLevel } = calculateEncounterXP(combat);

        if (!xpPerCharacter || !players.length) {
            if (!xpPerCharacter) {
                console.log('Auto XP Calculator | No XP to award');
                if (defeatedCreatures.length > 0) {
                    ui.notifications.warn(`Auto XP: Creatures defeated but 0 XP calculated. Check levels.`);
                }
            }
            if (!players.length) {
                console.warn('Auto XP Calculator | No player characters found to award XP');
            }
            if (!skipFlag) {
                await markCombatProcessed(combat);
            }
            return;
        }

        console.log('Auto XP Calculator | Awarding XP:', {
            xpPerCharacter,
            partyLevel,
            defeatedCreatures: defeatedCreatures.map(c => ({
                id: c.id,
                name: c.name,
                level: c.level,
                type: c.type
            })),
            players: players.map(p => ({
                id: p.actor.id,
                name: p.name,
                level: p.level
            }))
        });

        for (const player of players) {
            try {
                const currentXP = player.actor.system.details.xp?.value || 0;
                const newXP = currentXP + xpPerCharacter;
                await player.actor.update({ 'system.details.xp.value': newXP });
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
    const defeatedCreatures = combatants
        .filter(c => {
            if (!['npc', 'hazard'].includes(c.actor?.type)) return false;
            const isDefeated = c.defeated;
            const hp = c.actor?.system?.attributes?.hp?.value;
            const isDead = hp !== undefined && hp <= 0;
            return isDefeated || isDead;
        })
        .map(c => ({
            id: c.id,
            name: c.name,
            level: Number(c.actor.system.details.level?.value ?? 0),
            type: c.actor.type,
            actor: c.actor
        }));

    // Add banked creatures (deleted during combat)
    const bankedCreatures = combat.getFlag(MODULE_ID, 'banked-xp') || [];
    const allDefeatedCreatures = [...defeatedCreatures, ...bankedCreatures];

    const partyLevel = calculatePartyLevel(players);
    const xpPerCharacter = allDefeatedCreatures.reduce((total, creature) => {
        const diff = creature.level - partyLevel;
        return total + getXPForLevelDifference(diff);
    }, 0);

    return { xpPerCharacter, players, defeatedCreatures: allDefeatedCreatures, partyLevel };
}

function calculatePartyLevel(players) {
    if (!players.length) return 1;
    const totalLevels = players.reduce((total, player) => {
        const level = Number(player.level ?? 1);
        return total + level;
    }, 0);

    const average = totalLevels / players.length;
    return Math.max(1, Math.floor(average + 0.5));
}

function getXPForLevelDifference(diff) {
    if (diff <= -5) return 0;
    if (diff >= 10) diff = 10;
    return XP_BY_LEVEL_DIFF.get(diff) ?? 0;
}

function getUniquePlayerActors(combatants) {
    const seenActors = new Set();
    const players = [];
    for (const combatant of combatants) {
        const actor = combatant.actor;
        if (!actor || actor.type !== 'character') continue;
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