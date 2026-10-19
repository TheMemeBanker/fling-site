/* FLING — memecoin launchpad. Builds one pump.fun create transaction via PumpPortal's local API,
   signed in the user's own wallet. Art + metadata pinned to IPFS (relay if configured, else the user's Pinata key). */
const CONFIG = {
  uploadProxy: "",                                   // optional: your own relay (see worker/) e.g. "https://pin.yourdomain.xyz"
  rpcs: ["https://solana-rpc.publicnode.com", "https://solana.drpc.org", "https://api.mainnet-beta.solana.com"],
  tradeLocal: "https://pumpportal.fun/api/trade-local",
  feedWs: "wss://pumpportal.fun/api/data",
  gateway: "https://ipfs.io/ipfs/",
  fetchGateway: "https://gateway.pinata.cloud/ipfs/",     // gateway that sends CORS headers, used for reading metadata JSON in the browser
  pool: "pump",
};
const $ = (id) => document.getElementById(id);
const W3 = window.solanaWeb3;
const DRY = new URLSearchParams(location.search).get("dry") === "1";   // dry run: stop before broadcasting
let wallet = null, pubkey = null, imageFile = null, launching = false;

/* ---------- theme ---------- */
$("themeBtn").addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", cur);
  try { localStorage.setItem("fling-theme", cur); } catch (e) {}
});

/* ---------- wallet ---------- */
function provider() {
  const s = window.solana;
  if (s && (s.isPhantom || s.isSolflare || s.isBackpack || s.signTransaction)) return s;
  if (window.phantom?.solana) return window.phantom.solana;
  if (window.solflare?.isSolflare) return window.solflare;
  if (window.backpack) return window.backpack;
  return null;
}
async function connect() {
  const p = provider();
  if (!p) { setStatus("No Solana wallet found. Install Phantom, Solflare or Backpack and reload.", "err"); window.open("https://phantom.app/", "_blank", "noopener"); return; }
  try {
    const r = await p.connect();
    wallet = p; pubkey = (r && r.publicKey) ? r.publicKey : p.publicKey;
    const s = pubkey.toBase58();
    $("walletBtn").textContent = s.slice(0, 4) + "…" + s.slice(-4); $("walletBtn").classList.add("on");
    $("pvCreator").textContent = s.slice(0, 4) + "…" + s.slice(-4);
    setStatus("Wallet connected. Fill the form and fling it.");
    validate();
  } catch (e) { setStatus("Wallet connection was cancelled.", "err"); }
}
$("walletBtn").addEventListener("click", () => { if (!pubkey) connect(); else { wallet?.disconnect?.(); wallet = null; pubkey = null; $("walletBtn").textContent = "Connect wallet"; $("walletBtn").classList.remove("on"); $("pvCreator").textContent = "you"; validate(); } });
if (provider()?.isConnected && provider().publicKey) { wallet = provider(); pubkey = wallet.publicKey; const s = pubkey.toBase58(); $("walletBtn").textContent = s.slice(0,4)+"…"+s.slice(-4); $("walletBtn").classList.add("on"); $("pvCreator").textContent = s.slice(0,4)+"…"+s.slice(-4); }

/* ---------- form + live preview ---------- */
const f = { name: $("fName"), sym: $("fSymbol"), desc: $("fDesc"), tw: $("fTwitter"), tg: $("fTelegram"), web: $("fWebsite"), buy: $("fBuy"), slip: $("fSlip"), prio: $("fPrio") };
function num(v) { const n = parseFloat(String(v).replace(/[^0-9.]/g, "")); return isFinite(n) && n >= 0 ? n : 0; }
function preview() {
  $("nameCount").textContent = f.name.value.length + "/32";
  $("symCount").textContent = f.sym.value.length + "/10";
  $("descCount").textContent = f.desc.value.length + "/500";
  $("pvName").textContent = f.name.value.trim() || "Your coin";
  $("pvSym").textContent = "$" + (f.sym.value.trim().toUpperCase() || "TICKER");
  $("pvDesc").textContent = f.desc.value.trim() || "The description shows here. Keep it to one sharp line.";
  const b = num(f.buy.value); $("pvBuy").textContent = b > 0 ? "initial buy " + b + " SOL" : "";
}
function validate(silent) {
  const ok = f.name.value.trim().length > 0 && /^[A-Z0-9]{1,10}$/.test(f.sym.value.trim().toUpperCase()) && !!imageFile && !!pubkey && !launching;
  $("launchBtn").disabled = !ok;
  if (silent) return ok;
  if (!pubkey) setStatus("Connect a wallet to launch.");
  else if (!imageFile) setStatus("Add the art to enable launch.");
  else if (!ok && !launching) setStatus("Name and a 1–10 character ticker (A–Z, 0–9) are required.");
  else if (!launching) setStatus("Ready. Review the preview, then fling it.");
  return ok;
}
Object.values(f).forEach(el => el.addEventListener("input", () => { if (el === f.sym) el.value = el.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10); preview(); validate(); }));
const drop = $("dropZone"), fileIn = $("fImage");
function takeFile(file) {
  if (!file) return;
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) { setStatus("Use a PNG, JPG, GIF or WEBP.", "err"); return; }
  if (file.size > 4 * 1024 * 1024) { setStatus("Image is over 4 MB.", "err"); return; }
  imageFile = file;
  const url = URL.createObjectURL(file); $("pvImg").src = url; $("pvImg").classList.remove("pixel");
  $("dropTxt").textContent = file.name + " · " + Math.round(file.size / 1024) + " KB"; drop.classList.add("has");
  validate();
}
fileIn.addEventListener("change", () => takeFile(fileIn.files[0]));
["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", e => takeFile(e.dataTransfer.files[0]));
$("pvImg").classList.add("pixel");
try { const j = localStorage.getItem("fling-pinata"); if (j) $("pinataJwt").value = j; } catch (e) {}
$("pinataJwt").addEventListener("change", () => { try { localStorage.setItem("fling-pinata", $("pinataJwt").value.trim()); } catch (e) {} });
if (CONFIG.uploadProxy) { $("setupTxt").textContent = "Art and metadata are pinned to IPFS through this pad's relay before the coin is created. No key needed."; $("pinataJwt").closest("label").hidden = true; }

/* ---------- status / progress ---------- */
function setStatus(t, cls) { const s = $("status"); s.textContent = t; s.className = "fl-status" + (cls ? " " + cls : ""); }
function step(n, state) { $("progress").hidden = false; [...$("progress").children].forEach(li => { const k = +li.dataset.step; li.className = k < n ? "done" : k === n ? (state || "doing") : ""; }); }

/* ---------- pinning ---------- */
async function pinViaProxy(meta, file) {
  const fd = new FormData(); fd.append("file", file, file.name); Object.entries(meta).forEach(([k, v]) => fd.append(k, v ?? ""));
  const r = await fetch(CONFIG.uploadProxy.replace(/\/$/, "") + "/pin", { method: "POST", body: fd });
  if (!r.ok) throw new Error("Relay refused the upload (" + r.status + ")");
  const j = await r.json(); if (!j.metadataUri) throw new Error("Relay returned no metadata URI"); return j.metadataUri;
}
async function pinViaPinata(meta, file, jwt) {
  const h = { Authorization: "Bearer " + jwt };
  const fd = new FormData(); fd.append("file", file, file.name); fd.append("pinataMetadata", JSON.stringify({ name: meta.symbol + "-image" }));
  let r = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", { method: "POST", headers: h, body: fd });
  if (!r.ok) throw new Error("Pinata rejected the image (" + r.status + "). Check the key.");
  const img = await r.json();
  const json = { name: meta.name, symbol: meta.symbol, description: meta.description, image: CONFIG.gateway + img.IpfsHash, showName: true, createdOn: "https://pump.fun" };
  if (meta.twitter) json.twitter = meta.twitter; if (meta.telegram) json.telegram = meta.telegram; if (meta.website) json.website = meta.website;
  r = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", { method: "POST", headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify({ pinataContent: json, pinataMetadata: { name: meta.symbol + "-metadata" } }) });
  if (!r.ok) throw new Error("Pinata rejected the metadata (" + r.status + ")");
  const m = await r.json(); return CONFIG.gateway + m.IpfsHash;
}

/* ---------- launch ---------- */
async function rpcSend(raw) {
  let last;
  for (const url of CONFIG.rpcs) {
    try { const c = new W3.Connection(url, "confirmed"); const sig = await c.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 }); return { c, sig }; } catch (e) { last = e; }
  }
  throw last || new Error("No RPC accepted the transaction");
}
$("launchForm").addEventListener("submit", async (e) => {
  e.preventDefault(); if (!validate()) return;
  launching = true; $("launchBtn").disabled = true; $("result").hidden = true;
  const meta = { name: f.name.value.trim().slice(0, 32), symbol: f.sym.value.trim().toUpperCase().slice(0, 10), description: f.desc.value.trim().slice(0, 500), twitter: f.tw.value.trim(), telegram: f.tg.value.trim(), website: f.web.value.trim() };
  const buy = num(f.buy.value), slip = num(f.slip.value) || 10, prio = num(f.prio.value) || 0.0005;
  try {
    step(1); setStatus("Pinning art and metadata…");
    const jwt = $("pinataJwt").value.trim();
    let uri;
    if (CONFIG.uploadProxy) uri = await pinViaProxy(meta, imageFile);
    else if (jwt) uri = await pinViaPinata(meta, imageFile, jwt);
    else if (DRY) uri = "https://example.invalid/dry-run.json";
    else throw new Error("No pinning route. Add a Pinata JWT in the panel on the right (free at pinata.cloud) or configure the relay.");
    step(2); setStatus("Building the create transaction…");
    const mint = W3.Keypair.generate();
    const body = { publicKey: pubkey.toBase58(), action: "create", tokenMetadata: { name: meta.name, symbol: meta.symbol, uri }, mint: mint.publicKey.toBase58(), denominatedInSol: "true", amount: buy, slippage: slip, priorityFee: prio, pool: CONFIG.pool };
    const r = await fetch(CONFIG.tradeLocal, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error("Transaction builder refused: " + (await r.text()).slice(0, 140));
    const tx = W3.VersionedTransaction.deserialize(new Uint8Array(await r.arrayBuffer()));
    tx.sign([mint]);
    step(3); setStatus("Approve the transaction in your wallet…");
    const signed = await wallet.signTransaction(tx);
    if (DRY) { step(4, "done"); setStatus("Dry run complete: pinned, built and signed, not broadcast.", "ok"); showResult(mint.publicKey.toBase58(), null, meta); launching = false; validate(true); return; }
    step(4); setStatus("Sending…");
    const { c, sig } = await rpcSend(signed.serialize());
    setStatus("Confirming " + sig.slice(0, 8) + "…");
    const bh = await c.getLatestBlockhash("confirmed");
    const conf = await c.confirmTransaction({ signature: sig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight }, "confirmed");
    if (conf.value.err) throw new Error("Transaction failed on-chain: " + JSON.stringify(conf.value.err));
    step(4, "done"); setStatus("Flung. Your coin is live.", "ok");
    showResult(mint.publicKey.toBase58(), sig, meta); remember({ mint: mint.publicKey.toBase58(), sig, name: meta.name, symbol: meta.symbol, at: Date.now() });
  } catch (err) {
    setStatus(err.message || String(err), "err"); [...$("progress").children].forEach(li => { if (li.className === "doing") li.className = ""; });
  }
  launching = false; validate(true);
});
function showResult(mint, sig, meta) {
  const r = $("result"); r.hidden = false;
  r.innerHTML = `<b>${esc(meta.name)} ($${esc(meta.symbol)})</b><br>Mint <code>${mint}</code><br>` +
    `<a href="https://pump.fun/coin/${mint}" target="_blank" rel="noopener">Open on pump.fun</a> · <a href="https://solscan.io/token/${mint}" target="_blank" rel="noopener">Explorer</a>` +
    (sig ? ` · <a href="https://solscan.io/tx/${sig}" target="_blank" rel="noopener">Transaction</a>` : " · dry run, nothing sent");
}
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

/* ---------- your launches (local only) ---------- */
function mineLoad() { try { return JSON.parse(localStorage.getItem("fling-mine") || "[]"); } catch (e) { return []; } }
function remember(x) { const l = mineLoad(); l.unshift(x); try { localStorage.setItem("fling-mine", JSON.stringify(l.slice(0, 50))); } catch (e) {} renderMine(); }
function renderMine() {
  const l = mineLoad(); const el = $("mineList");
  if (!l.length) { el.innerHTML = '<div class="fl-live-empty">Nothing flung from here yet.</div>'; return; }
  el.innerHTML = l.map(x => `<a class="fl-row" href="https://pump.fun/coin/${x.mint}" target="_blank" rel="noopener"><span class="fl-row-art"><img src="./logo.png" alt="" style="image-rendering:pixelated;width:60%;height:60%;object-fit:contain"></span><span class="fl-row-name"><b>${esc(x.name)}</b><span>$${esc(x.symbol)}</span></span><span class="fl-row-k hide-m">mint<b>${x.mint.slice(0,4)}…${x.mint.slice(-4)}</b></span><span class="fl-row-k">status<b>${x.sig ? "live" : "dry run"}</b></span><span class="fl-row-t">${ago(x.at)}</span></a>`).join("");
}
function ago(t) { const s = Math.max(1, Math.round((Date.now() - t) / 1000)); return s < 60 ? s + "s ago" : s < 3600 ? Math.round(s / 60) + "m ago" : s < 86400 ? Math.round(s / 3600) + "h ago" : Math.round(s / 86400) + "d ago"; }

/* ---------- live board (pump.fun creates, via PumpPortal feed) ---------- */
let liveN = 0; const liveRows = [];
function liveConnect() {
  let ws; try { ws = new WebSocket(CONFIG.feedWs); } catch (e) { return; }
  ws.onopen = () => { ws.send(JSON.stringify({ method: "subscribeNewToken" })); $("liveEmpty").textContent = "Watching the feed — new coins appear as they land."; };
  ws.onmessage = (e) => { let d; try { d = JSON.parse(e.data); } catch (x) { return; } if (!d.mint || d.txType !== "create") return; liveAdd(d); };
  ws.onclose = () => setTimeout(liveConnect, 4000);
  ws.onerror = () => { try { ws.close(); } catch (e) {} };
}
function liveAdd(d) {
  liveN++; $("liveCount").textContent = liveN.toLocaleString("en-US");
  const name = d.name || "unnamed", sym = d.symbol || "?", mc = d.marketCapSol != null ? (+d.marketCapSol).toFixed(1) + " SOL" : "—", buy = d.solAmount ? (+d.solAmount).toFixed(2) + " SOL" : "0 SOL";
  const art = d.uri ? "" : "";
  const row = document.createElement("a"); row.className = "fl-row new"; row.href = "https://pump.fun/coin/" + d.mint; row.target = "_blank"; row.rel = "noopener";
  row.innerHTML = `<span class="fl-row-art"><img alt="" loading="lazy" src="./logo.png" style="image-rendering:pixelated;width:60%;height:60%;object-fit:contain;opacity:.7" data-uri="${esc(d.uri || "")}"></span><span class="fl-row-name"><b>${esc(name)}</b><span>$${esc(sym)}</span></span><span class="fl-row-k hide-m">dev buy<b>${buy}</b></span><span class="fl-row-k">market cap<b>${mc}</b></span><span class="fl-row-t">just now</span>`;
  const board = $("liveBoard"); const empty = $("liveEmpty"); if (empty) empty.remove();
  board.prepend(row); liveRows.unshift({ row, at: Date.now() });
  while (liveRows.length > 40) liveRows.pop().row.remove();
  resolveArt(row.querySelector("img"));
}
async function resolveArt(img) {
  const uri = img.dataset.uri; if (!uri) return;
  const m = uri.match(/(?:ipfs:\/\/|\/ipfs\/)([A-Za-z0-9]+)/); if (!m) return;   // non-IPFS hosts block browser reads; keep the placeholder
  try {
    const u = CONFIG.fetchGateway + m[1];
    const r = await fetch(u, { cache: "force-cache" }); const j = await r.json(); let src = j.image || "";
    const im = src.match(/(?:ipfs:\/\/|\/ipfs\/)([A-Za-z0-9]+)/); if (im) src = CONFIG.gateway + im[1];
    if (src) { img.src = src; img.style.cssText = ""; }
  } catch (e) {}
}
setInterval(() => { liveRows.forEach(x => { const t = x.row.querySelector(".fl-row-t"); if (t) t.textContent = ago(x.at); }); }, 15000);

preview(); validate(); renderMine(); liveConnect();
