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
- **Spin & Draft:** spin a wheel of all 30 franchises, draft anyone who ever played for that team, 6 picks, best-of-7 series decides it. Ratings live in `public/teams/*.json`, built by `lib/build-teams.py` from public box-score data (1947 to March 2025).

## Deep Ball+ and Stripe (owner: an adult 18+)
1. In Stripe → **Payment Links**, create:
   - a **$5/month** recurring product "Deep Ball+" → paste its link into `plusUrl` in `public/support-config.js`
   - a "Support Deep Ball" product with *customers choose what to pay* → `donateUrl`
   - Settings → Billing → **Customer portal**: turn it on and copy the link → `manageUrl`
   - Add a contact email → `contactEmail`
2. Stripe → Developers → **Webhooks** → Add endpoint `https://deepball.pages.dev/api/stripe` with events
   `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`.
   Copy its **signing secret** (whsec_…) into Cloudflare → deepball → Settings → Variables and Secrets as a Secret named `STRIPE_WEBHOOK_SECRET`, then redeploy.
3. Checkout links carry the player's ID (`client_reference_id`), so Plus unlocks on their account automatically and turns off if they cancel.

Plus features: host duos (2v2) rooms in every mode, custom Deep Ball question packs, host 4/8-player tournaments, ⭐ supporter badge. Joining a friend's room or tournament is free. The owner account always has Plus.
