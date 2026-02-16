import express from "express";
import cors from "cors";
import morgan from "morgan";
import { nanoid } from "nanoid";
import fs from "fs";
import path from "path";

const app = express();
app.use(express.json());
app.use(morgan("tiny"));

const PORT = process.env.PORT || 8080;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

app.use(
  cors({
    origin: CORS_ORIGIN === "*" ? true : CORS_ORIGIN,
    credentials: true
  })
);

const dataPath = path.join(process.cwd(), "data", "videos.json");

function loadVideos() {
  const raw = fs.readFileSync(dataPath, "utf-8");
  const json = JSON.parse(raw);
  return json.videos?.filter((v) => v.enabled) ?? [];
}

// Sessões em memória (MVP)
const sessions = new Map(); // sessionId -> { tgUserId, startedAt, lastPingAt, proofs, videoCount }
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2h

function cleanupSessions() {
  const now = Date.now();
  for (const [sid, s] of sessions.entries()) {
    if (now - s.lastPingAt > SESSION_TTL_MS) sessions.delete(sid);
  }
}
setInterval(cleanupSessions, 60_000);

// Healthcheck
app.get("/health", (req, res) => res.json({ ok: true }));

// Feed simples (filtros opcionais)
app.get("/feed", (req, res) => {
  const { creator, tag, limit } = req.query;
  let vids = loadVideos();

  if (creator) vids = vids.filter((v) => v.creator === creator);
  if (tag) vids = vids.filter((v) => (v.tags || []).includes(tag));

  const lim = Math.min(parseInt(limit || "20", 10), 50);
  vids = vids.slice(0, lim);

  res.json({ videos: vids });
});

// Iniciar sessão (MVP: sem verificação criptográfica do Telegram ainda)
app.post("/session/start", (req, res) => {
  const { tgUserId } = req.body || {};
  const sessionId = nanoid(16);

  sessions.set(sessionId, {
    tgUserId: tgUserId || null,
    startedAt: Date.now(),
    lastPingAt: Date.now(),
    proofs: 0,
    videoCount: 0
  });

  res.json({ sessionId });
});

// Ping de sessão (métrica + anti-replay lógico)
app.post("/session/ping", (req, res) => {
  const { sessionId, event, proofsDelta, videoDelta } = req.body || {};
  if (!sessionId || !sessions.has(sessionId)) {
    return res.status(400).json({ error: "invalid_session" });
  }

  const s = sessions.get(sessionId);
  s.lastPingAt = Date.now();

  if (typeof proofsDelta === "number" && proofsDelta > 0) s.proofs += proofsDelta;
  if (typeof videoDelta === "number" && videoDelta > 0) s.videoCount += videoDelta;

  // opcional: registrar eventos para auditoria / logs
  // event pode ser: "proof_ok", "video_end", etc.
  res.json({ ok: true, session: { proofs: s.proofs, videoCount: s.videoCount } });
});

app.listen(PORT, () => {
  console.log(`NackFlix backend running on :${PORT}`);
});