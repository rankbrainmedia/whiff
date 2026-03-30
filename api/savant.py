# api/savant.py
# Vercel Python serverless function
# Pulls from Baseball Savant via pybaseball — free Statcast data
# Endpoints:
#   GET /api/savant?type=pitcher_profile&mlbam_id=123
#   GET /api/savant?type=vs_batter&pitcher_id=123&batter_id=456
#   GET /api/savant?type=team_k_pct&team=NYY&season=2026

import json
import sys
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from datetime import datetime, timedelta

try:
    import pybaseball as pb
    import pandas as pd
    pb.cache.enable()
    PYBASEBALL_AVAILABLE = True
except ImportError:
    PYBASEBALL_AVAILABLE = False


def get_pitcher_profile(mlbam_id: int, season: int) -> dict:
    """
    Pull pitcher Statcast metrics for the season:
    - SwStr% (swinging strike rate) — the free version of whiff rate
    - K% (strikeout rate)
    - CSW% (called + swinging strikes)
    - Velocity, spin rate
    """
    if not PYBASEBALL_AVAILABLE:
        return {"error": "pybaseball not available"}

    try:
        # FanGraphs pitching stats — includes SwStr%, K%, BB%, CSW%
        fg = pb.pitching_stats(season, season, qual=1)
        if fg is None or fg.empty:
            return {"error": "No FanGraphs data"}

        # Match by MLBAM ID — FanGraphs uses its own ID, need crosswalk
        # pybaseball's playerid_reverse_lookup handles this
        player_info = pb.playerid_reverse_lookup([mlbam_id], key_type='mlbam')
        if player_info.empty:
            return {"error": f"Player {mlbam_id} not found in lookup"}

        fg_id = int(player_info.iloc[0]['key_fangraphs'])
        player_row = fg[fg['IDfg'] == fg_id]

        if player_row.empty:
            return {"error": f"No FanGraphs stats for player {fg_id}"}

        p = player_row.iloc[0]

        return {
            "name": p.get('Name', ''),
            "team": p.get('Team', ''),
            "season": season,
            "k_pct": round(float(p['K%']) * 100, 1) if 'K%' in p else None,
            "bb_pct": round(float(p['BB%']) * 100, 1) if 'BB%' in p else None,
            "swstr_pct": round(float(p['SwStr%']) * 100, 1) if 'SwStr%' in p else None,
            "csw_pct": round(float(p['CSW%']) * 100, 1) if 'CSW%' in p and p['CSW%'] is not None else None,
            "era": float(p['ERA']) if 'ERA' in p else None,
            "fip": float(p['FIP']) if 'FIP' in p else None,
            "k_per9": float(p['K/9']) if 'K/9' in p else None,
            "velocity": float(p['vFB']) if 'vFB' in p else None,
            "innings": float(p['IP']) if 'IP' in p else None,
            "games_started": int(p['GS']) if 'GS' in p else None,
            "source": "FanGraphs via pybaseball",
        }

    except Exception as e:
        return {"error": str(e)}


def get_vs_batter_splits(pitcher_mlbam: int, season: int) -> dict:
    """
    Get pitcher performance vs LHB and RHB this season from Statcast.
    Also pulls batter K% for lineup analysis.
    """
    if not PYBASEBALL_AVAILABLE:
        return {"error": "pybaseball not available"}

    try:
        start = f"{season}-03-01"
        end = datetime.now().strftime("%Y-%m-%d")

        # Statcast pitcher data — pitch-level, filter to this pitcher
        df = pb.statcast_pitcher(start, end, pitcher_mlbam)
        if df is None or df.empty:
            return {"error": "No Statcast data found"}

        df = df[df['events'].notna() | df['description'].notna()]

        # Compute swing & miss rate
        swings = df[df['description'].isin(['swinging_strike', 'swinging_strike_blocked',
                                              'foul', 'foul_tip', 'hit_into_play',
                                              'hit_into_play_no_out', 'hit_into_play_score'])]
        whiffs = df[df['description'].isin(['swinging_strike', 'swinging_strike_blocked'])]

        whiff_rate = len(whiffs) / len(swings) if len(swings) > 0 else None

        # Strikeouts
        k_events = df[df['events'] == 'strikeout']

        # Split by batter hand
        vs_lhb = df[df['stand'] == 'L']
        vs_rhb = df[df['stand'] == 'R']

        def whiff_rate_for(subset):
            s = subset[subset['description'].isin(['swinging_strike', 'swinging_strike_blocked',
                'foul', 'foul_tip', 'hit_into_play', 'hit_into_play_no_out', 'hit_into_play_score'])]
            w = subset[subset['description'].isin(['swinging_strike', 'swinging_strike_blocked'])]
            return round(len(w) / len(s) * 100, 1) if len(s) > 0 else None

        # Pitch type breakdown
        pitch_types = []
        if 'pitch_type' in df.columns:
            for pt, group in df.groupby('pitch_type'):
                if pt and len(group) >= 10:
                    pt_swings = group[group['description'].isin([
                        'swinging_strike', 'swinging_strike_blocked', 'foul', 'foul_tip',
                        'hit_into_play', 'hit_into_play_no_out', 'hit_into_play_score'])]
                    pt_whiffs = group[group['description'].isin([
                        'swinging_strike', 'swinging_strike_blocked'])]
                    pitch_types.append({
                        "pitch_type": pt,
                        "count": len(group),
                        "pct": round(len(group) / len(df) * 100, 1),
                        "whiff_rate": round(len(pt_whiffs) / len(pt_swings) * 100, 1) if len(pt_swings) > 0 else None,
                        "avg_velo": round(float(group['release_speed'].mean()), 1) if 'release_speed' in group else None,
                    })

        return {
            "pitcher_mlbam": pitcher_mlbam,
            "season": season,
            "total_pitches": len(df),
            "whiff_rate": round(whiff_rate * 100, 1) if whiff_rate else None,
            "strikeouts": len(k_events),
            "vs_lhb": {
                "pitches": len(vs_lhb),
                "whiff_rate": whiff_rate_for(vs_lhb),
            },
            "vs_rhb": {
                "pitches": len(vs_rhb),
                "whiff_rate": whiff_rate_for(vs_rhb),
            },
            "pitch_mix": sorted(pitch_types, key=lambda x: x['count'], reverse=True)[:6],
            "source": "Baseball Savant via pybaseball",
        }

    except Exception as e:
        return {"error": str(e)}


def get_team_k_pct(season: int) -> dict:
    """
    Team batting K% from FanGraphs — more nuanced than raw K totals.
    Useful for ranking teams by how often they strike out.
    """
    if not PYBASEBALL_AVAILABLE:
        return {"error": "pybaseball not available"}

    try:
        df = pb.team_batting(season, season)
        if df is None or df.empty:
            return {"error": "No team batting data"}

        teams = []
        for _, row in df.iterrows():
            k_pct = float(row['SO']) / float(row['PA']) if row.get('PA', 0) > 0 else None
            teams.append({
                "team": row.get('Team', ''),
                "season": season,
                "strikeouts": int(row['SO']) if 'SO' in row else None,
                "pa": int(row['PA']) if 'PA' in row else None,
                "k_pct": round(k_pct * 100, 1) if k_pct else None,
                "games": int(row['G']) if 'G' in row else None,
                "k_per_game": round(float(row['SO']) / float(row['G']), 2) if row.get('G', 0) > 0 else None,
            })

        # Rank by K% descending (rank 1 = most Ks = easiest for pitcher)
        teams_sorted = sorted(teams, key=lambda x: x.get('k_pct') or 0, reverse=True)
        for i, t in enumerate(teams_sorted):
            t['k_pct_rank'] = i + 1

        return {
            "season": season,
            "teams": teams_sorted,
            "source": "FanGraphs via pybaseball",
        }

    except Exception as e:
        return {"error": str(e)}


class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        def p(key, default=None):
            return params.get(key, [default])[0]

        req_type = p('type')
        season = int(p('season', datetime.now().year))

        result = {}

        if req_type == 'pitcher_profile':
            mlbam_id = p('mlbam_id')
            if not mlbam_id:
                result = {"error": "mlbam_id required"}
            else:
                result = get_pitcher_profile(int(mlbam_id), season)

        elif req_type == 'vs_batter':
            pitcher_id = p('pitcher_id')
            if not pitcher_id:
                result = {"error": "pitcher_id required"}
            else:
                result = get_vs_batter_splits(int(pitcher_id), season)

        elif req_type == 'team_k_pct':
            result = get_team_k_pct(season)

        else:
            result = {
                "error": "Unknown type. Use: pitcher_profile, vs_batter, team_k_pct",
                "pybaseball_available": PYBASEBALL_AVAILABLE,
            }

        body = json.dumps(result).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)
