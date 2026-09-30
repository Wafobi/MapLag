# MapLag — Hide & Seek Map

Created with Claude AI.

## Overview
Single-page HTML/JS App für das JetLag Hide & Seek game. 

**Play now:** https://wafobi.github.io/MapLag/index.html

Everyone who enters the same password shares the same map. To run a separate
game with the same password, add a room name to the link, e.g.
`index.html?room=sunday`, and share that link.

## Tests

The app has no build step; the test bench runs the real app in jsdom with
Leaflet, Turf and a fake Firebase:

```sh
npm install
npm test
```
