/* FLING — memecoin launchpad. Builds one pump.fun create transaction via PumpPortal's local API,
   signed in the user's own wallet. Art + metadata pinned to IPFS (relay if configured, else the user's Pinata key). */
const CONFIG = {
  uploadProxy: "",                                   // optional: your own relay (see worker/) e.g. "https://pin.yourdomain.xyz"
  rpcs: ["https://solana-rpc.publicnode.com", "https://solana.drpc.org", "https://api.mainnet-beta.solana.com"],
  tradeLocal: "https://pumpportal.fun/api/trade-local",
  feedWs: "wss://pumpportal.fun/api/data",
  irysGateway: "https://gateway.irys.xyz/",                 // permanent storage (Arweave via Irys); uploads under 100 KiB are free, signed by the launcher's wallet
  irysBundle: "./vendor/irys.bundle.js",
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
    validate(); showBalance();
  } catch (e) { setStatus("Wallet connection was cancelled.", "err"); }
}
$("walletBtn").addEventListener("click", () => { if (!pubkey) connect(); else { wallet?.disconnect?.(); wallet = null; pubkey = null; $("walletBtn").textContent = "Connect wallet"; $("walletBtn").classList.remove("on"); $("pvCreator").textContent = "you"; validate(); } });
if (provider()?.isConnected && provider().publicKey) { wallet = provider(); pubkey = wallet.publicKey; const s = pubkey.toBase58(); $("walletBtn").textContent = s.slice(0,4)+"…"+s.slice(-4); $("walletBtn").classList.add("on"); $("pvCreator").textContent = s.slice(0,4)+"…"+s.slice(-4); }

async function showBalance() {
  const el = $("walletBal"); if (!pubkey) { el.hidden = true; return; }
  for (const url of CONFIG.rpcs) {
    try { const c = new W3.Connection(url, "confirmed"); const lam = await c.getBalance(pubkey); el.hidden = false; el.innerHTML = "Wallet balance <b>" + (lam / 1e9).toFixed(4) + " SOL</b>"; return; } catch (e) {}
  }
  el.hidden = true;
}
/* pump.fun bonding curve at launch: 30 virtual SOL, 1.073B virtual tokens, 1% fee on the buy */
function quote(sol) {
  if (!(sol > 0)) return null;
  const vS = 30, vT = 1_073_000_000, net = sol * 0.99;
  const out = vT - (vS * vT) / (vS + net);
  return { tokens: out, pct: out / 1_000_000_000 * 100 };
}
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
  const q = quote(b); $("buyQuote").textContent = q ? "≈ " + Math.round(q.tokens).toLocaleString("en-US") + " tokens · " + q.pct.toFixed(2) + "% of supply" : "";
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
  squareCrop(file).then(cropped => {
    imageFile = cropped;
    const url = URL.createObjectURL(cropped); $("pvImg").src = url; $("pvImg").classList.remove("pixel");
    $("dropTxt").textContent = cropped.name + " · " + Math.round(cropped.size / 1024) + " KB" + (cropped !== file ? " · cropped square" : ""); drop.classList.add("has");
    validate();
  });
}
/* centre-crop non-square stills to a square (GIFs are left untouched to keep animation) */
async function squareCrop(file) {
  if (file.type === "image/gif") return file;
  try {
    const bmp = await createImageBitmap(file);
    if (bmp.width === bmp.height) return file;
    const s = Math.min(bmp.width, bmp.height, 1024);
    const cv = document.createElement("canvas"); cv.width = s; cv.height = s;
    const src = Math.min(bmp.width, bmp.height);
    cv.getContext("2d").drawImage(bmp, (bmp.width - src) / 2, (bmp.height - src) / 2, src, src, 0, 0, s, s);
    const blob = await new Promise(r => cv.toBlob(r, "image/png"));
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".png", { type: "image/png" });
  } catch (e) { return file; }
}
fileIn.addEventListener("change", () => takeFile(fileIn.files[0]));
["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", e => takeFile(e.dataTransfer.files[0]));
$("pvImg").classList.add("pixel");
try { const j = localStorage.getItem("fling-pinata"); if (j) $("pinataJwt").value = j; } catch (e) {}
$("pinataJwt").addEventListener("change", () => { try { localStorage.setItem("fling-pinata", $("pinataJwt").value.trim()); } catch (e) {} });
if (CONFIG.uploadProxy) { $("setup").hidden = true; }

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

/* ---------- vanity mint (optional): grind for a base58 key ending in "pump" in web workers ---------- */
const WORKER_SRC = `importScripts("https://cdn.jsdelivr.net/npm/@solana/web3.js@1.98.0/lib/index.iife.min.js");
let stop=false; onmessage=(e)=>{ if(e.data==="stop"){stop=true;return;} const suffix=e.data; let n=0;
  while(!stop){ const kp=solanaWeb3.Keypair.generate(); n++; if(kp.publicKey.toBase58().endsWith(suffix)){ postMessage({found:Array.from(kp.secretKey),n}); return; } if(n%2000===0) postMessage({n:2000}); } };`;
function grindVanity(suffix, onProgress) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: "application/javascript" }));
    const n = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1)); const ws = []; let total = 0, done = false;
    const finish = (kp) => { if (done) return; done = true; ws.forEach(w => { try { w.postMessage("stop"); w.terminate(); } catch (e) {} }); resolve(kp); };
    for (let i = 0; i < n; i++) {
      const w = new Worker(url); ws.push(w);
      w.onmessage = (e) => { if (e.data.found) finish(W3.Keypair.fromSecretKey(Uint8Array.from(e.data.found))); else { total += e.data.n; onProgress(total, n); } };
      w.onerror = () => { finish(null); };
      w.postMessage(suffix);
    }
    grindVanity.cancel = () => finish(null);
  });
}
/* ---------- permanent storage via Irys (default route, no keys) ---------- */
let irysLoading = null;
function loadIrys() {
  if (window.IrysWeb) return Promise.resolve();
  if (!irysLoading) irysLoading = new Promise((res, rej) => { const s = document.createElement("script"); s.src = CONFIG.irysBundle; s.onload = res; s.onerror = () => rej(new Error("Could not load the storage client")); document.head.appendChild(s); });
  return irysLoading;
}
function walletForIrys() {
  return {
    publicKey: pubkey,
    signMessage: async (m) => { const r = await wallet.signMessage(m); return r && r.signature ? r.signature : r; },
    sendTransaction: async (tx, conn, opts) => { if (wallet.signAndSendTransaction) { const r = await wallet.signAndSendTransaction(tx, opts); return r.signature || r; } const s = await wallet.signTransaction(tx); return await conn.sendRawTransaction(s.serialize(), opts); },
  };
}
/* shrink stills under the free tier (100 KiB): resize then step the JPEG quality down; keep PNG when it already fits */
async function shrinkForUpload(file, limit = 95 * 1024) {
  if (file.size <= limit || file.type === "image/gif") return file;
  const bmp = await createImageBitmap(file);
  let s = Math.min(bmp.width, bmp.height, 512);
  for (let round = 0; round < 6; round++) {
    const cv = document.createElement("canvas"); cv.width = s; cv.height = s;
    const src = Math.min(bmp.width, bmp.height); cv.getContext("2d").drawImage(bmp, (bmp.width - src) / 2, (bmp.height - src) / 2, src, src, 0, 0, s, s);
    for (const q of [0.92, 0.85, 0.78, 0.7, 0.6]) {
      const blob = await new Promise(r => cv.toBlob(r, "image/jpeg", q));
      if (blob.size <= limit) return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
    }
    s = Math.round(s * 0.8);
  }
  throw new Error("Could not get the image under 100 KB. Try a simpler image.");
}
async function pinViaIrys(meta, file, onStatus) {
  onStatus("Loading storage client…"); await loadIrys();
  const { WebUploader, WebSolana } = window.IrysWeb;
  const irys = await WebUploader(WebSolana).withProvider(walletForIrys()).withRpc(CONFIG.rpcs[0]).mainnet();
  onStatus("Preparing the art…"); const img = await shrinkForUpload(file);
  const bytes = img.size + 600;
  if (bytes > 100 * 1024) { const price = await irys.getPrice(bytes); const bal = await irys.getBalance(); if (bal.lt(price)) { onStatus("Funding storage (tiny SOL amount, approve in wallet)…"); await irys.fund(price.multipliedBy(1.2).integerValue()); } }
  onStatus("Sign the storage message in your wallet…");
  const up = await irys.uploadFile(img, { tags: [{ name: "Content-Type", value: img.type }, { name: "App-Name", value: "FLING" }] });
  const imageUrl = CONFIG.irysGateway + up.id;
  const json = { name: meta.name, symbol: meta.symbol, description: meta.description, image: imageUrl, showName: true, createdOn: "https://pump.fun" };
  if (meta.twitter) json.twitter = meta.twitter; if (meta.telegram) json.telegram = meta.telegram; if (meta.website) json.website = meta.website;
  onStatus("Storing metadata…");
  const up2 = await irys.upload(JSON.stringify(json), { tags: [{ name: "Content-Type", value: "application/json" }, { name: "App-Name", value: "FLING" }] });
  return { uri: CONFIG.irysGateway + up2.id, image: imageUrl };
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
  e.preventDefault();
  if ($("launchBtn").dataset.skip) { grindVanity.cancel && grindVanity.cancel(); return; }
  if (!validate()) return;
  launching = true; $("launchBtn").disabled = true; $("result").hidden = true;
  const meta = { name: f.name.value.trim().slice(0, 32), symbol: f.sym.value.trim().toUpperCase().slice(0, 10), description: f.desc.value.trim().slice(0, 500), twitter: f.tw.value.trim(), telegram: f.tg.value.trim(), website: f.web.value.trim() };
  const buy = num(f.buy.value), slip = num(f.slip.value) || 10, prio = num(f.prio.value) || 0.0005;
  try {
    step(1); setStatus("Storing art and metadata…");
    const jwt = $("pinataJwt").value.trim();
    let uri;
    if (CONFIG.uploadProxy) uri = await pinViaProxy(meta, imageFile);
    else if (jwt) uri = await pinViaPinata(meta, imageFile, jwt);
    else if (wallet.signMessage) uri = (await pinViaIrys(meta, imageFile, setStatus)).uri;
    else if (DRY) uri = "https://example.invalid/dry-run.json";
    else throw new Error("This wallet cannot sign messages. Open Options and paste a free Pinata key instead.");
    step(2);
    let mint = null;
    if ($("fVanity").checked && !DRY) {
      const t0 = Date.now(); $("launchBtn").textContent = "Skip grinding"; $("launchBtn").disabled = false; $("launchBtn").dataset.skip = "1";
      mint = await grindVanity("pump", (tot, n) => setStatus("Grinding a pump address… " + tot.toLocaleString("en-US") + " keys tried on " + n + " threads, " + Math.round((Date.now() - t0) / 1000) + "s"));
      $("launchBtn").textContent = "Fling it"; delete $("launchBtn").dataset.skip; $("launchBtn").disabled = true;
      if (!mint) setStatus("Skipped grinding, using a random mint address.");
    }
    if (!mint) mint = W3.Keypair.generate();
    setStatus("Building the create transaction…");
    const body = { publicKey: pubkey.toBase58(), action: "create", tokenMetadata: { name: meta.name, symbol: meta.symbol, uri }, mint: mint.publicKey.toBase58(), denominatedInSol: "true", amount: buy, slippage: slip, priorityFee: prio, pool: CONFIG.pool };
    const r = await fetch(CONFIG.tradeLocal, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error("Transaction builder refused: " + (await r.text()).slice(0, 140));
    const tx = W3.VersionedTransaction.deserialize(new Uint8Array(await r.arrayBuffer()));
    tx.sign([mint]);
    step(3); setStatus("Approve the transaction in your wallet…");
    const signed = await wallet.signTransaction(tx);
    if (DRY) { step(4, "done"); setStatus("Dry run complete: stored, built and signed, not broadcast.", "ok"); showResult(mint.publicKey.toBase58(), null, meta); $("result").innerHTML += `<br>metadata <a href="${uri}" target="_blank" rel="noopener">${uri}</a>`; launching = false; validate(true); return; }
    step(4); setStatus("Sending…");
    const { c, sig } = await rpcSend(signed.serialize());
    setStatus("Confirming " + sig.slice(0, 8) + "…");
    const bh = await c.getLatestBlockhash("confirmed");
    const conf = await c.confirmTransaction({ signature: sig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight }, "confirmed");
    if (conf.value.err) throw new Error("Transaction failed on-chain: " + JSON.stringify(conf.value.err));
    step(4, "done"); setStatus("Flung. Your coin is live.", "ok");
    showResult(mint.publicKey.toBase58(), sig, meta); remember({ mint: mint.publicKey.toBase58(), sig, name: meta.name, symbol: meta.symbol, at: Date.now() }); showBalance(); shareFor(mint.publicKey.toBase58(), meta);
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
function shareFor(mint, meta) {
  const txt = `$${meta.symbol} is live. ${meta.name} — flung onto pump.fun via @FlingItFun.\nhttps://pump.fun/coin/${mint}`;
  $("share").hidden = false; $("shareTxt").value = txt; $("shareX").href = "https://x.com/intent/post?text=" + encodeURIComponent(txt);
}
$("copyShare").addEventListener("click", async () => { try { await navigator.clipboard.writeText($("shareTxt").value); $("copyShare").textContent = "Copied"; setTimeout(() => $("copyShare").textContent = "Copy post", 1500); } catch (e) { $("shareTxt").select(); } });
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

/* ---------- your launches (local only) ---------- */
function mineLoad() { try { return JSON.parse(localStorage.getItem("fling-mine") || "[]"); } catch (e) { return []; } }
function remember(x) { const l = mineLoad(); l.unshift(x); try { localStorage.setItem("fling-mine", JSON.stringify(l.slice(0, 50))); } catch (e) {} renderMine(); }
function renderMine() {
  const l = mineLoad(); const el = $("mineList"); const sec = document.getElementById("mine");
  if (!l.length) { sec.hidden = true; el.innerHTML = ""; return; }
  sec.hidden = false;
  el.innerHTML = l.map(x => `<a class="fl-row" href="https://pump.fun/coin/${x.mint}" target="_blank" rel="noopener"><span class="fl-row-art"><img src="./brand/fling-mark-orange.svg" alt="" style="width:55%;height:55%;object-fit:contain"></span><span class="fl-row-name"><b>${esc(x.name)}</b><span>$${esc(x.symbol)}</span></span><span class="fl-row-k hide-m">mint<b>${x.mint.slice(0,4)}…${x.mint.slice(-4)}</b></span><span class="fl-row-k">status<b>${x.sig ? "live" : "dry run"}</b></span><span class="fl-row-t">${ago(x.at)}</span></a>`).join("");
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
  row.innerHTML = `<span class="fl-row-art"><img alt="" loading="lazy" src="./brand/fling-mark-orange.svg" style="width:55%;height:55%;object-fit:contain;opacity:.8" data-uri="${esc(d.uri || "")}"></span><span class="fl-row-name"><b>${esc(name)}</b><span>$${esc(sym)}</span></span><span class="fl-row-k hide-m">dev buy<b>${buy}</b></span><span class="fl-row-k">market cap<b>${mc}</b></span><span class="fl-row-t">just now</span>`;
  row.dataset.buy = d.solAmount || 0; if ($("liveFilter").checked && (+row.dataset.buy) < 0.5) row.classList.add("hid");
  const board = $("liveBoard"); const empty = $("liveEmpty"); if (empty) empty.remove();
  board.prepend(row); liveRows.unshift({ row, at: Date.now() });
  while (liveRows.length > 40) liveRows.pop().row.remove();
  resolveArt(row.querySelector("img"));
}
/* art lookups go through a slow queue (one every 1.6 s) so the public gateway does not rate-limit us */
const artQ = []; let artBusy = false;
function resolveArt(img) { artQ.push(img); if (artQ.length > 12) artQ.shift(); if (!artBusy) artPump(); }
async function artPump() { artBusy = true; while (artQ.length) { const img = artQ.shift(); if (!img.isConnected) continue; await resolveArtNow(img); await new Promise(r => setTimeout(r, 1600)); } artBusy = false; }
async function resolveArtNow(img) {
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

$("liveFilter").addEventListener("change", () => { const on = $("liveFilter").checked; liveRows.forEach(x => x.row.classList.toggle("hid", on && (+x.row.dataset.buy) < 0.5)); });
preview(); validate(); renderMine(); liveConnect(); showBalance();
