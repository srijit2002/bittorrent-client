import Tracker from "../lib/Tracker.js";
import net from "node:net";
import TorrentMessageBuilder from "./TorrentMessageBuilder.js";
import TorrentHelper from "./TorrentHelper.js";
import Pieces from "../lib/Pieces.js";
import Queue from "../lib/Queue.js";
import fs from "fs-extra";
import onWholeMsg from "./onWholeMessage.js";
import path from "node:path";

export default class TorrentDownloader {
  constructor(torrent) {
    this.torrent = torrent;
  }
  #chokeHandler(socket) {
    socket.close();
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
    if (!this.torrent.files) return 0;
    let index = 0;
    const curLength = 0;
    for (let file of this.torrent.files) {
      if (offset >= curLength && offset < curLength + file.length) {
        break;
      }
      index++;
      curLength += file.length;
    }
    return index;
  }
  #pieceHandler(payload, socket, pieces, queue, files) {
    console.log("Writing Piece");
    pieces.addReceived(payload);
    const offset = pieces.index * torrent.info["piece length"] + pieces.begin;
    const fd = files[this.#getFileIndex(offset)];
    fs.write(fd, pieces.block, 0, pieces.block.length, offset, () => {});

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
    queue.push(pieceIndex);
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
    socket.on("error", console.log);
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
            this.torrent.info.name,
            file.path.join(path.sep)
          ),
          "w"
        )
      );
    } else {
      fds.push(
        fs.openSync(path.resolve(destPath, this.torrent.info.name), "w")
      );
    }
    return fds;
  }
  #populateFiles(destPath) {
    if (this.torrent.info.files) {
      this.torrent.info.files.forEach((file) =>
        fs.ensureFileSync(
          path.resolve(
            destPath,
            this.torrent.info.name,
            file.path.join(path.sep)
          ),
          ""
        )
      );
    } else {
      fs.writeFileSync(path.resolve(destPath, this.torrent.info.name), "");
    }
  }
  download(path) {
    const tracker = new Tracker(this.torrent);
    this.#populateFiles(path);
    const fds = this.#createFdList(path);
    tracker.getPeerList((peerlist) => {
      const pieces = new Pieces(this.torrent);
      peerlist.forEach((peer) => {
        this.#connectAndDownloadFromPeer(peer, pieces, fds);
      });
    });
  }
}
