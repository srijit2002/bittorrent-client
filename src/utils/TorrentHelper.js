import bencode from "bencode";
import fs from "fs";
import crypto from "crypto";

export default class TorrentHelper {
  static BLOCK_LEN = Math.pow(2, 14);
  static getBlockLen() {
    return this.BLOCK_LEN;
  }
  static parseTorrent(filePath) {
    return bencode.decode(fs.readFileSync(filePath), "utf8");
  }
  static parsePeerMsg(msg) {
    const id = msg.length > 4 ? msg.readInt8(4) : null;
    let payload = msg.length > 5 ? msg.slice(5) : null;
    if (id === 6 || id === 7 || id === 8) {
      const rest = payload.slice(8);
      payload = {
        index: payload.readInt32BE(0),
        begin: payload.readInt32BE(4),
      };
      payload[id === 7 ? "block" : "length"] = rest;
    }

    return {
      size: msg.readInt32BE(0),
      id: id,
      payload: payload,
    };
  }
  static getInfoHash(torrent) {
    const info = bencode.encode(torrent.info);
    return crypto.createHash("sha1").update(info).digest();
  }
  static getSize(torrent) {
    const size = torrent.info.files
      ? torrent.info.files.map((file) => file.length).reduce((a, b) => a + b, 0)
      : torrent.info.length;
    return BigInt(size);
  }
  static pieceLen(torrent, pieceIndex) {
    const totalLength = torrent.info.length;
    const pieceLength = torrent.info["piece length"];

    const lastPieceLength = totalLength % pieceLength;
    const lastPieceIndex = Math.floor(totalLength / pieceLength);

    return lastPieceIndex === pieceIndex ? lastPieceLength : pieceLength;
  }
  static getBlockLen(torrent, pieceIndex, blockIndex) {
    const pieceLength = this.pieceLen(torrent, pieceIndex);

    const lastPieceLength = pieceLength % this.BLOCK_LEN;
    const lastPieceIndex = Math.floor(pieceLength / this.BLOCK_LEN);

    return blockIndex === lastPieceIndex ? lastPieceLength : this.BLOCK_LEN;
  }
  static blocksPerPiece(torrent, pieceIndex) {
    const pieceLength = this.pieceLen(torrent, pieceIndex);
    return Math.ceil(pieceLength / this.BLOCK_LEN);
  }
}
