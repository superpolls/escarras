/**
 * Servidor fals de Firebase Realtime Database per a les proves: la part de l'API REST que fa servir
 * l'app (GET, PUT, DELETE, Server-Sent Events) i les mateixes regles que firebase/database.rules.json.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const ROOM = /^[A-Za-z0-9_-]+$/;
const isObj = (v: Json): v is Record<string, Json> => !!v && typeof v === "object" && !Array.isArray(v);

/** Regles de firebase/database.rules.json, escrites en codi. */
export function allowed(parts: string[], current: Json, next: Json): boolean {
  if (parts[0] !== "r" || parts.length < 3) return false;
  const room = parts[1]!;
  if (room.length !== 22 || !ROOM.test(room)) return false;
  const kind = parts[2];
  if (kind === "h" && parts.length === 3) {
    if (!isObj(next)) return false;
    const keys = Object.keys(next);
    if (keys.some(k => !["s", "p", "d"].includes(k)) || keys.length !== 3) return false;
    const { s, p, d } = next;
    if (typeof s !== "number" || typeof p !== "number" || typeof d !== "string" || d.length > 8000 || !(s > p)) return false;
    return isObj(current) ? p === current.s : p === -1;
  }
  if (kind === "s" && parts.length === 4) {
    if (!/^[0-7]$/.test(parts[3]!) || !isObj(next)) return false;
    const keys = Object.keys(next);
    if (keys.some(k => !["d", "p"].includes(k)) || keys.length !== 2) return false;
    const { d, p } = next;
    if (typeof d !== "string" || d.length !== 22 || typeof p !== "string") return false;
    return isObj(current) ? p === current.d : p === "";
  }
  if (kind === "c" && parts.length === 4) {
    const dev = parts[3]!;
    if (next === null) return true; // esborrar una petició
    return dev.length === 22 && ROOM.test(dev) && typeof next === "number" && next >= 0 && next <= 7;
  }
  return false;
}

export interface FakeRtdb {
  url: string;
  server: Server;
  data: () => Json;
  close: () => Promise<void>;
  /** Simula que el servidor no respon (per a proves de desconnexió). */
  setDown: (down: boolean) => void;
  writes: number;
}

export async function startFakeRtdb(port = 0): Promise<FakeRtdb> {
  let root: Json = null;
  let down = false;
  const streams = new Set<{ parts: string[]; res: ServerResponse }>();
  const state = { writes: 0 };

  const get = (parts: string[]): Json => {
    let n: Json = root;
    for (const p of parts) n = isObj(n) ? n[p] ?? null : null;
    return n;
  };
  const set = (parts: string[], value: Json) => {
    const rec = (node: Json, i: number): Json => {
      if (i === parts.length) return value;
      const base: Record<string, Json> = isObj(node) ? { ...node } : {};
      const child = rec(base[parts[i]!] ?? null, i + 1);
      if (child === null) delete base[parts[i]!]; else base[parts[i]!] = child;
      return Object.keys(base).length ? base : null;
    };
    root = rec(root, 0);
  };
  const notify = (parts: string[]) => {
    for (const s of streams) {
      const prefix = s.parts;
      if (parts.length >= prefix.length && prefix.every((p, i) => parts[i] === p)) {
        const rel = "/" + parts.slice(prefix.length).join("/");
        s.res.write(`event: put\ndata: ${JSON.stringify({ path: rel, data: get(parts) })}\n\n`);
      }
    }
  };

  const cors = (res: ServerResponse) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
  };

  const body = (req: IncomingMessage) => new Promise<string>(ok => {
    let b = "";
    req.on("data", c => { b += c; });
    req.on("end", () => ok(b));
  });

  const server = createServer(async (req, res) => {
    cors(res);
    if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
    if (down) { req.socket.destroy(); return; }
    const url = new URL(req.url ?? "/", "http://x");
    if (!url.pathname.endsWith(".json")) { res.writeHead(404).end(); return; }
    const parts = url.pathname.slice(1, -5).split("/").filter(Boolean);
    if (req.method === "GET") {
      if (parts[0] !== "r" || parts.length < 2 || parts[1]!.length !== 22) { res.writeHead(401).end('{"error":"Permission denied"}'); return; }
      if ((req.headers.accept ?? "").includes("text/event-stream")) {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
        res.write(`event: put\ndata: ${JSON.stringify({ path: "/", data: get(parts) })}\n\n`);
        const s = { parts, res };
        streams.add(s);
        const ka = setInterval(() => res.write("event: keep-alive\ndata: null\n\n"), 15000);
        req.on("close", () => { streams.delete(s); clearInterval(ka); });
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(get(parts)));
      return;
    }
    if (req.method === "PUT" || req.method === "DELETE") {
      let next: Json = null;
      if (req.method === "PUT") {
        try { next = JSON.parse(await body(req)) as Json; } catch { res.writeHead(400).end('{"error":"Invalid data"}'); return; }
        if (next === null) { res.writeHead(401).end('{"error":"Permission denied"}'); return; }
      }
      if (!allowed(parts, get(parts), next)) { res.writeHead(401).end('{"error":"Permission denied"}'); return; }
      set(parts, next);
      state.writes += 1;
      notify(parts);
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(next));
      return;
    }
    res.writeHead(405).end();
  });

  await new Promise<void>(ok => server.listen(port, "127.0.0.1", ok));
  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : port;
  return {
    url: `http://127.0.0.1:${actualPort}`,
    server,
    data: () => root,
    setDown: (d: boolean) => {
      down = d;
      if (d) for (const s of streams) s.res.destroy();
    },
    get writes() { return state.writes; },
    close: () => new Promise<void>(ok => {
      for (const s of streams) s.res.destroy();
      server.close(() => ok());
    }),
  };
}

// Execució directa (proves al navegador): npx tsx tests/fake-rtdb.ts 9400
if (process.argv[1]?.endsWith("fake-rtdb.ts")) {
  const port = Number(process.argv[2] ?? 9400);
  void startFakeRtdb(port).then(s => console.log(`Servidor fals de Firebase a ${s.url}`));
}
