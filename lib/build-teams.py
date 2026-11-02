# Builds public/teams/<CODE>.json from aggregated box scores (agg.json).
# Each entry: n=name, r=rating (best season with that franchise), s=stat line, y=years with the team.
import json, sys, collections, csv
d = json.load(open(sys.argv[1]))
# Listed positions + heights (common_player_info.csv): id -> ("Guard-Forward", inches)
INFO = {}
if len(sys.argv) > 3:
    for row in csv.DictReader(open(sys.argv[3])):
        h = row.get('height (ft"in)', "") or ""
        try: ft, inch = h.split('"'); inches = int(ft) * 12 + int(inch or 0)
        except Exception: inches = 0
        INFO[row["PlayerID"]] = (row.get("position", "") or "", inches)

def positions(pid, p, r, a):
    """Main position first, then the other spots he can fill. Guards fit PG/SG, forwards SF/PF, centers C."""
    pos, h = INFO.get(pid, ("", 0))
    parts = set(x.strip() for x in pos.split("-") if x.strip())
    ratio = a / p if p else 0
    def guard():  # a point guard runs the offense: lots of assists for how much he scores
        return "PG" if a >= 9 or (a >= 6 and ratio >= .3) or (h and h <= 74 and a >= 3) or (h and h <= 75 and a >= 4 and ratio >= .28) else "SG"
    def forward():
        return "PF" if r >= 8 and a < 5 or (h and h >= 81 and a < 5) or (r >= 6.5 and a < 4 and (not h or h >= 80)) else "SF"
    if not parts:  # no listing: judge from the stat line
        parts = {"Center"} if r >= 9 and a < 3 else {"Guard"} if a >= 4.5 or (a >= 2.5 and r < 6) else {"Forward"} if r >= 5.5 else {"Guard"}
    if parts == {"Guard"}: g = guard(); return [g, "SG" if g == "PG" else "PG"]
    if parts == {"Forward"}: f = forward(); return [f, "PF" if f == "SF" else "SF"]
    if parts == {"Center"}: return ["C"]
    if parts == {"Guard", "Forward"}:
        main = guard() if (h and h <= 78) or a >= 8 or not h else "SF"
        return list(dict.fromkeys([main, "SG", "SF"] + (["PG"] if main == "PG" else [])))
    if parts == {"Forward", "Center"}:
        main = "C" if r >= 10 or (h and h >= 83) else "PF"
        return list(dict.fromkeys([main, "PF", "C"]))
    return ["SF", "PF"]

FR = {"Atlanta Hawks":"ATL","Milwaukee Hawks":"ATL","St. Louis Hawks":"ATL","Tri-Cities Blackhawks":"ATL","Boston Celtics":"BOS",
 "Brooklyn Nets":"BKN","New Jersey Nets":"BKN","New York Nets":"BKN","Charlotte Bobcats":"CHA","Charlotte Hornets":"CHA",
 "Chicago Bulls":"CHI","Cleveland Cavaliers":"CLE","Dallas Mavericks":"DAL","Denver Nuggets":"DEN","Detroit Pistons":"DET",
 "Ft. Wayne Zollner Pistons":"DET","Golden State Warriors":"GSW","Philadelphia Warriors":"GSW","San Francisco Warriors":"GSW",
 "Houston Rockets":"HOU","San Diego Rockets":"HOU","Indiana Pacers":"IND","Los Angeles Clippers":"LAC","San Diego Clippers":"LAC",
 "Buffalo Braves":"LAC","Los Angeles Lakers":"LAL","Minneapolis Lakers":"LAL","Memphis Grizzlies":"MEM","Vancouver Grizzlies":"MEM",
 "Miami Heat":"MIA","Milwaukee Bucks":"MIL","Minnesota Timberwolves":"MIN","New Orleans Hornets":"NOP","Oklahoma City Hornets":"NOP",
 "New Orleans Pelicans":"NOP","New York Knicks":"NYK","Oklahoma City Thunder":"OKC","Seattle SuperSonics":"OKC","Orlando Magic":"ORL",
 "Philadelphia 76ers":"PHI","Syracuse Nationals":"PHI","Phoenix Suns":"PHX","Portland Trail Blazers":"POR","Sacramento Kings":"SAC",
 "Kansas City Kings":"SAC","Kansas City-Omaha Kings":"SAC","Cincinnati Royals":"SAC","Rochester Royals":"SAC","San Antonio Spurs":"SAS",
 "Toronto Raptors":"TOR","Utah Jazz":"UTA","New Orleans Jazz":"UTA","Washington Wizards":"WAS","Washington Bullets":"WAS",
 "Capital Bullets":"WAS","Chicago Packers":"WAS","Chicago Zephyrs":"WAS","Baltimore Bullets":"WAS"}
by = collections.defaultdict(list)  # (fr, pid) -> seasons
for pid, team, season, g, mins, pts, reb, ast, stl, blk, fgm, fga, ftm, fta, tov in d["rows"]:
    if team == "Baltimore Bullets" and season < 1960: continue  # the 1940s-50s Bullets folded
    fr = FR.get(team)
    if fr and g > 0: by[(fr, pid)].append((season, g, mins, pts, reb, ast, stl, blk, fgm, fga, ftm, fta, tov))
def rate(s):
    season, g, mins, pts, reb, ast, stl, blk, fgm, fga, ftm, fta, tov = s
    p, r, a, st, b, to = (x / g for x in (pts, reb, ast, stl, blk, tov))
    tsa = 2 * (fga + .44 * fta); ts = pts / tsa if tsa else 0
    shots_ok = fga > 0 and fgm <= fga and 0.3 < ts < 0.8
    score = p + .9 * r + 1.4 * a + 1.6 * st + 1.6 * b - .7 * to + ((ts - .54) * p if shots_ok else 0)
    if r == 0 and a < 1 and p > 3: score = p * 1.45  # early box scores have no rebounds/assists; estimate from scoring
    return score, p, r, a, ts
out = collections.defaultdict(list)
for (fr, pid), seasons in by.items():
    games = sum(s[1] for s in seasons)
    ok = [s for s in seasons if s[1] >= 20] or [max(seasons, key=lambda s: s[1])]
    best = max(ok, key=lambda s: rate(s)[0])
    sc, p, r, a, ts = rate(best)
    if best[1] < 20: sc *= best[1] / 20  # short stints count less
    rating = round(max(0, sc) + min(games, 800) / 160, 1)
    yrs = sorted(s[0] for s in seasons)
    yr = f"{yrs[0]-1}–{str(yrs[-1])[-2:]}" if yrs[0] != yrs[-1] else f"{yrs[0]-1}–{str(yrs[0])[-2:]}"
    pos = positions(pid, p, r, a)
    out[fr].append({"n": d["names"][pid], "p": pos, "r": rating, "s": f"{p:.1f} pts · {r:.1f} reb · {a:.1f} ast ({best[0]-1}-{str(best[0])[-2:]})", "y": yr})
import os
os.makedirs(sys.argv[2], exist_ok=True)
for fr, lst in out.items():
    lst.sort(key=lambda x: -x["r"])
    json.dump(lst, open(f"{sys.argv[2]}/{fr}.json", "w"), separators=(",", ":"))
print({k: len(v) for k, v in sorted(out.items())})
for fr in ["LAL", "CHI", "GSW"]: print(fr, [(x["n"], "/".join(x["p"])) for x in out[fr][:12]])
allp = [x for v in out.values() for x in v]; print("primary counts", collections.Counter(x["p"][0] for x in allp), "listed:", sum(1 for v in by for _ in [0]) )
