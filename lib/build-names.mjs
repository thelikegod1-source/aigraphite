// Builds public/names.json (the autocomplete list) from every name in the game's data.
// Run after editing answers or players: node lib/build-names.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { PLAYERS } from "./players.js";
const src = readFileSync(new URL("./answers.js", import.meta.url), "utf8");
const names = new Set(PLAYERS.map(p => p.name));
for (const m of src.matchAll(/([A-Z][A-Za-z.'\-]+(?: [A-Za-z.'\-]+){0,3}) \d+(?=,|")/g)) names.add(m[1].trim());
const extra = readFileSync(new URL("./extra-names.txt", import.meta.url), "utf8").split("\n").map(s => s.trim()).filter(Boolean);
for (const n of extra) names.add(n);
const list = [...names].sort((a, b) => a.localeCompare(b));
writeFileSync(new URL("../public/names.json", import.meta.url), JSON.stringify(list));
console.log(list.length, "names");
