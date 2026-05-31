# Changelog


## [1.3.0] - 2026-05-31
### Added
- Added GM settings: Enable/Disable Auto XP, XP Multiplier, Notify Players, D&D 5e Encounter Multiplier toggle
- Added D&D 5e encounter difficulty multiplier (DMG p.82) — scales total monster XP based on number of enemies defeated
- Added level-up detection for D&D 5e — notifies GM and player when a character has enough XP to advance
- Added `AutoXP.registerHandler(handler)` global API for third-party modules to support additional game systems
- Added socket `level-up` message type for player-side level-up notifications

### Fixed
- Fixed race condition guard: replaced `combat.xpProcessing` plain property with a module-level `Set`, which correctly persists across object re-fetches
- Fixed potential double-award on `deleteCombat`: the module-level Set now prevents re-entry instead of the unreliable `skipFlag` parameter; `xpAwarded` flag is now always written regardless of how combat ends
- Fixed PF2e metrics fallback: now surfaces an in-game `ui.notifications.warn` instead of only logging to the console
- Fixed socket listener: added payload type and shape validation before using `data.actorIds` or `data.amount`

### Documentation
- Updated README to document full D&D 5e support, GM settings, and the `AutoXP` handler registration API
- Fixed `module.json` download URL (was pointing to v1.1.1, now correctly points to v1.3.0)

## [1.2.0] - 2025-12-31
### Added
- Added D&D 5e support
- Added banked XP system to store data of deleted defeated combatants
- Added support for banked XP in combat end detection
- Added player toast notifications to inform players of XP awards

### Fixed
- Fixed issue where XP was not awarded for combatants deleted from the tracker before combat end.
- Fixed issue where XP was awarded to NPC's at the end of encounters.
- Fixed XP calculation to use the correct system XP value, taken from system combat tracker. 
- Added "Banked XP" system to store data of deleted defeated combatants.

## [1.1.2] - 2025-12-30
### Fixed
- Fixed issue where XP was not awarded for combatants deleted from the tracker before combat end.
- Added "Banked XP" system to store data of deleted defeated combatants.

## [1.1.1] - 2025-11-24
### Fixed
- Restricted XP calculation to GM only to prevent duplicate awards
- Added fallback check for 0 HP to detect defeated creatures
- Added race condition protection for combat updates
- Added warning notification when 0 XP is calculated

## [1.1.0] - 2025-11-24
### Added
- Automatic XP calculation that mirrors the PF2e encounter XP table
- Combat end detection that runs when an encounter is ended or deleted
- Notifications that show how much XP each character received

### Fixed
- XP is no longer split between characters; each hero now receives the full PF2e award
- Eliminated reliance on NPC XP fields, which are unused in PF2e stat blocks

## [1.0.1] - 2024-05-08
### Added
- Initial release
- Automatic XP calculation after combat
- XP distribution among player characters
- Rounding up of XP values
- Chat notifications for XP gains 
- Updated correct URL for install
