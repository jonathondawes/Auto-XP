# Auto XP Calculator

A Foundry VTT module that automatically calculates and distributes XP after combat encounters. This module only currently supports PF2e

## Features

- Automatically calculates XP after combat encounters
- Supports Pathfinder 2E
- Distributes XP evenly among player characters
- Rounds up XP values to ensure no XP is lost
- Provides in-game notifications about XP distribution

## System Support

### Pathfinder 2E
- Uses the built-in encounter analysis to determine XP values
- Distributes XP based on the encounter's award value

## DnD 5e
- Coming soon

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

Note: Combat must be tracked using the foundry combat tracker for this module to work correctly. 

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
