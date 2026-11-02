# Deep Ball

1v1 NBA knowledge game. Both players get the same prompt and 30 seconds. An AI judge (Google Gemini) checks each answer and scores how deep the pull is. First to 3 round wins.

- `public/` is the website (static files).
- `functions/api/` is the server: matchmaking, timers, and the AI judge.

## Put it online (free, Cloudflare Pages)

1. **Gemini key:** go to aistudio.google.com, then Get API key, then Create. Copy it.
2. **Database:** in dash.cloudflare.com, go to Storage & Databases → D1 → Create. Name it `deepball`. (Tables are created automatically.)
3. **Site:** go to Workers & Pages → Create → Pages → Connect to Git. Pick this repo.
   - Project name: `deepball` (this gives you deepball.pages.dev)
   - Framework preset: None. Build command: leave empty. Build output directory: `public`
   - Deploy.
4. **Connect them:** open the project → Settings:
   - Bindings → Add → D1 database. Variable name `DB`, database `deepball`.
   - Variables and Secrets → Add → Secret. Name `GEMINI_API_KEY`, value your key.
   - Optional: `GEMINI_MODEL` to change the model (default `gemini-2.5-flash`).
5. **Redeploy:** Deployments → latest → Retry deployment. Done.

Every push to `main` updates the site.
