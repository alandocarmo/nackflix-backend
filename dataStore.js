const fs = require("fs");
const path = require("path");

const creatorsPath = path.join(__dirname, "data", "creators.json");
const videosPath = path.join(__dirname, "data", "videos.json");

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
}

function getCreators() {
  return readJson(creatorsPath, { creators: [] }).creators;
}

function saveCreators(creators) {
  writeJson(creatorsPath, { creators });
}

function getVideos() {
  return readJson(videosPath, { videos: [] }).videos;
}

function saveVideos(videos) {
  writeJson(videosPath, { videos });
}

module.exports = {
  getCreators,
  saveCreators,
  getVideos,
  saveVideos,
};