const FIELDS = ["name", "category", "phone", "province", "city", "county", "town", "address", "verified", "source", "poiId", "lat", "lng", "follow", "checkedAt"];
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  return !origin || new URL(origin).host === new URL(request.url).host;
}

async function readJson(request, maxBytes = 12 * 1024 * 1024) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > maxBytes) throw Object.assign(new Error("请求内容超过大小限制。"), { status: 413 });
  const text = await request.text();
  if (!text) throw Object.assign(new Error("请求内容为空。"), { status: 400 });
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw Object.assign(new Error("请求内容超过大小限制。"), { status: 413 });
  try { return JSON.parse(text); }
  catch { throw Object.assign(new Error("请求内容不是有效 JSON。"), { status: 400 }); }
}

function normalizeLead(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("线索格式无效。");
  const name = String(item.name || "").trim();
  if (!name || name.length > 80) throw new Error("商家名称必填，且最多 80 个字符。");
  const id = String(item.id || crypto.randomUUID());
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error("线索编号格式无效。");
  const data = Object.fromEntries(FIELDS.map((field) => [field, String(item[field] || "").slice(0, field === "address" ? 500 : 180)]));
  data.name = name;
  if (data.verified !== "verified" && data.verified !== "pending") data.verified = "pending";
  if (data.phone.length > 32) throw new Error("电话号码长度超出限制。");
  return { ...data, id, updatedAt: new Date().toISOString() };
}

function validImage(mime, bytes) {
  if (mime === "image/jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === "image/png") return [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  return mime === "image/webp" && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
}

async function handle(request, env) {
  if (!env.DB) return json({ error: "线索数据库尚未配置。" }, 503);
  const url = new URL(request.url);
  const path = decodeURIComponent(url.pathname);
  const method = request.method;
  if ((method === "POST" || method === "DELETE") && !sameOrigin(request)) return json({ error: "跨站请求已拒绝。" }, 403);

  if (method === "GET" && path === "/api/config") return json({ amapKey: env.AMAP_KEY || "", amapSecurityCode: env.AMAP_SECURITY_CODE || "" });
  if (method === "GET" && path === "/api/leads") {
    const { results = [] } = await env.DB.prepare("SELECT data FROM leads ORDER BY rowid DESC").all();
    return json(results.map((row) => JSON.parse(row.data)));
  }
  if (method === "GET" && path === "/api/call-marks") {
    const { results = [] } = await env.DB.prepare("SELECT id, called_at AS calledAt FROM call_marks").all();
    return json({ callMarks: Object.fromEntries(results.map(({ id, calledAt }) => [id, calledAt])) });
  }
  if (method === "POST" && path === "/api/call-marks") {
    const payload = await readJson(request, 4096), id = String(payload.id || "");
    if (!id || id.length > 220 || (!(id.startsWith("lead:") && id.length > 5) && !(id.startsWith("poi:") && id.length > 4))) return json({ error: "商户标记编号无效。" }, 400);
    if (typeof payload.called !== "boolean") return json({ error: "已拨状态无效。" }, 400);
    if (payload.called) await env.DB.prepare("INSERT INTO call_marks (id, called_at) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET called_at=excluded.called_at").bind(id, new Date().toISOString()).run();
    else await env.DB.prepare("DELETE FROM call_marks WHERE id = ?").bind(id).run();
    const { results = [] } = await env.DB.prepare("SELECT id, called_at AS calledAt FROM call_marks").all();
    return json({ callMarks: Object.fromEntries(results.map(({ id: markId, calledAt }) => [markId, calledAt])) });
  }
  if (method === "POST" && (path === "/api/leads" || path === "/api/leads/batch")) {
    const payload = await readJson(request, 5 * 1024 * 1024), items = Array.isArray(payload) ? payload : [payload];
    if (items.length > 1000) return json({ error: "单次最多导入 1000 条线索。" }, 413);
    const leads = items.map(normalizeLead);
    if (leads.length) await env.DB.batch(leads.map((lead) => env.DB.prepare("INSERT INTO leads (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at").bind(lead.id, JSON.stringify(lead), lead.updatedAt)));
    return json({ saved: leads.length });
  }
  if (method === "GET" && path === "/api/photos") {
    const { results = [] } = await env.DB.prepare("SELECT id, lead_id AS leadId, file_name AS fileName, mime, uploader, authorized, uploaded_at AS uploadedAt FROM photos WHERE lead_id = ? AND authorized = 1 ORDER BY uploaded_at DESC").bind(url.searchParams.get("leadId") || "").all();
    return json(results.map((photo) => ({ ...photo, authorized: Boolean(photo.authorized) })));
  }
  if (method === "POST" && path === "/api/photos") {
    const payload = await readJson(request, 15 * 1024 * 1024);
    const leadId = String(payload.leadId || ""), uploader = String(payload.uploader || "").trim(), fileName = String(payload.fileName || "门店照片").slice(0, 160);
    if (payload.authorized !== true) throw new Error("需要确认照片授权。");
    if (!leadId || !uploader) throw new Error("缺少线索编号或授权来源。");
    if (typeof payload.dataUrl !== "string") throw new Error("照片数据格式无效。");
    const match = payload.dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw new Error("仅支持 JPG、PNG 或 WebP 图片。");
    const mime = match[1], binary = atob(match[2]), bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error("照片不能为空，且单张不能超过 10MB。");
    if (!validImage(mime, bytes)) throw new Error("图片文件类型与内容不匹配。");
    if (!env.PHOTOS) return json({ error: "照片存储尚未启用，请在 Cloudflare 控制台启用 R2 后重试。" }, 503);
    const exists = await env.DB.prepare("SELECT id FROM leads WHERE id = ?").bind(leadId).first();
    if (!exists) throw new Error("线索不存在，请刷新页面后重试。");
    const id = crypto.randomUUID(), extension = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" }[mime], storageKey = `${id}${extension}`, uploadedAt = new Date().toISOString();
    await env.PHOTOS.put(storageKey, bytes, { httpMetadata: { contentType: mime } });
    try {
      await env.DB.prepare("INSERT INTO photos (id, lead_id, file_name, mime, uploader, authorized, uploaded_at, storage_key) VALUES (?, ?, ?, ?, ?, 1, ?, ?)").bind(id, leadId, fileName, mime, uploader, uploadedAt, storageKey).run();
    } catch (error) { await env.PHOTOS.delete(storageKey); throw error; }
    return json({ id, leadId, fileName, mime, uploader, authorized: true, uploadedAt }, 201);
  }
  if (method === "GET" && path.startsWith("/api/photos/")) {
    const id = path.slice("/api/photos/".length);
    const photo = await env.DB.prepare("SELECT mime, storage_key AS storageKey FROM photos WHERE id = ? AND authorized = 1").bind(id).first();
    if (!photo) return json({ error: "照片不存在。" }, 404);
    const object = await env.PHOTOS?.get(photo.storageKey);
    if (!object) return json({ error: "照片不存在。" }, 404);
    return new Response(object.body, { headers: { "Content-Type": photo.mime, "Content-Disposition": "inline", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  }
  if (method === "DELETE" && path.startsWith("/api/photos/")) {
    const id = path.slice("/api/photos/".length), photo = await env.DB.prepare("SELECT storage_key AS storageKey FROM photos WHERE id = ?").bind(id).first();
    if (photo?.storageKey) await env.PHOTOS?.delete(photo.storageKey);
    await env.DB.prepare("DELETE FROM photos WHERE id = ?").bind(id).run();
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }
  if (method === "DELETE" && path.startsWith("/api/leads/")) {
    const id = path.slice("/api/leads/".length), { results = [] } = await env.DB.prepare("SELECT storage_key AS storageKey FROM photos WHERE lead_id = ?").bind(id).all();
    if (env.PHOTOS) await Promise.all(results.map((photo) => env.PHOTOS.delete(photo.storageKey)));
    await env.DB.batch([env.DB.prepare("DELETE FROM photos WHERE lead_id = ?").bind(id), env.DB.prepare("DELETE FROM call_marks WHERE id = ?").bind(`lead:${id}`), env.DB.prepare("DELETE FROM leads WHERE id = ?").bind(id)]);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }
  return json({ error: "接口不存在。" }, 404);
}

export async function onRequest(context) {
  try { return await handle(context.request, context.env); }
  catch (error) {
    const status = error.status || (/格式|授权|名称|类型|不能为空|超出限制|编号|电话号码|不存在/.test(error.message || "") ? 400 : 500);
    return json({ error: status === 500 ? "服务器暂时无法处理请求。" : error.message }, status);
  }
}
