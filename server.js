const express = require("express");
const cors = require("cors");
const { nanoid } = require("nanoid");
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const { getR2Client } = require("./r2");
const { getCreators, saveCreators, getVideos, saveVideos } = require("./dataStore");

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

  let videos = getVideos().filter((v) => v.enabled);

  if (creator) {
    videos = videos.filter(
      (v) => String(v.creatorHandle || "").toLowerCase() === creator
    );
  }

  res.json({ videos: videos.slice(0, limit) });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("NackFlix backend running on port", port);
});