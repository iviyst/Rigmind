// Game State Integration for CS2 and Dota 2: the games' official feed of player state.
// Used for game-reactive lighting and match recaps. Read-only; it can't affect the game.
import { EventEmitter } from "node:events";
import { createServer, Server } from "node:http";
import { existsSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { runPs } from "./ps";
import { dataDir, load } from "./store";
import { telemetry } from "./telemetry";
import { netmon } from "./netmon";
import type { MatchRecap } from "../shared/types";

const PORT = 3712;
const recapsFile = () => join(dataDir("matches"), "matches.json");
const authToken = randomBytes(12).toString("hex"); // rotates each launch; written into the cfg files

export type GameEvent = { kind: "health"; value: number } | { kind: "flash" } | { kind: "bomb"; state: "planted" | "defused" | "exploded" } | { kind: "kill" } | { kind: "death" } | { kind: "round"; won: boolean | null };

function cfg(name: string) {
  return `"Rigmind ${name}"
{
  "uri" "http://127.0.0.1:${PORT}/${name}"
  "timeout" "1.1"
  "buffer" "0.1"
  "throttle" "0.1"
  "heartbeat" "10.0"
  "auth" { "token" "${authToken}" }
  "data"
  {
    "provider" "1"
    "map" "1"
    "round" "1"
    "player_id" "1"
    "player_state" "1"
    "player_match_stats" "1"
    "hero" "1"
  }
}
`;
}

class GameStateFeed extends EventEmitter {
  private server: Server | null = null;
  private cs = { health: 100, kills: 0, deaths: 0, round: -1, roundKills: 0, bomb: "" as string };
  private match: MatchRecap | null = null;

  /** Write the cfg files into CS2 and Dota 2 so the games send their state to Rigmind. */
  async install(): Promise<string[]> {
    const steam = (await runPs(`(Get-ItemProperty 'HKCU:\\Software\\Valve\\Steam' -ErrorAction SilentlyContinue).SteamPath`).catch(() => "")).trim();
    if (!steam) return [];
    const libs = [steam];
    try {
      const vdf = readFileSync(join(steam, "steamapps", "libraryfolders.vdf"), "utf8");
      for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.push(m[1].replace(/\\\\/g, "\\"));
    } catch {
      /* ignore */
    }
    const done: string[] = [];
    for (const lib of new Set(libs)) {
      const cs2 = join(lib, "steamapps", "common", "Counter-Strike Global Offensive", "game", "csgo", "cfg");
      if (existsSync(cs2)) {
        writeFileSync(join(cs2, "gamestate_integration_rigmind.cfg"), cfg("cs2"));
        done.push("CS2");
      }
      const dota = join(lib, "steamapps", "common", "dota 2 beta", "game", "dota", "cfg");
      if (existsSync(dota)) {
        mkdirSync(join(dota, "gamestate_integration"), { recursive: true });
        writeFileSync(join(dota, "gamestate_integration", "gamestate_integration_rigmind.cfg"), cfg("dota2"));
        done.push("Dota 2");
      }
    }
    return done;
  }

  async init() {
    if (!load().extras.gameLighting) return;
    await this.install().catch(() => []);
    this.server = createServer((req, res) => {
      if (req.method !== "POST") return res.writeHead(405).end();
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.writeHead(200).end();
        try {
          const j = JSON.parse(body);
          if (j?.auth?.token !== authToken) return; // only accept our own games' feed
          if (req.url?.startsWith("/cs2")) this.onCs2(j);
          else if (req.url?.startsWith("/dota2")) this.onDota(j);
        } catch {
          /* ignore */
        }
      });
    });
    this.server.on("error", () => (this.server = null));
    this.server.listen(PORT, "127.0.0.1");
  }

  private startMatch(game: "cs2" | "dota2", map: string | null) {
    this.match = { id: randomUUID(), game, start: Date.now(), end: Date.now(), map, stats: {}, rounds: [], summary: null };
  }

  private onCs2(j: any) {
    const p = j.player;
    const mapName = j.map?.name ?? null;
    if (j.map?.phase === "live" && !this.match) this.startMatch("cs2", mapName);
    if (p?.state && p.steamid === j.provider?.steamid) {
      const hp = p.state.health ?? 100;
      if (hp < this.cs.health) this.emit("event", { kind: "health", value: hp } as GameEvent);
      if (hp === 0 && this.cs.health > 0) {
        this.emit("event", { kind: "death" } as GameEvent);
        const r = this.match?.rounds[this.match.rounds.length - 1];
        if (r) r.died = true;
      }
      if ((p.state.flashed ?? 0) > 120) this.emit("event", { kind: "flash" } as GameEvent);
      if ((p.state.round_kills ?? 0) > this.cs.roundKills) this.emit("event", { kind: "kill" } as GameEvent);
      this.cs.health = hp;
      this.cs.roundKills = p.state.round_kills ?? 0;
      if (this.match && p.match_stats) this.match.stats = { kills: p.match_stats.kills, deaths: p.match_stats.deaths, assists: p.match_stats.assists, mvps: p.match_stats.mvps, score: p.match_stats.score };
    }
    const bomb = j.round?.bomb ?? "";
    if (bomb && bomb !== this.cs.bomb && ["planted", "defused", "exploded"].includes(bomb)) this.emit("event", { kind: "bomb", state: bomb } as GameEvent);
    this.cs.bomb = bomb;
    const round = j.map?.round ?? -1;
    if (this.match && round !== this.cs.round && round >= 0) {
      // New round: record the last one with the PC's state.
      const t = telemetry.latest();
      const team = p?.team;
      const lastWin = j.round?.win_team;
      this.match.rounds.push({ n: round, won: lastWin && team ? lastWin === team : null, kills: this.cs.roundKills, died: false, fps: t?.fps?.fps ?? null, ping: netmon.gamePing() });
      this.cs.round = round;
      this.emit("event", { kind: "round", won: null } as GameEvent);
    }
    if (j.map?.phase === "gameover" && this.match) this.finishMatch({ ...this.match.stats, team_ct: j.map?.team_ct?.score ?? null, team_t: j.map?.team_t?.score ?? null });
  }

  private onDota(j: any) {
    const state = j.map?.game_state ?? "";
    if (state === "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS" && !this.match) this.startMatch("dota2", null);
    const hero = j.hero;
    if (hero) {
      const hp = hero.health_percent ?? 100;
      if (hp < this.cs.health) this.emit("event", { kind: "health", value: hp } as GameEvent);
      if (hero.alive === false && this.cs.health > 0) this.emit("event", { kind: "death" } as GameEvent);
      this.cs.health = hero.alive === false ? 0 : hp;
    }
    if (this.match && j.player) this.match.stats = { kills: j.player.kills, deaths: j.player.deaths, assists: j.player.assists, last_hits: j.player.last_hits, gpm: j.player.gpm, hero: hero?.name ?? null };
    if (state === "DOTA_GAMERULES_STATE_POST_GAME" && this.match) this.finishMatch(this.match.stats);
  }

  private finishMatch(stats: MatchRecap["stats"]) {
    if (!this.match) return;
    const m = { ...this.match, end: Date.now(), stats };
    this.match = null;
    this.cs = { health: 100, kills: 0, deaths: 0, round: -1, roundKills: 0, bomb: "" };
    if (m.end - m.start < 5 * 60_000) return;
    writeFileSync(recapsFile(), JSON.stringify([m, ...this.recaps()].slice(0, 50)));
    this.emit("match", m);
  }

  recaps(): MatchRecap[] {
    try {
      return existsSync(recapsFile()) ? JSON.parse(readFileSync(recapsFile(), "utf8")) : [];
    } catch {
      return [];
    }
  }
  saveRecapSummary(id: string, summary: string) {
    const all = this.recaps().map((m) => (m.id === id ? { ...m, summary } : m));
    writeFileSync(recapsFile(), JSON.stringify(all));
  }
}

export const gsi = new GameStateFeed();
