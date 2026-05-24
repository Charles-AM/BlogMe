from flask import Flask, jsonify
from flask_cors import CORS
import requests, time, re
from datetime import datetime, timezone

app = Flask(__name__)
CORS(app, origins="*")

ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/tennis"
CACHE = {}
CACHE_TTL = {"rankings": 3600, "calendar": 3600, "news": 300, "player": 600, "matches": 45}

def _cached(key, ttl_key, fetch_fn):
    now = time.time()
    if key in CACHE:
        ts, data = CACHE[key]
        if now - ts < CACHE_TTL[ttl_key]:
            return data
    data = fetch_fn()
    CACHE[key] = (now, data)
    return data

def _get(url, params=None, timeout=10):
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Origin": "https://www.espn.com",
        "Referer": "https://www.espn.com/",
    }
    r = requests.get(url, params=params, headers=headers, timeout=timeout)
    r.raise_for_status()
    return r.json()

def _espn_status(name):
    return {"in":"live","inprogress":"live","pre":"upcoming","scheduled":"upcoming","post":"finished","final":"finished"}.get(name.lower(), name.lower() or "unknown")

def _fetch_espn_matches():
    events = []
    for league in ("atp-tennis", "wta-tennis"):
        try:
            sb = _get(f"{ESPN_BASE}/{league}/scoreboard", params={"limit": 50})
        except Exception:
            continue
        for ev in sb.get("events", []):
            comps = ev.get("competitions", [{}])
            comp = comps[0] if comps else {}
            competitors = comp.get("competitors", [])
            home = next((c for c in competitors if c.get("homeAway") == "home"), competitors[0] if competitors else {})
            away = next((c for c in competitors if c.get("homeAway") == "away"), competitors[1] if len(competitors) > 1 else {})
            status_type = ev.get("status", {}).get("type", {})
            events.append({
                "id": ev.get("id"),
                "competition": ev.get("name") or ev.get("shortName", ""),
                "home": (home.get("athlete") or home.get("team") or {}).get("displayName", "TBD"),
                "away": (away.get("athlete") or away.get("team") or {}).get("displayName", "TBD"),
                "home_score": home.get("score"),
                "away_score": away.get("score"),
                "home_logo": (home.get("team") or {}).get("logo", ""),
                "away_logo": (away.get("team") or {}).get("logo", ""),
                "status": _espn_status(status_type.get("name", "")),
                "status_text": status_type.get("shortDetail") or status_type.get("description") or "",
                "time": ev.get("date", ""),
                "url": ((ev.get("links") or [{}])[0].get("href") or ""),
                "venue": ev.get("venue", {}).get("fullName", ""),
            })
    return events

@app.route("/api/matches")
def matches():
    try:
        raw = _get("https://sportscore.com/api/widget/matches/?sport=tennis&limit=50")
        return jsonify({"source": "sportscore", "data": raw, "updated": datetime.now(timezone.utc).isoformat()})
    except Exception:
        pass
    try:
        events = _cached("espn_matches", "matches", _fetch_espn_matches)
        return jsonify({"source": "espn", "matches": events, "updated": datetime.now(timezone.utc).isoformat()})
    except Exception as e:
        return jsonify({"error": str(e)}), 502

def _fetch_rankings(tour):
    league = "atp-tennis" if tour == "atp" else "wta-tennis"
    try:
        raw = _get(f"{ESPN_BASE}/{league}/rankings")
    except Exception as e:
        return {"error": str(e), "rows": []}
    entries = []
    for group in raw.get("rankings", []):
        entries.extend(group.get("entries", []))
    rows = []
    for entry in entries:
        athlete = entry.get("athlete", {})
        rows.append({
            "rank": entry.get("currentRank") or entry.get("rank") or "",
            "name": athlete.get("displayName") or "Unknown",
            "country": athlete.get("citizenship") or "-",
            "points": entry.get("points") or entry.get("rankingPoints") or "-",
            "age": athlete.get("age") or "-",
            "turned_pro": athlete.get("turnedPro") or "-",
            "headshot": athlete.get("headshot", {}).get("href") or "",
        })
    rows.sort(key=lambda r: int(r["rank"]) if str(r["rank"]).isdigit() else 9999)
    return {"tour": tour.upper(), "updated": datetime.now(timezone.utc).isoformat(), "rows": rows}

@app.route("/api/espn/rankings/atp")
def atp_rankings():
    return jsonify(_cached("rankings_atp", "rankings", lambda: _fetch_rankings("atp")))

@app.route("/api/espn/rankings/wta")
def wta_rankings():
    return jsonify(_cached("rankings_wta", "rankings", lambda: _fetch_rankings("wta")))

@app.route("/api/espn/news")
def tennis_news():
    def fetch():
        injury_re = re.compile(r"\b(injur|withdraw|retir|illness|hurt|surgery|wrist|knee|back|ankle|shoulder|elbow|strain|sprain|sidelined)\b", re.I)
        try:
            raw = _get("https://site.api.espn.com/apis/site/v2/sports/tennis/news", params={"limit": 40})
        except Exception as e:
            return {"error": str(e), "articles": []}
        articles = []
        for item in raw.get("articles", []):
            headline = item.get("headline", "")
            desc = item.get("description") or item.get("abstract") or ""
            articles.append({
                "id": item.get("id"),
                "headline": headline,
                "description": desc,
                "published": item.get("published") or "",
                "url": item.get("links", {}).get("web", {}).get("href") or "",
                "image": (item.get("images", [{}])[0].get("url") or "") if item.get("images") else "",
                "category": item.get("categories", [{}])[0].get("description") or "Tennis",
                "is_injury": bool(injury_re.search(f"{headline} {desc}")),
            })
        return {"updated": datetime.now(timezone.utc).isoformat(), "articles": articles}
    return jsonify(_cached("news", "news", fetch))

@app.route("/api/espn/player/<path:name>")
def player_info(name):
    def fetch():
        try:
            raw = _get("https://site.api.espn.com/apis/common/v3/search", params={"query": name, "sport": "tennis", "limit": 5})
        except Exception as e:
            return {"error": str(e)}
        athlete_id = None
        for result in raw.get("results", []):
            for item in result.get("contents", []):
                if item.get("type") == "athlete":
                    athlete_id = item.get("id"); break
            if athlete_id: break
        if not athlete_id:
            return {"name": name, "found": False}
        try:
            bio = _get(f"https://site.web.api.espn.com/apis/common/v3/sports/tennis/athletes/{athlete_id}")
        except Exception as e:
            return {"name": name, "found": False, "error": str(e)}
        a = bio.get("athlete", {})
        return {"found": True, "name": a.get("displayName", name), "country": a.get("citizenship") or "-",
                "age": a.get("age") or "-", "height": a.get("displayHeight") or "-",
                "turned_pro": a.get("turnedPro") or "-", "ranking": a.get("rank") or "-",
                "plays": a.get("hand") or "-", "headshot": a.get("headshot", {}).get("href") or "",
                "bio": a.get("description") or ""}
    return jsonify(_cached(f"player_{name.lower()}", "player", fetch))

@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "time": datetime.now(timezone.utc).isoformat()})

if __name__ == "__main__":
    print("=" * 50)
    print("  Tennis Proxy  |  http://localhost:5000")
    print("=" * 50)
    app.run(port=5000, debug=False, host="0.0.0.0")
