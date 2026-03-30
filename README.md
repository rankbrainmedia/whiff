# The Whiff ⚾
### Pitcher Strikeout Intelligence — thewhiff.ai

A baseball pitcher strikeout analytics platform for serious bettors.

## Data Sources
- **MLB Stats API** — free, official MLB data (schedule, game logs, team stats, probable pitchers)
- **Baseball Savant via pybaseball** — free Statcast data (whiff rate, pitch mix, bat vs. pitcher)
- **The Odds API** — live FanDuel/DraftKings K prop lines (~$79/mo)

## Stack
- Next.js 14 (React frontend + API routes)
- Python serverless function on Vercel (pybaseball)
- Deployed on Vercel

---

## Setup

### 1. Clone & install
```bash
git clone https://github.com/YOUR_USERNAME/thewhiff
cd thewhiff
npm install
```

### 2. Environment variables
Create `.env.local`:
```
ODDS_API_KEY=your_key_from_the-odds-api.com
```
The tool works without this — you just won't see prop lines until it's set.

### 3. Run locally
```bash
npm run dev
```
Open http://localhost:3000

---

## Deploy to Vercel

### One-time setup
```bash
npm i -g vercel
vercel login
vercel --prod
```

### Set env var in Vercel dashboard
Settings → Environment Variables → Add `ODDS_API_KEY`

### Python runtime
Vercel automatically detects `api/savant.py` and runs it as a Python 3.9 serverless function.
The `requirements.txt` in the root is used to install pybaseball dependencies.

---

## API Routes

| Route | Description |
|---|---|
| `GET /api/schedule?date=YYYY-MM-DD` | Today's games + probable pitchers |
| `GET /api/pitcher/[id]?opposingTeamId=XXX` | Pitcher stats, game log, vs-team splits |
| `GET /api/teams` | All 30 teams ranked by strikeouts |
| `GET /api/props` | Live K prop lines from FanDuel/DraftKings |
| `GET /api/savant?type=pitcher_profile&mlbam_id=XXX` | FanGraphs SwStr%, K%, FIP |
| `GET /api/savant?type=vs_batter&pitcher_id=XXX` | Statcast whiff rate, pitch mix |
| `GET /api/savant?type=team_k_pct&season=2026` | Team K% from FanGraphs |

---

## Upgrading to Sportradar
When you're ready to upgrade beyond the free stack:
1. Sign up at marketplace.sportradar.com
2. Get MLB v8 + Statcast access
3. Replace `lib/mlb.js` calls with Sportradar endpoints
4. Replace `api/savant.py` whiff rate with Sportradar's native SwStr% fields

The frontend doesn't need to change — just swap the data sources.

---

## Monetization (coming soon)
- Stripe subscription ($49/mo)
- Auth via NextAuth.js
- User dashboard with pick history
- Email digest via Resend
