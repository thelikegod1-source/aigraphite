# Deep Ball

1v1 NBA knowledge game. Both players get the same prompt and 30 seconds. An AI judge (Cloudflare Workers AI) checks each answer and scores how deep the pull is. First to 3 round wins.

- `public/` is the website (static files).
- `functions/api/` is the server: matchmaking, timers, and the AI judge.
- `lib/prompts.js` holds the prompts. Every verdict is saved, so each answer only uses AI the first time.

## Put it online (free, Cloudflare Pages)

1. (Optional) A Gemini API key from aistudio.google.com as a backup AI.
2. **Database:** in dash.cloudflare.com, go to Storage & Databases → D1 → Create. Name it `deepball`. (Tables are created automatically.)
3. **Site:** go to Workers & Pages → Create → Pages → Connect to Git. Pick this repo.
   - Project name: `deepball` (this gives you deepball.pages.dev)
   - Framework preset: None. Build command: leave empty. Build output directory: `public`
   - Deploy.
4. **Connect them:** open the project → Settings:
   - Bindings → Add → D1 database. Variable name `DB`, database `deepball`.
   - Bindings → Add → Workers AI. Variable name `AI`. (Free daily AI allowance.)
   - Optional backup: Variables and Secrets → Add → Secret `GEMINI_API_KEY`.
   - Optional: `GEMINI_MODEL` to change the model (default `gemini-2.5-flash`).
5. **Redeploy:** Deployments → latest → Retry deployment. Done.

Every push to `main` updates the site.

## Features
- **Two modes:** Deep Ball (AI-judged deep pulls) and Guess the Player (clues every 6s, first right guess wins; `lib/players.js`).
- **Usernames, Elo and leaderboard:** online matches are rated (everyone starts at 1000). Practice is unrated.
- **Player code:** shown on the Profile tab; paste it on another device to keep your name and record.
- **Private rooms:** "Play a friend" makes a 5-letter code.
- **Share card:** image of your result for Instagram/TikTok.
- **Installable:** Add to Home Screen opens it full-screen like an app.
