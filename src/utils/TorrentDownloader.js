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

export default class TorrentDownloader {
  #totalSize;
  #progressBar;
  constructor(torrent) {
    this.torrent = torrent;
    this.#totalSize = TorrentHelper.getSize(torrent);
    this.#progressBar = new cliProgress.SingleBar({
      format: colors.green("{bar}") + " {percentage}% complete",
      barCompleteChar: "\u2588",
      barIncompleteChar: "\u2591",
      hideCursor: true,
    });
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

  #getFileIndex(offset) {
    if (!this.torrent.info.files) return 0;
    let index = 0;
    let curLength = 0;
    for (let file of this.torrent.info.files) {
      if (offset >= curLength && offset < curLength + file.length) {
        break;
      }
      index++;
      curLength += file.length;
    }
    return index;
  }

  #printProgress(pieces) {
    this.#progressBar.update(pieces.getDownloadedBlockCount());
  }

  #pieceHandler(payload, socket, pieces, queue, files) {
    if (pieces.getDownloadedBlockCount() === 0) {
      process.stdout.write(`Downloading...\n`);
      this.#progressBar.start(pieces.getTotalBlockCount());
    }
    pieces.addReceived(payload);
    this.#printProgress(pieces);
    const offset = payload.index * this.torrent.info["piece length"] + payload.begin;
    const fd = files[this.#getFileIndex(offset)];
    fs.write(fd, payload.block, 0, payload.block.length, offset);
    if (pieces.isDone()) {
      console.log("DONE!");
      this.#progressBar.stop();
      socket.end();
      try {
        files.forEach((file) => file.close());
      } catch (e) {
        console.log("Error in closing file");
      }
    } else {
      this.#requestPiece(socket, pieces, queue);
    }
  }

  #msgHandler(msg, socket, pieces, queue, files) {
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
          this.#pieceHandler(m.payload, socket, pieces, queue, files);
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
    const isFirstPiece = queue.length() == 0;
    const pieceIndex = payload.readUInt32BE(0);
    queue.queue(pieceIndex);
    if (isFirstPiece) {
      this.#requestPiece(socket, pieces, queue);
    }
  }

  #isHandshake(msg) {
    return msg.length === msg.readUInt8(0) + 49 && msg.toString("utf8", 1) === "BitTorrent protocol";
  }

  #connectAndDownloadFromPeer(peer, pieces, files) {
    const socket = new net.Socket();
    socket.on("error", (e) => {});
    socket.connect(peer.port, peer.ip, () => {
      socket.write(TorrentMessageBuilder.buildHandshake(this.torrent));
    });
    const queue = new Queue(this.torrent);
    onWholeMsg(socket, (msg) => this.#msgHandler(msg, socket, pieces, queue, files));
  }

  #createFdList(destPath) {
    if (this.torrent.info.files) {
      return this.torrent.info.files.map((file) =>
        fs.openSync(
          path.resolve(destPath, this.torrent.info.name.toString("utf8"), file.path.map((p) => p.toString("utf8")).join(path.sep)),
          "w"
        )
      );
    } else {
      return [
        fs.openSync(path.resolve(destPath, this.torrent.info.name.toString("utf8")), "w")
      ];
    }
  }

  #populateFiles(destPath) {
    if (this.torrent.info.files) {
      this.torrent.info.files.forEach((file) => {
        const filePath = path.resolve(destPath, this.torrent.info.name.toString("utf8"), file.path.map((p) => p.toString("utf8")).join(path.sep));
        fs.ensureFileSync(filePath);
      });
    } else {
      fs.ensureFileSync(path.resolve(destPath, this.torrent.info.name.toString("utf8")));
    }
  }

  #fetchPeers(callback) {
    let peerlist = new Set();
    let cur = 0;
    const trackerInterval = setInterval(() => {
      if (cur >= this.torrent["announce-list"].length) {
        clearInterval(trackerInterval);
        console.log("Please try again after some time");
        return;
      }
      const url = this.torrent["announce-list"][cur][0].toString("utf8");
      const tracker = new URL(url).protocol === "http:" ? new HTTPTracker(this.torrent) : new UDPTracker(this.torrent);
      tracker.getPeerList((peers) => {
        peers.forEach((peer) => peerlist.add(peer));
        if (peerlist.size >= 8) {
          clearInterval(trackerInterval);
          callback(Array.from(peerlist));
        }
      });
      cur++;
    }, 2500);
  }

  download(destPath) {
    this.#populateFiles(destPath);
    const fds = this.#createFdList(destPath);
    process.stdout.write("Peer discovery in progress\n\n");
    this.#fetchPeers((peerlist) => {
      const pieces = new Pieces(this.torrent);
      peerlist.forEach((peer) => this.#connectAndDownloadFromPeer(peer, pieces, fds));
    });
  }
}
