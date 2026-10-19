// FLING pin relay — Cloudflare Worker. Pins the launch image + metadata JSON to IPFS through Pinata with a
// server-held key, so launchers never need their own. Deploy with `wrangler deploy` after `wrangler secret put PINATA_JWT`.
export default {
  async fetch(req, env) {
    const cors = { "Access-Control-Allow-Origin": env.ALLOW_ORIGIN || "*", "Access-Control-Allow-Methods": "POST,OPTIONS", "Access-Control-Allow-Headers": "content-type" };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    if (req.method !== "POST" || url.pathname !== "/pin") return new Response("not found", { status: 404, headers: cors });
    if (!env.PINATA_JWT) return Response.json({ error: "relay not configured" }, { status: 500, headers: cors });
    let fd; try { fd = await req.formData(); } catch (e) { return Response.json({ error: "bad form" }, { status: 400, headers: cors }); }
    const file = fd.get("file"); const name = String(fd.get("name") || "").slice(0, 32); const symbol = String(fd.get("symbol") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
    if (!file || !name || !symbol) return Response.json({ error: "file, name and symbol are required" }, { status: 400, headers: cors });
    if (file.size > 4 * 1024 * 1024 || !/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return Response.json({ error: "image must be png/jpg/gif/webp under 4 MB" }, { status: 400, headers: cors });
    const h = { Authorization: "Bearer " + env.PINATA_JWT };
    const f1 = new FormData(); f1.append("file", file, file.name || "image"); f1.append("pinataMetadata", JSON.stringify({ name: symbol + "-image" }));
    const r1 = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", { method: "POST", headers: h, body: f1 });
    if (!r1.ok) return Response.json({ error: "image pin failed " + r1.status }, { status: 502, headers: cors });
    const img = await r1.json();
    const gateway = env.GATEWAY || "https://ipfs.io/ipfs/";
    const json = { name, symbol, description: String(fd.get("description") || "").slice(0, 500), image: gateway + img.IpfsHash, showName: true, createdOn: "https://pump.fun" };
    for (const k of ["twitter", "telegram", "website"]) { const v = String(fd.get(k) || "").trim(); if (v) json[k] = v.slice(0, 200); }
    const r2 = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", { method: "POST", headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify({ pinataContent: json, pinataMetadata: { name: symbol + "-metadata" } }) });
    if (!r2.ok) return Response.json({ error: "metadata pin failed " + r2.status }, { status: 502, headers: cors });
    const m = await r2.json();
    return Response.json({ metadataUri: gateway + m.IpfsHash, image: json.image }, { headers: cors });
  }
};
