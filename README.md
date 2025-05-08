# Auto XP Calculator

A Foundry VTT module that automatically calculates and distributes XP after combat encounters for both Pathfinder 2E and D&D 5E.

## Features

- Automatically calculates XP after combat encounters
- Supports both Pathfinder 2E and D&D 5E systems
- Distributes XP evenly among player characters
- Rounds up XP values to ensure no XP is lost
- Provides in-game notifications about XP distribution

## System Support

### Pathfinder 2E
- Uses the built-in encounter analysis to determine XP values
- Distributes XP based on the encounter's award value

### D&D 5E
- Calculates XP based on defeated NPCs
- Sums up the XP values of all defeated enemies
- Distributes the total XP among player characters

## Installation

1. In Foundry VTT, go to the "Add-on Modules" tab
2. Click "Install Module"
3. Enter the following URL: `https://github.com/jonathondawes/auto-xp/releases/latest/download/module.zip`
4. Click "Install"
5. Enable the module in your world settings

## Usage

The module works automatically - no configuration needed! When a combat ends:
1. The module calculates the total XP from the encounter
2. Divides the XP evenly among all player characters
3. Updates each character's XP value
4. Shows a notification with the total XP and amount per player

## License

This module is licensed under the MIT License - see the LICENSE file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
