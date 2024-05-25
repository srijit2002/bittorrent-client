"use strict";
import TorrentDownloader from "./utils/TorrentDownloader.js";
import TorrentHelper from "./utils/TorrentHelper.js";
import path from "path";
import printFileInfo from "./utils/printFileInfo.js";

if (process.argv[2]) {
  const torrent = TorrentHelper.parseTorrent(path.resolve(process.argv[2]));
  printFileInfo(torrent);
  let torrentDownloader = new TorrentDownloader(".bt-client");
  torrentDownloader.download(torrent, path.resolve("downloads"));
} else {
  console.log("Usage: node src/index.js <filepath>");
}
