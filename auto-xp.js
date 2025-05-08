// Handle combat updates
Hooks.on('updateCombat', (combat, update, options, userId) => {
    console.log('Auto XP Calculator | Combat Update:', {
        combatId: combat.id,
        update,
        combatState: combat.started,
        round: combat.round,
        turn: combat.turn,
        combatants: combat.combatants.map(c => ({
            id: c.id,
            name: c.name,
            defeated: c.defeated,
            actor: c.actor?.name
        }))
    });

    // Only process if combat has ended
    if (!combat.started) {
        console.log('Auto XP Calculator | Combat ended, processing XP...');
        processCombatXP(combat);
    }
});

// Handle combatant updates
Hooks.on('updateCombatant', (combat, combatant, update, options, userId) => {
    console.log('Auto XP Calculator | Combatant Update:', {
        combatantId: combatant.id,
        combatantName: combatant.name,
        update,
        defeated: combatant.defeated,
        actor: combatant.actor?.name
    });
});

// Process XP for a completed combat
async function processCombatXP(combat) {
    console.log('Auto XP Calculator | Starting XP processing...');
    
    // Get all combatants
    const combatants = combat.combatants;
    console.log('Auto XP Calculator | Found combatants:', combatants.map(c => ({
        id: c.id,
        name: c.name,
        defeated: c.defeated,
        actor: c.actor?.name
    })));

    // Filter out defeated NPCs
    const defeatedNPCs = combatants.filter(c => 
        c.defeated && 
        c.actor && 
        c.actor.type === 'npc'
    );
    console.log('Auto XP Calculator | Defeated NPCs:', defeatedNPCs.map(npc => ({
        name: npc.name,
        xp: npc.actor.system.details.xp?.value || 0
    })));

    // Get all player characters
    const players = combatants.filter(c => 
        c.actor && 
        c.actor.type === 'character'
    );
    console.log('Auto XP Calculator | Player characters:', players.map(p => ({
        name: p.name,
        id: p.actor.id
    })));

    // Calculate total XP
    const totalXP = defeatedNPCs.reduce((sum, npc) => {
        const xp = npc.actor.system.details.xp?.value || 0;
        console.log(`Auto XP Calculator | Adding XP from ${npc.name}: ${xp}`);
        return sum + xp;
    }, 0);
    console.log('Auto XP Calculator | Total XP to distribute:', totalXP);

    // Calculate XP per player (rounding up)
    const xpPerPlayer = Math.ceil(totalXP / players.length);
    console.log('Auto XP Calculator | XP per player:', xpPerPlayer);

    // Distribute XP to each player
    for (const player of players) {
        try {
            const currentXP = player.actor.system.details.xp?.value || 0;
            const newXP = currentXP + xpPerPlayer;
            console.log(`Auto XP Calculator | Updating ${player.name}'s XP:`, {
                current: currentXP,
                adding: xpPerPlayer,
                new: newXP
            });
            
            await player.actor.update({
                'system.details.xp.value': newXP
            });
            
            console.log(`Auto XP Calculator | Successfully updated ${player.name}'s XP`);
        } catch (error) {
            console.error(`Auto XP Calculator | Error updating XP for ${player.name}:`, error);
        }
    }

    // Show notification
    if (totalXP > 0) {
        const message = `Combat complete! ${totalXP} XP distributed (${xpPerPlayer} XP per player)`;
        console.log('Auto XP Calculator | Showing notification:', message);
        ui.notifications.info(message);
    }
} 