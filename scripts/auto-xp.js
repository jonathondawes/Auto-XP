class AutoXP {
    static init() {
        // Register the module
        Hooks.on('ready', () => {
            console.log('Auto XP Calculator | Initializing');
        });

        // Listen for combat end
        Hooks.on('combatComplete', async (combat) => {
            await this.calculateAndDistributeXP(combat);
        });

        // Listen for combat state changes
        Hooks.on('updateCombat', async (combat, update, options, userId) => {
            // Check if combat is being ended
            if (update.combatState === 0) {  // 0 means combat is ended
                await this.calculateAndDistributeXP(combat);
            }
        });
    }

    static async calculateAndDistributeXP(combat) {
        try {
            // Get all combatants that are defeated (assuming they're enemies)
            const defeatedCombatants = combat.combatants.filter(c => c.defeated);
            
            // Calculate total XP from defeated enemies
            let totalXP = 0;
            for (const combatant of defeatedCombatants) {
                const actor = combatant.actor;
                if (actor && actor.system?.details?.xp?.value) {
                    totalXP += actor.system.details.xp.value;
                }
            }

            if (totalXP === 0) {
                console.log('Auto XP Calculator | No XP to distribute');
                return;
            }

            // Get all player characters in the combat
            const playerCharacters = combat.combatants.filter(c => 
                c.actor?.type === 'character' && 
                !c.defeated && 
                c.actor.hasPlayerOwner
            );

            if (playerCharacters.length === 0) {
                console.log('Auto XP Calculator | No player characters found in combat');
                return;
            }

            // Calculate XP per player (rounded up)
            const xpPerPlayer = Math.ceil(totalXP / playerCharacters.length);

            // Update each player's XP
            for (const pc of playerCharacters) {
                const actor = pc.actor;
                if (actor) {
                    const currentXP = actor.system?.details?.xp?.value || 0;
                    const newXP = currentXP + xpPerPlayer;
                    
                    await actor.update({
                        'system.details.xp.value': newXP
                    });

                    // Notify the player
                    const playerName = actor.name;
                    const message = `${playerName} earned ${xpPerPlayer} XP!`;
                    ChatMessage.create({
                        user: game.user.id,
                        content: message,
                        speaker: ChatMessage.getSpeaker()
                    });
                }
            }

            // Show total XP notification
            ChatMessage.create({
                user: game.user.id,
                content: `Total XP earned: ${totalXP} (${xpPerPlayer} per player)`,
                speaker: ChatMessage.getSpeaker()
            });

        } catch (error) {
            console.error('Auto XP Calculator | Error calculating XP:', error);
        }
    }
}

// Initialize the module
Hooks.once('init', () => {
    AutoXP.init();
});