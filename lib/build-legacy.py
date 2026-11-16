# Spin & Draft ratings: blends box-score stats with how good a player was *known* to be.
#
#   python3 lib/build-legacy.py
#
# Reads the stat-only ratings in lib/teams-stats/*.json (built by build-teams.py), mixes in each player's
# legacy (All-Star picks, All-NBA, MVPs, Finals MVPs, rings, NBA 75th team, Hall of Fame), adds players who joined
# a team after the box-score data ends (March 2025) plus the 2025 and 2026 rookies, and writes public/teams/*.json.
#
# Why: stats alone overrate empty-calorie seasons (Michael Adams as the #3 Nugget ever) and underrate winners.
# A franchise only gets the legacy of a player in proportion to how close his peak there was to his career peak,
# so Shaq is huge for the Lakers but small for the Celtics.
import json, glob, os, collections

HERE = os.path.dirname(os.path.abspath(__file__))
SRC, OUT = os.path.join(HERE, "teams-stats"), os.path.join(HERE, "..", "public", "teams")

# name: (All-Star selections, All-NBA selections, MVPs, Finals MVPs, rings, NBA 75th Anniversary Team, Hall of Fame)
# Career totals through the 2025-26 season. Approximate is fine: this measures reputation, not a stat sheet.
L = {
 # ---- all-time greats
 "Michael Jordan": (14, 11, 5, 6, 6, 1, 1), "LeBron James": (21, 21, 4, 4, 4, 1, 0), "Kareem Abdul-Jabbar": (19, 15, 6, 2, 6, 1, 1),
 "Magic Johnson": (12, 10, 3, 3, 5, 1, 1), "Larry Bird": (12, 10, 3, 2, 3, 1, 1), "Bill Russell": (12, 11, 5, 0, 11, 1, 1),
 "Wilt Chamberlain": (13, 10, 4, 1, 2, 1, 1), "Kobe Bryant": (18, 15, 1, 2, 5, 1, 1), "Tim Duncan": (15, 15, 2, 3, 5, 1, 1),
 "Shaquille O'Neal": (15, 14, 1, 3, 4, 1, 1), "Hakeem Olajuwon": (12, 12, 1, 2, 2, 1, 1), "Stephen Curry": (11, 11, 2, 1, 4, 1, 0),
 "Kevin Durant": (15, 11, 1, 2, 2, 1, 0), "Oscar Robertson": (12, 11, 1, 0, 1, 1, 1), "Jerry West": (14, 12, 0, 1, 1, 1, 1),
 "Julius Erving": (16, 12, 4, 0, 3, 1, 1), "Moses Malone": (13, 8, 3, 1, 1, 1, 1), "Karl Malone": (14, 14, 2, 0, 0, 1, 1),
 "Elgin Baylor": (11, 10, 0, 0, 0, 1, 1), "Bob Pettit": (11, 11, 2, 0, 1, 1, 1), "Dirk Nowitzki": (14, 12, 1, 1, 1, 1, 1),
 "Kevin Garnett": (15, 9, 1, 0, 1, 1, 1), "Giannis Antetokounmpo": (10, 9, 2, 1, 1, 1, 0), "Nikola Jokic": (7, 7, 3, 1, 1, 0, 0),
 "Charles Barkley": (11, 11, 1, 0, 0, 1, 1), "David Robinson": (10, 10, 1, 0, 2, 1, 1), "John Stockton": (10, 11, 0, 0, 0, 1, 1),
 "Isiah Thomas": (12, 5, 0, 1, 2, 1, 1), "Scottie Pippen": (7, 7, 0, 0, 6, 1, 1), "John Havlicek": (13, 11, 0, 1, 8, 1, 1),
 "Allen Iverson": (11, 7, 1, 0, 0, 1, 1), "Dwyane Wade": (13, 8, 0, 1, 3, 1, 1), "Chris Paul": (12, 11, 0, 0, 0, 1, 0),
 "James Harden": (11, 7, 1, 0, 0, 1, 0), "Kawhi Leonard": (6, 6, 0, 2, 2, 1, 0), "Patrick Ewing": (11, 7, 0, 0, 0, 1, 1),
 "George Gervin": (12, 7, 0, 0, 0, 1, 1), "Rick Barry": (12, 6, 0, 1, 1, 1, 1), "Elvin Hayes": (12, 6, 0, 0, 1, 1, 1),
 "Bob Cousy": (13, 12, 1, 0, 6, 1, 1), "Willis Reed": (7, 5, 1, 2, 2, 1, 1), "Walt Frazier": (7, 6, 0, 0, 2, 1, 1),
 "Dominique Wilkins": (9, 7, 0, 0, 0, 1, 1), "Clyde Drexler": (10, 5, 0, 0, 1, 1, 1), "Gary Payton": (9, 9, 0, 0, 1, 1, 1),
 "Jason Kidd": (10, 6, 0, 0, 1, 1, 1), "Steve Nash": (8, 7, 2, 0, 0, 1, 1), "Paul Pierce": (10, 4, 0, 1, 1, 1, 1),
 "Ray Allen": (10, 2, 0, 0, 2, 1, 1), "Reggie Miller": (5, 3, 0, 0, 0, 0, 1), "Russell Westbrook": (9, 9, 1, 0, 0, 1, 0),
 "Anthony Davis": (10, 5, 0, 0, 1, 1, 0), "Damian Lillard": (9, 7, 0, 0, 0, 1, 0), "Carmelo Anthony": (10, 6, 0, 0, 0, 1, 0),
 "Dwight Howard": (8, 8, 0, 0, 1, 0, 0), "Kevin McHale": (7, 1, 0, 0, 3, 1, 1), "Robert Parish": (9, 2, 0, 0, 4, 1, 1),
 "James Worthy": (7, 2, 0, 1, 3, 1, 1), "Dennis Rodman": (2, 2, 0, 0, 5, 1, 1), "Pete Maravich": (5, 4, 0, 0, 0, 1, 1),
 "Nate Archibald": (6, 5, 0, 0, 1, 1, 1), "Dave Cowens": (8, 3, 1, 0, 2, 1, 1), "Wes Unseld": (5, 1, 1, 1, 1, 1, 1),
 "Bill Walton": (2, 2, 1, 1, 2, 1, 1), "Bob McAdoo": (5, 2, 1, 0, 2, 0, 1), "Earl Monroe": (4, 1, 0, 0, 1, 1, 1),
 "Hal Greer": (10, 7, 0, 0, 1, 1, 1), "Sam Jones": (5, 3, 0, 0, 10, 1, 1), "Dave Bing": (7, 3, 0, 0, 0, 1, 1),
 "Dave DeBusschere": (8, 1, 0, 0, 2, 1, 1), "Jerry Lucas": (7, 5, 0, 0, 1, 1, 1), "Lenny Wilkens": (9, 0, 0, 0, 0, 1, 1),
 "Paul Arizin": (10, 4, 0, 0, 1, 1, 1), "Dolph Schayes": (12, 12, 0, 0, 1, 1, 1), "George Mikan": (4, 6, 0, 0, 5, 1, 1),
 "Bob Lanier": (8, 0, 0, 0, 0, 0, 1), "Alex English": (8, 3, 0, 0, 0, 0, 1), "Bernard King": (4, 4, 0, 0, 0, 0, 1),
 "Adrian Dantley": (6, 2, 0, 0, 0, 0, 1), "Artis Gilmore": (6, 0, 0, 0, 0, 0, 1), "Kevin Johnson": (3, 5, 0, 0, 0, 0, 0),
 "Tim Hardaway": (5, 5, 0, 0, 0, 0, 1), "Chris Mullin": (5, 4, 0, 0, 0, 0, 1), "Mitch Richmond": (6, 5, 0, 0, 1, 0, 1),
 "Alonzo Mourning": (7, 2, 0, 0, 1, 0, 1), "Dikembe Mutombo": (8, 3, 0, 0, 0, 0, 1), "Grant Hill": (7, 5, 0, 0, 0, 0, 1),
 "Tracy McGrady": (7, 7, 0, 0, 0, 0, 1), "Vince Carter": (8, 2, 0, 0, 0, 0, 1), "Pau Gasol": (6, 4, 0, 0, 2, 0, 1),
 "Tony Parker": (6, 4, 0, 1, 4, 0, 1), "Manu Ginobili": (2, 2, 0, 0, 4, 0, 1), "Chris Webber": (5, 5, 0, 0, 0, 0, 1),
 "Yao Ming": (8, 5, 0, 0, 0, 0, 1), "Ben Wallace": (4, 5, 0, 0, 1, 0, 1), "Chauncey Billups": (5, 3, 0, 1, 1, 0, 1),
 "Shawn Kemp": (6, 3, 0, 0, 0, 0, 0), "Joe Dumars": (6, 2, 0, 1, 2, 0, 1), "Dennis Johnson": (5, 2, 0, 1, 3, 0, 1),
 "Sidney Moncrief": (5, 5, 0, 0, 0, 0, 1), "Marques Johnson": (5, 3, 0, 0, 0, 0, 1), "Jack Sikma": (7, 0, 0, 0, 1, 0, 1),
 "Gus Williams": (2, 2, 0, 0, 1, 0, 0), "Spencer Haywood": (5, 4, 0, 0, 1, 0, 1), "Walter Davis": (6, 2, 0, 0, 0, 0, 0),
 "Paul Westphal": (5, 4, 0, 0, 1, 0, 1), "Tom Chambers": (4, 2, 0, 0, 0, 0, 0), "Larry Nance": (3, 0, 0, 0, 0, 0, 0),
 "Mark Price": (4, 4, 0, 0, 0, 0, 0), "Brad Daugherty": (5, 1, 0, 0, 0, 0, 0), "Kevin Love": (5, 2, 0, 0, 1, 0, 0),
 "Kyrie Irving": (9, 3, 0, 0, 1, 0, 0), "Kemba Walker": (4, 1, 0, 0, 0, 0, 0), "Larry Johnson": (2, 1, 0, 0, 0, 0, 0),
 "Alonzo Mourning ": (0, 0, 0, 0, 0, 0, 0), "Glen Rice": (3, 1, 0, 0, 1, 0, 0), "Antawn Jamison": (2, 0, 0, 0, 0, 0, 0),
 "Gilbert Arenas": (3, 3, 0, 0, 0, 0, 0), "Peja Stojakovic": (3, 1, 0, 0, 1, 0, 0), "Jermaine O'Neal": (6, 3, 0, 0, 0, 0, 0),
 "Rasheed Wallace": (4, 0, 0, 0, 1, 0, 0), "Amar'e Stoudemire": (6, 5, 0, 0, 0, 0, 0), "Shawn Marion": (4, 2, 0, 0, 1, 0, 0),
 "Elton Brand": (2, 1, 0, 0, 0, 0, 0), "Baron Davis": (2, 1, 0, 0, 0, 0, 0), "Steve Francis": (3, 0, 0, 0, 0, 0, 0),
 "Stephon Marbury": (2, 2, 0, 0, 0, 0, 0), "Latrell Sprewell": (4, 1, 0, 0, 0, 0, 0), "Patrick Ewing ": (0, 0, 0, 0, 0, 0, 0),
 "Allan Houston": (2, 0, 0, 0, 0, 0, 0), "Bill Laimbeer": (4, 0, 0, 0, 2, 0, 0), "Detlef Schrempf": (3, 1, 0, 0, 0, 0, 0),
 "Rik Smits": (1, 0, 0, 0, 0, 0, 0), "Toni Kukoc": (0, 0, 0, 0, 3, 0, 1), "Horace Grant": (1, 0, 0, 0, 4, 0, 0),
 "Robert Horry": (0, 0, 0, 0, 7, 0, 0), "Derek Fisher": (0, 0, 0, 0, 5, 0, 0), "Lamar Odom": (0, 0, 0, 0, 2, 0, 0),
 "Andre Iguodala": (1, 0, 0, 1, 4, 0, 0), "Draymond Green": (4, 2, 0, 0, 4, 0, 0), "Klay Thompson": (5, 2, 0, 0, 4, 0, 0),
 "Brandon Roy": (3, 2, 0, 0, 0, 0, 0), "LaMarcus Aldridge": (7, 5, 0, 0, 0, 0, 0), "Clyde Drexler ": (0, 0, 0, 0, 0, 0, 0),
 "Arvydas Sabonis": (0, 0, 0, 0, 0, 0, 1), "Drazen Petrovic": (0, 1, 0, 0, 0, 0, 1), "Bernard King ": (0, 0, 0, 0, 0, 0, 0),
 "Joe Johnson": (7, 1, 0, 0, 0, 0, 0), "Josh Smith": (0, 0, 0, 0, 0, 0, 0), "Al Horford": (5, 1, 0, 0, 1, 0, 0),
 "Paul George": (9, 6, 0, 0, 0, 0, 0), "Blake Griffin": (6, 5, 0, 0, 0, 0, 0), "DeMar DeRozan": (6, 2, 0, 0, 0, 0, 0),
 "Kyle Lowry": (6, 1, 0, 0, 1, 0, 0), "Vince Carter ": (0, 0, 0, 0, 0, 0, 0), "Chris Bosh": (11, 1, 0, 0, 2, 0, 1),
 "Deron Williams": (3, 2, 0, 0, 0, 0, 0), "Carlos Boozer": (2, 1, 0, 0, 0, 0, 0), "Zach Randolph": (2, 1, 0, 0, 0, 0, 0),
 "Marc Gasol": (3, 2, 0, 0, 1, 0, 0), "Mike Conley": (1, 0, 0, 0, 0, 0, 0), "Tony Allen": (0, 0, 0, 0, 1, 0, 0),
 "Rajon Rondo": (4, 1, 0, 0, 2, 0, 0), "Kevin Garnett ": (0, 0, 0, 0, 0, 0, 0), "Dennis Johnson ": (0, 0, 0, 0, 0, 0, 0),
 "Gail Goodrich": (5, 1, 0, 0, 1, 0, 1), "Jamaal Wilkes": (3, 0, 0, 0, 4, 0, 1), "Michael Cooper": (0, 0, 0, 0, 5, 0, 1),
 "Byron Scott": (0, 0, 0, 0, 3, 0, 0), "Bob Dandridge": (4, 1, 0, 0, 2, 0, 1), "Oscar Robertson ": (0, 0, 0, 0, 0, 0, 0),
 "Maurice Lucas": (4, 1, 0, 0, 1, 0, 0), "Calvin Murphy": (3, 0, 0, 0, 0, 0, 1), "Rudy Tomjanovich": (5, 0, 0, 0, 0, 0, 1),
 "Ralph Sampson": (4, 1, 0, 0, 0, 0, 1), "Mookie Blaylock": (1, 0, 0, 0, 0, 0, 0), "Dan Issel": (1, 0, 0, 0, 0, 0, 1),
 "David Thompson": (4, 2, 0, 0, 0, 0, 1), "Fat Lever": (2, 1, 0, 0, 0, 0, 0), "Kiki Vandeweghe": (2, 0, 0, 0, 0, 0, 0),
 "World B. Free": (1, 1, 0, 0, 0, 0, 0), "Mark Aguirre": (3, 0, 0, 0, 2, 0, 0), "Rolando Blackman": (4, 0, 0, 0, 0, 0, 0),
 "Derek Harper": (0, 0, 0, 0, 0, 0, 0), "Jason Terry": (0, 0, 0, 0, 1, 0, 0), "Michael Finley": (2, 0, 0, 0, 1, 0, 0),
 "Hersey Hawkins": (1, 0, 0, 0, 0, 0, 0), "Maurice Cheeks": (4, 0, 0, 0, 1, 0, 1), "Bobby Jones": (4, 0, 0, 0, 1, 0, 1),
 "Billy Cunningham": (4, 3, 0, 0, 1, 1, 1), "Chet Walker": (7, 0, 0, 0, 1, 0, 1), "Nate Thurmond": (7, 0, 0, 0, 0, 1, 1),
 "Tom Heinsohn": (6, 0, 0, 0, 8, 0, 1), "Bill Sharman": (8, 7, 0, 0, 4, 0, 1), "K.C. Jones": (0, 0, 0, 0, 8, 0, 1),
 "Satch Sanders": (0, 0, 0, 0, 8, 0, 1), "Frank Ramsey": (0, 0, 0, 0, 7, 0, 1), "Jo Jo White": (7, 0, 0, 1, 2, 0, 1),
 "Gus Johnson": (5, 4, 0, 0, 1, 0, 1), "Walt Bellamy": (4, 0, 0, 0, 0, 0, 1), "Zelmo Beaty": (2, 0, 0, 0, 0, 0, 1),
 "Lou Hudson": (6, 1, 0, 0, 0, 0, 1), "Connie Hawkins": (4, 1, 0, 0, 0, 0, 1), "Bob Love": (3, 2, 0, 0, 0, 0, 0),
 "Chet Walker ": (0, 0, 0, 0, 0, 0, 0), "Norm Van Lier": (3, 0, 0, 0, 0, 0, 0), "Jerry Sloan": (2, 0, 0, 0, 0, 0, 1),
 "Bob Petit": (0, 0, 0, 0, 0, 0, 0), "Cliff Hagan": (5, 0, 0, 0, 1, 0, 1), "Clyde Lovellette": (4, 0, 0, 0, 3, 0, 1),
 "Bailey Howell": (6, 0, 0, 0, 2, 0, 1), "Jack Twyman": (6, 2, 0, 0, 0, 0, 1), "Maurice Stokes": (3, 3, 0, 0, 0, 0, 1),
 "Kenny Smith": (0, 0, 0, 0, 2, 0, 0), "Vlade Divac": (1, 0, 0, 0, 0, 0, 1), "Doug Christie": (0, 0, 0, 0, 0, 0, 0),
 "Mike Bibby": (0, 0, 0, 0, 0, 0, 0), "DeMarcus Cousins": (4, 2, 0, 0, 0, 0, 0), "Bradley Beal": (3, 1, 0, 0, 0, 0, 0),
 "John Wall": (5, 1, 0, 0, 0, 0, 0), "Ben Simmons": (3, 1, 0, 0, 0, 0, 0), "Tony Parker ": (0, 0, 0, 0, 0, 0, 0),
 "David Lee": (2, 1, 0, 0, 1, 0, 0), "Monta Ellis": (0, 0, 0, 0, 0, 0, 0), "Kevin Martin": (0, 0, 0, 0, 0, 0, 0),
 "Hedo Turkoglu": (0, 0, 0, 0, 0, 0, 0), "Penny Hardaway": (4, 3, 0, 0, 0, 0, 0), "Nick Anderson": (0, 0, 0, 0, 0, 0, 0),
 "Terry Porter": (2, 0, 0, 0, 0, 0, 0), "Clifford Robinson": (1, 0, 0, 0, 0, 0, 0), "Rasheed Wallace ": (0, 0, 0, 0, 0, 0, 0),
 "Andrei Kirilenko": (1, 0, 0, 0, 0, 0, 0), "Mark Eaton": (1, 0, 0, 0, 0, 0, 0), "Darrell Griffith": (0, 0, 0, 0, 0, 0, 0),
 "Pete Maravich ": (0, 0, 0, 0, 0, 0, 0), "Jeff Hornacek": (1, 0, 0, 0, 0, 0, 0), "Gordon Hayward": (1, 0, 0, 0, 0, 0, 0),
 "Wally Szczerbiak": (1, 0, 0, 0, 0, 0, 0), "Sam Cassell": (2, 1, 0, 0, 3, 0, 0), "Stephon Marbury ": (0, 0, 0, 0, 0, 0, 0),
 "Tom Gugliotta": (1, 0, 0, 0, 0, 0, 0), "Kevin Love ": (0, 0, 0, 0, 0, 0, 0), "Vin Baker": (4, 1, 0, 0, 0, 0, 0),
 "Glenn Robinson": (2, 0, 0, 0, 1, 0, 0), "Michael Redd": (1, 1, 0, 0, 0, 0, 0), "Terry Cummings": (2, 1, 0, 0, 0, 0, 0),
 "Bob Dandridge ": (0, 0, 0, 0, 0, 0, 0), "Brandon Jennings": (0, 0, 0, 0, 0, 0, 0), "Ray Allen ": (0, 0, 0, 0, 0, 0, 0),
 "Khris Middleton": (3, 0, 0, 0, 1, 0, 0), "Jrue Holiday": (2, 0, 0, 0, 2, 0, 0), "Brook Lopez": (1, 0, 0, 0, 1, 0, 0),
 "Vince Carter  ": (0, 0, 0, 0, 0, 0, 0), "Jason Kidd ": (0, 0, 0, 0, 0, 0, 0), "Richard Jefferson": (0, 0, 0, 0, 0, 0, 0),
 "Kenyon Martin": (1, 0, 0, 0, 0, 0, 0), "Buck Williams": (3, 0, 0, 0, 0, 0, 0), "Derrick Coleman": (1, 0, 0, 0, 0, 0, 0),
 "Brook Lopez ": (0, 0, 0, 0, 0, 0, 0), "Bernard King  ": (0, 0, 0, 0, 0, 0, 0), "Isiah Thomas ": (0, 0, 0, 0, 0, 0, 0),
 "Grant Hill ": (0, 0, 0, 0, 0, 0, 0), "Derrick Rose": (3, 1, 1, 0, 0, 0, 0), "Jimmy Butler": (6, 5, 0, 0, 0, 0, 0),
 "Joakim Noah": (2, 1, 0, 0, 0, 0, 0), "Luol Deng": (2, 0, 0, 0, 0, 0, 0), "Zach LaVine": (2, 0, 0, 0, 0, 0, 0),
 "DeMar DeRozan ": (0, 0, 0, 0, 0, 0, 0), "Dwyane Wade ": (0, 0, 0, 0, 0, 0, 0), "Udonis Haslem": (0, 0, 0, 0, 3, 0, 0),
 "Goran Dragic": (1, 1, 0, 0, 0, 0, 0), "Hassan Whiteside": (0, 0, 0, 0, 0, 0, 0), "Tim Hardaway ": (0, 0, 0, 0, 0, 0, 0),
 "Glen Rice ": (0, 0, 0, 0, 0, 0, 0), "Kevin Willis": (1, 0, 0, 0, 1, 0, 0), "Doc Rivers": (1, 0, 0, 0, 0, 0, 0),
 "Spud Webb": (0, 0, 0, 0, 0, 0, 0), "Steve Smith": (1, 0, 0, 0, 1, 0, 0), "Dikembe Mutombo ": (0, 0, 0, 0, 0, 0, 0),
 # ---- modern stars (through 2025-26)
 "Luka Doncic": (6, 5, 0, 0, 0, 0, 0), "Shai Gilgeous-Alexander": (4, 3, 1, 1, 1, 0, 0), "Jayson Tatum": (6, 4, 0, 0, 1, 0, 0),
 "Joel Embiid": (7, 5, 1, 0, 0, 0, 0), "Jaylen Brown": (5, 1, 0, 1, 1, 0, 0), "Devin Booker": (4, 1, 0, 0, 0, 0, 0),
 "Anthony Edwards": (4, 2, 0, 0, 0, 0, 0), "Donovan Mitchell": (6, 2, 0, 0, 0, 0, 0), "Ja Morant": (2, 1, 0, 0, 0, 0, 0),
 "Zion Williamson": (2, 0, 0, 0, 0, 0, 0), "Trae Young": (4, 1, 0, 0, 0, 0, 0), "Victor Wembanyama": (2, 1, 0, 0, 0, 0, 0),
 "Tyrese Haliburton": (3, 2, 0, 0, 0, 0, 0), "Jalen Brunson": (3, 2, 0, 0, 0, 0, 0), "Domantas Sabonis": (3, 2, 0, 0, 0, 0, 0),
 "De'Aaron Fox": (1, 1, 0, 0, 0, 0, 0), "Bam Adebayo": (3, 0, 0, 0, 0, 0, 0), "Pascal Siakam": (4, 2, 0, 0, 1, 0, 0),
 "Karl-Anthony Towns": (5, 2, 0, 0, 0, 0, 0), "Rudy Gobert": (3, 4, 0, 0, 0, 0, 0), "Jamal Murray": (1, 0, 0, 0, 1, 0, 0),
 "Paolo Banchero": (1, 0, 0, 0, 0, 0, 0), "Cade Cunningham": (2, 1, 0, 0, 0, 0, 0), "Evan Mobley": (2, 1, 0, 0, 0, 0, 0),
 "Darius Garland": (2, 0, 0, 0, 0, 0, 0), "Jalen Williams": (1, 1, 0, 0, 1, 0, 0), "Chet Holmgren": (0, 0, 0, 0, 1, 0, 0),
 "LaMelo Ball": (1, 0, 0, 0, 0, 0, 0), "Lauri Markkanen": (1, 0, 0, 0, 0, 0, 0), "Jaren Jackson Jr.": (2, 0, 0, 0, 0, 0, 0),
 "Desmond Bane": (0, 0, 0, 0, 0, 0, 0), "Brandon Ingram": (1, 0, 0, 0, 0, 0, 0), "Kristaps Porzingis": (1, 0, 0, 0, 1, 0, 0),
 "Alperen Sengun": (1, 0, 0, 0, 0, 0, 0), "Scottie Barnes": (1, 0, 0, 0, 0, 0, 0), "Franz Wagner": (0, 0, 0, 0, 0, 0, 0),
 "Tyler Herro": (1, 0, 0, 0, 0, 0, 0), "Dejounte Murray": (1, 0, 0, 0, 0, 0, 0), "Fred VanVleet": (1, 0, 0, 0, 1, 0, 0),
 "Julius Randle": (3, 2, 0, 0, 0, 0, 0), "Nikola Vucevic": (2, 0, 0, 0, 0, 0, 0), "Andrew Wiggins": (1, 0, 0, 0, 1, 0, 0),
 "Myles Turner": (0, 0, 0, 0, 0, 0, 0), "Aaron Gordon": (0, 0, 0, 0, 1, 0, 0), "Michael Porter Jr.": (0, 0, 0, 0, 1, 0, 0),
 "Jalen Green": (0, 0, 0, 0, 0, 0, 0), "Jalen Johnson": (1, 0, 0, 0, 0, 0, 0), "Tyrese Maxey": (2, 0, 0, 0, 0, 0, 0),
 "Josh Giddey": (0, 0, 0, 0, 0, 0, 0), "Norman Powell": (1, 0, 0, 0, 1, 0, 0), "Kyle Kuzma": (0, 0, 0, 0, 1, 0, 0),
 "Jerami Grant": (0, 0, 0, 0, 0, 0, 0), "CJ McCollum": (0, 0, 0, 0, 0, 0, 0), "Bobby Portis": (0, 0, 0, 0, 1, 0, 0),
}
L = {k.strip(): v for k, v in L.items() if any(v)}  # trailing-space keys above are harmless placeholders

def legacy_points(v):
    allstar, allnba, mvp, fmvp, rings, t75, hof = v
    return 1.5 * allstar + 3 * allnba + 10 * mvp + 5 * fmvp + 2 * min(rings, 8) + 8 * t75 + 6 * hof
def fame(v):  # 0..~60, flattens so the GOAT debate doesn't swamp everything else
    p = legacy_points(v)
    return 75 * p / (p + 45)

# Players on a team now who never played for it in the box-score data (it ends March 2025), or only briefly.
# Only moves at least one solid source confirms. (team, name)
MOVES = [
 # 2025 offseason
 ("HOU", "Kevin Durant"), ("PHX", "Jalen Green"), ("PHX", "Dillon Brooks"), ("ORL", "Desmond Bane"), ("POR", "Jrue Holiday"),
 ("BOS", "Anfernee Simons"), ("ATL", "Kristaps Porzingis"), ("MIL", "Myles Turner"), ("POR", "Damian Lillard"),
 ("DEN", "Jonas Valanciunas"), ("CLE", "Lonzo Ball"),
 # 2025-26 season
 ("WAS", "Trae Young"), ("ATL", "CJ McCollum"), ("ATL", "Corey Kispert"), ("WAS", "Anthony Davis"), ("UTA", "Jaren Jackson Jr."),
 ("CLE", "James Harden"), ("LAC", "Darius Garland"), ("IND", "Ivica Zubac"), ("LAC", "Bennedict Mathurin"),
 ("CHI", "Jaden Ivey"), ("CHI", "Mike Conley"), ("DET", "Kevin Huerter"), ("CHI", "Guerschon Yabusele"),
 # 2026 offseason
 ("MIA", "Giannis Antetokounmpo"), ("MIA", "Bobby Portis"), ("MIL", "Tyler Herro"), ("MIL", "Jaime Jaquez Jr."),
 ("PHI", "Jaylen Brown"), ("BOS", "Paul George"), ("PHI", "LeBron James"), ("POR", "Ja Morant"), ("MEM", "Jerami Grant"),
 ("TOR", "Kawhi Leonard"), ("LAC", "Brandon Ingram"), ("LAC", "Gradey Dick"), ("ATL", "Luguentz Dort"),
 ("BOS", "Mitchell Robinson"), ("CHI", "Norman Powell"), ("LAC", "Rui Hachimura"),
 # traded at the 2025 deadline: the data has only a few games with the new team, so treat them as current too
 ("LAL", "Luka Doncic"), ("SAS", "De'Aaron Fox"), ("GSW", "Jimmy Butler"), ("SAC", "Zach LaVine"),
]

# Rookies: (team, name, position(s), draft year, pick). Rated from draft slot (2025 class has a season in already).
ROOKIES = [
 ("DAL", "Cooper Flagg", ["SF", "PF"], 2025, 1), ("SAS", "Dylan Harper", ["PG", "SG"], 2025, 2), ("PHI", "VJ Edgecombe", ["SG", "SF"], 2025, 3),
 ("CHA", "Kon Knueppel", ["SG", "SF"], 2025, 4), ("UTA", "Ace Bailey", ["SF", "SG"], 2025, 5), ("WAS", "Tre Johnson", ["SG", "PG"], 2025, 6),
 ("NOP", "Jeremiah Fears", ["PG", "SG"], 2025, 7), ("BKN", "Egor Demin", ["PG", "SG"], 2025, 8), ("TOR", "Collin Murray-Boyles", ["PF", "C"], 2025, 9),
 ("PHX", "Khaman Maluach", ["C"], 2025, 10), ("MEM", "Cedric Coward", ["SF", "SG"], 2025, 11), ("CHI", "Noa Essengue", ["PF", "SF"], 2025, 12),
 ("NOP", "Derik Queen", ["C", "PF"], 2025, 13), ("SAS", "Carter Bryant", ["SF", "PF"], 2025, 14), ("OKC", "Thomas Sorber", ["C", "PF"], 2025, 15),
 ("POR", "Yang Hansen", ["C"], 2025, 16), ("MIN", "Joan Beringer", ["C", "PF"], 2025, 17), ("UTA", "Walter Clayton Jr.", ["PG", "SG"], 2025, 18),
 ("BKN", "Nolan Traore", ["PG", "SG"], 2025, 19), ("MIL", "Kasparas Jakucionis", ["PG", "SG"], 2025, 20), ("WAS", "Will Riley", ["SF", "SG"], 2025, 21),
 ("BKN", "Drake Powell", ["SG", "SF"], 2025, 22), ("ATL", "Asa Newell", ["PF", "C"], 2025, 23), ("SAC", "Nique Clifford", ["SG", "SF"], 2025, 24),
 ("ORL", "Jase Richardson", ["SG", "PG"], 2025, 25), ("BKN", "Ben Saraf", ["PG", "SG"], 2025, 26), ("BKN", "Danny Wolf", ["PF", "C"], 2025, 27),
 ("BOS", "Hugo Gonzalez", ["SF", "SG"], 2025, 28), ("CHA", "Liam McNeeley", ["SF", "SG"], 2025, 29), ("LAC", "Yanic Konan Niederhauser", ["C"], 2025, 30),
 ("WAS", "AJ Dybantsa", ["SF", "PF"], 2026, 1), ("UTA", "Darryn Peterson", ["SG", "PG"], 2026, 2), ("MEM", "Cameron Boozer", ["PF", "C"], 2026, 3),
 ("CHI", "Caleb Wilson", ["PF", "SF"], 2026, 4), ("LAC", "Keaton Wagler", ["SG", "PG"], 2026, 5), ("BKN", "Mikel Brown Jr.", ["PG", "SG"], 2026, 6),
 ("SAC", "Darius Acuff Jr.", ["PG", "SG"], 2026, 7), ("ATL", "Kingston Flemings", ["PG", "SG"], 2026, 8), ("DAL", "Morez Johnson Jr.", ["PF", "C"], 2026, 9),
 ("MIL", "Brayden Burries", ["SG", "PG"], 2026, 10), ("GSW", "Yaxel Lendeborg", ["PF", "SF"], 2026, 11), ("OKC", "Aday Mara", ["C"], 2026, 12),
 ("MIL", "Nate Ament", ["SF", "PF"], 2026, 13), ("CHA", "Hannes Steinbach", ["PF", "C"], 2026, 14), ("CHI", "Dailyn Swain", ["SF", "SG"], 2026, 15),
 ("OKC", "Bennett Stirtz", ["PG", "SG"], 2026, 16), ("DET", "Ebuka Okorie", ["PG", "SG"], 2026, 17), ("CHA", "Christian Anderson", ["PG", "SG"], 2026, 18),
 ("TOR", "Allen Graves", ["PF", "SF"], 2026, 19), ("SAS", "Jayden Quaintance", ["C", "PF"], 2026, 20), ("PHX", "Koa Peat", ["PF", "SF"], 2026, 30),
]

STAT_W, FAME_W = 0.4, 0.6   # how much box-score stats vs. legacy count

teams = {os.path.basename(f)[:-5]: json.load(open(f)) for f in sorted(glob.glob(os.path.join(SRC, "*.json")))}
best_any = collections.defaultdict(float)   # each player's best stat rating with any franchise
recent = collections.defaultdict(float)     # best stat rating in a stint that reached 2021 or later
for lst in teams.values():
    for p in lst:
        best_any[p["n"]] = max(best_any[p["n"]], p["r"])
        if int(p["y"][-2:]) in range(21, 30): recent[p["n"]] = max(recent[p["n"]], p["r"])
moved = collections.defaultdict(set)
for t, n in MOVES: moved[t].add(n)
missing = [n for t, n in MOVES if n not in best_any]

def blend(p, team):
    n, stat = p["n"], p["r"]
    current = n in moved[team]
    if current: stat = max(stat, 0.85 * recent.get(n, best_any[n]))      # rated on who he is now, not a short stint
    share = 0.7 if current else min(1, stat / best_any[n] if best_any[n] else 0) ** 1.5
    return STAT_W * stat + FAME_W * fame(L[n]) * share if n in L else STAT_W * stat

old_top = [p["r"] for lst in teams.values() for p in lst[:10]]
out = {}
for t, lst in teams.items():
    rows = []
    for p in lst:
        q = dict(p); q["raw"] = p["r"]; rows.append(q)
    have = {p["n"] for p in rows}
    for n in moved[t] - have:  # joined this team after the data ends: borrow his line from his last team
        src = max((p for lst2 in teams.values() for p in lst2 if p["n"] == n), key=lambda p: (int(p["y"][-2:]) < 50, p["y"][-2:], p["r"]), default=None)
        if src: rows.append({**src, "raw": 0, "s": src["s"] + " (before joining)", "y": "2025–"})
    rows = [{**p, "r": blend({**p, "r": p["raw"] or 0}, t)} for p in rows]
    for team, n, pos, yr, pick in ROOKIES:
        if team == t: rows.append({"n": n, "p": pos, "r": (32 if yr == 2025 else 27) - 0.5 * (pick - 1), "s": f"{yr} draft · pick #{pick}", "y": f"{yr}–", "rk": 1})
    out[t] = rows
# Keep the overall scale close to before so the best-of-7 odds still feel the same.
new_top = sorted((p["r"] for rows in out.values() for p in sorted(rows, key=lambda x: -x["r"])[:10]), reverse=True)
k = (sum(old_top) / len(old_top)) / (sum(new_top) / len(new_top))
os.makedirs(OUT, exist_ok=True)
for t, rows in out.items():
    for p in rows:
        p["r"] = round(p["r"] * (1 if p.get("rk") else k), 1); p.pop("raw", None); p.pop("rk", None)
    # rookies were set on the final scale directly: lottery picks land around a solid starter
    rows.sort(key=lambda x: -x["r"])
    json.dump(rows, open(os.path.join(OUT, f"{t}.json"), "w"), separators=(",", ":"))
print("scale k =", round(k, 3), "| moves not found in data:", missing)
for t in ["LAL", "BOS", "CHI", "DEN", "IND", "GSW", "MIA", "PHI", "DAL", "WAS"]:
    print(t, [(p["n"], p["r"]) for p in out[t][:8]])
