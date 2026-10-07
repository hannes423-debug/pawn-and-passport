# Privacy

What Chess Match Profile keeps about you, who can see it, and how to take it
back. Plain words; this is not a legal document. (First draft, milestone 2:
deletion and exports arrive in milestone 8.)

## What we keep

- **Your account**: email address and a scrambled form of your password
  (argon2id). Nobody can read the password back, us included.
- **Your chess identity**: username (shown to others), and if you give them,
  a display name and a country.
- **Your choices**: every time you say yes or no to one of the uses below, a
  dated record with the version of the wording you saw. Old answers are
  kept, so it is always clear what you agreed to and when.
- **Your games** (from the next release on): games you play here, and games
  you import from a Lichess account you prove is yours.

## Your choices

| Choice | Needed? | Starts as |
|---|---|---|
| Store my games | a condition of using the service | yes |
| Analyse my games (a chess engine; no AI language model) | a condition of using the service | yes |
| Import from Lichess (asked again before every import) | optional | off |
| Use my profile for a Pawn & Passport opponent | optional | off |
| Show my name (display name and country) | optional | off |
| Use my likeness (nothing can be uploaded yet) | optional | off |
| Promotion | optional | off |

Change the optional ones any time in Settings. The two conditions can only
be withdrawn by deleting your account.

## Who sees what

- **Everyone else** sees only your username, unless you turn on "Show my
  name".
- **The site's operator** (one master account) sees usernames, chess data,
  profiles and your choices, and runs exports. It never sees your email or
  password, and sees your display name and country only if you turned on
  "Show my name". This is enforced in the database queries, not just the
  screens.
- **Logs** never contain emails, passwords, session ids or reset tokens.

## Password reset

A reset link works once, for one hour, and signs you out everywhere. Without
an email server configured, the link is printed on the server's console for
the operator to pass on; your address is not printed with it.
