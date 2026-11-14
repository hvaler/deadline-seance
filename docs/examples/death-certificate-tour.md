# Death certificate

Release: Hollow Bank app 3.2

Freeze: Wed 2026-11-18 18:00 (Europe/Madrid)

As of: Mon 2026-11-16 09:00, the start time of the board

## The cut

The team has 23 points before the freeze. With a 0 % reserve, 23 points are available.

- Kept inside: 4 tickets, 23 points, saved cost of delay 63.
- Left outside: 14 tickets, 144 points, cost of delay 189.
- Waiting for the next release costs 378 for all of them (cost of delay × 2 weeks).

## Will it hold?

Estimates are simulated between 80 % and 150 % of their value on 1,000 nights, measured against all 23 points of the team.

The cut holds on 29 of 1,000 nights (2 %).

## Left outside

| Key | Title | Points | Cost of delay | Waiting cost (× 2 weeks) | Reason |
|---|---|---:|---|---:|---|
| HB-119 | Core ledger migration | 48 | value 8 + urgency 5 + risk 8 = 21 | 42 | Does not fit: needs 48 points, 0 left. |
| HB-106 | Card freeze toggle | 5 | value 8 + urgency 5 + risk 3 = 16 | 32 | Follows HB-104, which is left outside. |
| HB-117 | Onboarding rewrite | 21 | value 8 + urgency 3 + risk 5 = 16 | 32 | Follows HB-104, which is left outside. |
| HB-118 | Referral programme | 8 | value 5 + urgency 1 → 8 + risk 3 = 16 | 32 | Does not fit: needs 8 points, 0 left. |
| HB-109 | Instant-transfer limits screen | 5 | value 5 + urgency 5 + risk 5 = 15 | 30 | Pushed out by the exhumed HB-108: needs 5 points, 0 left. |
| HB-111 | Savings goals | 13 | imported cost of delay 14 | 28 | Does not fit: needs 13 points, 0 left. |
| HB-113 | Accessibility audit fixes | 5 | value 3 + urgency 3 → 8 + risk 3 = 14 | 28 | Does not fit: needs 5 points, 0 left. |
| HB-110 | Spending insights widget | 13 | value 5 + urgency 2 → 5 + risk 3 = 13 | 26 | Does not fit: needs 13 points, 0 left. |
| HB-115 | Phone wallet pass | 8 | value 5 + urgency 3 + risk 5 = 13 | 26 | Does not fit: needs 8 points, 0 left. |
| HB-104 | Biometric login fallback | 5 | value 5 + urgency 3 + risk 3 = 11 | 22 | Does not fit: needs 5 points, 0 left. |
| HB-105 | Dark-mode statement PDF | 3 | value 3 + urgency 1 → 5 + risk 3 = 11 | 22 | Pushed out by the exhumed HB-108: needs 3 points, 0 left. |
| HB-107 | Card freeze push alerts | 3 | value 5 + urgency 3 + risk 3 = 11 | 22 | Follows HB-106, which is left outside. |
| HB-114 | FX rate alerts | 5 | value 5 + urgency 3 + risk 3 = 11 | 22 | Cannot ship: depends on HB-112, which was put down (Won't Do). |
| HB-116 | Balance home-screen widget | 2 | value 3 + urgency 2 + risk 2 = 7 | 14 | Does not fit: needs 2 points, 0 left. |

## Zombies

A ticket is a zombie when leaving it out again makes 3 releases in a row. Its urgency climbs a step on the scale for each release it is left out.

- HB-118, Referral programme: left out 4 releases; urgency 8 now, 13 if left out again.
- HB-113, Accessibility audit fixes: left out 2 releases; urgency 8 now, 13 if left out again.
- HB-110, Spending insights widget: left out 2 releases; urgency 5 now, 8 if left out again.
- HB-105, Dark-mode statement PDF: left out 3 releases; urgency 5 now, 8 if left out again.

## Put down (Won't Do)

- HB-112, Multi-currency wallet: closed as Won't Do. Blocks HB-114.

## People away

- Ana

## Exhumed by decision

- HB-108, Transaction search: 8 points, cost of delay 10. Pushed out: HB-105 (11), HB-109 (15).
