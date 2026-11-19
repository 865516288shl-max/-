# 镇级行政区与已拨商户标记实施计划

> **For agentic workers:** This plan is executed inline in the current checkout; do not delegate.

**Goal:** Add town/street-level search, keep authorized merchant photos with an AMap detail link, and persist a red “called” marker across devices.

**Architecture:** Extend the current AMap DistrictSearch cascade and selected adcode in `app.js`; add a small `callMarks` collection to the existing server JSON store with GET/POST/DELETE endpoints; render the shared marker on current lead and live POI cards. Keep existing authorized-photo storage, and retain AMap deep-link behavior without loading AMap image URLs.

**Tech Stack:** Existing vanilla JavaScript, HTML/CSS, Node.js HTTP server, JSON file store, AMap JS API.

**Spec:** `docs/superpowers/specs/2026-11-17-town-and-call-markers-design.md`

## Global Constraints

- AMap photos are not scraped, cached, downloaded, or independently displayed.
- Only user-authorized photos already uploaded to this website are shown in its photo gallery.
- Call status is manual, shared on the server, and reversible.
- AMap search is incomplete and only returns available phone/address fields.
- Preserve the no-login public access behavior and warn that edits are public.

## Review Focus

- County selection changes clear any previously selected town before results are searched.
- Districts with no returned child division keep town selection unavailable with a clear empty option.
- A POI without an AMap ID still gets a stable marker key for the current result identifier.
- Marking a phone does not imply that a `tel:` link was successfully called.
- Cross-device refresh reads shared call marks without replacing live search results.

---

### Task 1: Town/street selection and search scope

**Files:**
- Modify: `dealer-map/index.html` (add town/street selector)
- Modify: `dealer-map/app.js` (load child divisions when county changes, maintain selection, include town adcode/name in search)
- Modify: `dealer-map/styles.css` (keep fourth selector usable in responsive filter layout)

- [x] Add the town/street selector and empty/loading state.
- [x] Extend county-change handling to query AMap DistrictSearch for one further level using the county adcode, clear stale town values, and then update options.
- [x] Make selected town take precedence as the PlaceSearch scope; include it in result labels and local lead matching where applicable.
- [x] Keep the selector disabled and explain when no child divisions are returned.
- [x] Run JavaScript syntax validation and inspect layout rules at desktop/mobile breakpoints.

### Task 2: Shared manual call markers

**Files:**
- Modify: `dealer-map/server.mjs` (store shape and call-mark routes)
- Modify: `dealer-map/app.js` (load, toggle, refresh, and render markers for local leads and live POIs)
- Modify: `dealer-map/styles.css` (red called state and accessible button styles)
- Modify: `dealer-map/index.html` (photo/link/privacy wording if needed)

- [x] Add persisted `callMarks` records keyed by local lead ID or AMap POI ID, with `calledAt` timestamp.
- [x] Add GET and POST API operations; `called:false` deletes a mark. Validate key length and same-origin writes like the other mutation routes.
- [x] Render an explicit manual “标记已拨/取消已拨” control and red indicator; clicking the telephone link alone must not change state.
- [x] Refresh marks periodically and when the page becomes visible so other devices see changes.
- [x] Keep local authorized-photo gallery and AMap detail link; do not add AMap photo URLs or proxying.
- [x] Run JavaScript syntax validation and inspect all changed UI labels and delegated click handlers.

### Task 3: Documentation and final review

**Files:**
- Modify: `dealer-map/README.md` (town-level scope, shared call markers, photo limits)
- Review: all files listed above

- [x] Update feature and privacy notes so shared call marks and public edit behavior are accurate.
- [x] Review the design acceptance points against the resulting code; note that live AMap calls need a valid AMap key and domain allowlist.
- [x] Report syntax-check results and disclose that no full test suite exists/was run if that remains true.
