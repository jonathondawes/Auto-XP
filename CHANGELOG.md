# Changelog

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
