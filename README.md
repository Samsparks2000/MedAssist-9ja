# MedAssist-9ja

Find the nearest verified hospital, pharmacy or specialist that has the drug, bed, blood, oxygen, equipment or doctor you need, now. Built from the *MedAssist-9ja User Stories and PRD* (MVP = Phases 1–3) and the MVP design (`mvp.pdf`), for an **Ibadan and Lagos** pilot.

- `server/` – Node.js + Express + TypeScript API, PostgreSQL, Socket.IO live updates
- `web/` – React + Vite responsive web app / PWA (desktop layouts from the design, phone tab bar and sticky actions on mobile)

## Run it

Requires Node.js 20+ (tested on 24). No database install is needed: an embedded PostgreSQL starts automatically and keeps its data in `~/.medassist-9ja/pgdata`.

On Windows PowerShell use `npm.cmd` (PowerShell blocks the `npm` script by default):

```bash
npm.cmd install
```

```bash
npm.cmd run dev
```

Open http://localhost:5173 (the API runs on http://localhost:4000). The first start takes about a minute. Stop with Ctrl+C.

Optional: copy `server/.env.example` to `server/.env` to change settings.

**Starting fresh:** to wipe the local demo database and re-seed, stop the app and delete the folder `%USERPROFILE%\.medassist-9ja\pgdata`, then start again.

### Demo accounts (fictional sample data)

Sign in → **I run a pharmacy or hospital** → **Sign in with email and password**. Every account uses the `SEED_PASSWORD` from `server/.env.example`. You can also sign in with the account's phone number and the code shown on screen in development mode.

| Role | Email |
|---|---|
| Admin | admin@medassist.test (phone 0803 000 0000) |
| Pharmacy, Ibadan | bodija-market@medassist.test, ui-gate@medassist.test |
| Hospital, Ibadan | bodija-specialist@medassist.test |
| Specialist, Ibadan | c-okafor@medassist.test |
| Pharmacy, Lagos | tunde@medassist.test |
| Hospital, Lagos | bello@medassist.test |

Patients sign in with any Nigerian phone number; the code is shown on screen and printed in the server log.

### Tests

```bash
npm.cmd test
```

45 tests (unit + API integration against a throwaway embedded Postgres) cover search, radius expansion, fuzzy matching, concurrent reservations, pay-now and pay-at-pickup flows, webhooks/refunds, inventory upload and alerts, bed-request forwarding, registration and verification, specialist confirmation and collect-by times. If a previous run left a database on the test port, run with `TEST_DB_PORT=5547`.

## What's in it

**Patients:** landing page with search and “Browse by need”, guest Emergency screen (call 112 first, “What is happening?”, hospitals tagged with the right doctor/beds/services), results list and map (5/10/20 km search areas, sort, filters, “Search up to 10 km”), pharmacy pages with stock, hours and trust details, reserve with **Pay now** (card/transfer/USSD) or **Pay at pickup**, pickup code `MA-0000`, order timeline, receipts, refunds, refill reminders, “Tell me when back”, bed requests, complaints.

**Pharmacies:** overview with reservations to confirm, alerts and “Searches you missed”; inventory; add stock with live patient preview; spreadsheet upload with “Did you mean…?” fixes; record a sale; reports with CSV export; payouts; staff accounts; profile.

**Hospitals:** beds by ward with −/+ counters, services status, blood bank grid, specialists today; bed requests; specialists and rota (confirm doctors who list you); supplies; reports; payouts; staff accounts; profile.

**Specialists:** registration with MDCN details and hospital links, weekly schedule with on-call days, “available now” toggle.

**Admin:** verification queue with documents, checklist and “Ask for more information”; outdated listings; complaints by category; payments and refunds; all facilities; drug catalogue and requests; reports and audit log.

**Registration:** pharmacy, hospital and specialist forms with phone verification, document upload, map pin, opening hours, payout bank lookup, and “Save and finish later”.

## Third-party services

Everything works offline with test adapters. Switch them on in `server/.env`:

- **Payments**: `PAYMENT_PROVIDER=paystack` + `PAYSTACK_SECRET_KEY=sk_test_…` (also used for bank lists, account-name lookup and settlement subaccounts). Point the Paystack webhook at `<API_URL>/api/payments/webhook`.
- **SMS**: `SMS_PROVIDER=termii` + `TERMII_API_KEY`.
- **Geocoding**: `GEOCODER=nominatim` (OpenStreetMap); the default is a built-in list of Ibadan and Lagos landmarks.
- **Database**: set `DATABASE_URL` to use your own Postgres instead of the embedded one.

The Paystack and Termii adapters follow their public APIs but have not been run against live accounts.

## Notes

- Freshness follows the PRD: listings are flagged after 24 h without an update and hidden after 72 h (configurable in `.env`); the design suggested 7 and 30 days.
- Out of scope (PRD Phase 4+): local languages, USSD-only search, delivery, telemedicine, HMO claims.
