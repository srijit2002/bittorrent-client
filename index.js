#!/usr/bin/env node
"use strict";
import TorrentDownloader from "./src/utils/TorrentDownloader.js";
import TorrentHelper from "./src/utils/TorrentHelper.js";
import path from "path";
import printFileInfo from "./src/utils/printFileInfo.js";
import showSelectFileDialog from "./src/utils/showSelectFileDialog.js";
import ansiColors from "ansi-colors";

showSelectFileDialog((torrentFilePath) => {
  if (path.extname(torrentFilePath) !== ".torrent") {
    console.log(ansiColors.red("Invalid .torrent file"));
  } else {
    const torrent = TorrentHelper.parseTorrent(torrentFilePath);
    printFileInfo(torrent);
    let torrentDownloader = new TorrentDownloader(".bt-client");
    torrentDownloader.download(torrent, path.resolve("downloads"));
  }
});
