import crypto from "crypto";
import dgram from "node:dgram";
import TorrentHelper from "../utils/TorrentHelper.js";
import IDGenerator from "./IDGenerator.js";

export default class UDPTracker {
  #torrentUrl;
  constructor(torrent) {
    this.torrent = torrent;
    this.#torrentUrl = new URL(torrent.announce.toString("utf8"));
  }
  #udpSend(socket, message, url, callback = () => {}) {
    socket.send(message, 0, message.length, url.port, url.hostname, callback);
  }
  #getRespType(resp) {
    const action = resp.readUInt32BE(0);
    if (action === 0) return "connect";
    if (action === 1) return "announce";
    return "error";
  }
  #buildConnReq() {
    const buf = Buffer.alloc(16);
    // connection id
    buf.writeUInt32BE(0x417, 0);
    buf.writeUInt32BE(0x27101980, 4);
    // action
    buf.writeUInt32BE(0, 8);
    // transaction id
    crypto.randomBytes(4).copy(buf, 12);
    return buf;
  }

  #parseConnResp(resp) {
    return {
      action: resp.readUInt32BE(0),
      transactionId: resp.readUInt32BE(4),
      connectionId: resp.slice(8),
    };
  }
  #parseAnnounceResp(resp) {
    function group(iterable, groupSize) {
      let groups = [];
      for (let i = 0; i < iterable.length; i += groupSize) {
        groups.push(iterable.slice(i, i + groupSize));
      }
      return groups;
    }

    return {
      action: resp.readUInt32BE(0),
      transactionId: resp.readUInt32BE(4),
      leechers: resp.readUInt32BE(8),
      seeders: resp.readUInt32BE(12),
      peers: group(resp.slice(20), 6).map((address) => {
        return {
          ip: address.slice(0, 4).join("."),
          port: address.readUInt16BE(4),
        };
      }),
    };
  }
  #buildAnnounceReq(connId, port = 6881) {
    const buf = Buffer.allocUnsafe(98);

    // connection id
    connId.copy(buf, 0);
    // action
    buf.writeUInt32BE(1, 8);
    // transaction id
    crypto.randomBytes(4).copy(buf, 12);
    // info hash
    TorrentHelper.getInfoHash(this.torrent).copy(buf, 16);
    // peerId
    IDGenerator.generate().copy(buf, 36);
    // downloaded
    Buffer.alloc(8).copy(buf, 56);
    // left
    let buff = Buffer.alloc(8);
    buff.writeBigInt64BE(BigInt(TorrentHelper.getSize(this.torrent)));
    buff.copy(buf, 64);
    // uploaded
    Buffer.alloc(8).copy(buf, 72);
    // event
    buf.writeUInt32BE(0, 80);
    // ip address
    buf.writeUInt32BE(0, 80);
    // key
    crypto.randomBytes(4).copy(buf, 88);
    // num want
    buf.writeInt32BE(-1, 92);
    // port
    buf.writeUInt16BE(port, 96);

    return buf;
  }
  getPeerList(callback = () => {}) {
    const socket = dgram.createSocket("udp4");
    this.#udpSend(socket, this.#buildConnReq(), this.#torrentUrl, (err) => {
      if (err) {
        socket.close();
        console.log("Some error has occured -> ", err);
        return;
      }
      console.log("Connection request sent to tracker ");
    });

    socket.on("message", (response) => {
      if (this.#getRespType(response) === "connect") {
        const connResp = this.#parseConnResp(response);
        const announceReq = this.#buildAnnounceReq(connResp.connectionId);
        this.#udpSend(socket, announceReq, this.#torrentUrl);
      } else if (this.#getRespType(response) === "announce") {
        const announceResp = this.#parseAnnounceResp(response);
        callback(announceResp.peers);
      } else {
        console.log("Tracker Error: ", response.toString("utf8", 8));
      }
    });
  }
}
