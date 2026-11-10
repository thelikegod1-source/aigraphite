// www.deepball.org -> deepball.org. (deepball.pages.dev is moved in the browser by app.js so each
// player's saved code comes along; a server redirect would lose it.) API calls/webhooks are never redirected.
const CANON = "deepball.org";
export async function onRequest({ request, next }) {
  const url = new URL(request.url);
  const old = url.hostname === "www." + CANON;
  if (old && request.method === "GET" && !url.pathname.startsWith("/api/")) {
    url.hostname = CANON; url.protocol = "https:"; url.port = "";
    return Response.redirect(url.toString(), 301);
  }
  return next();
}
