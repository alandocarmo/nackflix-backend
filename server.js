const express = require("express");
const cors = require("cors");
const { nanoid } = require("nanoid");
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const { getR2Client } = require("./r2");
const {
  getCreators,
  saveCreators,
  getVideos,
  saveVideos,
  getAds,
  saveAds,
  getUsers,
  saveUsers,
  getSubscriptions,
  saveSubscriptions,
} = require("./dataStore");

const app = express();
app.use(express.json({ limit: "5mb" }));

app.use(
  cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true,
  })
);

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

/* =========================
   SESSIONS
========================= */

const sessions = new Map();

app.post("/session/start", (req, res) => {
  const { tgUserId = null, userId = null } = req.body || {};
  const sessionId = nanoid(16);

  sessions.set(sessionId, {
    sessionId,
    tgUserId,
    userId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    events: [],
    taps: 0,
    videosCompleted: 0,
  });

  res.json({ sessionId });
});

app.post("/session/ping", (req, res) => {
  const payload = req.body || {};
  const {
    sessionId,
    event = "unknown",
    proofsDelta = 0,
    videoDelta = 0,
    count = 0,
  } = payload;

  if (!sessionId || !sessions.has(sessionId)) {
    return res.status(400).json({ error: "invalid_session" });
  }

  const session = sessions.get(sessionId);

  session.updatedAt = new Date().toISOString();
  session.events.push({
    at: new Date().toISOString(),
    ...payload,
  });

  session.taps += Number(proofsDelta || 0) + Number(count || 0);
  session.videosCompleted += Number(videoDelta || 0);

  sessions.set(sessionId, session);

  res.json({
    ok: true,
    session: {
      sessionId: session.sessionId,
      taps: session.taps,
      videosCompleted: session.videosCompleted,
      updatedAt: session.updatedAt,
    },
  });
});

/* =========================
   AUTH / USERS
========================= */

app.post("/auth/register", (req, res) => {
  const {
    fullName,
    email,
    password,
    phone = "",
    bio = "",
    avatarUrl = "",
    location = "global",
    wantsToBeCreator = false,
  } = req.body || {};

  if (!fullName || !email || !password) {
    return res.status(400).json({ error: "missing_required_fields" });
  }

  const users = getUsers();
  const exists = users.find((u) => u.email.toLowerCase() === email.toLowerCase());

  if (exists) {
    return res.status(409).json({ error: "user_already_exists" });
  }

  const user = {
    id: nanoid(10),
    fullName,
    email,
    password, // MVP: plain text. depois trocar por hash.
    phone,
    bio,
    avatarUrl,
    location,
    wantsToBeCreator,
    adFreeActive: false,
    createdAt: new Date().toISOString(),
  };

  users.push(user);
  saveUsers(users);

  res.json({ user });
});

app.post("/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  const users = getUsers();

  const user = users.find(
    (u) => u.email.toLowerCase() === String(email).toLowerCase() && u.password === password
  );

  if (!user) {
    return res.status(401).json({ error: "invalid_credentials" });
  }

  res.json({ user });
});

app.get("/users/:id", (req, res) => {
  const users = getUsers();
  const user = users.find((u) => u.id === req.params.id);

  if (!user) {
    return res.status(404).json({ error: "user_not_found" });
  }

  res.json({ user });
});

app.put("/users/:id", (req, res) => {
  const users = getUsers();
  const index = users.findIndex((u) => u.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({ error: "user_not_found" });
  }

  users[index] = {
    ...users[index],
    ...req.body,
    id: users[index].id,
    email: req.body.email || users[index].email,
  };

  saveUsers(users);
  res.json({ user: users[index] });
});

/* =========================
   SUBSCRIPTIONS
========================= */

app.post("/subscriptions/buy", (req, res) => {
  const { userId, planCode } = req.body || {};

  if (!userId || !planCode) {
    return res.status(400).json({ error: "missing_required_fields" });
  }

  if (planCode !== "ad_free_10usd") {
    return res.status(400).json({ error: "invalid_plan_code" });
  }

  const users = getUsers();
  const userIndex = users.findIndex((u) => u.id === userId);

  if (userIndex === -1) {
    return res.status(404).json({ error: "user_not_found" });
  }

  const subscriptions = getSubscriptions();

  const subscription = {
    id: nanoid(10),
    userId,
    planCode,
    amountUsd: 10,
    status: "active",
    createdAt: new Date().toISOString(),
  };

  subscriptions.push(subscription);
  saveSubscriptions(subscriptions);

  users[userIndex].adFreeActive = true;
  saveUsers(users);

  res.json({ ok: true, subscription, user: users[userIndex] });
});

/* =========================
   CREATORS
========================= */

app.post("/creators", (req, res) => {
  const { handle, name, bio = "", avatarUrl = "" } = req.body || {};

  if (!handle || !name) {
    return res.status(400).json({ error: "handle_and_name_required" });
  }

  const creators = getCreators();
  const exists = creators.find(
    (c) => c.handle.toLowerCase() === handle.toLowerCase()
  );

  if (exists) {
    return res.status(409).json({ error: "creator_already_exists" });
  }

  const creator = {
    id: nanoid(10),
    handle,
    name,
    bio,
    avatarUrl,
    createdAt: new Date().toISOString(),
  };

  creators.push(creator);
  saveCreators(creators);

  res.json({ creator });
});

app.get("/creators", (req, res) => {
  res.json({ creators: getCreators() });
});

app.get("/creators/:handle", (req, res) => {
  const handle = String(req.params.handle).toLowerCase();
  const creators = getCreators();

  const creator = creators.find(
    (c) => c.handle.toLowerCase() === handle
  );

  if (!creator) {
    return res.status(404).json({ error: "creator_not_found" });
  }

  const videos = getVideos().filter(
    (v) => String(v.creatorHandle || "").toLowerCase() === handle
  );

  res.json({ creator, videos });
});

/* =========================
   UPLOAD SIGN
========================= */

app.post("/uploads/sign", async (req, res) => {
  try {
    const { creatorHandle, filename, contentType } = req.body || {};

    if (!creatorHandle || !filename || !contentType) {
      return res.status(400).json({
        error: "creatorHandle_filename_contentType_required",
      });
    }

    const creators = getCreators();
    const creator = creators.find(
      (c) => c.handle.toLowerCase() === creatorHandle.toLowerCase()
    );

    if (!creator) {
      return res.status(404).json({ error: "creator_not_found" });
    }

    const ext = filename.includes(".") ? filename.split(".").pop() : "mp4";
    const safeExt =
      String(ext).toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";

    const key = `creators/${creator.handle}/${Date.now()}-${nanoid(6)}.${safeExt}`;

    const Bucket = process.env.R2_BUCKET;
    const r2 = getR2Client();

    const cmd = new PutObjectCommand({
      Bucket,
      Key: key,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    });

    const uploadUrl = await getSignedUrl(r2, cmd, { expiresIn: 60 * 10 });

    const publicBase = process.env.R2_PUBLIC_BASE_URL.replace(/\/+$/, "");
    const publicUrl = `${publicBase}/${key}`;

    res.json({ uploadUrl, publicUrl, key });
  } catch (err) {
    console.error("sign_failed", err);
    res.status(500).json({ error: "sign_failed" });
  }
});

/* =========================
   VIDEOS
========================= */

app.post("/videos", (req, res) => {
  const {
    creatorHandle,
    title,
    tags = [],
    url,
    durationSec = null,
  } = req.body || {};

  if (!creatorHandle || !title || !url) {
    return res.status(400).json({
      error: "creatorHandle_title_url_required",
    });
  }

  const creators = getCreators();
  const creator = creators.find(
    (c) => c.handle.toLowerCase() === creatorHandle.toLowerCase()
  );

  if (!creator) {
    return res.status(404).json({ error: "creator_not_found" });
  }

  const videos = getVideos();

  const video = {
    id: nanoid(10),
    title,
    creatorHandle: creator.handle,
    tags: Array.isArray(tags) ? tags : [],
    source: {
      type: "mp4",
      url,
    },
    durationSec,
    enabled: true,
    createdAt: new Date().toISOString(),
  };

  videos.unshift(video);
  saveVideos(videos);

  res.json({ video });
});

app.get("/feed", (req, res) => {
  const limit = Math.max(1, Math.min(50, parseInt(req.query.limit || "20", 10)));
  const creator = req.query.creator
    ? String(req.query.creator).toLowerCase()
    : null;

  let videos = getVideos().filter((v) => v.enabled !== false);

  if (creator) {
    videos = videos.filter(
      (v) => String(v.creatorHandle || "").toLowerCase() === creator
    );
  }

  res.json({ videos: videos.slice(0, limit) });
});

/* =========================
   ADS
========================= */

app.post("/ads", (req, res) => {
  const {
    advertiserName,
    title,
    subtitle = "",
    adType,
    mediaUrl,
    ctaLabel = "Entrar em contato",
    ctaUrl = "",
    plan,
    locations = ["global"],
    startsAt = null,
    endsAt = null,
  } = req.body || {};

  if (!advertiserName || !title || !adType || !mediaUrl || !plan) {
    return res.status(400).json({ error: "missing_required_fields" });
  }

  if (!["video", "image"].includes(adType)) {
    return res.status(400).json({ error: "invalid_ad_type" });
  }

  if (!["daily", "weekly", "monthly"].includes(plan)) {
    return res.status(400).json({ error: "invalid_plan" });
  }

  const ads = getAds();

  const ad = {
    id: nanoid(10),
    advertiserName,
    title,
    subtitle,
    adType,
    mediaUrl,
    ctaLabel,
    ctaUrl,
    plan,
    locations: Array.isArray(locations) ? locations : ["global"],
    startsAt,
    endsAt,
    enabled: true,
    createdAt: new Date().toISOString(),
    lastShownAt: null,
    impressions: 0,
  };

  ads.unshift(ad);
  saveAds(ads);

  res.json({ ad });
});

app.get("/ads", (req, res) => {
  res.json({ ads: getAds() });
});

app.post("/ads/:id/shown", (req, res) => {
  const { id } = req.params;
  const ads = getAds();

  const index = ads.findIndex((a) => a.id === id);
  if (index === -1) {
    return res.status(404).json({ error: "ad_not_found" });
  }

  ads[index].lastShownAt = new Date().toISOString();
  ads[index].impressions = Number(ads[index].impressions || 0) + 1;

  saveAds(ads);

  res.json({ ok: true, ad: ads[index] });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("NackFlix backend running on port", port);
});