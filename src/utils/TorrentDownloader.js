import net from "node:net";
import TorrentMessageBuilder from "./TorrentMessageBuilder.js";
import TorrentHelper from "./TorrentHelper.js";
import Pieces from "../lib/Pieces.js";
import Queue from "../lib/Queue.js";
import fs from "fs-extra";
import onWholeMsg from "./onWholeMessage.js";
import path from "node:path";
import HTTPTracker from "../lib/HTTPTracker.js";
import UDPTracker from "../lib/UDPTracker.js";
import cliProgress from "cli-progress";
import colors from "ansi-colors";
import createFiles from "./createFiles.js";

export default class TorrentDownloader {
  #progressBar;
  #inProgreesFilePath;
  #destFolderPath;
  #systemDir;
  constructor(systemDir) {
    this.#progressBar = new cliProgress.SingleBar({
      format: colors.green("{bar}") + " {percentage}% complete",
      barCompleteChar: "\u2588",
      barIncompleteChar: "\u2591",
      hideCursor: true,
    });
    this.#systemDir = systemDir;
  }

  #chokeHandler(socket) {
    socket.end();
  }

  #unchokeHandler(socket, pieces, state) {
    state.choked = false;
    this.#requestPiece(socket, pieces, state);
  }

  #bitfieldHandler(payload, socket, pieces, queue) {
    const isFirstPiece = queue.length() == 0;
    payload.forEach((byte, i) => {
      for (let j = 0; j < 8; j++) {
        if (byte % 2) queue.queue(i * 8 + 7 - j);
        byte = Math.floor(byte / 2);
      }
    });
    if (isFirstPiece) this.#requestPiece(socket, pieces, queue);
  }
  #printProgress(pieces) {
    this.#progressBar.update(pieces.getDownloadedBlockCount());
  }
  #getFolderStruc() {
    if (!this.torrent.info.files) {
      return [
        {
          path: path.resolve(
            this.#destFolderPath,
            this.info.name.toString("utf8")
          ),
          size: this.torrent.info.length,
        },
      ];
    }
    const folderStruc = this.torrent.info.files.map((file) => ({
      path: path.resolve(
        this.#destFolderPath,
        file.path.map((p) => p.toString("utf8")).join(path.sep)
      ),
      size: file.length,
    }));
    return folderStruc;
  }
  #pieceHandler(payload, socket, pieces, queue, file) {
    if (pieces.getDownloadedBlockCount() === 0) {
      process.stdout.write(`Downloading...\n`);
      this.#progressBar.start(pieces.getTotalBlockCount());
    }
    pieces.addReceived(payload);
    this.#printProgress(pieces);
    const offset =
      payload.index * this.torrent.info["piece length"] + payload.begin;
    fs.writeSync(file, payload.block, 0, payload.block.length, offset);
    if (pieces.isDone()) {
      createFiles(this.#inProgreesFilePath, this.#getFolderStruc());
      this.#progressBar.stop();
      try {
        fs.unlinkSync(this.#inProgreesFilePath);
        socket.end();
        fs.closeSync(file);
      } catch (error) {
      } finally {
        console.log("\nDONE!");
        process.exit(0);
      }
    } else {
      this.#requestPiece(socket, pieces, queue);
    }
  }

  #msgHandler(msg, socket, pieces, queue, file) {
    if (this.#isHandshake(msg)) {
      socket.write(TorrentMessageBuilder.buildInterested());
    } else {
      const m = TorrentHelper.parsePeerMsg(msg);
      switch (m.id) {
        case 0:
          this.#chokeHandler(socket);
          break;
        case 1:
          this.#unchokeHandler(socket, pieces, queue);
          break;
        case 4:
          this.#haveHandler(m.payload, socket, pieces, queue);
          break;
        case 5:
          this.#bitfieldHandler(m.payload, socket, pieces, queue);
          break;
        case 7:
          this.#pieceHandler(m.payload, socket, pieces, queue, file);
          break;
      }
    }
  }

  #requestPiece(socket, pieces, queue) {
    if (queue.choked) return null;
    while (queue.length()) {
      const pieceBlock = queue.deque();
      if (pieces.needed(pieceBlock)) {
        socket.write(TorrentMessageBuilder.buildRequest(pieceBlock));
        pieces.addRequested(pieceBlock);
        break;
      }
    }
  }

  #haveHandler(payload, socket, pieces, queue) {
    const isFirstPiece = queue.length() === 0;
    const pieceIndex = payload.readUInt32BE(0);
    queue.queue(pieceIndex);
    if (isFirstPiece) {
      this.#requestPiece(socket, pieces, queue);
    }
  }

  #isHandshake(msg) {
    return (
      msg.length === msg.readUInt8(0) + 49 &&
      msg.toString("utf8", 1) === "BitTorrent protocol"
    );
  }

  #connectAndDownloadFromPeer(peer, pieces, file) {
    const socket = new net.Socket();
    socket.on("error", (e) => {});
    socket.connect(peer.port, peer.ip, () => {
      socket.write(TorrentMessageBuilder.buildHandshake(this.torrent));
    });
    const queue = new Queue(this.torrent);
    onWholeMsg(socket, (msg) =>
      this.#msgHandler(msg, socket, pieces, queue, file)
    );
  }

  #fetchPeers(callback = () => {}) {
    const PEER_COUNT = 30;
    let peerlist = new Set();
    let announceList = this.torrent["announce-list"];
    for (let announceUrl of announceList) {
      const url = announceUrl[0].toString("utf8");
      this.torrent.announce = announceUrl[0];
      let tracker = null;
      if (new URL(url).protocol === "http:") {
        tracker = new HTTPTracker(this.torrent);
      } else {
        if (new URL(url).port) {
          tracker = new UDPTracker(this.torrent);
        }
      }
      if (tracker) {
        tracker.getPeerList((peers) => {
          peers.forEach((peer) => peerlist.add(peer));
          if (peerlist.size >= PEER_COUNT) {
            callback(Array.from(peerlist));
          }
        });
      }
    }
  }

  download(torrent, dpath) {
    this.torrent = torrent;
    this.#destFolderPath = dpath;
    this.#inProgreesFilePath = path.resolve(
      this.#systemDir,
      this.torrent.info.name.toString("utf8")
    );
    fs.ensureFileSync(this.#inProgreesFilePath);
    const fd = fs.openSync(this.#inProgreesFilePath, "w");
    process.stdout.write("Peer discovery in progress\n\n");
    this.#fetchPeers((peerlist) => {
      const pieces = new Pieces(this.torrent);
      peerlist.forEach((peer) =>
        this.#connectAndDownloadFromPeer(peer, pieces, fd)
      );
    });
  }
}
