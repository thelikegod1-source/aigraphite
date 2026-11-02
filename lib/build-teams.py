# Builds public/teams/<CODE>.json from aggregated box scores (agg.json).
# Each entry: n=name, r=rating (best season with that franchise), s=stat line, y=years with the team.
import json, sys, collections
d = json.load(open(sys.argv[1]))
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
    out[fr].append({"n": d["names"][pid], "r": rating, "s": f"{p:.1f} pts · {r:.1f} reb · {a:.1f} ast ({best[0]-1}-{str(best[0])[-2:]})", "y": yr})
import os
os.makedirs(sys.argv[2], exist_ok=True)
for fr, lst in out.items():
    lst.sort(key=lambda x: -x["r"])
    json.dump(lst, open(f"{sys.argv[2]}/{fr}.json", "w"), separators=(",", ":"))
print({k: len(v) for k, v in sorted(out.items())})
for fr in ["LAL", "CHI", "SAC", "OKC"]: print(fr, [(x["n"], x["r"]) for x in out[fr][:6]], "...", [(x["n"], x["r"]) for x in out[fr][100:103]])
