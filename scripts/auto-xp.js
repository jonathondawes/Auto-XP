class AutoXP {
    static init() {
        // Register the module
        Hooks.once('init', () => {
            console.log('Auto XP Calculator | Initializing');
            this.system = game.system.id;
            console.log('Auto XP Calculator | Detected system:', this.system);
        });

        // Handle combat updates
        Hooks.on('updateCombat', async (combat, update, options, userId) => {
            console.log('Auto XP Calculator | Combat Update:', {
                combatId: combat.id,
                update,
                active: combat.active,
                round: combat.round,
                turn: combat.turn,
                started: combat.started
            });

            // Check if combat is being ended
            if (update.hasOwnProperty('started') && !update.started) {
                console.log('Auto XP Calculator | Combat ended, processing XP...');
                await this.calculateAndDistributeXP(combat);
            }
        });

        // Handle combatant updates
        Hooks.on('updateCombatant', (combatant, update, options, userId) => {
            // Get the actual combatant data
            const combatantData = combatant.parent.combatants.get(combatant.id);
            
            console.log('Auto XP Calculator | Combatant Update:', {
                combatantId: combatantData.id,
                combatantName: combatantData.name,
                actorName: combatantData.actor?.name,
                actorType: combatantData.actor?.type,
                update,
                defeated: update.defeated,
                currentDefeated: combatantData.defeated
            });
        });

        // Handle combat deletion
        Hooks.on('deleteCombat', async (combat, options, userId) => {
            console.log('Auto XP Calculator | Combat deleted, processing XP...');
            await this.calculateAndDistributeXP(combat);
        });

        // Handle combat end
        Hooks.on('combatComplete', async (combat) => {
            console.log('Auto XP Calculator | Combat Complete hook triggered');
            await this.calculateAndDistributeXP(combat);
        });
    }

    static async calculateAndDistributeXP(combat) {
        try {
            console.log('Auto XP Calculator | Starting XP processing...');
            
            // Get all combatants
            const combatants = Array.from(combat.combatants);
            console.log('Auto XP Calculator | Found combatants:', combatants.map(c => ({
                id: c.id,
                name: c.name,
                defeated: c.defeated,
                actorName: c.actor?.name,
                actorType: c.actor?.type,
                system: c.actor?.system
            })));

            // Get all player characters
            const players = combatants.filter(c => 
                c.actor?.type === 'character'
            );
            console.log('Auto XP Calculator | Player characters:', players.map(p => ({
                name: p.name,
                actorName: p.actor?.name,
                id: p.actor?.id,
                system: p.actor?.system
            })));

            if (players.length === 0) {
                console.log('Auto XP Calculator | No player characters found in combat');
                return;
            }

            // Get encounter XP based on system
            let encounterXP = 0;
            
            if (this.system === 'pf2e') {
                // Pathfinder 2E XP calculation
                const analysis = combat.analyze();
                console.log('Auto XP Calculator | PF2E Combat Analysis:', analysis);
                encounterXP = analysis?.award?.xp || 0;
            } else if (this.system === 'dnd5e') {
                // D&D 5E XP calculation
                const defeatedEnemies = combatants.filter(c => 
                    c.actor?.type === 'npc' && c.defeated
                );
                console.log('Auto XP Calculator | D&D 5E Defeated Enemies:', defeatedEnemies);
                
                // Sum up XP from defeated enemies
                encounterXP = defeatedEnemies.reduce((total, enemy) => {
                    const xp = enemy.actor?.system?.details?.xp?.value || 0;
                    return total + xp;
                }, 0);
            }

            console.log('Auto XP Calculator | Encounter XP:', encounterXP);

            if (encounterXP === 0) {
                console.log('Auto XP Calculator | No XP to distribute');
                return;
            }

            // Calculate XP per player (rounding up)
            const xpPerPlayer = Math.ceil(encounterXP / players.length);
            console.log('Auto XP Calculator | XP per player:', xpPerPlayer);

            // Distribute XP to each player
            for (const player of players) {
                try {
                    let currentXP = 0;
                    let updatePath = '';

                    // Get current XP based on system
                    if (this.system === 'pf2e') {
                        currentXP = player.actor?.system?.details?.xp?.value || 0;
                        updatePath = 'system.details.xp.value';
                    } else if (this.system === 'dnd5e') {
                        currentXP = player.actor?.system?.details?.xp?.value || 0;
                        updatePath = 'system.details.xp.value';
                    }

                    const newXP = currentXP + xpPerPlayer;
                    console.log(`Auto XP Calculator | Updating ${player.name}'s XP:`, {
                        current: currentXP,
                        adding: xpPerPlayer,
                        new: newXP,
                        system: player.actor?.system
                    });
                    
                    await player.actor.update({
                        [updatePath]: newXP
                    });
                    
                    console.log(`Auto XP Calculator | Successfully updated ${player.name}'s XP`);
                } catch (error) {
                    console.error(`Auto XP Calculator | Error updating XP for ${player.name}:`, error);
                }
            }

            // Show notification
            if (encounterXP > 0) {
                const message = `Combat complete! ${encounterXP} XP distributed (${xpPerPlayer} XP per player)`;
                console.log('Auto XP Calculator | Showing notification:', message);
                ui.notifications.info(message);
            }

        } catch (error) {
            console.error('Auto XP Calculator | Error calculating XP:', error);
        }
    }
}

// Initialize the module
Hooks.once('init', () => {
    AutoXP.init();
});