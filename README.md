# Kaplan Food Schedule

Employee scheduling for Kaplan Food. Static site on GitHub Pages (`/docs`), data in Firebase (project `kaplan-schedule`).

- **Password screen** signs into one Firebase Auth account (`manager@kaplan-schedule.app`). Firestore rules only allow that account, so the data stays private even though this repo is public.
- **Schedule**: weekly grid, quick shifts, split shifts, per-shift role (Kitchen / Cashier-Restock), day notes, copy last week, hours totals, overtime / overlap / time-off / availability warnings.
- **Coverage**: hour-by-hour view per role with gaps highlighted; store and kitchen hours can be changed per day.
- **Employees**, **Time off**, **Settings** (usual hours, quick shifts, overtime limit, import / backup).
- **Print** and **Save image** (PNG) of any week.

## Develop

```
npm install
npm run build      # bundles src/ -> docs/app.js
```

Local testing against the Firebase emulators: serve `docs/` on localhost and open `http://localhost:PORT/?emu=1`.

`firestore.rules` is the rule set to paste into the Firebase console. `tools/parse_doc.py` converts the old Google Doc schedule into an import file (the import file itself is not stored here).
