# Show Day Timing — Flex Success

Show-day stage timing for men's bodybuilding competitions. Parses a Muscleware
Expeditor Sheet PDF, estimates when each class hits the stage, re-times the whole
day live when a class runs over, and learns from your real finish times so the
estimates get sharper every show.

## Why this is on Vercel and not a Claude artifact

Artifact hosting mints a **new page with empty storage every time you publish**,
so iterating on the tool meant losing your learned history. On Vercel the origin
never changes, so a redeploy keeps every coach's data intact.

## Deploy

1. Create a new GitHub repo and put these files in it:

   ```
   index.html
   api/history.js      (only needed for shared team learning)
   README.md
   ```

2. In Vercel: **Add New -> Project -> Import** that repo. No build step, no
   framework preset needed — it's a static file. Click Deploy.

3. You get a permanent URL like `show-timing.vercel.app`. Bookmark it. Every
   future `git push` updates that same URL with data intact.

That's it for single-coach use. `localStorage` keeps your schedule and learning
history per browser, indefinitely.

## Optional: shared learning across coaches

By default each coach's browser learns independently. To pool learning so every
show teaches everyone:

1. In your Vercel project: **Storage -> Create -> KV**, and connect it. Vercel
   injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` for you.

2. In `index.html`, change:

   ```js
   window.TEAM_SYNC_URL = null;
   ```
   to
   ```js
   window.TEAM_SYNC_URL = '/api/history';
   ```

3. Push. Now every "Learn from actuals" pushes to the shared pool, and every page
   load pulls everyone else's records in.

The local copy is always authoritative for the current show, so a venue with bad
wifi degrades gracefully — it keeps working offline and syncs when it can.

## Seeding your existing history

Use the **Share/backup** button in the app. Paste your exported text into the same
box on the new deployment and hit **Import & merge**. Merge skips duplicates, so
it's safe to run more than once.

## How the timing works

- Physique-style classes: `(competitors x 0.5) + (routines x 1) + 2` min
- Comparison-style classes: `(competitors x 1) + (routines x 1) + 2` min
- A competitor is auto-flagged for a routine the first time their comp number
  appears anywhere in the show; override per athlete in the expanded row.
- Delays are excluded from learning, so unplanned interruptions never distort
  class estimates.
- A class needs 2 logged shows before its own history is used; until then it
  borrows the average adjustment for its style bucket (needs 3+).
