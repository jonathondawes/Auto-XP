# Foundry UAT — XP review and undo

Use a backed-up test world and the source JS/CSS/manifest from this branch.
Existing release ZIPs do not contain these changes. Do not publish a new
compatibility claim until tested in Foundry. The manifest version remains
unchanged until release packaging.

Run this checklist in both PF2e and D&D 5e, recording Foundry and system versions.
Verify the oldest supported Foundry version with a compatible system version,
and Foundry 13/14 (which use the newer chat rendering hook).

1. With default settings, end a combat with defeated enemies and player-owned
   characters. Each character receives exactly the displayed XP. Player chat
   contains no action controls. The active GM sees Undo award.
2. Award 25 XP separately, then undo the combat award. Exactly the combat amount
   is subtracted, preserving those 25 XP. Repeated clicking does not subtract
   again. Character levels and advancement choices are not rolled back.
3. Switch XP Award Mode to GM Review. End another encounter. No character XP
   changes; only GMs see a pending card. Edit the amount and award it. All
   recipients receive that amount, and players see the result if notifications
   are enabled. Try zero, invalid, blank and negative input.
4. Review another encounter and choose Discard. No XP changes; the card stays
   GM-only. Repeated end/delete events do not recreate the award.
5. Delete an encounter while its award is pending. Refresh the browser; review
   and award still work. Delete an automatically awarded encounter, refresh,
   then undo using its chat card.
6. Open two GM sessions and a player session. Only the active GM awards XP or
   operates controls. The other GM must not produce a second award. Disconnect
   the active GM and reload the new active GM's chat to check authority handoff.
7. Disable Notify Players. Award and undo cards remain whispered to GMs.
8. Use browser developer tools to simulate a failed actor update or missing
   actor in a test world. Successful recipients are not awarded twice when
   retrying; undo only removes successful awards. Restore a missing actor with
   its original UUID to retry it.
9. Reduce a recipient's current XP below the award amount, then undo. That
   character reports an error; its XP never becomes negative. Correct the XP
   total and Retry undo; previously undone characters remain unchanged.
10. In 5e, cross a level-up threshold. Confirm the badge/player notification.
    Undo does not produce a level-up popup. An actor already above its next-level
    threshold should not be repeatedly notified by further XP awards.

Record results here or in the PR before release. Automated tests mock Foundry;
the full live integration checklist has not yet been completed.

## v1.4.0 validation — 2026-10-25

- Foundry 13.351, Pathfinder 2e 7.10.1, backed-up AV Test world.
- Confirmed module active and XP Award Mode setting visible in the running world.
- Maintainer reported the module works after local testing and authorized release.
- All 17 automated regression tests pass.
- Full multi-GM/player, failure-recovery, D&D 5e and Foundry 14 checks remain unrecorded.
