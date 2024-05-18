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

export default class TorrentDownloader {
  #totalDownloaded;
  #totalSize;
  constructor(torrent) {
    this.torrent = torrent;
    this.#totalDownloaded = 0;
    this.#totalSize = TorrentHelper.getSize(torrent);
  }
  #chokeHandler(socket) {
    socket.end();
  }
  #unchokeHandler(socket, pieces, state) {
    state.chocked = false;
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
  #printProgress() {
    process.stdout.write(
      `Downloading ${Math.round(
        (this.#totalDownloaded * 100) / this.#totalSize
      )}% complete ....\r`
    );
  }
  #pieceHandler(payload, socket, pieces, queue, files) {
    pieces.addReceived(payload);
    const offset =
      payload.index * this.torrent.info["piece length"] + payload.begin;
    const fd = files[this.#getFileIndex(offset)];
    fs.write(fd, payload.block, 0, payload.block.length, offset, () => {
      this.#totalDownloaded += payload.block.length;
      this.#printProgress();
    });
    if (pieces.isDone()) {
      console.log("DONE!");
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
      if (m.id === 0) this.#chokeHandler(socket);
      if (m.id === 1) this.#unchokeHandler(socket, pieces, queue);
      if (m.id === 4) this.#haveHandler(m.payload, socket, pieces, queue);
      if (m.id === 5) this.#bitfieldHandler(m.payload, socket, pieces, queue);
      if (m.id === 7) {
        this.#pieceHandler(m.payload, socket, pieces, queue, files);
      }
    }
  }
  #requestPiece(socket, pieces, queue) {
    if (queue.chocked) return null;
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
    return (
      msg.length === msg.readUInt8(0) + 49 &&
      msg.toString("utf8", 1) === "BitTorrent protocol"
    );
  }
  #connectAndDownloadFromPeer(peer, pieces, files) {
    const socket = net.Socket();
    socket.on("error", (e) => {});
    socket.connect(peer.port, peer.ip, () => {
      socket.write(TorrentMessageBuilder.buildHandshake(this.torrent));
    });
    const queue = new Queue(this.torrent);
    onWholeMsg(socket, (msg) =>
      this.#msgHandler(msg, socket, pieces, queue, files)
    );
  }
  #createFdList(destPath) {
    let fds = [];
    if (this.torrent.info.files) {
      fds = this.torrent.info.files.map((file) =>
        fs.openSync(
          path.resolve(
            destPath,
            this.torrent.info.name.toString("utf8"),
            file.path.map((p) => p.toString("utf8")).join(path.sep)
          ),
          "w"
        )
      );
    } else {
      fds.push(
        fs.openSync(
          path.resolve(destPath, this.torrent.info.name.toString("utf8")),
          "w"
        )
      );
    }
    return fds;
  }
  #populateFiles(destPath) {
    if (this.torrent.info.files) {
      this.torrent.info.files.forEach((file) => {
        const filePath = path.resolve(
          destPath,
          this.torrent.info.name.toString("utf8"),
          file.path.map((p) => p.toString("utf8")).join(path.sep)
        );
        fs.ensureFileSync(filePath);
      });
    } else {
      fs.ensureFileSync(
        path.resolve(destPath, this.torrent.info.name.toString("utf8"))
      );
    }
  }
  download(path) {
    let tracker = null;
    if (new URL(this.torrent.announce.toString("utf8")).protocol === "http:") {
      tracker = new HTTPTracker(this.torrent);
    } else {
      tracker = new UDPTracker(this.torrent);
    }

    this.#populateFiles(path);
    const fds = this.#createFdList(path);
    tracker.getPeerList((peerlist) => {
      console.log("Download will start soon");
      const pieces = new Pieces(this.torrent);
      peerlist.forEach((peer) => {
        this.#connectAndDownloadFromPeer(peer, pieces, fds);
      });
    });
  }
}
