const $ = (id) => document.getElementById(id);
let leads = [];
let searchResults = null;
let callMarks = {};
let selectedId = null;
let sortVerifiedFirst = true;
let map = null;
let mapMarkers = new Map();
let geoCoder = null;
let districtSearch = null;
let placeSearch = null;
let mapLoadPromise = null;
let regionRoot = null;
let townOptions = [];
let detailRequestId = 0;
let toastTimer;
let searchTimer;

const categoryKeywords = {
  "水暖": ["水暖", "水暖器材"],
  "锅炉": ["锅炉", "锅炉设备"],
  "暖通": ["暖通", "暖通设备"],
  "管材管件": ["管材管件", "管材"]
};
function esc(value = "") { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) } });
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || `请求失败（${response.status}）。`);
  return payload;
}
function nodeChildren(node) { return node?.districtList || []; }
function selectedProvince() { return nodeChildren(regionRoot).find((item) => item.adcode === $("provinceFilter").value) || null; }
function selectedCity() { return getCityOptions().find((item) => item.adcode === $("cityFilter").value) || null; }
function getCityOptions() { return nodeChildren(selectedProvince()).filter((item) => item.level === "city"); }
function getDirectAreaOptions() { return nodeChildren(selectedProvince()).filter((item) => item.level !== "city"); }
function getCountyOptions() {
  const city = selectedCity();
  return city ? nodeChildren(city) : getDirectAreaOptions();
}
function selectedCounty() { return getCountyOptions().find((item) => item.adcode === $("countyFilter").value) || null; }
function selectedTown() { return townOptions.find((item) => item.adcode === $("townFilter").value) || null; }
function selectedRegion() { return selectedTown() || selectedCounty() || selectedCity() || selectedProvince(); }
function selectedRegionName() {
  return [selectedProvince()?.name, selectedCity()?.name, selectedCounty()?.name, selectedTown()?.name].filter(Boolean).join(" ") || "请选择地区";
}
function updateRegionSelects() {
  const province = $("provinceFilter"), city = $("cityFilter"), county = $("countyFilter"), town = $("townFilter");
  const priorProvince = province.value, priorCity = city.value, priorCounty = county.value;
  province.innerHTML = `<option value="">选择省份/直辖市/自治区</option>` + nodeChildren(regionRoot).map((item) => `<option value="${esc(item.adcode)}">${esc(item.name)}</option>`).join("");
  if ([...province.options].some((option) => option.value === priorProvince)) province.value = priorProvince;
  const cities = getCityOptions(), direct = getDirectAreaOptions();
  city.innerHTML = `<option value="">${cities.length ? "选择城市" : (province.value ? "省直辖区划" : "先选省份")}</option>` + cities.map((item) => `<option value="${esc(item.adcode)}">${esc(item.name)}</option>`).join("");
  city.disabled = !province.value || cities.length === 0;
  if (cities.some((item) => item.adcode === priorCity)) city.value = priorCity;
  else city.value = "";
  const counties = getCountyOptions();
  county.innerHTML = `<option value="">${counties.length ? "选择区县/下辖区划" : "先选城市"}</option>` + counties.map((item) => `<option value="${esc(item.adcode)}">${esc(item.name)}</option>`).join("");
  county.disabled = !province.value || counties.length === 0;
  if (counties.some((item) => item.adcode === priorCounty)) county.value = priorCounty;
  else county.value = "";
  townOptions = []; town.innerHTML = `<option value="">先选区县</option>`; town.disabled = true;
  void direct;
}
function populateFromLocalLeads() {
  if (regionRoot) return;
  const names = [...new Set(leads.map((lead) => lead.province).filter(Boolean))].sort();
  $("provinceFilter").innerHTML = `<option value="">选择省份</option>` + names.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join("");
  $("provinceFilter").disabled = false;
  $("cityFilter").innerHTML = `<option value="">请使用已导入线索</option>`;
  $("countyFilter").innerHTML = `<option value="">请使用已导入线索</option>`;
  $("townFilter").innerHTML = `<option value="">高德区划未连接</option>`;
  $("cityFilter").disabled = true; $("countyFilter").disabled = true;
  $("townFilter").disabled = true;
}
function localMatches() {
  const query = $("searchInput").value.trim().toLowerCase(), provinceName = selectedProvince()?.name, cityName = selectedCity()?.name, countyName = selectedCounty()?.name, category = $("categoryFilter").value;
  const townName = selectedTown()?.name;
  const result = leads.filter((lead) => (!provinceName || lead.province === provinceName) && (!cityName || lead.city === cityName) && (!countyName || lead.county === countyName) && (!townName || lead.town === townName) && (!category || lead.category === category) && (!query || [lead.name, lead.address, lead.phone, lead.category].some((item) => String(item || "").toLowerCase().includes(query))));
  return result.sort((a, b) => sortVerifiedFirst ? (a.verified === b.verified ? a.name.localeCompare(b.name, "zh-CN") : a.verified === "verified" ? -1 : 1) : a.name.localeCompare(b.name, "zh-CN"));
}
function activeRows() { return searchResults === null ? localMatches() : searchResults; }
function getArea() { return selectedRegionName(); }
function render() {
  const rows = activeRows();
  if (!rows.some((item) => item.id === selectedId)) selectedId = rows[0]?.id ?? null;
  const isAmap = searchResults !== null;
  $("exportBtn").hidden = !isAmap || rows.length === 0;
  $("resultCount").textContent = rows.length;
  $("resultUnit").textContent = isAmap ? "个高德搜索结果" : "条本地线索";
  $("areaSummary").textContent = getArea();
  $("sourceNotice").textContent = isAmap ? "实时 POI 结果；可能不完整，电话请先核实" : "高德搜索结果不保证覆盖地区内全部商家";
  $("mapAreaTitle").textContent = `${getArea()}${$("categoryFilter").value ? ` · ${$("categoryFilter").value}` : ""} · 商户分布`;
  $("visibleCount").textContent = `${rows.length} 个门店`;
  $("leadList").innerHTML = rows.length ? rows.map((item) => {
    const isLive = item.fromAmap === true;
    const called = Boolean(callMarks[callKey(item)]);
    const phone = item.phone ? `<a class="phone-link" href="tel:${esc(item.phone.replace(/[^+\d]/g, ""))}" onclick="event.stopPropagation()">☎ ${esc(item.phone)}</a>` : `<span class="phone-line">未公开电话</span>`;
    return `<article class="lead-card ${item.id === selectedId ? "selected" : ""} ${called ? "called" : ""}" data-lead="${esc(item.id)}" tabindex="0" role="group" aria-label="查看${esc(item.name)}"><div class="lead-card-top"><strong class="lead-name">${esc(item.name)}</strong><span class="lead-category">${esc(item.category || (isLive ? "高德 POI" : "未分类"))}</span></div><div class="lead-address"><span>⌖</span><span>${esc([item.city, item.county, item.town, item.address].filter(Boolean).join(" · ") || "地址待补充")}</span></div><div class="lead-card-bottom">${phone}<span class="verify ${isLive ? "live" : item.verified === "verified" ? "verified" : "pending"}">${isLive ? "高德实时" : item.verified === "verified" ? "已核实" : "待核实"}</span><span class="mini-follow">${esc(isLive ? "非入库结果" : item.follow || "待联系")}</span><button type="button" class="call-mark ${called ? "active" : ""}" data-toggle-call="${esc(item.id)}" aria-pressed="${called}" title="${called ? "取消已拨标记" : "手动标记已拨"}">${called ? "已拨" : "标记已拨"}</button></div></article>`;
  }).join("") : `<div class="empty-state"><strong>${isAmap ? "高德没有返回匹配商家" : "当前地区还没有本地线索"}</strong>${isAmap ? "换个品类或关键词试试；高德搜索不能保证全量。" : "点击“搜索商户”查询高德实时 POI，或导入已核实的线索。"}</div>`;
  renderMapMarkers(rows);
  if (map) refreshAmapMarkers(rows);
}
function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
function exportSearchResults() {
  if (!searchResults?.length) return;
  const headers = ["省份", "城市", "区县", "类别", "商家名称", "联系电话", "门店地址", "高德POI ID", "高德详情/照片入口", "数据来源", "检索日期"];
  const date = new Date().toLocaleDateString("sv-SE");
  const lines = [headers, ...searchResults.map((item) => [item.province, item.city, item.county, item.category, item.name, item.phone, item.address, item.poiId, poiLinks(item).web, "高德地图 JS API 实时搜索（非全量，待人工核验）", date])];
  const csv = `\ufeff${lines.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = `${[selectedProvince()?.name, selectedCity()?.name, selectedCounty()?.name, $("categoryFilter").value || "商户"].filter(Boolean).join("_")}_高德候选_${date}.csv`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function renderMapMarkers() { $("mapMarkers").innerHTML = ""; }
function lngLat(lead) {
  const value = lead.location || lead.lng && lead.lat && [lead.lng, lead.lat];
  if (value?.getLng && value?.getLat) return [value.getLng(), value.getLat()];
  if (Array.isArray(value)) return [Number(value[0]), Number(value[1])];
  if (typeof value === "string") return value.split(",").map(Number);
  return [NaN, NaN];
}
function refreshAmapMarkers(rows) {
  if (!map || !window.AMap) return;
  for (const marker of mapMarkers.values()) marker.setMap(null);
  mapMarkers.clear();
  for (const lead of rows) {
    const [lng, lat] = lngLat(lead);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    const marker = new AMap.Marker({ position: [lng, lat], title: lead.name, anchor: "bottom-center", content: `<div class="amap-pin ${lead.fromAmap ? "live" : lead.verified === "verified" ? "" : "pending"} ${callMarks[callKey(lead)] ? "called" : ""}">${esc(lead.name)}</div>` });
    marker.on("click", () => selectLead(lead.id, true)); marker.setMap(map); mapMarkers.set(lead.id, marker);
  }
}
function selectLead(id, showDetails = false) { selectedId = id; render(); if (showDetails) { const item = activeRows().find((row) => row.id === id); if (item?.fromAmap) showAmapDetails(item); else showLeadDetails(id); } }
function callKey(item) { return item.fromAmap || item.poiId ? `poi:${item.poiId || item.id}` : `lead:${item.id}`; }
async function toggleCallMark(item) {
  const id = callKey(item), called = !callMarks[id];
  try {
    const result = await api("/api/call-marks", { method: "POST", body: JSON.stringify({ id, called }) });
    callMarks = result.callMarks || {};
    render();
    if ($("detailDialog").open) {
      const current = activeRows().find((row) => row.id === item.id);
      $("detailDialog").close();
      if (current?.fromAmap) showAmapDetails(current); else if (current) await showLeadDetails(current.id);
    }
    showToast(called ? "已标记为打过电话" : "已取消已拨标记");
  } catch (error) { showToast(error.message || "保存已拨标记失败。"); }
}
function poiLinks(lead) {
  const [lng, lat] = lngLat(lead), qs = new URLSearchParams({ src: "nuanshangmap", callnative: "1" });
  if (lead.poiId) qs.set("poiid", lead.poiId);
  else if (Number.isFinite(lng) && Number.isFinite(lat)) { qs.set("position", `${lng},${lat}`); qs.set("name", lead.name); }
  else { qs.set("keyword", lead.name); if (lead.city) qs.set("city", lead.city); return { web: `https://uri.amap.com/search?${qs.toString()}` }; }
  return { web: `https://uri.amap.com/marker?${qs.toString()}` };
}
function openMapDetail(lead) {
  const anchor = document.createElement("a");
  anchor.href = poiLinks(lead).web; anchor.target = "_blank"; anchor.rel = "noopener noreferrer"; anchor.click();
}
async function showAmapDetails(lead) {
  const requestId = ++detailRequestId;
  const savedLead = lead.poiId ? leads.find((item) => item.poiId === lead.poiId) : null;
  let photos = [];
  if (savedLead) try { photos = await api(`/api/photos?leadId=${encodeURIComponent(savedLead.id)}`); } catch {}
  if (requestId !== detailRequestId) return;
  const called = Boolean(callMarks[callKey(lead)]);
  const photoGallery = photos.length ? `<div class="detail-section-title">本站授权照片 <span class="photo-count">${photos.length} 张</span></div><div class="photo-gallery">${photos.map((photo) => `<div class="photo-item"><img src="/api/photos/${encodeURIComponent(photo.id)}" alt="${esc(photo.fileName)}" /><span class="photo-caption">${esc(photo.fileName)} · ${esc(photo.uploader)}</span></div>`).join("")}</div>` : `<div class="no-photos">${savedLead ? "该商户暂无本站授权照片。" : "暂无与此高德 POI 关联的本站授权照片。"} 高德上传照片请在高德详情查看；本站仅展示商家授权后上传的照片。</div>`;
  const photoAction = savedLead ? `<button id="manageSavedPhotosBtn">管理/上传本站授权照片</button>` : "";
  $("detailContent").innerHTML = `<div class="detail-head"><div><div class="eyebrow">高德地图实时 POI · ${esc([lead.city, lead.county, lead.town].filter(Boolean).join(" / "))}</div><h2>${esc(lead.name)}</h2></div><span class="lead-category">${esc(lead.category || "商户")}</span></div><div class="detail-meta"><div class="meta-item"><span>联系电话</span><strong>${lead.phone ? esc(lead.phone) : "高德未提供电话"}</strong></div><div class="meta-item"><span>门店地址</span><strong>${esc([lead.province, lead.city, lead.county, lead.town, lead.address].filter(Boolean).join(" ") || "高德未提供地址")}</strong></div><div class="meta-item"><span>来源与覆盖</span><strong>高德实时搜索结果，不保证全量；联系前请核实</strong></div></div><div class="detail-actions">${lead.phone ? `<a class="call-btn" href="tel:${esc(lead.phone.replace(/[^+\d]/g, ""))}">☎ 拨打电话</a>` : ""}<button id="toggleCallDetail" class="call-mark ${called ? "active" : ""}" aria-pressed="${called}">${called ? "已拨 · 取消标记" : "手动标记已拨"}</button><a id="openAmapBtn" href="${esc(poiLinks(lead).web)}" target="_blank" rel="noopener noreferrer">⌖ 在高德查看照片与详情 ↗</a>${photoAction}</div>${photoGallery}`;
  $("detailDialog").showModal(); $("toggleCallDetail").onclick = () => toggleCallMark(lead);
  if (savedLead) $("manageSavedPhotosBtn").onclick = () => { $("detailDialog").close(); void showLeadDetails(savedLead.id); };
}
async function showLeadDetails(id) {
  const lead = leads.find((item) => item.id === id); if (!lead) return;
  let photos = [];
  try { photos = await api(`/api/photos?leadId=${encodeURIComponent(id)}`); } catch (error) { showToast(error.message); }
  const called = Boolean(callMarks[callKey(lead)]);
  $("detailContent").innerHTML = `<div class="detail-head"><div><div class="eyebrow">${esc([lead.city, lead.county, lead.town].filter(Boolean).join(" / ") || "经销商线索")}</div><h2>${esc(lead.name)}</h2></div><span class="lead-category">${esc(lead.category || "未分类")}</span></div><div class="detail-meta"><div class="meta-item"><span>联系电话</span><strong>${lead.phone ? esc(lead.phone) : "待补充"}</strong></div><div class="meta-item"><span>核验状态</span><strong class="verify ${lead.verified === "verified" ? "verified" : "pending"}">${lead.verified === "verified" ? "已核实" : "待核实"}</strong></div><div class="meta-item"><span>门店地址</span><strong>${esc([lead.province, lead.city, lead.county, lead.town, lead.address].filter(Boolean).join(" ") || "待补充")}</strong></div><div class="meta-item"><span>电话来源 / 核验时间</span><strong>${esc(lead.source || "未记录")}${lead.checkedAt ? ` · ${esc(new Date(lead.checkedAt).toLocaleDateString("zh-CN"))}` : ""}</strong></div><div class="meta-item"><span>跟进状态</span><strong>${esc(lead.follow || "待联系")}</strong></div><div class="meta-item"><span>高德 POI ID</span><strong>${esc(lead.poiId || "未关联")}</strong></div></div><div class="detail-actions">${lead.phone ? `<a class="call-btn" href="tel:${esc(lead.phone.replace(/[^+\d]/g, ""))}">☎ 拨打电话</a>` : ""}<button id="toggleCallDetail" class="call-mark ${called ? "active" : ""}" aria-pressed="${called}">${called ? "已拨 · 取消标记" : "手动标记已拨"}</button><button id="openAmapBtn">⌖ 在高德查看照片与详情 ↗</button><button id="editLeadBtn">✎ 编辑线索</button><button id="addPhotoBtn">＋ 添加授权照片</button></div><div class="detail-section-title">门店照片 <span class="photo-count">${photos.length} 张 · 商家授权上传</span></div><div class="photo-gallery">${photos.length ? photos.map((photo) => `<div class="photo-item"><img src="/api/photos/${encodeURIComponent(photo.id)}" alt="${esc(photo.fileName)}" /><span class="photo-caption">${esc(photo.fileName)} · ${esc(photo.uploader)}</span><button data-delete-photo="${esc(photo.id)}" title="删除照片" aria-label="删除照片">×</button></div>`).join("") : `<div class="no-photos">还没有商家授权照片。高德上传照片可通过上方入口前往高德查看。</div>`}</div>`;
  $("detailDialog").showModal(); $("openAmapBtn").onclick = () => openMapDetail(lead); $("toggleCallDetail").onclick = () => toggleCallMark(lead);
  $("editLeadBtn").onclick = () => { $("detailDialog").close(); editLead(lead); };
  $("addPhotoBtn").onclick = () => { $("photoForm").reset(); $("photoLeadId").value = lead.id; $("photoDialog").showModal(); };
  document.querySelectorAll("[data-delete-photo]").forEach((button) => button.addEventListener("click", async (event) => { event.stopPropagation(); try { await api(`/api/photos/${encodeURIComponent(button.dataset.deletePhoto)}`, { method: "DELETE" }); showToast("照片已删除，授权已撤回"); await showLeadDetails(id); } catch (error) { showToast(error.message); } }));
}
function editLead(lead) {
  $("leadForm").reset(); $("leadFormTitle").textContent = "编辑经销商线索"; $("leadId").value = lead.id;
  for (const [field, key] of Object.entries({ Name: "name", Category: "category", Phone: "phone", Province: "province", City: "city", County: "county", Town: "town", Address: "address", Verified: "verified", Source: "source", PoiId: "poiId", Lat: "lat", Lng: "lng", Follow: "follow" })) $("lead" + field).value = lead[key] ?? "";
  $("leadDialog").showModal();
}
function createLeadForm() {
  $("leadForm").reset(); $("leadFormTitle").textContent = "添加经销商线索"; $("leadId").value = "";
  $("leadProvince").value = selectedProvince()?.name || ""; $("leadCity").value = selectedCity()?.name || ""; $("leadCounty").value = selectedCounty()?.name || "";
  $("leadTown").value = selectedTown()?.name || "";
  $("leadDialog").showModal();
}
function showToast(message) { const toast = $("toast"); toast.textContent = message; toast.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("show"), 2600); }
function areaSearchCode() { return selectedRegion()?.adcode || ""; }
function updateAreaFocus() {
  const area = selectedRegion();
  if (!map || !area) return;
  const center = area.center;
  if (center?.getLng && center?.getLat) map.setZoomAndCenter(11, center);
  else if (Array.isArray(center)) map.setZoomAndCenter(11, center);
  else {
    if (!geoCoder) geoCoder = new AMap.Geocoder();
    geoCoder.getLocation(area.name, (status, result) => { if (status === "complete" && result.geocodes?.[0]) map.setZoomAndCenter(11, result.geocodes[0].location); });
  }
}
function loadDistrictDirectory() {
  return new Promise((resolve, reject) => {
    if (!window.AMap) return reject(new Error("高德地图未连接，无法加载全国区划目录。"));
    AMap.plugin("AMap.DistrictSearch", () => {
      districtSearch = new AMap.DistrictSearch({ level: "country", subdistrict: 3, extensions: "base", showbiz: false });
      districtSearch.search("中国", (status, result) => {
        const root = result?.districtList?.[0];
        if (status !== "complete" || !root?.districtList?.length) return reject(new Error("高德没有返回全国行政区划，请检查 Key 权限和网络。"));
        regionRoot = root; updateRegionSelects(); $("provinceFilter").disabled = false; resolve(root);
      });
    });
  });
}
function loadTownDirectory(county) {
  const town = $("townFilter"); townOptions = [];
  town.innerHTML = `<option value="">${county ? "加载镇/街道中…" : "先选区县"}</option>`;
  town.disabled = true;
  if (!county || !window.AMap) return Promise.resolve([]);
  return new Promise((resolve) => {
    const search = new AMap.DistrictSearch({ level: "district", subdistrict: 1, extensions: "base", showbiz: false });
    search.search(county.adcode, (status, result) => {
      if (selectedCounty()?.adcode !== county.adcode) return resolve([]);
      if (status !== "complete") { town.innerHTML = `<option value="">镇/街道加载失败</option>`; return resolve([]); }
      townOptions = nodeChildren(result?.districtList?.[0]);
      town.innerHTML = `<option value="">${townOptions.length ? "选择镇/街道（可选）" : "该区县未返回镇/街道"}</option>` + townOptions.map((item) => `<option value="${esc(item.adcode)}">${esc(item.name)}</option>`).join("");
      town.disabled = townOptions.length === 0;
      resolve(townOptions);
    });
  });
}
async function connectAmap(key, security) {
  if (!key || !security) { $("mapStatus").textContent = "服务器未配置高德地图凭据"; $("mapConfigStatus").textContent = "服务器尚未配置高德地图凭据。"; return; }
  if (!window.AMap) {
    if (!mapLoadPromise) {
      window._AMapSecurityConfig = { securityJsCode: security };
      mapLoadPromise = new Promise((resolve, reject) => { const script = document.createElement("script"); script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&plugin=AMap.Geocoder,AMap.DistrictSearch,AMap.PlaceSearch`; script.onload = resolve; script.onerror = () => { mapLoadPromise = null; reject(new Error("高德地图加载失败，请检查 Key、域名白名单和网络。")); }; document.head.append(script); });
    }
    await mapLoadPromise;
  }
  if (!map) map = new AMap.Map("amapContainer", { zoom: 4, center: [105.4, 35.8], viewMode: "2D", resizeEnable: true });
  $("mapPlaceholder").style.display = "none"; $("amapContainer").style.display = "block"; $("amapAttribution").hidden = false;
  $("mapStatus").textContent = "高德地图已连接"; $("mapConfigStatus").textContent = "服务器已提供高德地图配置。";
  if (!regionRoot) await loadDistrictDirectory();
  render(); updateAreaFocus();
}
async function restoreMap() {
  try { const config = await api("/api/config"); await connectAmap(config.amapKey, config.amapSecurityCode); }
  catch (error) { $("mapStatus").textContent = "高德连接失败 · 可查本地线索"; $("mapConfigStatus").textContent = error.message; populateFromLocalLeads(); render(); }
}
function placeSearchRequest(keyword, adcode, pageIndex = 1) {
  return new Promise((resolve) => {
    const search = new AMap.PlaceSearch({ city: adcode, citylimit: true, pageSize: 50, pageIndex, extensions: "all", autoFitView: false });
    search.search(keyword, (status, result) => {
      if (status !== "complete") return resolve([]);
      resolve(result?.poiList?.pois || result?.pois || []);
    });
  });
}
function normalizePoi(poi) {
  const area = selectedRegion();
  return { id: `amap-${poi.id || `${poi.name}-${poi.address}`}`, poiId: poi.id || "", name: poi.name || "未命名商户", category: $("categoryFilter").value || poi.type || "商户", phone: poi.tel || "", province: poi.pname || selectedProvince()?.name || "", city: poi.cityname || selectedCity()?.name || "", county: poi.adname || selectedCounty()?.name || area?.name || "", town: selectedTown()?.name || "", address: poi.address || "", location: poi.location, fromAmap: true, source: "高德实时 POI" };
}
async function runMerchantSearch({ automatic = false } = {}) {
  const adcode = areaSearchCode(), area = selectedRegion(), query = $("searchInput").value.trim(), category = $("categoryFilter").value;
  if (!area) return showToast("请先选择省份和地区。");
  if (!query && !category) return showToast("请选择经营品类或输入搜索关键词。");
  if (!window.AMap) return showToast("高德搜索暂不可用；请检查 Key 权限和网络。");
  const keywords = query ? [query, ...(category ? categoryKeywords[category] || [category] : [])] : categoryKeywords[category] || [category];
  const button = $("searchBtn"); button.disabled = true; button.textContent = "搜索中…";
  $("mapStatus").textContent = `正在搜索 ${area.name} 的商户…`;
  try {
    if (!placeSearch) placeSearch = new AMap.PlaceSearch({ city: adcode, citylimit: true, pageSize: 50, extensions: "all", autoFitView: false });
    const found = new Map();
    for (const keyword of [...new Set(keywords)]) {
      const pois = await placeSearchRequest(keyword, adcode);
      for (const poi of pois) { const item = normalizePoi(poi); if (!found.has(item.id)) found.set(item.id, item); }
    }
    searchResults = [...found.values()]; selectedId = searchResults[0]?.id || null;
    $("mapStatus").textContent = "高德实时搜索结果 · 未保存到本地目录";
    render();
    if (map) {
      updateAreaFocus();
      const markers = [...mapMarkers.values()]; if (markers.length) map.setFitView(markers, false, [50, 50, 50, 50]);
    }
    if (!automatic && !searchResults.length) showToast("没有返回结果，可以换关键词搜索。高德结果可能不完整。");
  } catch (error) { searchResults = []; render(); showToast(error.message || "高德搜索失败。"); }
  finally { button.disabled = false; button.textContent = "搜索商户"; }
}
function scheduleSearch() { clearTimeout(searchTimer); if (selectedRegion() && $("categoryFilter").value) searchTimer = setTimeout(() => runMerchantSearch({ automatic: true }), 350); }
async function refreshLeads({ quiet = true } = {}) {
  if (document.visibilityState === "hidden" || $("leadDialog").open || $("photoDialog").open || $("detailDialog").open) return;
  try { leads = await api("/api/leads"); if (searchResults === null) render(); }
  catch (error) { if (!quiet) showToast(error.message); }
}
function parseCsv(text) {
  const rows = []; let row = [], value = "", quoted = false;
  for (let i = 0; i < text.length; i++) { const char = text[i]; if (char === '"' && quoted && text[i + 1] === '"') { value += '"'; i++; } else if (char === '"') quoted = !quoted; else if ((char === "," || char === "\t") && !quoted) { row.push(value.trim()); value = ""; } else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && text[i + 1] === "\n") i++; row.push(value.trim()); if (row.some(Boolean)) rows.push(row); row = []; value = ""; } else value += char; }
  row.push(value.trim()); if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) throw new Error("CSV 至少需要标题行和一条线索。");
  const aliases = { "商家名称": "name", "名称": "name", name: "name", "品类": "category", category: "category", "电话": "phone", "联系电话": "phone", phone: "phone", "省份": "province", province: "province", "城市": "city", city: "city", "区县": "county", county: "county", "镇/街道": "town", town: "town", "地址": "address", address: "address", "高德POI ID": "poiId", poiId: "poiId", "纬度": "lat", lat: "lat", "经度": "lng", lng: "lng", "电话来源": "source", source: "source" };
  const headers = rows[0].map((item) => aliases[item]); if (!headers.includes("name")) throw new Error("CSV 标题必须包含“商家名称”或 name 列。");
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((key, i) => [key, values[i] || ""]))).filter((item) => item.name).map((item) => ({ id: crypto.randomUUID(), category: "水暖", verified: "pending", follow: "待联系", ...item, source: item.source || "CSV 导入 · 待核验" }));
}
function fileToDataUrl(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error("读取照片失败。")); reader.readAsDataURL(file); }); }

document.addEventListener("click", (event) => {
  const mapButton = event.target.closest("[data-open-amap]"); if (mapButton) { event.stopPropagation(); const item = activeRows().find((row) => row.id === mapButton.dataset.openAmap); if (item) openMapDetail(item); return; }
  const callButton = event.target.closest("[data-toggle-call]"); if (callButton) { event.stopPropagation(); const item = activeRows().find((row) => row.id === callButton.dataset.toggleCall); if (item) void toggleCallMark(item); return; }
  const card = event.target.closest("[data-lead]"); if (card) selectLead(card.dataset.lead, true);
  const closer = event.target.closest("[data-close]"); if (closer) $(closer.dataset.close).close();
});
$("detailDialog").addEventListener("click", (event) => {
  if (event.target !== event.currentTarget) return;
  const rect = event.currentTarget.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.currentTarget.close();
});
document.addEventListener("keydown", (event) => { if (event.target.closest("button,a,input,select")) return; const card = event.target.closest(".lead-card"); if (card && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); selectLead(card.dataset.lead, true); } });
$("provinceFilter").addEventListener("change", () => { $("cityFilter").value = ""; $("countyFilter").value = ""; updateRegionSelects(); searchResults = null; render(); updateAreaFocus(); scheduleSearch(); });
$("cityFilter").addEventListener("change", () => { $("countyFilter").value = ""; updateRegionSelects(); searchResults = null; render(); updateAreaFocus(); scheduleSearch(); });
$("countyFilter").addEventListener("change", () => { const county = selectedCounty(); searchResults = null; render(); updateAreaFocus(); scheduleSearch(); void loadTownDirectory(county); });
$("townFilter").addEventListener("change", () => { searchResults = null; render(); updateAreaFocus(); scheduleSearch(); });
$("categoryFilter").addEventListener("change", () => { searchResults = null; render(); scheduleSearch(); });
$("searchInput").addEventListener("keydown", (event) => { if (event.key === "Enter") runMerchantSearch(); });
$("searchBtn").addEventListener("click", () => runMerchantSearch());
$("resetBtn").addEventListener("click", () => { $("searchInput").value = ""; $("categoryFilter").value = ""; $("provinceFilter").value = ""; $("cityFilter").value = ""; $("countyFilter").value = ""; updateRegionSelects(); searchResults = null; render(); });
$("sortBtn").addEventListener("click", () => { sortVerifiedFirst = !sortVerifiedFirst; render(); showToast(sortVerifiedFirst ? "已优先显示已核实线索" : "已按商家名称排序"); });
$("addLeadBtn").addEventListener("click", createLeadForm);
$("leadForm").addEventListener("submit", async (event) => {
  event.preventDefault(); const id = $("leadId").value || crypto.randomUUID(); const previous = leads.find((x) => x.id === id);
  const lead = { id, name: $("leadName").value.trim(), category: $("leadCategory").value, phone: $("leadPhone").value.trim(), province: $("leadProvince").value.trim(), city: $("leadCity").value.trim(), county: $("leadCounty").value.trim(), town: $("leadTown").value.trim(), address: $("leadAddress").value.trim(), verified: $("leadVerified").value, source: $("leadSource").value.trim(), poiId: $("leadPoiId").value.trim(), lat: $("leadLat").value, lng: $("leadLng").value, follow: $("leadFollow").value, checkedAt: $("leadVerified").value === "verified" ? (previous?.checkedAt || new Date().toISOString()) : "" };
  try { await api("/api/leads", { method: "POST", body: JSON.stringify(lead) }); leads = previous ? leads.map((x) => x.id === id ? lead : x) : [lead, ...leads]; selectedId = id; searchResults = null; render(); $("leadDialog").close(); showToast(previous ? "线索已更新" : "线索已添加"); }
  catch (error) { showToast(error.message); }
});
$("photoForm").addEventListener("submit", async (event) => {
  event.preventDefault(); const files = [...$("photoFiles").files], leadId = $("photoLeadId").value, uploader = $("photoUploader").value.trim();
  if (!$ ("photoConsent").checked) return showToast("请先确认照片授权。");
  if (!files.length) return showToast("请选择要添加的照片。");
  if (files.some((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024)) return showToast("仅支持 JPG、PNG、WebP，且每张不超过 10MB。");
  try { for (const file of files) await api("/api/photos", { method: "POST", body: JSON.stringify({ leadId, uploader, authorized: true, fileName: file.name, dataUrl: await fileToDataUrl(file) }) }); $("photoDialog").close(); showToast(`已添加 ${files.length} 张授权照片`); await showLeadDetails(leadId); }
  catch (error) { showToast(error.message); }
});
$("importBtn").addEventListener("click", () => $("csvInput").click());
$("exportBtn").addEventListener("click", exportSearchResults);
$("csvInput").addEventListener("change", async (event) => { const file = event.target.files[0]; if (!file) return; try { const imported = parseCsv(await file.text()); await api("/api/leads/batch", { method: "POST", body: JSON.stringify(imported) }); leads = await api("/api/leads"); searchResults = null; render(); showToast(`已导入 ${imported.length} 条线索；请核实电话和来源。`); } catch (error) { showToast(error.message || "CSV 导入失败。"); } finally { event.target.value = ""; } });
$("amapSetupBtn").addEventListener("click", () => $("settingsDialog").showModal()); $("mapSetupInline").addEventListener("click", () => $("settingsDialog").showModal());
$("settingsForm").addEventListener("submit", async (event) => { event.preventDefault(); try { await restoreMap(); if (map && regionRoot) { $("settingsDialog").close(); showToast("高德地图和全国行政区划已连接"); } } catch (error) { showToast(error.message); } });
$("privacyBtn").addEventListener("click", () => $("privacyDialog").showModal());
$("locateBtn").addEventListener("click", () => { if (!map) return showToast("高德地图尚未连接。"); if (!navigator.geolocation) return showToast("浏览器不支持定位。"); navigator.geolocation.getCurrentPosition(({ coords }) => map.setZoomAndCenter(13, [coords.longitude, coords.latitude]), () => showToast("无法获取定位，请检查浏览器权限。")); });
$("mapZoomIn").addEventListener("click", () => map ? map.zoomIn() : showToast("高德地图尚未连接。")); $("mapZoomOut").addEventListener("click", () => map ? map.zoomOut() : showToast("高德地图尚未连接。"));

async function start() {
  try { [leads, callMarks] = await Promise.all([api("/api/leads"), api("/api/call-marks").then((result) => result.callMarks || {})]); } catch (error) { showToast(error.message); }
  render(); await restoreMap();
}
void start();
async function refreshCallMarks() { try { callMarks = (await api("/api/call-marks")).callMarks || {}; render(); } catch {} }
setInterval(() => { refreshLeads({ quiet: true }); void refreshCallMarks(); }, 15000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { refreshLeads({ quiet: true }); void refreshCallMarks(); } });
