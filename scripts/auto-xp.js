class AutoXP {
    static init() {
        // Register the module
        Hooks.on('ready', () => {
            console.log('Auto XP Calculator | Initializing');
        });

        // Listen for combat creation
        Hooks.on('createCombat', (combat) => {
            console.log('Auto XP Calculator | Combat Created:', combat);
        });

        // Listen for combat updates
        Hooks.on('updateCombat', async (combat, update, options, userId) => {
            console.log('Auto XP Calculator | Combat Update:', {
                combat: combat,
                update: update,
                options: options,
                userId: userId
            });

            // Check if combat is being ended
            if (update.combatState === 0) {  // 0 means combat is ended
                console.log('Auto XP Calculator | Combat state changed to ended');
                await this.calculateAndDistributeXP(combat);
            }
        });

        // Listen for combat end
        Hooks.on('combatComplete', async (combat) => {
            console.log('Auto XP Calculator | Combat Complete hook triggered');
            await this.calculateAndDistributeXP(combat);
        });

        // Listen for combatant updates
        Hooks.on('updateCombatant', (combat, combatant, update, options, userId) => {
            console.log('Auto XP Calculator | Combatant Update:', {
                combatant: combatant,
                update: update,
                options: options,
                userId: userId
            });
        });

        // Listen for combat deletion
        Hooks.on('deleteCombat', (combat) => {
            console.log('Auto XP Calculator | Combat Deleted:', combat);
        });
    }

    static async calculateAndDistributeXP(combat) {
        try {
            console.log('Auto XP Calculator | Starting XP calculation');
            
            // Get all combatants that are defeated (assuming they're enemies)
            const defeatedCombatants = combat.combatants.filter(c => c.defeated);
            console.log('Auto XP Calculator | Defeated combatants:', defeatedCombatants);
            
            // Calculate total XP from defeated enemies
            let totalXP = 0;
            for (const combatant of defeatedCombatants) {
                const actor = combatant.actor;
                console.log('Auto XP Calculator | Checking combatant:', actor?.name);
                if (actor && actor.system?.details?.xp?.value) {
                    console.log('Auto XP Calculator | Found XP value:', actor.system.details.xp.value);
                    totalXP += actor.system.details.xp.value;
                }
            }

            console.log('Auto XP Calculator | Total XP calculated:', totalXP);

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
            console.log('Auto XP Calculator | Player characters found:', playerCharacters);

            if (playerCharacters.length === 0) {
                console.log('Auto XP Calculator | No player characters found in combat');
                return;
            }

            // Calculate XP per player (rounded up)
            const xpPerPlayer = Math.ceil(totalXP / playerCharacters.length);
            console.log('Auto XP Calculator | XP per player:', xpPerPlayer);

            // Update each player's XP
            for (const pc of playerCharacters) {
                const actor = pc.actor;
                if (actor) {
                    const currentXP = actor.system?.details?.xp?.value || 0;
                    const newXP = currentXP + xpPerPlayer;
                    console.log('Auto XP Calculator | Updating XP for', actor.name, 'from', currentXP, 'to', newXP);
                    
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