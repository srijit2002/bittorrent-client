"use strict";
import TorrentDownloader from "./utils/TorrentDownloader.js";
import TorrentHelper from "./utils/TorrentHelper.js";
import path from "path";

const torrent = TorrentHelper.parseTorrent(path.resolve(process.argv[2]));
new TorrentDownloader(torrent).download(path.resolve("./downloads"));
