"use strict";
import TorrentDownloader from "./utils/TorrentDownloader.js";
import TorrentHelper from "./utils/TorrentHelper.js";
import path from "path";

const torrent = TorrentHelper.parseTorrent(path.resolve(process.argv[2]));
new TorrentDownloader(torrent).download(path.resolve("./downloads"));
/*
<Buffer 7d 6d 06 34 1e 6f 0d da b5 eb c0 ea 73 8c 16 3a 9f 71 9a 0d>

should: -> 
<Buffer c7 98 fe 1b 5b 7c 97 d1 14 b0 cc 07 9c c2 40 bf 8a 33 c3 ab>
%c7%98%fe%1b%5b%7c%97%d1%14%b0%cc%07%9c%c2%40%bf%8a3%c3%ab
*/
