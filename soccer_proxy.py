from flask import Flask, jsonify, request
from flask_cors import CORS
import requests, time, re
from datetime import datetime, timezone

app = Flask(__name__)
CORS(app, origins="*")

API_FOOTBALL_KEY = "66cdfb9fbac6ef56e690a489b590584c"
AFL  = "https://v3.football.api-sports.io"
OLDB = "https://api.openligadb.de"
ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer"
CACHE = {}
TTL = {"live":30,"stand":300,"fix":120,"news":180,"score":300}

LEAGUES = {"39":"Premier League","140":"La Liga","135":"Serie A","78":"Bundesliga","61":"Ligue 1","2":"Champions League","3":"Europa League"}

def _cached(key,ttl_key,fn):
    now=time.time()
    if key in CACHE:
        ts,val=CACHE[key]
        if now-ts<TTL[ttl_key]: return val
    val=fn(); CACHE[key]=(now,val); return val

def _get(url,params=None,headers=None,timeout=12):
    h={"User-Agent":"Mozilla/5.0 Chrome/124.0","Accept":"application/json"}
    if headers: h.update(headers)
    r=requests.get(url,params=params,headers=h,timeout=timeout)
    r.raise_for_status(); return r.json()

def _afl(path,params=None):
    return _get(f"{AFL}{path}",params=params,headers={"x-rapidapi-key":API_FOOTBALL_KEY,"x-rapidapi-host":"v3.football.api-sports.io"})

def _espn_status(s):
    return {"in":"live","inprogress":"live","pre":"upcoming","scheduled":"upcoming","post":"finished","final":"finished"}.get(s.lower(),s.lower() or "unknown")

def _parse_fixture(f):
    fix=f.get("fixture",{}); teams=f.get("teams",{}); goals=f.get("goals",{})
    score=f.get("score",{}); league=f.get("league",{}); status=fix.get("status",{})
    events=f.get("events") or []
    ht=score.get("halftime") or {}; ft=score.get("fulltime") or {}
    et=score.get("extratime") or {}; pk=score.get("penalty") or {}
    parts=[]
    if ft.get("home") is not None: parts.append(f"FT {ft['home']}-{ft['away']}")
    if ht.get("home") is not None: parts.append(f"HT {ht['home']}-{ht['away']}")
    if et.get("home") is not None: parts.append(f"ET {et['home']}-{et['away']}")
    if pk.get("home") is not None: parts.append(f"PEN {pk['home']}-{pk['away']}")
    home_sc,away_sc=[],[]
    for ev in events:
        if ev.get("type") in ("Goal","goal"):
            tid=(ev.get("team") or {}).get("id")
            pl=(ev.get("player") or {}).get("name","")
            mn=ev.get("time",{}).get("elapsed","")
            entry=f"{pl} {mn}'"
            if tid==teams.get("home",{}).get("id"): home_sc.append(entry)
            else: away_sc.append(entry)
    raw=status.get("short","NS")
    if raw in ("1H","2H","HT","ET","BT","P","SUSP","INT","LIVE"): mapped="live"
    elif raw in ("FT","AET","PEN"): mapped="finished"
    elif raw in ("NS","TBD"): mapped="upcoming"
    else: mapped=raw.lower()
    return {"id":fix.get("id"),"competition":league.get("name",""),"league_id":str(league.get("id","")),"league_logo":league.get("logo",""),"round":league.get("round",""),"home":teams.get("home",{}).get("name","TBD"),"away":teams.get("away",{}).get("name","TBD"),"home_logo":teams.get("home",{}).get("logo",""),"away_logo":teams.get("away",{}).get("logo",""),"home_score":goals.get("home"),"away_score":goals.get("away"),"score_detail":" | ".join(parts),"home_scorers":home_sc,"away_scorers":away_sc,"status":mapped,"status_text":status.get("long",raw),"status_short":raw,"minute":status.get("elapsed"),"time":fix.get("date",""),"venue":(fix.get("venue") or {}).get("name",""),"city":(fix.get("venue") or {}).get("city",""),"source":"api-football"}

@app.route("/api/live")
def live():
    results=[]
    try:
        data=_cached("live_afl","live",lambda:_afl("/fixtures",{"live":"all"}))
        results=[_parse_fixture(f) for f in (data.get("response") or [])]
    except Exception as e: print(f"AFL live: {e}")
    try:
        oldb=_cached("live_oldb","live",lambda:_get(f"{OLDB}/getmatchdata/bl1"))
        for m in (oldb or []):
            g=(m.get("MatchResults") or [{}])[0]
            home=m.get("Team1",{}); away=m.get("Team2",{})
            fin=m.get("MatchIsFinished",False)
            status="finished" if fin else "upcoming"
            md=m.get("MatchDateTimeUTC","")
            if not fin and md:
                try:
                    dt=datetime.fromisoformat(md.replace("Z","+00:00"))
                    mins=(datetime.now(timezone.utc)-dt).total_seconds()/60
                    if 0<mins<120: status="live"
                except: pass
            results.append({"id":m.get("MatchID"),"competition":"Bundesliga","league_id":"78","home":home.get("TeamName","TBD"),"away":away.get("TeamName","TBD"),"home_logo":home.get("TeamIconUrl",""),"away_logo":away.get("TeamIconUrl",""),"home_score":g.get("PointsTeam1"),"away_score":g.get("PointsTeam2"),"status":status,"status_text":"Full Time" if fin else "Scheduled","time":md,"venue":"","source":"openligadb"})
    except Exception as e: print(f"OLDB: {e}")
    return jsonify({"matches":results,"updated":datetime.now(timezone.utc).isoformat()})

@app.route("/api/fixtures")
def fixtures():
    lg=request.args.get("league","39"); nx=request.args.get("next","20")
    try:
        data=_cached(f"fix_{lg}","fix",lambda:_afl("/fixtures",{"league":lg,"season":datetime.now().year,"next":nx}))
        return jsonify({"matches":[_parse_fixture(f) for f in (data.get("response") or [])]})
    except Exception as e: return jsonify({"error":str(e),"matches":[]}),500

@app.route("/api/standings")
def standings():
    lg=request.args.get("league","39")
    if lg=="78":
        try:
            data=_cached("stand_78","stand",lambda:_get(f"{OLDB}/getbltable/bl1/2024"))
            rows=[{"rank":i+1,"name":t.get("TeamName",""),"logo":t.get("TeamIconUrl",""),"played":t.get("Matches",0),"won":t.get("Won",0),"drawn":t.get("Draw",0),"lost":t.get("Lost",0),"gf":t.get("Goals",0),"ga":t.get("OpponentGoals",0),"gd":t.get("GoalDiff",0),"points":t.get("Points",0),"form":""} for i,t in enumerate(data or [])]
            return jsonify({"standings":rows,"league":"Bundesliga","source":"openligadb","updated":datetime.now(timezone.utc).isoformat()})
        except Exception as e: return jsonify({"error":str(e),"standings":[]}),500
    try:
        def fetch():
            data=_afl("/standings",{"league":lg,"season":datetime.now().year})
            rows=[]
            for group in (data.get("response") or []):
                for tbl in (group.get("league",{}).get("standings") or []):
                    for t in tbl:
                        tm=t.get("team",{}); a=t.get("all",{}); g=a.get("goals",{})
                        rows.append({"rank":t.get("rank"),"name":tm.get("name",""),"logo":tm.get("logo",""),"played":a.get("played",0),"won":a.get("win",0),"drawn":a.get("draw",0),"lost":a.get("lose",0),"gf":g.get("for",0),"ga":g.get("against",0),"gd":t.get("goalsDiff",0),"points":t.get("points",0),"form":t.get("form",""),"description":t.get("description","")})
            return rows
        rows=_cached(f"stand_{lg}","stand",fetch)
        return jsonify({"standings":rows,"league":LEAGUES.get(lg,lg),"source":"api-football","updated":datetime.now(timezone.utc).isoformat()})
    except Exception as e: return jsonify({"error":str(e),"standings":[]}),500

@app.route("/api/topscorers")
def topscorers():
    lg=request.args.get("league","39")
    try:
        def fetch():
            data=_afl("/players/topscorers",{"league":lg,"season":datetime.now().year})
            out=[]
            for entry in (data.get("response") or []):
                p=entry.get("player",{}); st=(entry.get("statistics") or [{}])[0]
                gls=st.get("goals",{}); gms=st.get("games",{})
                out.append({"name":p.get("name",""),"photo":p.get("photo",""),"team":(st.get("team") or {}).get("name",""),"team_logo":(st.get("team") or {}).get("logo",""),"goals":gls.get("total") or 0,"assists":gls.get("assists") or 0,"apps":gms.get("appearences") or 0})
            return out
        return jsonify({"scorers":_cached(f"sc_{lg}","stand",fetch),"updated":datetime.now(timezone.utc).isoformat()})
    except Exception as e: return jsonify({"error":str(e),"scorers":[]}),500

INJURY_RE=re.compile(r"\b(injur|suspend|ban|red.card|out|miss|withdraw|sidelined|strain|surgery)\b",re.I)

@app.route("/api/news")
def news():
    def fetch():
        arts=[]
        for slug in ("eng.1","esp.1","ger.1","ita.1","fra.1","uefa.champions"):
            try:
                raw=_get(f"{ESPN}/{slug}/news",params={"limit":10})
                for item in (raw.get("articles") or []):
                    hl=item.get("headline",""); desc=item.get("description") or item.get("abstract") or ""
                    imgs=item.get("images") or []; links=item.get("links") or {}
                    url=(links.get("web") or links.get("mobile") or {}).get("href","")
                    arts.append({"id":item.get("id"),"headline":hl,"description":desc,"published":item.get("published",""),"url":url,"image":imgs[0].get("url","") if imgs else "","league":slug,"is_injury":bool(INJURY_RE.search(f"{hl} {desc}"))})
            except Exception as e: print(f"news {slug}: {e}")
        seen,out=set(),[]
        for a in sorted(arts,key=lambda x:x["published"],reverse=True):
            if a["headline"] not in seen: seen.add(a["headline"]); out.append(a)
        return {"articles":out[:40],"updated":datetime.now(timezone.utc).isoformat()}
    return jsonify(_cached("news","news",fetch))

@app.route("/api/health")
def health():
    return jsonify({"status":"ok","has_key":bool(API_FOOTBALL_KEY),"time":datetime.now(timezone.utc).isoformat()})

if __name__=="__main__":
    print("="*50)
    print("  Soccer Proxy  |  http://localhost:5000")
    print("  Key: active" if API_FOOTBALL_KEY else "  Key: MISSING")
    print("="*50)
    app.run(port=5000,host="0.0.0.0",debug=False)
