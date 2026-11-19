import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.join(ROOT, ".env");
if (existsSync(ENV_FILE)) for (const line of (await readFile(ENV_FILE, "utf8")).split(/\r?\n/)) {
  const split = line.indexOf("=");
  if (split > 0 && !line.trimStart().startsWith("#")) {
    const key = line.slice(0, split).trim(), value = line.slice(split + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, "data"));
const PHOTO_DIR = path.join(DATA_DIR, "photos");
const STORE_FILE = path.join(DATA_DIR, "store.json");
const AMAP_KEY = process.env.AMAP_KEY || "";
const AMAP_SECURITY_CODE = process.env.AMAP_SECURITY_CODE || "";
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8080);
const MAX_JSON = 12 * 1024 * 1024;
let writeQueue = Promise.resolve();
const leadFields = ["name", "category", "phone", "province", "city", "county", "town", "address", "verified", "source", "poiId", "lat", "lng", "follow", "checkedAt"];

const json = (res, status, body, extra = {}) => {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": data.length, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", ...extra });
  res.end(data);
};
const empty = (res, status = 204, extra = {}) => { res.writeHead(status, { "Cache-Control": "no-store", ...extra }); res.end(); };
async function readStore() {
  try { const store = JSON.parse(await readFile(STORE_FILE, "utf8")); return { leads: Array.isArray(store.leads) ? store.leads : [], photos: Array.isArray(store.photos) ? store.photos : [], callMarks: Array.isArray(store.callMarks) ? store.callMarks : [] }; }
  catch (error) { if (error.code === "ENOENT") return { leads: [], photos: [], callMarks: [] }; throw error; }
}
async function updateStore(mutator) {
  const result = writeQueue.then(async () => {
    const store = await readStore();
    const value = await mutator(store);
    const temporary = `${STORE_FILE}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(store), { mode: 0o600 });
    await rename(temporary, STORE_FILE);
    return value;
  });
  writeQueue = result.catch(() => {});
  return result;
}
function sameOrigin(req) { return !req.headers.origin || new URL(req.headers.origin).host === req.headers.host; }
async function body(req, limit = MAX_JSON) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw Object.assign(new Error("请求内容超过大小限制。"), { status: 413 }); chunks.push(chunk); }
  if (!size) throw Object.assign(new Error("请求内容为空。"), { status: 400 });
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("请求内容不是有效 JSON。"), { status: 400 }); }
}
function normalizeLead(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("线索格式无效。");
  const name = String(item.name || "").trim();
  if (!name || name.length > 80) throw new Error("商家名称必填，且最多 80 个字符。");
  const id = String(item.id || randomUUID());
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error("线索编号格式无效。");
  const data = Object.fromEntries(leadFields.map((field) => [field, String(item[field] || "").slice(0, field === "address" ? 500 : 180)]));
  data.name = name;
  if (data.verified !== "verified" && data.verified !== "pending") data.verified = "pending";
  if (data.phone.length > 32) throw new Error("电话号码长度超出限制。");
  return { ...data, id, updatedAt: new Date().toISOString() };
}
async function savePhoto(payload) {
  const leadId = String(payload.leadId || ""), uploader = String(payload.uploader || "").trim(), fileName = String(payload.fileName || "门店照片").slice(0, 160);
  if (payload.authorized !== true) throw new Error("需要确认照片授权。");
  if (!leadId || !uploader) throw new Error("缺少线索编号或授权来源。");
  if (typeof payload.dataUrl !== "string") throw new Error("照片数据格式无效。");
  const match = payload.dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("仅支持 JPG、PNG 或 WebP 图片。");
  const mime = match[1], content = Buffer.from(match[2], "base64");
  if (!content.length || content.length > 10 * 1024 * 1024) throw new Error("照片不能为空，且单张不能超过 10MB。");
  const valid = mime === "image/jpeg" ? content.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) : mime === "image/png" ? content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) : content.subarray(0, 4).toString() === "RIFF" && content.subarray(8, 12).toString() === "WEBP";
  if (!valid) throw new Error("图片文件类型与内容不匹配。");
  const id = randomUUID(), extension = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" }[mime], storedName = id + extension;
  const record = { id, leadId, fileName, storedName, mime, uploader, authorized: true, uploadedAt: new Date().toISOString() };
  await updateStore(async (store) => {
    if (!store.leads.some((lead) => lead.id === leadId)) throw new Error("线索不存在，请刷新页面后重试。");
    await writeFile(path.join(PHOTO_DIR, storedName), content, { mode: 0o600 });
    store.photos.push(record);
  }).catch(async (error) => { await unlink(path.join(PHOTO_DIR, storedName)).catch(() => {}); throw error; });
  return { id, leadId, fileName, mime, uploader, authorized: true, uploadedAt: record.uploadedAt };
}
function staticFile(res, pathname) {
  const allowed = new Map([["/", "index.html"], ["/index.html", "index.html"], ["/styles.css", "styles.css"], ["/app.js", "app.js"]]);
  const file = allowed.get(pathname);
  if (!file) return json(res, 404, { error: "页面不存在。" });
  const types = { "index.html": "text/html; charset=utf-8", "styles.css": "text/css; charset=utf-8", "app.js": "text/javascript; charset=utf-8" };
  readFile(path.join(ROOT, "public", file)).then((content) => { res.writeHead(200, { "Content-Type": types[file], "Content-Length": content.length, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" }); res.end(content); }).catch(() => json(res, 404, { error: "页面不存在。" }));
}

await mkdir(PHOTO_DIR, { recursive: true });

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`), pathname = decodeURIComponent(url.pathname);
    if (req.method === "GET" && pathname === "/api/config") return json(res, 200, { amapKey: AMAP_KEY, amapSecurityCode: AMAP_SECURITY_CODE });
    if (req.method === "POST" && !sameOrigin(req)) return json(res, 403, { error: "跨站请求已拒绝。" });
    if (req.method === "GET" && pathname === "/api/leads") return json(res, 200, (await readStore()).leads);
    if (req.method === "GET" && pathname === "/api/call-marks") {
      const callMarks = Object.fromEntries((await readStore()).callMarks.map(({ id, calledAt }) => [id, calledAt]));
      return json(res, 200, { callMarks });
    }
    if (req.method === "POST" && pathname === "/api/call-marks") {
      const payload = await body(req, 4096), id = String(payload.id || "");
      if (!id || id.length > 220 || !(id.startsWith("lead:") && id.length > 5) && !(id.startsWith("poi:") && id.length > 4)) return json(res, 400, { error: "商户标记编号无效。" });
      if (typeof payload.called !== "boolean") return json(res, 400, { error: "已拨状态无效。" });
      const calledAt = payload.called ? new Date().toISOString() : "";
      await updateStore((store) => { store.callMarks = store.callMarks.filter((mark) => mark.id !== id); if (payload.called) store.callMarks.push({ id, calledAt }); });
      const callMarks = Object.fromEntries((await readStore()).callMarks.map((mark) => [mark.id, mark.calledAt]));
      return json(res, 200, { callMarks });
    }
    if (req.method === "POST" && (pathname === "/api/leads" || pathname === "/api/leads/batch")) {
      const payload = await body(req, 5 * 1024 * 1024), items = Array.isArray(payload) ? payload : [payload];
      if (items.length > 1000) return json(res, 413, { error: "单次最多导入 1000 条线索。" });
      const normalized = items.map(normalizeLead);
      await updateStore((store) => { for (const lead of normalized) { const index = store.leads.findIndex((current) => current.id === lead.id); if (index < 0) store.leads.unshift(lead); else store.leads[index] = lead; } });
      return json(res, 200, { saved: normalized.length });
    }
    if (req.method === "GET" && pathname === "/api/photos") {
      const photos = (await readStore()).photos.filter((photo) => photo.leadId === url.searchParams.get("leadId") && photo.authorized);
      return json(res, 200, photos.map(({ id, leadId, fileName, mime, uploader, authorized, uploadedAt }) => ({ id, leadId, fileName, mime, uploader, authorized, uploadedAt })));
    }
    if (req.method === "POST" && pathname === "/api/photos") return json(res, 201, await savePhoto(await body(req, 15 * 1024 * 1024)));
    if (req.method === "GET" && pathname.startsWith("/api/photos/")) {
      const id = pathname.split("/").at(-1), photo = (await readStore()).photos.find((item) => item.id === id && item.authorized);
      if (!photo) return json(res, 404, { error: "照片不存在。" });
      const content = await readFile(path.join(PHOTO_DIR, photo.storedName));
      res.writeHead(200, { "Content-Type": photo.mime, "Content-Length": content.length, "Content-Disposition": "inline", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }); return res.end(content);
    }
    if (req.method === "DELETE" && !sameOrigin(req)) return json(res, 403, { error: "跨站请求已拒绝。" });
    if (req.method === "DELETE" && pathname.startsWith("/api/photos/")) {
      const id = pathname.split("/").at(-1); let filename;
      await updateStore((store) => { const photo = store.photos.find((item) => item.id === id); filename = photo?.storedName; store.photos = store.photos.filter((item) => item.id !== id); });
      if (filename) await unlink(path.join(PHOTO_DIR, filename)).catch(() => {});
      return empty(res);
    }
    if (req.method === "DELETE" && pathname.startsWith("/api/leads/")) {
      const id = pathname.split("/").at(-1); let filenames = [];
      await updateStore((store) => { filenames = store.photos.filter((photo) => photo.leadId === id).map((photo) => photo.storedName); store.photos = store.photos.filter((photo) => photo.leadId !== id); store.callMarks = store.callMarks.filter((mark) => mark.id !== `lead:${id}`); store.leads = store.leads.filter((lead) => lead.id !== id); });
      await Promise.all(filenames.map((filename) => unlink(path.join(PHOTO_DIR, filename)).catch(() => {})));
      return empty(res);
    }
    if (req.method === "GET") return staticFile(res, pathname);
    return json(res, 404, { error: "接口不存在。" });
  } catch (error) {
    const status = error.status || (error.message?.includes("格式") || error.message?.includes("授权") || error.message?.includes("名称") || error.message?.includes("类型") || error.message?.includes("不能为空") || error.message?.includes("超出限制") || error.message?.includes("POI") || error.message?.includes("不存在") || error.message?.includes("编号") || error.message?.includes("电话号码") ? 400 : 500);
    if (status === 500) console.error(error);
    if (!res.headersSent) json(res, status, { error: status === 500 ? "服务器暂时无法处理请求。" : error.message });
    else res.destroy();
  }
});
server.listen(PORT, HOST, () => console.log(`Dealer map server listening on ${HOST}:${PORT}`));
