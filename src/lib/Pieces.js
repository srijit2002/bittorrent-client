"use strict";
import TorrentHelper from "../utils/TorrentHelper.js";

export default class Pieces {
  constructor(torrent) {
    function buildPiecesArray() {
      const nPieces = torrent.info.pieces.length / 20;
      const arr = new Array(nPieces).fill(null);
      return arr.map((_, i) =>
        new Array(TorrentHelper.blocksPerPiece(torrent, i)).fill(false)
      );
    }
    this._requested = buildPiecesArray();
    this._received = buildPiecesArray();
    this._totalBlocks = this._received.reduce((totalBlocks, blocks) => {
      return blocks.length + totalBlocks;
    }, 0);
  }

  addRequested(pieceBlock) {
    const blockIndex = pieceBlock.begin / TorrentHelper.BLOCK_LEN;
    this._requested[pieceBlock.index][blockIndex] = true;
  }

  addReceived(pieceBlock) {
    const blockIndex = pieceBlock.begin / TorrentHelper.BLOCK_LEN;
    this._received[pieceBlock.index][blockIndex] = true;
  }

  needed(pieceBlock) {
    if (this._requested.every((blocks) => blocks.every((i) => i))) {
      this._requested = this._received.map((blocks) => blocks.slice());
    }
    const blockIndex = pieceBlock.begin / TorrentHelper.BLOCK_LEN;
    return !this._requested[pieceBlock.index][blockIndex];
  }

  isDone() {
    return this._received.every((blocks) => blocks.every((i) => i));
  }
  getTotalBlockCount() {
    return this._totalBlocks;
  }
  getDownloadedBlockCount() {
    const downloaded = this._received.reduce((totalBlocks, blocks) => {
      return blocks.filter((i) => i).length + totalBlocks;
    }, 0);
    return downloaded;
  }
}
