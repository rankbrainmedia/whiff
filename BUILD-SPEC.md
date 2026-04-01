# Build Spec: Persistent Predictions + Admin + Public Logging + Changelog + Mobile

## Overview
Convert The Whiff from a local-only tool to a public-facing "build in public" app with persistent prediction tracking, admin-gated logging, public results, and a changelog.

## 1. Persistent Storage (Vercel Blob)

### API: `/api/predictions.js` — full rewrite
- Use `@vercel/blob` to read/write a single JSON blob `predictions.json`
- **GET** `/api/predictions` — returns all predictions (public, no auth needed)
- **POST** `/api/predictions` — create a new prediction (admin only, check cookie)
- **PATCH** `/api/predictions` — update actualK/result for a prediction by id (admin only)
- **DELETE** `/api/predictions?id=xxx` — delete a prediction (admin only)
- Each prediction object: `{ id, date, pitcherId, pitcherName, pitcherThrows, signal, kHat, bfHat, line, overOdds, underOdds, edge, pOver, grade, confidence, loggedAt, actualK, result }`
- `loggedAt` is server-generated ISO timestamp (proves it was logged before the game)

### Blob structure
- Read: `const { blobs } = await list(); const blob = blobs.find(b => b.pathname === 'predictions.json');` then fetch blob.url
- Or simpler: use `put('predictions.json', JSON.stringify(data), { access: 'public', addRandomSuffix: false })`
- Use `get` to read, merge, then `put` to write back
- This is fine for <1000 predictions per season

### Migration
- On first API hit, if blob doesn't exist, create empty `{ predictions: [] }`
- The existing localStorage predictions in Adam's browser should be importable (add a one-time admin endpoint or just have the client POST them)

## 2. Admin Auth

### API: `/api/admin.js` — new
- **POST** `/api/admin` with body `{ secret }` 
- If `secret === process.env.ADMIN_SECRET`, set httpOnly cookie `whiff_admin` with value = a signed token (or just the secret hash) that expires in 30 days
- Return `{ ok: true }`
- If wrong secret, return 401

### Admin cookie checking
- Create a helper `lib/auth.js`: `isAdmin(req)` checks for the `whiff_admin` cookie
- All write endpoints (POST/PATCH/DELETE predictions, POST changelog) check `isAdmin(req)`

### Client-side admin detection
- **GET** `/api/admin` — returns `{ isAdmin: true/false }` based on cookie presence
- Client calls this on mount to determine if admin UI should show
- URL trigger: visiting `/?admin=whiff_pix_z0z6` calls the POST endpoint automatically to set the cookie, then redirects to `/`

## 3. Frontend Changes to `pages/index.jsx`

### Admin mode
- On mount, fetch `/api/admin` to check admin status
- If admin: show "Log Projection" buttons (existing behavior)
- If not admin: hide all log buttons, hide admin controls
- The prediction logging now POSTs to `/api/predictions` instead of localStorage

### Public prediction count
- Show logged prediction count in the header (fetched from API, not localStorage)
- The 📊 results link is always visible to everyone

## 4. Results Page (`pages/results.jsx`) — major update

### Data source
- Fetch from `/api/predictions` on mount instead of localStorage
- Admin users see the editable "Actual" column (same click-to-edit behavior)
- Non-admin users see the Actual column as read-only
- The PATCH to update actualK now hits `/api/predictions`

### Public display enhancements
- Add "loggedAt" timestamp to each prediction row (shows when prediction was made, proving pre-game logging)
- Add a header banner: "All predictions are logged before first pitch. Timestamps are server-generated."
- Keep all existing stats: hit rate, ROI, units, record, performance by grade, calibration

## 5. Changelog Page (`pages/changelog.jsx`) — new

### Storage
- Vercel Blob: `changelog.json` — array of `{ id, date, category, title, body, createdAt }`
- Categories: 'Algorithm', 'UI', 'Data', 'Launch', 'General'

### API: `/api/changelog.js` — new
- **GET** — public, returns all entries sorted newest first
- **POST** — admin only, adds a new entry

### Page layout
- Dark background matching the site theme
- Timeline/vertical list layout
- Each entry: colored category tag + date + title (bold) + body (markdown-rendered or plain text)
- Category colors: Algorithm=#8b5cf6, UI=#3b82f6, Data=#16a34a, Launch=#f59e0b, General=#64748b

### Admin: inline "Add Entry" form at the top (only visible to admins)
- Fields: category dropdown, title, body (textarea)
- Submit POSTs to API

## 6. Mobile Optimization

### Pitcher cards (`pages/index.jsx`)
- The game card's pitcher side-by-side layout: on screens < 640px, stack vertically (one pitcher per row)
- Add a CSS media query or use a `useMediaQuery` hook to detect mobile
- Signal bar, K bars, confidence widget all already stack fine (they're full-width within the panel)

### Header
- On mobile, collapse the date nav + refresh + results link into a more compact layout
- Reduce header padding on mobile

### Results page
- Table scrolls horizontally on mobile (already has overflowX: auto)
- Summary cards: 2 columns on mobile instead of auto-fill

### General
- Touch targets: minimum 44px height for tappable elements
- Font sizes: minimum 12px for body text on mobile (no 9px labels on critical info)

## 7. Implementation Order
1. Install `@vercel/blob` — `npm install @vercel/blob`
2. Create `lib/auth.js` (admin cookie helper)
3. Rewrite `pages/api/predictions.js` (blob-backed CRUD)
4. Create `pages/api/admin.js` (auth endpoint)
5. Create `pages/api/changelog.js` (changelog CRUD)
6. Update `pages/index.jsx` (admin detection, API-based logging, mobile layout)
7. Update `pages/results.jsx` (API-based data, admin-only editing, loggedAt display, public banner)
8. Create `pages/changelog.jsx` (new page)
9. Mobile CSS/responsive tweaks throughout
10. Test build, deploy

## IMPORTANT RULES
- Do NOT change any projection algorithm logic (lib/projection.js, lib/model-config.js)
- Do NOT change any data-fetching API routes (schedule, pitcher, lineup, props, etc.)
- The admin secret is in env var ADMIN_SECRET — never expose it client-side except through the cookie-setting flow
- Server-generated timestamps only for loggedAt (never trust client timestamps)
- All Vercel Blob operations use the BLOB_READ_WRITE_TOKEN env var that's auto-available
