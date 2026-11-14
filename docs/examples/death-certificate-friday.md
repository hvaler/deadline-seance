# Death certificate

Release: Hollow Bank app 3.2

Freeze: Fri 2026-11-20 18:00 (Europe/Madrid)

As of: Mon 2026-11-16 09:00, the start time of the board

## The cut

The team has 59 points before the freeze. With a 0 % reserve, 59 points are available.

- Kept inside: 12 tickets, 59 points, saved cost of delay 167.
- Left outside: 7 tickets, 129 points, cost of delay 101.
- Waiting for the next release costs 202 for all of them (cost of delay × 2 weeks).

## Will it hold?

Estimates are simulated between 80 % and 150 % of their value on 1,000 nights, measured against all 59 points of the team.

The cut holds on 0 of 1,000 nights (0 %).

## Left outside

| Key | Title | Points | Cost of delay | Waiting cost (× 2 weeks) | Reason |
|---|---|---:|---|---:|---|
| HB-119 | Core ledger migration | 48 | value 8 + urgency 5 + risk 8 = 21 | 42 | Does not fit: needs 48 points, 0 left. |
| HB-112 | Multi-currency wallet | 21 | value 5 + urgency 2 → 8 + risk 3 = 16 | 32 | Does not fit: needs 21 points, 0 left. |
| HB-117 | Onboarding rewrite | 21 | value 8 + urgency 3 + risk 5 = 16 | 32 | Does not fit: needs 21 points, 0 left. |
| HB-111 | Savings goals | 13 | imported cost of delay 14 | 28 | Does not fit: needs 13 points, 0 left. |
| HB-110 | Spending insights widget | 13 | value 5 + urgency 2 → 5 + risk 3 = 13 | 26 | Does not fit: needs 13 points, 0 left. |
| HB-114 | FX rate alerts | 5 | value 5 + urgency 3 + risk 3 = 11 | 22 | Follows HB-112, which is left outside. |
| HB-108 | Transaction search | 8 | value 5 + urgency 2 + risk 3 = 10 | 20 | Does not fit: needs 8 points, 0 left. |

## Zombies

A ticket is a zombie when leaving it out again makes 3 releases in a row. Its urgency climbs a step on the scale for each release it is left out.

- HB-112, Multi-currency wallet: left out 3 releases; urgency 8 now, 13 if left out again.
- HB-110, Spending insights widget: left out 2 releases; urgency 5 now, 8 if left out again.

## Put down (Won't Do)

None.

## People away

None.

## Exhumed by decision

None.
