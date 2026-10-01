# Crunch 2026-10-01 (after v1.1.20)

User's order (review items, #3 dropped: minimalist UI on every device).
Each step: implement -> tests -> commit + push -> tick here. If a session
dies, resume at the first unticked step.

- [x] 1. A's "Go:" target = the current objective (HUD "Next:"), members only when close
- [x] 2. Help cards one at a time; held back while a dialogue is open
- [x] 4. Re-check old DESIGN items: desk locks tier on "Not yet"; walk lines through furniture
        Both already fixed: enterTournament() runs only on "Enter" (scene.js
        tournamentDesk); free walking on artist masks replaced the walk lines (v1.1.0).
        DESIGN.md section 21 updated.
- [ ] 5. Money: tournament entry fee + travel cost between cities (only these two for now).
        Rules from the user: not grindy; a loss should matter; winning the
        candidate rounds covers the entry fee; beating the Star Player is a good
        paycheck that funds more travel and tournaments. More money stuff later.
- [ ] 6. One faint objective marker visible at any distance
- [ ] 7. Won trophies displayed in each club's upstairs Trophy Hall
- [ ] 8. Member rematches with the head-to-head record line ("You 2-1 Danny")
        Found: the dialogue already says "We are 2-1 so far" and every talk ends in a
        challenge. Remaining: show the record on the name label + the dock button.
- [ ] 9. A member you've talked to fades their bubble
- [ ] 10. A button "Go: <long name>" -> short (icon + arrow)
