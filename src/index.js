"use strict";
import TorrentDownloader from "./utils/TorrentDownloader.js";
import TorrentHelper from "./utils/TorrentHelper.js";
import path from "path";
import createFiles from "./utils/createFiles.js";
import Pieces from "./lib/Pieces.js";

const torrent = TorrentHelper.parseTorrent(path.resolve(process.argv[2]));
// new TorrentDownloader(".bt-client").download(
//   torrent,
//   path.resolve("downloads")
// );
