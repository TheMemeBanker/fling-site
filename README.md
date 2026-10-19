# FLING — fling your memecoin

A static memecoin launchpad for pump.fun. One form, one wallet signature, no custody.

- `index.html` / `fling.css` / `app.js` — the whole site. Hosted on GitHub Pages.
- Launch flow: pin art + metadata to IPFS → PumpPortal local API builds the pump.fun create transaction → the user signs in Phantom/Solflare/Backpack → sent to Solana.
- Live board: PumpPortal's public websocket feed of new pump.fun coins.

## Pinning (one-time setup)
pump.fun no longer accepts direct metadata uploads, so art is pinned through Pinata.
- **Relay (recommended for a public pad):** deploy `worker/` to Cloudflare Workers (`wrangler secret put PINATA_JWT`, then `wrangler deploy`) and set `CONFIG.uploadProxy` in `app.js` to the worker URL. Launchers then need nothing.
- **No relay:** launchers paste their own Pinata JWT in the panel on the launch page; it is stored only in their browser.

Add `?dry=1` to the URL to run the whole flow without broadcasting (pins, builds and signs, never sends).
