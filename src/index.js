"use strict";
import TorrentDownloader from "./utils/TorrentDownloader.js";
import TorrentHelper from "./utils/TorrentHelper.js";
import path from "path";

if (process.argv[2]) {
  const torrent = TorrentHelper.parseTorrent(path.resolve(process.argv[2]));
  new TorrentDownloader(".bt-client").download(
    torrent,
    path.resolve("downloads")
  );
} else {
  console.log("Usage: node src/index.js <filepath>");
}
