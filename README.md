# Auto XP Calculator

A Foundry VTT module that automatically calculates and distributes XP after combat encounters. Supports **Pathfinder 2E** and **D&D 5e**, with an open API for third-party system support.

## Features

- Automatically calculates and awards XP when a combat encounter ends or is deleted
- Full support for Pathfinder 2E and D&D 5e XP rules
- Banks XP for creatures removed from the tracker mid-combat, so they still count at the end
- Prevents double-awarding via a persistent combat flag
- In-game notifications for both the GM and players
- Level-up detection for D&D 5e characters
- GM-configurable settings (multipliers, notifications, and more)
- Open handler registration API for third-party system support

## System Support

### Pathfinder 2E
- Defers to the PF2e system's own `combat.metrics.award.xp` value, keeping XP in sync with the system's encounter budget UI
- Awards the full PF2e XP value to every player character (not split)
- Displays an in-game warning if the system XP value cannot be retrieved

### D&D 5e
- Sums the XP values of all defeated NPCs and hazards
- Applies the official encounter difficulty multiplier from the DMG (p.82) based on the number of monsters defeated (toggleable via settings)
- Splits the adjusted total evenly among all player characters
- Detects when a character has accumulated enough XP to level up and notifies both GM and player

| Monster Count | Multiplier |
|---|---|
| 1 | ×1 |
| 2 | ×1.5 |
| 3–6 | ×2 |
| 7–10 | ×2.5 |
| 11–14 | ×3 |
| 15+ | ×4 |

## Installation

1. In Foundry VTT, go to the **Add-on Modules** tab
2. Click **Install Module**
3. Enter the following URL: `https://github.com/jonathondawes/auto-xp/releases/latest/download/module.zip`
4. Click **Install**
5. Enable the module in your world settings

## Usage

The module works automatically — no configuration required. When a combat ends:

1. The module calculates the total XP from all defeated creatures (including any removed mid-combat)
2. Applies any configured multipliers
3. Updates each character's XP value on their sheet
4. Shows a GM notification with the XP awarded
5. Sends a notification to each player for their owned characters
6. **(5e only)** Alerts the GM and player if a character has enough XP to level up

> **Note:** Combat must be tracked using the Foundry combat tracker for this module to work correctly.

## Configuration

The following settings are available in **Game Settings → Module Settings → Auto XP Calculator**:

| Setting | Description | Default |
|---|---|---|
| **Enable Auto XP** | Toggle automatic XP awarding on or off | Enabled |
| **XP Multiplier** | Multiply all XP awards by this value (e.g. `0.5` for half XP, `2.0` for double) | `1.0` |
| **Notify Players** | Send in-game notifications to players when XP is awarded | Enabled |
| **D&D 5e: Apply Encounter Multiplier** | Apply the official 5e encounter difficulty multiplier (DMG p.82) | Enabled |

## API

Auto XP exposes a global `AutoXP` object that other modules can use to register support for additional game systems.

### `AutoXP.registerHandler(handler)`

Registers a custom system handler. Must be called before the `ready` hook fires (e.g. from your module's `init` hook). Custom handlers take priority over the built-in PF2e and D&D 5e handlers.

**Requirements:** The handler must extend `SystemHandler` and implement:
- `get isValid()` — returns `true` if this handler should be used for the current game system
- `getCreatureData(combatant)` — returns a plain object with creature data for XP calculation
- `calculateXP(combat, players, defeatedCreatures)` — returns `{ xpPerCharacter: number }`
- `async updatePlayerXP(actor, amount)` — updates the actor and returns `{ currentXP, newXP, leveledUp }`

**Example:**

```js
Hooks.once('init', () => {
    class MySystemHandler extends SystemHandler {
        get isValid() { return game.system.id === 'my-system'; }

        getCreatureData(combatant) {
            return {
                id: combatant.id,
                name: combatant.name,
                xp: Number(combatant.actor.system.xp ?? 0),
            };
        }

        calculateXP(combat, players, defeatedCreatures) {
            const total = defeatedCreatures.reduce((sum, c) => sum + (c.xp || 0), 0);
            return { xpPerCharacter: Math.floor(total / players.length) };
        }

        async updatePlayerXP(actor, amount) {
            const currentXP = actor.system.xp || 0;
            const newXP = currentXP + amount;
            await actor.update({ 'system.xp': newXP });
            return { currentXP, newXP, leveledUp: false };
        }
    }

    AutoXP.registerHandler(new MySystemHandler());
});
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
