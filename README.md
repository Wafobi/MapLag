# MapLag — Hide & Seek Map

Created with Claude AI.

## Overview
Single-page HTML/JS App für das JetLag Hide & Seek game. 

**Play now:** https://wafobi.github.io/MapLag/index.html

Everyone who enters the same password shares the same map. To run a separate
game with the same password, add a room name to the link, e.g.
`index.html?room=sunday`, and share that link.

## Offline

- **Dead zones:** everything you draw is stored on the device first and
  uploaded once the connection is back — also after closing or reloading
  the app. A badge on the map shows when you are offline and how many
  changes are still pending.
- **Solo:** "📴 Offline spielen" in the start dialog plays without password
  and without sync; the map is kept on this device only.
- **Map tiles:** every tile you have looked at online is kept (up to ~4000)
  and shown offline. The transit layer is not cached. The app itself also
  opens without network once it has been loaded online.

## Tests

The app has no build step; the test bench runs the real app in jsdom with
Leaflet, Turf and a fake Firebase:

```sh
npm install
npm test
```
