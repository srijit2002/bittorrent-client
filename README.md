# BitTorrent Client

A command line toy BitTorrent client written in Node.js.

## Features ✨

- Supports downloading files (both single and multiple files) 📂
- Can be resumed and paused ⏸️
- Shows download progress 📊

## Requirements

- Node.js: [Download here](https://nodejs.org/)

## How to Run

1. Clone the repo:
   ```sh
   git clone https://github.com/srijit2002/bittorrent-client.git
   ```
2. Navigate to the project directory:
   ```sh
   cd bittorrent-client
   ```
3. Install the necessary dependencies:
   ```sh
   npm install
   ```
4. Run the client:
   ```sh
   node src/index.js <torrent file path>
   ```

**Note:** Currently, only UDP trackers are supported.

## Resources Used 📚

- [How to Make Your Own BitTorrent Client](https://allenkim67.github.io/programming/2016/05/04/how-to-make-your-own-bittorrent-client.html)
- [BitTorrent Internals](https://youtube.com/playlist?list=PLsdq-3Z1EPT1rNeq2GXpnivaWINnOaCd0&si=PG77h6g2msxq1Zd6)
- [BitTorrent Specification](https://wiki.theory.org/BitTorrentSpecification)
- [BEP 0003](https://www.bittorrent.org/beps/bep_0003.html)
- [UDP Tracker Protocol](https://www.rasterbar.com/products/libtorrent/udp_tracker_protocol.html)
- [BEP 0015](https://www.bittorrent.org/beps/bep_0015.html)
---
