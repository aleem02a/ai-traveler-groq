"use strict";
/* =====================================================
   TripWise — Groq AI Edition v3
   Features: Voice Input · NLP Form Fill · Live Maps
   Trip Comparison · Budget Negotiator · Day Re-planner
   PDF Export · Calendar Export · WhatsApp · QR Code
   Saved Plans · Distance Matrix · Emergency Links
   ===================================================== */

/* ──────────────────────────────────────
   API CONFIG (key is stored server-side)
   ────────────────────────────────────── */

/* ─── Config ─── */
const API_CHAT_URL   = "/api/chat";
const API_STREAM_URL = "/api/stream";
const PLAN_MODEL     = "llama-3.3-70b-versatile";
const CHAT_MODEL     = "llama-3.1-8b-instant";
const THEME_STORE    = "tripwise_theme";
const PLANS_STORE    = "tripwise_saved_plans";
const MAX_CHAT_TURNS = 16;
const MAX_SAVED      = 10;
const PLAN_MAX_TOKENS = 3600;
const STREAM_MAX_TOKENS = 700;
const DEFAULT_RETRY_AFTER_MS = 30000;

/* ─── State ─── */
const S = {
  plan:        null,
  chatHistory: [],
  generating:  false,
  chatStreaming: false,
  rateLimitedUntil: 0,
  toastTimer:  null,
  voiceActive: false,
  voiceRecognizer: null
};

let leafletMapInstance = null;
let leafletActiveDay   = 0;

/* ─── DOM ─── */
const $  = id  => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

const D = {
  introScreen:       $("introScreen"),
  appShell:          $("appShell"),
  introCta:          $("introCta"),
  planStatus:        $("planStatus"),
  printBtn:          $("printBtn"),
  shareBtn:          $("shareBtn"),
  savedPlansBtn:     $("savedPlansBtn"),
  planForm:          $("planForm"),
  fCity:             $("fCity"),
  fDate:             $("fDate"),
  fDays:             $("fDays"),
  fPeople:           $("fPeople"),
  fBudget:           $("fBudget"),
  fTransport:        $("fTransport"),
  fStay:             $("fStay"),
  fMeal:             $("fMeal"),
  fExtra:            $("fExtra"),
  generateBtn:       $("generateBtn"),
  sampleBtn:         $("sampleBtn"),
  nlpInput:          $("nlpInput"),
  nlpFillBtn:        $("nlpFillBtn"),
  voiceBtn:          $("voiceBtn"),
  tripLabel:         $("tripLabel"),
  tripTitle:         $("tripTitle"),
  statGrid:          $("statGrid"),
  fitNum:            $("fitNum"),
  fitFill:           $("fitFill"),
  fitSub:            $("fitSub"),
  reasonsList:       $("reasonsList"),
  refineInput:       $("refineInput"),
  refineBtn:         $("refineBtn"),
  tabItinerary:      $("tab-itinerary"),
  tabBudget:         $("tab-budget"),
  tabMap:            $("tab-map"),
  tabStops:          $("tab-stops"),
  tabSafety:         $("tab-safety"),
  aiOverlay:         $("aiOverlay"),
  overlayStep:       $("overlayStep"),
  overlayFill:       $("overlayFill"),
  chatFab:           $("chatFab"),
  chatBox:           $("chatBox"),
  chatMsgs:          $("chatMsgs"),
  chatForm:          $("chatForm"),
  chatInput:         $("chatInput"),
  printArea:         $("printArea"),
  toast:             $("toast"),
  introThemeBtn:     $("introThemeBtn"),
  themeToggleBtn:    $("themeToggleBtn"),
  mobileFormToggle:  $("mobileFormToggle"),
  formPanel:         $("formPanel"),
  formOverlay:       $("formOverlay"),
  formCloseBtn:      $("formCloseBtn"),
  mobileBottomBar:   $("mobileBottomBar"),
  mobileShareBtn:    $("mobileShareBtn"),
  mobilePrintBtn:    $("mobilePrintBtn"),
  mobileGenerateBtn: $("mobileGenerateBtn"),
  summaryBtn:        $("summaryBtn"),
  negotiateBtn:      $("negotiateBtn"),
  compareBtn:        $("compareBtn"),
  saveBtn:           $("saveBtn"),
  calendarBtn:       $("calendarBtn"),
  pdfBtn:            $("pdfBtn"),
  qrBtn:             $("qrBtn"),
  qrDownloadBtn:     $("qrDownloadBtn"),
  qrCopyBtn:         $("qrCopyBtn"),
  qrFallbackText:    $("qrFallbackText"),
  waBtn:             $("waBtn"),
  exportShareBtn:    $("exportShareBtn"),
  savedPlansNav:     $("savedPlansNav"),
  footerSavedPlansNav:$("footerSavedPlansNav"),
  safetyNav:         $("safetyNav"),
  footerSafetyNav:   $("footerSafetyNav"),
  copyrightYear:     $("copyrightYear"),
  replanDaySelect:   $("replanDaySelect"),
  replanReason:      $("replanReason"),
  replanSubmitBtn:   $("replanSubmitBtn")
};

/* ===================================================
   HELPERS
   =================================================== */

const esc = s => (s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const inr = n => "₹" + (Math.round(n || 0)).toLocaleString("en-IN");
const todayISO = () => new Date().toISOString().slice(0, 10);
const timeNow = () => new Date().toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit" });

/* ─── #14 Animated Counter ─── */
function animateValue(el, end, prefix = "", suffix = "", duration = 800) {
  if (!el) return;
  const start = 0;
  const startTime = performance.now();
  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const current = Math.round(start + (end - start) * eased);
    el.textContent = prefix + current.toLocaleString("en-IN") + suffix;
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ─── #21 Simple markdown → HTML for chat ─── */
function chatMarkdown(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^[•\-]\s+/gm, '<span style="color:var(--p2);margin-right:4px">→</span>')
    .replace(/\n/g, '<br>');
}

function toast(msg, dur = 3200) {
  const el = D.toast;
  if (!el) return;
  clearTimeout(S.toastTimer);
  el.textContent = msg;
  el.classList.add("show");
  S.toastTimer = setTimeout(() => el.classList.remove("show"), dur);
}

function formatWait(ms) {
  const seconds = Math.max(1, Math.ceil((ms || 0) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function parseRetryAfter(value) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : 0;
}

function rememberRateLimit(ms = DEFAULT_RETRY_AFTER_MS) {
  S.rateLimitedUntil = Math.max(S.rateLimitedUntil || 0, Date.now() + ms);
}

function getRateLimitWait() {
  return Math.max(0, (S.rateLimitedUntil || 0) - Date.now());
}

function makeCooldownError() {
  const retryAfterMs = getRateLimitWait();
  const err = new Error(`Groq rate limit reached. Please retry in ${formatWait(retryAfterMs)}.`);
  err.status = 429;
  err.retryAfterMs = retryAfterMs;
  return err;
}

function ensureAIReady() {
  if (getRateLimitWait() > 0) throw makeCooldownError();
}

function userFriendlyAIError(err) {
  const msg = err?.message || "AI unavailable";
  if (err?.status === 429 || /429|rate.?limit/i.test(msg)) {
    const retryAfterMs = err?.retryAfterMs || getRateLimitWait() || DEFAULT_RETRY_AFTER_MS;
    rememberRateLimit(retryAfterMs);
    return `Groq rate limit reached. Try again in ${formatWait(retryAfterMs)}.`;
  }
  return msg;
}

async function readAPIError(res) {
  const payload = await res.json().catch(() => ({}));
  const retryAfterMs = parseRetryAfter(res.headers.get("Retry-After")) ||
    Number(payload?.error?.retryAfterMs || 0) ||
    (res.status === 429 ? DEFAULT_RETRY_AFTER_MS : 0);

  const err = new Error(payload?.error?.message || `HTTP ${res.status}`);
  err.status = res.status;
  err.retryAfterMs = retryAfterMs;
  if (res.status === 429) rememberRateLimit(retryAfterMs);
  return err;
}

function showScreen(id) {
  $$(".screen").forEach(s => s.classList.remove("active"));
  $(id).classList.add("active");
}

function showModal(id) {
  const m = $(id);
  if (m) { m.classList.remove("hidden"); document.body.style.overflow = "hidden"; }
}

function hideModal(id) {
  const m = $(id);
  if (m) { m.classList.add("hidden"); document.body.style.overflow = ""; }
}

/* Close modal on overlay click */
$$(".modal-overlay").forEach(mo => {
  mo.addEventListener("click", e => {
    if (e.target === mo) hideModal(mo.id);
  });
});

/* Lazy-load a script */
function loadScript(url) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${url}"]`)) { resolve(); return; }
    const s = document.createElement("script");
    s.src   = url;
    s.onload  = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

/* ===================================================
   GROQ API
   =================================================== */

async function groqChat(messages, { model = CHAT_MODEL, jsonMode = false, temperature = 0.7, maxTokens = 4096 } = {}) {
  ensureAIReady();

  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    ...(jsonMode ? { response_format: { type: "json_object" } } : {})
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);

  let res;
  try {
    res = await fetch(API_CHAT_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
      signal:  controller.signal
    });
  } catch (fetchErr) {
    clearTimeout(timeout);
    if (fetchErr.name === "AbortError") {
      const err = new Error("AI request timed out. Please try again.");
      err.status = 408;
      throw err;
    }
    const err = new Error("Network error — check your connection and try again.");
    err.status = 0;
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    throw await readAPIError(res);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    const err = new Error("AI returned an invalid response. Please try again.");
    err.status = 502;
    throw err;
  }
  return data.choices?.[0]?.message?.content || "";
}

/* Streaming chat */
async function groqStream(messages, onChunk) {
  ensureAIReady();

  const body = {
    model: CHAT_MODEL, messages, temperature: 0.75, max_tokens: STREAM_MAX_TOKENS
  };
  const res = await fetch(API_STREAM_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body)
  });
  if (!res.ok) throw await readAPIError(res);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value);
    for (const line of text.split("\n")) {
      if (!line.startsWith("data: ") || line.includes("[DONE]")) continue;
      try {
        const chunk = JSON.parse(line.slice(6))?.choices?.[0]?.delta?.content || "";
        if (chunk) { full += chunk; onChunk(chunk); }
      } catch {}
    }
  }
  return full;
}

/* ===================================================
   JSON EXTRACTOR
   =================================================== */

function extractJSON(raw) {
  if (!raw) throw new Error("Empty AI response");
  try { return JSON.parse(raw); } catch {}
  const stripped = raw.replace(/^```[\w]*\n?/, "").replace(/\n?```$/, "").trim();
  try { return JSON.parse(stripped); } catch {}
  const m = stripped.match(/\{[\s\S]*\}/);
  if (m) try { return JSON.parse(m[0]); } catch {}
  throw new Error("AI response was not valid JSON");
}

/* ===================================================
   THEME
   =================================================== */

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_STORE, theme);
  document.querySelectorAll(".theme-icon").forEach(el => el.textContent = theme === "dark" ? "🌙" : "☀️");
}

function toggleTheme() {
  applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
}

/* ===================================================
   MOBILE DRAWER
   =================================================== */

function openForm()  { D.formPanel.classList.add("open"); D.formOverlay.classList.add("active"); document.body.style.overflow = "hidden"; }
function closeForm() { D.formPanel.classList.remove("open"); D.formOverlay.classList.remove("active"); document.body.style.overflow = ""; }

function findClosestCity(input) {
  const opts  = Array.from($$("#fCity option")).map(o => o.value);
  const lower = input.toLowerCase().trim();
  const exact = opts.find(c => c.toLowerCase() === lower);
  if (exact) return exact;
  const partial = opts.find(c => c.toLowerCase().includes(lower) || lower.includes(c.toLowerCase().split(" ")[0]));
  return partial || null;
}

/* ===================================================
   NLP AUTO-FILL + VOICE INPUT
   =================================================== */

async function nlpAutoFill() {
  const text = D.nlpInput?.value?.trim();
  if (!text) { toast("Type your trip description first"); return; }

  const btn = D.nlpFillBtn;
  btn.disabled = true;
  btn.textContent = "Analyzing...";

  const localParams = parseTripTextLocally(text);

  try {
    const aiParams = normalizeTripParams(await extractTripParamsWithAI(text));
    const applied = applyTripParams(mergeTripParams(localParams, aiParams, text));
    if (applied) toast("Form filled from your description!");
    else throw new Error("No usable trip details found");
  } catch (e) {
    const applied = applyTripParams(localParams);
    if (applied) toast("Filled basic details locally. You can adjust anything before generating.", 4200);
    else toast("Parse failed. Try adding city, days, people, and budget.");
  } finally {
    btn.disabled = false;
    btn.textContent = "✨ Auto-Fill Form with AI";
  }
}

async function extractTripParamsWithAI(text) {
  const raw = await groqChat(
    [
      { role: "system", content: "You are a trip parameter extractor. Return only valid JSON with no extra text." },
      { role: "user", content:
`Extract trip parameters from: "${text}"
Return ONLY JSON:
{
  "city": "Goa",
  "days": 3,
  "travelers": 2,
  "budget": 12000,
  "transport": "Metro and Bus",
  "stay": "Student hostel",
  "meal": "street food stalls",
  "interests": ["culture","food"],
  "pace": "balanced",
  "extra": ""
}
transport: "Metro and Bus"|"Walk and Transit"|"Rental Scooter"|"Shared Cabs"
stay: "Student hostel"|"Budget hotel"|"Friends or campus stay"|"Airbnb or PG accommodation"
meal: "street food stalls"|"mix of street food and cafes"|"sit-down restaurants"
interests array from: culture,food,nature,markets,nightlife,education,adventure,photography
pace: relaxed|balanced|packed
If the user gives a budget per person/student/head, multiply it by the traveler count and return the total group budget.`
      }
    ],
    { model: CHAT_MODEL, jsonMode: true, temperature: 0.3, maxTokens: 400 }
  );

  return extractJSON(raw);
}

function mergeTripParams(localParams = {}, aiParams = {}, sourceText = "") {
  const merged = { ...localParams };
  Object.entries(aiParams).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "") return;
    if (Array.isArray(value) && !value.length) return;
    if (key === "budget" && localParams.budget && isPerPersonBudget(sourceText)) return;
    merged[key] = value;
  });
  if (!aiParams.interests?.length && localParams.interests?.length) merged.interests = localParams.interests;
  if (!aiParams.extra && localParams.extra) merged.extra = localParams.extra;
  return merged;
}

function normalizeTripParams(p = {}, sourceText = "") {
  const out = { ...p };
  out.travelers = toWholeNumber(out.travelers ?? out.people ?? out.students ?? out.persons ?? out.groupSize);
  out.days = toWholeNumber(out.days ?? out.durationDays);
  out.budget = toMoneyNumber(out.budget ?? out.groupBudget ?? out.totalBudget);

  const context = `${sourceText} ${out.budgetScope || ""} ${out.notes || ""}`.toLowerCase();
  if (out.budget && isPerPersonBudget(context) && out.travelers > 1) {
    out.budget *= out.travelers;
  }

  if (out.city) out.city = String(out.city).trim();
  if (out.transport) out.transport = String(out.transport).trim();
  if (out.stay) out.stay = String(out.stay).trim();
  if (out.meal) out.meal = String(out.meal).trim();
  if (out.pace) out.pace = String(out.pace).toLowerCase().trim();
  if (typeof out.interests === "string") out.interests = out.interests.split(/[,/|]/).map(s => s.trim());
  if (Array.isArray(out.interests)) {
    out.interests = [...new Set(out.interests.map(normalizeInterest).filter(Boolean))];
  }
  return out;
}

function toWholeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : null;
  const asText = String(value).toLowerCase().replace(/,/g, "").trim();
  return numberFromToken(asText) || null;
}

function toMoneyNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : null;
  const asText = String(value).toLowerCase().replace(/,/g, "").trim();
  const m = asText.match(/(\d+(?:\.\d+)?)\s*(k|thousand|lakh|lakhs)?/);
  if (!m) return null;
  return scaleMoney(parseFloat(m[1]), m[2] || "");
}

function scaleMoney(value, unit = "") {
  if (!Number.isFinite(value)) return null;
  if (/k|thousand/.test(unit)) value *= 1000;
  if (/lakh/.test(unit)) value *= 100000;
  return Math.round(value);
}

function isPerPersonBudget(text) {
  return /\b(per\s*(person|student|head)|each|pp)\b/.test(text || "");
}

function normalizeInterest(value) {
  const v = String(value || "").toLowerCase().trim();
  if (/heritage|history|temple|museum|fort|palace|culture/.test(v)) return "culture";
  if (/food|cafe|restaurant|eat|street/.test(v)) return "food";
  if (/nature|beach|mountain|park|lake|waterfall|forest|garden/.test(v)) return "nature";
  if (/market|shopping|bazaar|souvenir/.test(v)) return "markets";
  if (/night|party|club|bar|pub/.test(v)) return "nightlife";
  if (/study|education|campus|college|library/.test(v)) return "education";
  if (/adventure|trek|hike|rafting|surf|sport/.test(v)) return "adventure";
  if (/photo|instagram|view|scenic/.test(v)) return "photography";
  return ["culture","food","nature","markets","nightlife","education","adventure","photography"].includes(v) ? v : "";
}

function applyTripParams(p = {}) {
  p = normalizeTripParams(p);
  let applied = 0;

  if (p.city) {
    const matched = findClosestCity(p.city) || findCityInText(p.city);
    if (matched) { D.fCity.value = matched; applied++; }
  }
  if (p.days) {
    D.fDays.value = Math.max(1, Math.min(7, parseInt(p.days, 10) || 3));
    applied++;
  }
  if (p.travelers) {
    D.fPeople.value = Math.max(1, Math.min(20, parseInt(p.travelers, 10) || 2));
    applied++;
  }
  if (p.budget) {
    D.fBudget.value = Math.max(500, parseInt(p.budget, 10) || 12000);
    applied++;
  }
  if (setSelectValue(D.fTransport, p.transport)) applied++;
  if (setSelectValue(D.fStay, p.stay)) applied++;
  if (setSelectValue(D.fMeal, p.meal)) applied++;
  if (["relaxed","balanced","packed"].includes(p.pace)) {
    $$("input[name='pace']").forEach(r => r.checked = r.value === p.pace);
    applied++;
  }
  if (Array.isArray(p.interests) && p.interests.length) {
    const picked = new Set(p.interests.map(v => String(v).toLowerCase()));
    $$("input[name='int']").forEach(cb => { cb.checked = picked.has(cb.value); });
    applied++;
  }
  if (p.extra) {
    D.fExtra.value = p.extra;
    applied++;
  }

  return applied;
}

function findCityInText(text) {
  const lower = String(text || "").toLowerCase();
  const opts = Array.from($$("#fCity option")).map(o => o.value);
  return opts.find(city => {
    const c = city.toLowerCase();
    const first = c.split(/\s+/)[0];
    return lower.includes(c) || (first.length > 3 && lower.includes(first));
  }) || null;
}

function setSelectValue(select, value) {
  if (!select || !value) return false;
  const lower = String(value).toLowerCase();
  const options = Array.from(select.options);
  const option = options.find(o => o.value.toLowerCase() === lower) ||
    options.find(o => lower.includes(o.value.toLowerCase()) || o.value.toLowerCase().includes(lower));
  if (!option) return false;
  select.value = option.value;
  return true;
}

function parseTripTextLocally(text) {
  const lower = String(text || "").toLowerCase();
  const params = {};

  const city = findCityInText(text);
  if (city) params.city = city;

  const days = lower.match(/\b(\d+|one|two|three|four|five|six|seven)\s*(?:day|days)\b/);
  if (days) params.days = numberFromToken(days[1]);

  const travelers = lower.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\s*(?:friends?|students?|people|persons?|travellers?|travelers?|mates?|classmates?)\b/);
  if (travelers) params.travelers = numberFromToken(travelers[1]);

  const budget = parseBudgetFromText(lower, params.travelers || 1);
  if (budget) params.budget = budget;

  if (/(scooter|bike|rental)/.test(lower)) params.transport = "Rental Scooter";
  else if (/(cab|taxi|ola|uber)/.test(lower)) params.transport = "Shared Cabs";
  else if (/(walk|walking)/.test(lower)) params.transport = "Walk and Transit";
  else if (/(metro|bus|train|transit)/.test(lower)) params.transport = "Metro and Bus";

  if (/(airbnb|pg|apartment|homestay)/.test(lower)) params.stay = "Airbnb or PG accommodation";
  else if (/(hostel|dorm)/.test(lower)) params.stay = "Student hostel";
  else if (/(hotel|room)/.test(lower)) params.stay = "Budget hotel";
  else if (/(stay with friends?|friends?'? place|campus stay|college stay)/.test(lower)) params.stay = "Friends or campus stay";

  if (/(restaurant|sit[ -]?down)/.test(lower)) params.meal = "sit-down restaurants";
  else if (/(cafe|cafes)/.test(lower)) params.meal = "mix of street food and cafes";
  else if (/(street food|food stall|stalls|cheap food)/.test(lower)) params.meal = "street food stalls";

  if (/(relaxed|slow|chill|easy)/.test(lower)) params.pace = "relaxed";
  else if (/(packed|fast|tight|maximum|max places)/.test(lower)) params.pace = "packed";
  else if (/(balanced|moderate)/.test(lower)) params.pace = "balanced";

  const interestMap = {
    culture: /(culture|heritage|history|temple|museum|fort|palace)/,
    food: /(food|cafe|restaurant|street food|eat)/,
    nature: /(nature|beach|mountain|park|lake|waterfall|forest|garden)/,
    markets: /(market|shopping|bazaar|souvenir)/,
    nightlife: /(nightlife|party|club|bar|pub|night)/,
    education: /(study|education|campus|college|library)/,
    adventure: /(adventure|trek|hike|rafting|surf|sport)/,
    photography: /(photo|photography|instagram|views|scenic)/
  };
  params.interests = Object.entries(interestMap).filter(([, re]) => re.test(lower)).map(([key]) => key);

  const extraBits = [];
  if (/(veg|vegetarian|vegan|jain)/.test(lower)) extraBits.push("vegetarian-friendly food");
  const avoid = lower.match(/avoid\s+([^,.]+)/);
  if (avoid) extraBits.push(`avoid ${avoid[1].trim()}`);
  if (/(hidden gem|hidden gems|offbeat)/.test(lower)) extraBits.push("include hidden gems");
  if (extraBits.length) params.extra = extraBits.join(", ");

  return normalizeTripParams(params);
}

function numberFromToken(token) {
  const words = {
    one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10,
    eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15, sixteen:16, seventeen:17,
    eighteen:18, nineteen:19, twenty:20
  };
  const value = String(token || "").toLowerCase().trim();
  if (words[value]) return words[value];
  const numeric = parseInt(value.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseBudgetFromText(lower, travelers = 1) {
  lower = String(lower || "").replace(/,/g, "");
  const patterns = [
    /(?:under|budget|within|around|approx|approximately|rs\.?|inr|₹)\s*₹?\s*(\d+(?:\.\d+)?)\s*(k|thousand|lakh|lakhs)?/,
    /₹\s*(\d+(?:\.\d+)?)\s*(k|thousand|lakh|lakhs)?/,
    /(\d+(?:\.\d+)?)\s*(k|thousand|lakh|lakhs)\s*(?:budget|rs|inr|rupees)?/,
    /(\d{3,7})\s*(?:rs|inr|rupees?)\b/
  ];
  for (const re of patterns) {
    const m = lower.match(re);
    if (!m) continue;
    let value = scaleMoney(parseFloat(m[1]), m[2] || "");
    if (isPerPersonBudget(lower) && travelers > 1) value *= travelers;
    return Math.round(value);
  }
  return null;
}

function resetVoiceInputButton() {
  S.voiceActive = false;
  S.voiceRecognizer = null;
  D.voiceBtn?.classList.remove("listening");
  if (D.voiceBtn) {
    D.voiceBtn.disabled = false;
    D.voiceBtn.textContent = "🎤";
    D.voiceBtn.title = "Voice input (Chrome/Edge)";
    D.voiceBtn.setAttribute("aria-pressed", "false");
  }
}

function startVoiceInput() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast("Voice is not supported. Use Chrome or Edge, or type your trip details."); return; }
  if (S.voiceActive && S.voiceRecognizer) {
    S.voiceRecognizer.stop();
    toast("Stopped listening.");
    return;
  }

  const rec = new SR();
  S.voiceActive = true;
  S.voiceRecognizer = rec;
  rec.lang = "en-IN";
  rec.continuous = false;
  rec.interimResults = false;
  let hadError = false;
  let gotTranscript = false;

  D.voiceBtn.classList.add("listening");
  D.voiceBtn.textContent = "🔴";
  D.voiceBtn.title = "Stop listening";
  D.voiceBtn.setAttribute("aria-pressed", "true");
  toast("Listening... speak your trip details");

  rec.onresult = e => {
    const transcript = e.results?.[0]?.[0]?.transcript?.trim();
    if (!transcript) return;
    gotTranscript = true;
    D.nlpInput.value = transcript;
    toast("Got it. Auto-filling your form...");
    nlpAutoFill();
  };

  rec.onerror = e => {
    hadError = true;
    const messages = {
      "not-allowed": "Microphone permission blocked. Allow mic access and try again.",
      "service-not-allowed": "Voice service is blocked in this browser.",
      "no-speech": "No speech detected. Try again closer to the mic.",
      "audio-capture": "No microphone found. Check your audio input.",
      "network": "Voice network error. Type your trip details instead.",
      "aborted": "Voice input stopped."
    };
    toast(messages[e.error] || "Voice error. Try again.");
    resetVoiceInputButton();
  };

  rec.onend = () => {
    resetVoiceInputButton();
    if (!hadError && !gotTranscript) toast("Voice input ended. You can type your trip details instead.");
  };

  try {
    rec.start();
  } catch (e) {
    resetVoiceInputButton();
    toast("Voice could not start. Try typing your trip details.");
  }
}

/* ===================================================
   PLAN PROMPT BUILDER
   =================================================== */

function buildPrompt(p) {
  return `Generate a detailed ${p.days}-day student travel plan for ${p.city}, India.
Students: ${p.travelers} | Budget: ₹${p.budget} total | Start: ${p.startDate}
Transport: ${p.transport} | Stay: ${p.stay} | Meals: ${p.meal}
Interests: ${p.interests.join(", ")} | Pace: ${p.pace}
${p.extra ? "Special: " + p.extra : ""}
Keep the response compact enough for low API rate limits: 3-4 activities per day, descriptions under 22 words, and no more than 14 mapStops.

Return ONLY this JSON structure (no extra text):
{
  "tripTitle": "2-4 word evocative title",
  "fitScore": 85,
  "highlights": ["highlight1","highlight2","highlight3"],
  "aiInsight": "2-sentence AI insight on why this plan fits the group",
  "reasons": ["reason 1","reason 2","reason 3"],
  "budget": {
    "groupTotal": 11200,
    "perPerson": 5600,
    "remaining": 800,
    "breakdown": {
      "accommodation": 3200,
      "food": 2800,
      "transport": 1800,
      "entryFees": 1200,
      "miscellaneous": 600,
      "bufferEmergency": 1400
    },
    "savingTips": ["tip1","tip2","tip3"]
  },
  "days": [
    {
      "dayNumber": 1,
      "date": "${p.startDate}",
      "theme": "Day theme",
      "activities": [
        {
          "time": "09:00",
          "type": "sightseeing",
          "name": "Place name",
          "description": "2 sentence description",
          "durationMins": 90,
          "entryFee": 0,
          "mealCost": 0,
          "transportCost": 0,
          "tags": ["free","must-visit"],
          "mapsQuery": "Place name ${p.city} India"
        }
      ]
    }
  ],
  "mapStops": [
    {
      "name": "Stop name",
      "lat": 28.6139,
      "lng": 77.2090,
      "type": "Sightseeing",
      "day": 1,
      "entryFee": 0,
      "description": "Short description"
    }
  ],
  "safetyTips": {
    "overview": "General safety overview",
    "dos": ["do 1","do 2","do 3","do 4"],
    "donts": ["dont 1","dont 2","dont 3"],
    "emergency": { "police": "100", "ambulance": "108", "tourist": "1800-111-363", "local": "local helpline" }
  }
}`;
}

/* ===================================================
   LOADING OVERLAY
   =================================================== */

const STEPS = [
  "Reading your preferences…",
  "Checking local attractions…",
  "Calculating student budget…",
  "Building your itinerary…",
  "Mapping out stops…",
  "Finalising safety tips…",
  "Almost ready…"
];

let _stepTimer = null;
let _stepIdx   = 0;

function showLoading() {
  _stepIdx = 0;
  D.aiOverlay.classList.remove("hidden");
  D.overlayFill.style.width = "0%";
  D.overlayStep.textContent = STEPS[0];
  _stepTimer = setInterval(() => {
    _stepIdx = (_stepIdx + 1) % STEPS.length;
    D.overlayStep.textContent = STEPS[_stepIdx];
    D.overlayFill.style.width = Math.round((_stepIdx / (STEPS.length - 1)) * 88) + "%";
  }, 900);
}

function hideLoading() {
  clearInterval(_stepTimer);
  D.overlayFill.style.width = "100%";
  setTimeout(() => D.aiOverlay.classList.add("hidden"), 350);
}

/* ===================================================
   GENERATE PLAN
   =================================================== */

async function generatePlan() {
  if (S.generating) return;
  if (getRateLimitWait() > 0) {
    toast(userFriendlyAIError(makeCooldownError()), 5200);
    return;
  }

  const interests = [...$$("input[name='int']:checked")].map(c => c.value);
  const pace      = (document.querySelector("input[name='pace']:checked") || {}).value || "balanced";

  const params = {
    city:      D.fCity.value,
    startDate: D.fDate.value || todayISO(),
    days:      Math.max(1, Math.min(7,  parseInt(D.fDays.value,   10) || 3)),
    travelers: Math.max(1, Math.min(20, parseInt(D.fPeople.value, 10) || 2)),
    budget:    Math.max(500, parseInt(D.fBudget.value, 10) || 12000),
    transport: D.fTransport.value,
    stay:      D.fStay.value,
    meal:      D.fMeal.value,
    pace,
    interests: interests.length ? interests : ["culture","food"],
    extra:     D.fExtra.value.trim()
  };

  S.generating = true;
  S.chatHistory = [];
  D.generateBtn.disabled = true;
  showLoading();
  showSkeletonState();

  const MAX_RETRIES = 3;
  let lastErr = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 1) {
        D.overlayStep.textContent = `Retrying… (attempt ${attempt}/${MAX_RETRIES})`;
      }

      const raw  = await groqChat(
        [
          { role: "system", content: "You are TripWise, an expert Indian student travel planner. Always return valid JSON only." },
          { role: "user",   content: buildPrompt(params) }
        ],
        { model: PLAN_MODEL, jsonMode: true, temperature: 0.65, maxTokens: PLAN_MAX_TOKENS }
      );

      const plan   = extractJSON(raw);
      plan._params = params;
      S.plan       = plan;

      renderAll(plan, params);
      activateTab("itinerary");
      toast("⚡ AI plan ready!");

      // Refresh Leaflet map instance if map tab was open
      leafletMapInstance = null;
      lastErr = null;
      break; // success — exit retry loop

    } catch (err) {
      console.error(`Groq error (attempt ${attempt}/${MAX_RETRIES}):`, err);
      lastErr = err;

      // Don't retry rate-limit (429) or auth (401/403) errors
      if (err?.status === 429 || err?.status === 401 || err?.status === 403) break;

      // Wait before retrying (exponential backoff: 1.5s, 3s, 6s)
      if (attempt < MAX_RETRIES) {
        const delayMs = 1500 * Math.pow(2, attempt - 1);
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }

  if (lastErr) {
    handleAPIError(lastErr);
  }

  S.generating           = false;
  D.generateBtn.disabled = false;
  hideLoading();
}

/* ─── #15 Skeleton Loading State ─── */
function showSkeletonState() {
  const skeletonStat = `
    <div class="stat-card"><div class="skeleton-stat"><div class="skeleton skeleton-line w40 h20"></div><div class="skeleton skeleton-line w60"></div><div class="skeleton skeleton-line w40"></div></div></div>
    <div class="stat-card"><div class="skeleton-stat"><div class="skeleton skeleton-line w40 h20"></div><div class="skeleton skeleton-line w60"></div><div class="skeleton skeleton-line w40"></div></div></div>
    <div class="stat-card"><div class="skeleton-stat"><div class="skeleton skeleton-line w40 h20"></div><div class="skeleton skeleton-line w60"></div><div class="skeleton skeleton-line w40"></div></div></div>
    <div class="stat-card"><div class="skeleton-stat"><div class="skeleton skeleton-line w40 h20"></div><div class="skeleton skeleton-line w60"></div><div class="skeleton skeleton-line w40"></div></div></div>`;
  D.statGrid.innerHTML = skeletonStat;

  D.tabItinerary.innerHTML = `
    <div class="skeleton-card"><div class="skeleton skeleton-line w60 h20"></div><div class="skeleton skeleton-line w100"></div><div class="skeleton skeleton-line w80"></div><div class="skeleton skeleton-line w100"></div><div class="skeleton skeleton-line w60"></div></div>
    <div class="skeleton-card" style="margin-top:12px"><div class="skeleton skeleton-line w40 h20"></div><div class="skeleton skeleton-line w100"></div><div class="skeleton skeleton-line w80"></div><div class="skeleton skeleton-line w100"></div></div>`;
}

function handleAPIError(err) {
  const msg = userFriendlyAIError(err);
  if (err?.status === 429 || /rate.?limit/i.test(msg)) {
    toast(msg, 6200);
  } else {
    toast("❌ AI error: " + msg.slice(0, 70));
  }
  D.tabItinerary.innerHTML = `
    <div class="empty-state">
      <div class="es-icon">⚠</div>
      <div class="es-title">Generation failed</div>
      <p>${esc(msg)}</p>
      <button class="btn-primary" style="margin-top:16px" onclick="generatePlan()">⚡ Retry</button>
    </div>`;
  activateTab("itinerary");
}

/* ===================================================
   RENDER ALL
   =================================================== */

function renderAll(plan, params) {
  renderHeader(plan, params);
  renderStats(plan, params);
  renderFitScore(plan);
  renderItinerary(plan, params);
  renderBudget(plan, params);
  renderStops(plan, params, 1);
  renderSafety(plan, params);
  renderPrintArea(plan, params);
  D.planStatus.textContent = `${params.city} · ${params.days} days · ${inr(plan.budget?.perPerson)}/person`;
}

function renderHeader(plan, params) {
  D.tripLabel.textContent = `${params.days} days · ${params.travelers} students · ${params.city}`;
  D.tripTitle.textContent = plan.tripTitle || "AI Trip Plan";
}

function renderStats(plan, params) {
  const b = plan.budget || {};
  D.statGrid.innerHTML = `
    <div class="stat-card"><div class="si">💰</div><div class="sv" id="statPerPerson">₹0</div><div class="sl">Per Student</div></div>
    <div class="stat-card"><div class="si">📍</div><div class="sv" id="statStops">0</div><div class="sl">AI Stops</div></div>
    <div class="stat-card"><div class="si">📅</div><div class="sv" id="statDays">0</div><div class="sl">Days</div></div>
    <div class="stat-card"><div class="si">🎯</div><div class="sv" id="statFit">0%</div><div class="sl">Fit Score</div></div>`;

  /* #14 Animated counters */
  requestAnimationFrame(() => {
    animateValue($("statPerPerson"), Math.round(b.perPerson || 0), "₹", "", 900);
    animateValue($("statStops"), (plan.mapStops||[]).length, "", "", 600);
    animateValue($("statDays"), params.days, "", "", 500);
    animateValue($("statFit"), plan.fitScore || 0, "", "%", 800);
  });
}

function renderFitScore(plan) {
  const score = plan.fitScore || 0;
  D.fitNum.textContent = score + "%";
  D.fitFill.style.width = score + "%";
  D.fitSub.textContent = score >= 85 ? "Excellent match!" : score >= 70 ? "Good fit" : score >= 55 ? "Decent fit — consider adjustments" : "Low fit — budget may be tight";

  const reasons = plan.reasons || plan.highlights || [];
  D.reasonsList.innerHTML = reasons.slice(0, 4).map(r => `<li>${esc(r)}</li>`).join("") ||
    "<li>AI reasoning loaded</li>";
}

/* ─── Itinerary ─── */
function renderItinerary(plan, params) {
  const days = plan.days || [];
  if (!days.length) {
    D.tabItinerary.innerHTML = `<div class="empty-state"><div class="es-icon">📅</div><div class="es-title">No itinerary</div></div>`;
    return;
  }

  D.tabItinerary.innerHTML = days.map(day => {
    const acts = (day.activities || []).map(a => {
      if (a.type === "transit") {
        return `<div class="act-row transit">
          <div class="act-time">${esc(a.time||"")}</div>
          <div class="transit-txt">${esc(a.description||a.name||"Transit")}</div>
        </div>`;
      }
      const cost = (a.entryFee||0) + (a.mealCost||0) + (a.transportCost||0);
      return `<div class="act-row">
        <div class="act-time">${esc(a.time||"")}</div>
        <div>
          <div class="act-name">${esc(a.name||"Activity")}</div>
          <div class="act-desc">${esc(a.description||"")}</div>
          <div class="act-tags">${(a.tags||[]).map(t=>`<span class="act-tag">${esc(t)}</span>`).join("")}</div>
        </div>
        <div class="act-cost ${cost===0?'free':'paid'}">${cost===0?"Free":inr(cost)}</div>
      </div>`;
    }).join("");

    const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent((day.activities||[]).filter(a=>a.type!=="transit").map(a=>a.name).join(" + ")+" "+params.city)}`;

    return `<div class="day-block">
      <div class="day-hd">
        <div class="day-hd-left">
          <span class="day-num">Day ${day.dayNumber}</span>
          <span class="day-theme">${esc(day.theme||"")}</span>
          <span class="day-date">${formatDate(day.date||params.startDate, day.dayNumber)}</span>
        </div>
        <div class="day-hd-actions">
          <a class="day-route-btn" href="${mapsUrl}" target="_blank" rel="noopener">🗺 Route</a>
          <button class="replan-day-btn" onclick="openReplanModal(${day.dayNumber})">🔄 Replan</button>
        </div>
      </div>
      <div class="act-list">${acts}</div>
    </div>`;
  }).join("");
}

function formatDate(iso, dayNum) {
  try {
    const d = new Date(iso);
    d.setDate(d.getDate() + (dayNum - 1));
    return d.toLocaleDateString("en-IN", { weekday:"short", day:"numeric", month:"short" });
  } catch { return ""; }
}

/* ─── Budget ─── */
function renderBudget(plan, params) {
  const b  = plan.budget  || {};
  const bd = b.breakdown || {};
  const over = b.remaining < 0;

  const items = [
    { label:"Accommodation", key:"accommodation", icon:"🏠", color:"#6c63ff" },
    { label:"Food & Meals",  key:"food",          icon:"🍜", color:"#34d399" },
    { label:"Transport",     key:"transport",      icon:"🚇", color:"#38bdf8" },
    { label:"Entry Fees",    key:"entryFees",      icon:"🎟", color:"#fbbf24" },
    { label:"Miscellaneous", key:"miscellaneous",  icon:"🛍", color:"#a78bfa" },
    { label:"Emergency Fund",key:"bufferEmergency",icon:"🛡", color:"#f87171" }
  ];

  D.tabBudget.innerHTML = `
    <div class="budget-hero">
      <div class="bh-lbl">Total group estimate</div>
      <div class="bh-total">${inr(b.groupTotal)}</div>
      <div class="bh-sub">${inr(b.perPerson)} per student · Budget: ${inr(params.budget)} · ${over ? `<span style="color:var(--red)">Over by ${inr(Math.abs(b.remaining))}</span>` : `<span style="color:var(--green)">Buffer: ${inr(b.remaining)}</span>`}</div>
      <div class="bh-bar"><div class="bh-fill ${over?"over":"ok"}" style="width:${Math.min(100,(b.groupTotal/params.budget)*100).toFixed(0)}%"></div></div>
    </div>
    <div class="budget-grid">
      ${items.map(it => {
        const val  = bd[it.key] || 0;
        const pct  = b.groupTotal > 0 ? ((val / b.groupTotal) * 100).toFixed(0) : 0;
        return `<div class="bi">
          <div class="bi-lbl">${it.icon} ${it.label}</div>
          <div class="bi-val">${inr(val)}</div>
          <div class="bi-bar"><div class="bi-fill" style="width:${pct}%;background:${it.color}"></div></div>
        </div>`;
      }).join("")}
    </div>
    <div class="tips-title">💡 AI Saving Tips</div>
    <div class="tip-list">
      ${(b.savingTips||[]).map(t=>`<div class="tip-row"><span style="color:var(--green);font-weight:700;flex-shrink:0">💡</span>${esc(t)}</div>`).join("")}
    </div>`;
}

/* ─── Live Map Tab ─── */
function renderMapTab(plan, params, activeDay) {
  activeDay = activeDay ?? leafletActiveDay;
  leafletActiveDay = activeDay;

  const stops = plan.mapStops || [];
  if (!stops.length) {
    D.tabMap.innerHTML = `<div class="empty-state"><div class="es-icon">🗺</div><div class="es-title">No map stops</div><p>The AI didn't return GPS coordinates. Try regenerating.</p></div>`;
    return;
  }

  const days      = [...new Set(stops.map(s => Number(s.day)||1))].sort((a,b)=>a-b);
  const filtered  = activeDay === 0 ? stops : stops.filter(s => (Number(s.day)||1) === activeDay);
  const transport = params.transport || "";

  const dayTabsHtml = `
    <div class="map-day-tabs">
      <button class="map-day-tab ${activeDay===0?"active":""}" data-day="0" onclick="renderMapTab(S.plan,S.plan._params,0)">All Days</button>
      ${days.map(d => `<button class="map-day-tab ${activeDay===d?"active":""}" data-day="${d}" onclick="renderMapTab(S.plan,S.plan._params,${d})">Day ${d}</button>`).join("")}
    </div>`;

  // Distance matrix for filtered stops
  const distHtml = renderDistanceMatrix(filtered, transport);

  // Emergency links
  const city    = params.city || "India";
  const emHtml  = `
    <div class="emergency-section">
      <h4>🚨 Emergency — Find Nearby</h4>
      <div class="emergency-links">
        <a class="em-link" href="https://www.google.com/maps/search/hospital+near+${encodeURIComponent(city)}" target="_blank" rel="noopener">🏥 Hospital</a>
        <a class="em-link" href="https://www.google.com/maps/search/police+station+near+${encodeURIComponent(city)}" target="_blank" rel="noopener">🚔 Police</a>
        <a class="em-link" href="https://www.google.com/maps/search/ATM+near+${encodeURIComponent(city)}" target="_blank" rel="noopener">🏧 ATM</a>
        <a class="em-link" href="https://www.google.com/maps/search/pharmacy+near+${encodeURIComponent(city)}" target="_blank" rel="noopener">💊 Pharmacy</a>
        <a class="em-link" href="https://www.google.com/maps/search/railway+station+near+${encodeURIComponent(city)}" target="_blank" rel="noopener">🚉 Station</a>
      </div>
    </div>`;

  D.tabMap.innerHTML = `
    <div class="map-tab-wrap">
      ${dayTabsHtml}
      <div id="mapContainer"></div>
      ${distHtml}
      ${emHtml}
    </div>`;

  // Init Leaflet
  setTimeout(() => initLeafletMap(filtered, params), 50);
}

function initLeafletMap(stops, params) {
  const container = document.getElementById("mapContainer");
  if (!container || typeof L === "undefined") return;

  if (leafletMapInstance) { leafletMapInstance.remove(); leafletMapInstance = null; }

  if (!stops.length) return;

  const center = [stops[0].lat || 20.5937, stops[0].lng || 78.9629];
  leafletMapInstance = L.map("mapContainer", { zoomControl: true }).setView(center, 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a>"
  }).addTo(leafletMapInstance);

  const dayColors = ["#6c63ff","#34d399","#38bdf8","#fbbf24","#f87171","#a78bfa","#fb923c"];
  const days      = [...new Set(stops.map(s => Number(s.day)||1))].sort((a,b)=>a-b);
  const bounds    = [];

  stops.forEach((stop, idx) => {
    if (!stop.lat || !stop.lng) return;
    const dayIdx = days.indexOf(Number(stop.day)||1);
    const color  = dayColors[dayIdx % dayColors.length];

    const icon = L.divIcon({
      className: "",
      html: `<div style="background:${color};border:2.5px solid white;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:12px;box-shadow:0 3px 10px rgba(0,0,0,0.45);font-family:Inter,sans-serif">${idx+1}</div>`,
      iconSize:   [32, 32],
      iconAnchor: [16, 16]
    });

    L.marker([stop.lat, stop.lng], { icon })
      .addTo(leafletMapInstance)
      .bindPopup(`<div style="font-family:Inter,sans-serif;min-width:160px;font-size:13px">
        <strong style="font-size:14px">${esc(stop.name)}</strong><br>
        <span style="color:#666;font-size:11px">Day ${stop.day || 1} · ${esc(stop.type||"Stop")}</span><br>
        ${stop.entryFee > 0 ? `<span style="color:#059669;font-size:11px">Entry: ₹${stop.entryFee}</span>` : '<span style="color:#6b7280;font-size:11px">Free entry</span>'}<br>
        <span style="font-size:11px;color:#555">${esc((stop.description||"").slice(0,80))}</span>
      </div>`);

    bounds.push([stop.lat, stop.lng]);
  });

  // Draw route polyline per day
  days.forEach((d, di) => {
    const dayStops = stops.filter(s => (Number(s.day)||1) === d && s.lat && s.lng);
    if (dayStops.length > 1) {
      L.polyline(dayStops.map(s => [s.lat, s.lng]), {
        color:     dayColors[di % dayColors.length],
        weight:    3,
        opacity:   0.65,
        dashArray: "7,5"
      }).addTo(leafletMapInstance);
    }
  });

  if (bounds.length > 1) leafletMapInstance.fitBounds(bounds, { padding: [32, 32] });
  else if (bounds.length === 1) leafletMapInstance.setView(bounds[0], 14);
}

/* Distance Matrix */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2-lat1) * Math.PI / 180;
  const dLng = (lng2-lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function renderDistanceMatrix(stops, transport) {
  const valid = stops.filter(s => s.lat && s.lng);
  if (valid.length < 2) return "";

  const speedKmH = transport?.includes("Scooter") ? 20 : transport?.includes("Walk") ? 5 : 15;
  const rows = [];

  for (let i = 0; i < valid.length - 1; i++) {
    const a   = valid[i], b = valid[i+1];
    const km  = haversineKm(a.lat, a.lng, b.lat, b.lng);
    const min = Math.round((km / speedKmH) * 60);
    rows.push(`<tr>
      <td>${esc(a.name)}</td>
      <td>${esc(b.name)}</td>
      <td><span class="dist-km">${km.toFixed(1)} km</span></td>
      <td>~${min} min</td>
    </tr>`);
  }

  return `<div class="distance-section">
    <h4>📏 Distance & Travel Time</h4>
    <div class="dist-table-wrap">
      <table class="dist-table">
        <thead><tr><th>From</th><th>To</th><th>Distance</th><th>Time</th></tr></thead>
        <tbody>${rows.join("")}</tbody>
      </table>
    </div>
  </div>`;
}

/* ─── Stops Tab ─── */
function renderStops(plan, params, activeDay) {
  const stops = plan.mapStops || [];
  if (!stops.length) {
    D.tabStops.innerHTML = `<div class="empty-state"><div class="es-icon">📍</div><div class="es-title">No stops data</div></div>`;
    return;
  }

  const days    = [...new Set(stops.map(s => Number(s.day)||1))].sort((a,b)=>a-b);
  const current = activeDay || days[0];
  const shown   = stops.filter(s => (Number(s.day)||1) === current);

  const allUrl = `https://www.google.com/maps/dir/${stops.slice(0,10).filter(s=>s.lat&&s.lng).map(s=>`${s.lat},${s.lng}`).join("/")}`;

  const dayTabs = days.map(d =>
    `<button class="day-tab ${d===current?"active":""}" onclick="renderStops(S.plan,S.plan._params,${d})">Day ${d}</button>`
  ).join("");

  const cards = shown.map((stop, idx) => {
    const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(stop.name + " " + params.city)}`;
    return `<div class="stop-card">
      <div class="stop-hd">
        <div class="stop-idx">${idx+1}</div>
        <div class="stop-name">${esc(stop.name)}</div>
        <div class="stop-type">${esc(stop.type||"Stop")}</div>
      </div>
      <div class="stop-desc">${esc(stop.description||"")}</div>
      <div class="stop-ft">
        <div class="stop-cost ${stop.entryFee>0?"paid":"free"}">${stop.entryFee>0?"₹"+stop.entryFee+" entry":"Free entry"}</div>
        <a class="stop-link" href="${mapsUrl}" target="_blank" rel="noopener">📍 View on Maps</a>
      </div>
    </div>`;
  }).join("");

  D.tabStops.innerHTML = `
    <div class="stops-header">
      <p>All stops in order — open full route in Google Maps</p>
      <a class="open-route-btn" href="${allUrl}" target="_blank" rel="noopener">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        Open Full Route
      </a>
    </div>
    <div class="day-tabs">${dayTabs}</div>
    <div class="stops-grid">${cards}</div>`;
}

/* ─── Safety Tab ─── */
function renderSafety(plan, params) {
  const sf = plan.safetyTips || {};
  const em = sf.emergency || {};

  const dos   = (sf.dos   || []).map(t=>`<li>✅ ${esc(t)}</li>`).join("");
  const donts = (sf.donts || []).map(t=>`<li>⛔ ${esc(t)}</li>`).join("");

  D.tabSafety.innerHTML = `
    <div class="safety-overview">
      <h3>🛡 Safety Overview — ${esc(params.city)}</h3>
      <p>${esc(sf.overview||"Always travel in groups and stay aware of your surroundings.")}</p>
    </div>
    <div class="safety-grid">
      <div class="safety-card"><div class="safety-card-icon">✅</div><h4>Do's</h4><ul style="list-style:none;display:flex;flex-direction:column;gap:5px">${dos||"<li>Stay in groups</li>"}</ul></div>
      <div class="safety-card"><div class="safety-card-icon">⛔</div><h4>Don'ts</h4><ul style="list-style:none;display:flex;flex-direction:column;gap:5px">${donts||"<li>Don't carry large cash</li>"}</ul></div>
    </div>
    <div class="sos-bar">
      <div class="sos-item"><div class="sos-num">${esc(em.police||"100")}</div><div class="sos-lbl">Police</div></div>
      <div class="sos-item"><div class="sos-num">${esc(em.ambulance||"108")}</div><div class="sos-lbl">Ambulance</div></div>
      <div class="sos-item"><div class="sos-num">${esc(em.tourist||"1363")}</div><div class="sos-lbl">Tourist</div></div>
      <div class="sos-item"><div class="sos-num">${esc(em.local||"—")}</div><div class="sos-lbl">Local</div></div>
    </div>`;
}

/* ─── Print Area ─── */
function renderPrintArea(plan, params) {
  const b  = plan.budget  || {};
  const bd = b.breakdown  || {};
  const sf = plan.safetyTips || {};
  const em = sf.emergency || {};

  const daysHtml = (plan.days||[]).map(day => {
    const acts = (day.activities||[]).map(a => {
      const cost = (a.entryFee||0)+(a.mealCost||0)+(a.transportCost||0);
      return `<div class="print-act">
        <div class="print-act-time">${esc(a.time||"")}</div>
        <div><strong>${esc(a.name||a.description||"")}</strong><br><small style="color:#555">${esc(a.description||"")}</small></div>
        <div class="print-act-cost">${cost>0?inr(cost):"Free"}</div>
      </div>`;
    }).join("");
    return `<div class="print-day"><h2>Day ${day.dayNumber} — ${esc(day.theme||"")}</h2>${acts}</div>`;
  }).join("");

  D.printArea.innerHTML = `
    <div class="print-cover">
      <h1>TripWise AI — ${esc(plan.tripTitle||"Trip Plan")}</h1>
      <p>${params.days} Days · ${params.travelers} Students · ${esc(params.city)} · Generated ${new Date().toLocaleDateString("en-IN")}</p>
      <p>Budget: ${inr(params.budget)} · Per person: ${inr(b.perPerson)} · Fit Score: ${plan.fitScore||0}%</p>
    </div>
    ${daysHtml}
    <div class="print-budget">
      <h2>Budget Breakdown</h2>
      <div class="print-bg">
        ${["accommodation","food","transport","entryFees","miscellaneous","bufferEmergency"].map(k=>`<div class="print-bi"><strong>${k}</strong><span>${inr(bd[k]||0)}</span></div>`).join("")}
      </div>
      <p style="margin-top:8px"><strong>Total: ${inr(b.groupTotal)}</strong> · Remaining: ${inr(b.remaining)}</p>
    </div>
    <div class="print-safety">
      <h2>Safety &amp; Emergency</h2>
      <ul>${(sf.dos||[]).map(t=>`<li>✅ ${esc(t)}</li>`).join("")}${(sf.donts||[]).map(t=>`<li>⛔ ${esc(t)}</li>`).join("")}</ul>
      <p style="margin-top:8px">Police: ${esc(em.police||"100")} · Ambulance: ${esc(em.ambulance||"108")} · Tourist: ${esc(em.tourist||"1363")}</p>
    </div>`;
}

/* ===================================================
   TABS
   =================================================== */

function activateTab(name) {
  $$(".tab").forEach(b => { b.classList.toggle("active", b.dataset.tab === name); b.setAttribute("aria-selected", String(b.dataset.tab === name)); });
  $$(".tab-panel").forEach(p => p.classList.toggle("active", p.id === `tab-${name}`));

  if (name === "map" && S.plan) {
    // Ensure map is rendered when tab opens
    setTimeout(() => {
      if (leafletMapInstance) {
        leafletMapInstance.invalidateSize();
      } else {
        renderMapTab(S.plan, S.plan._params, leafletActiveDay);
      }
    }, 80);
  }
}

/* ===================================================
   AI QUICK ACTIONS
   =================================================== */

/* ─── Trip Summarizer ─── */
async function generateTripSummary() {
  if (!S.plan) { toast("Generate a plan first!"); return; }
  if (getRateLimitWait() > 0) { toast(userFriendlyAIError(makeCooldownError()), 5200); return; }
  const btn = D.summaryBtn;
  btn.disabled = true; btn.textContent = "📝 Summarizing…";

  const plan = S.plan;
  const p    = plan._params || {};
  const b    = plan.budget  || {};

  try {
    const text = await groqChat(
      [
        { role: "system", content: "Generate a concise WhatsApp-ready trip summary. Use *bold* and emojis." },
        { role: "user",   content:
`Create a WhatsApp summary for:
City: ${p.city} | Duration: ${p.days} days | Students: ${p.travelers}
Budget: ₹${b.perPerson}/person (Total: ₹${b.groupTotal})
Trip: "${plan.tripTitle}" | Fit Score: ${plan.fitScore}%
Key stops: ${(plan.mapStops||[]).slice(0,6).map(s=>s.name).join(", ")}
Highlights: ${(plan.highlights||[]).join(", ")}
Saving tips: ${(b.savingTips||[]).slice(0,2).join("; ")}
Make it exciting, under 250 words, use *bold* for key info, include day highlights.`
        }
      ],
      { model: CHAT_MODEL, temperature: 0.8, maxTokens: 400 }
    );

    $("summaryText").textContent = text;
    showModal("summaryModal");

    $("summaryCopyBtn").onclick = () => {
      navigator.clipboard.writeText(text).then(() => toast("📋 Copied!")).catch(() => toast("Copy failed"));
    };
    $("summaryWaBtn").onclick = () => {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
    };

  } catch (e) { toast("❌ " + userFriendlyAIError(e)); }
  finally { btn.disabled = false; btn.textContent = "📝 Summarize"; }
}

/* ─── Budget Negotiator ─── */
async function runBudgetNegotiator() {
  if (!S.plan) { toast("Generate a plan first!"); return; }
  if (getRateLimitWait() > 0) { toast(userFriendlyAIError(makeCooldownError()), 5200); return; }
  const btn = D.negotiateBtn;
  btn.disabled = true; btn.textContent = "💸 Analyzing…";

  const plan  = S.plan;
  const p     = plan._params || {};
  const b     = plan.budget  || {};
  const bd    = b.breakdown  || {};
  const over  = b.remaining  < 0;

  try {
    const text = await groqChat(
      [
        { role: "system", content: "You are a budget advisor for Indian student trips. Be specific with numbers and place names." },
        { role: "user",   content:
`Analyze this ${p.city} trip budget:
Group Total Estimated: ₹${b.groupTotal} | Budget: ₹${p.budget}
${over ? `OVER BUDGET by ₹${Math.abs(b.remaining)}` : `Buffer remaining: ₹${b.remaining}`}
Per person: ₹${b.perPerson}
Breakdown: Accommodation ₹${bd.accommodation||0} | Food ₹${bd.food||0} | Transport ₹${bd.transport||0} | Fees ₹${bd.entryFees||0}

${over ? "Give 5 SPECIFIC ways to cut costs and come within budget." : "Give 5 smart ways to enhance the trip with the remaining ₹"+b.remaining+" buffer."}
Use bullet points. Be specific with real alternatives and amounts.`
        }
      ],
      { model: CHAT_MODEL, temperature: 0.7, maxTokens: 500 }
    );

    $("negotiatorTitle").textContent = over ? "💸 Cut Costs — You're Over Budget!" : "💸 Upgrade Tips — You Have Budget Left!";
    $("negotiatorText").textContent  = text;
    showModal("negotiatorModal");

  } catch (e) { toast("❌ " + userFriendlyAIError(e)); }
  finally { btn.disabled = false; btn.textContent = "💸 Budget AI"; }
}

/* ─── Trip Comparison ─── */
async function generateComparison() {
  if (!S.plan) { toast("Generate a plan first!"); return; }
  if (getRateLimitWait() > 0) { toast(userFriendlyAIError(makeCooldownError()), 5200); return; }
  const btn = D.compareBtn;
  btn.disabled = true; btn.textContent = "⚖ Comparing…";

  $("comparisonLoading").classList.remove("hidden");
  $("comparisonGrid").innerHTML = "";
  showModal("comparisonModal");

  const p = S.plan._params || {};

  const compareModes = [
    { mode:"budget", label:"💰 Budget",  cls:"g", card:"budget-card",   budget:Math.round(p.budget * 0.65), stay:"student dormitory/shared hostel", meal:"street food stalls only" },
    { mode:"balanced", label:"⚖ Balanced", cls:"p", card:"balanced-card", budget:p.budget, stay:p.stay, meal:p.meal },
    { mode:"comfort", label:"✨ Comfort",  cls:"a", card:"comfort-card",  budget:Math.round(p.budget * 1.4), stay:"budget hotel with private room", meal:"mix of cafes and casual restaurants" }
  ];

  const buildComparePrompt = () => `Generate three compact trip variants for ${p.city}, India.
Duration: ${p.days} days | Students: ${p.travelers} | Base transport: ${p.transport}
Variants:
${compareModes.map(m => `- ${m.mode}: budget ₹${m.budget}, stay ${m.stay}, meals ${m.meal}`).join("\n")}
Return ONLY JSON:
{"variants":[{"mode":"budget","tripTitle":"string","fitScore":85,"budget":{"groupTotal":0,"perPerson":0},"topStops":["a","b","c","d"],"highlights":["x","y"],"accommodation":"string","transport":"string"}]}`;

  try {
    const raw = await groqChat(
      [{ role:"system",content:"Return valid JSON only."},{role:"user",content:buildComparePrompt()}],
      { model: CHAT_MODEL, jsonMode:true, temperature:0.6, maxTokens:1600 }
    );

    const parsed = extractJSON(raw);
    const variantList = Array.isArray(parsed.variants) ? parsed.variants : [parsed.budget, parsed.balanced, parsed.comfort].filter(Boolean);
    const byMode = new Map(variantList.map(v => [String(v?.mode || "").toLowerCase(), v]));
    const fallbackList = [...variantList];
    const variants = compareModes.map(m => ({
      label: m.label,
      cls: m.cls,
      card: m.card,
      data: byMode.get(m.mode) || fallbackList.shift()
    }));

    if (variants.some(v => !v.data)) throw new Error("AI did not return all comparison variants");

    $("comparisonGrid").innerHTML = variants.map((v, vi) => {
      const d = v.data;
      return `<div class="comp-card ${v.card}">
        <div class="comp-label ${v.cls}">${v.label}</div>
        <div class="comp-title">${esc(d.tripTitle||"Trip Plan")}</div>
        <div class="comp-cost">${inr(d.budget?.perPerson)}</div>
        <div class="comp-per">per student · Total ${inr(d.budget?.groupTotal)}</div>
        <div class="comp-score">🎯 Fit Score: ${d.fitScore||0}%</div>
        <div class="comp-stops">${(d.topStops||[]).map(s=>`<div class="comp-stop">${esc(s)}</div>`).join("")}</div>
        <div style="color:var(--t3);font-size:.7rem;margin-top:4px">🏠 ${esc(d.accommodation||"")} · 🚇 ${esc(d.transport||"")}</div>
        <button class="comp-load-btn" onclick="loadComparisonVariant(${vi})">Load This Plan →</button>
      </div>`;
    }).join("");

    // Store variants for loading
    window._compVariants = variants.map((v,i) => ({
      ...v.data, _params:{ ...p, budget: compareModes[i].budget }
    }));

  } catch (e) {
    toast("❌ Comparison failed: " + userFriendlyAIError(e));
    $("comparisonGrid").innerHTML = `<div style="padding:24px;color:var(--red);text-align:center">Failed to generate comparison. Please try again.</div>`;
  } finally {
    $("comparisonLoading").classList.add("hidden");
    btn.disabled = false; btn.textContent = "⚖ Compare";
  }
}

function loadComparisonVariant(idx) {
  const v = window._compVariants?.[idx];
  if (!v) return;
  toast("ℹ Loading comparison variant — generating full plan…");
  hideModal("comparisonModal");

  // Fill form with variant budget and regenerate
  if (v._params?.budget) D.fBudget.value = v._params.budget;
  generatePlan();
}

/* ─── Day Re-planner ─── */
function openReplanModal(dayNum) {
  if (!S.plan) return;
  const days = S.plan.days || [];

  D.replanDaySelect.innerHTML = days.map(d =>
    `<option value="${d.dayNumber}" ${d.dayNumber===dayNum?"selected":""}>Day ${d.dayNumber} — ${esc(d.theme||"")}</option>`
  ).join("");
  D.replanReason.value = "";
  showModal("replanModal");
}

async function replanDay() {
  if (!S.plan) return;
  const dayNum = parseInt(D.replanDaySelect.value, 10);
  const reason = D.replanReason.value.trim();
  if (!reason) { toast("Please describe what to change"); D.replanReason.focus(); return; }
  if (getRateLimitWait() > 0) { toast(userFriendlyAIError(makeCooldownError()), 5200); return; }

  const btn = D.replanSubmitBtn;
  btn.disabled = true; btn.textContent = "🔄 Replanning…";

  const plan = S.plan;
  const p    = plan._params || {};
  const b    = plan.budget  || {};
  const curDay = plan.days.find(d => d.dayNumber === dayNum);
  if (!curDay) { toast("Day not found"); btn.disabled=false; btn.textContent="🔄 Replan with AI"; return; }

  try {
    const raw = await groqChat(
      [
        { role:"system", content:"You are TripWise. Return valid JSON only. Keep the same structure as the input day object." },
        { role:"user",   content:
`Replan Day ${dayNum} of a ${p.days}-day trip to ${p.city}.
Reason for change: ${reason}
Current day: ${JSON.stringify(curDay)}
Budget per person per day: ₹${Math.round((b.perPerson||2000)/p.days)}
Transport: ${p.transport}. Meals: ${p.meal}. Stay: ${p.stay}.
Return ONLY the updated day JSON object with same structure (dayNumber, date, theme, activities array).`
        }
      ],
      { model: PLAN_MODEL, jsonMode:true, temperature:0.7, maxTokens:2500 }
    );

    const newDay = extractJSON(raw);
    const idx    = plan.days.findIndex(d => d.dayNumber === dayNum);
    if (idx !== -1) {
      plan.days[idx] = { ...newDay, dayNumber: dayNum };
      S.plan = plan;
      renderItinerary(plan, p);
      renderPrintArea(plan, p);
      activateTab("itinerary");
      hideModal("replanModal");
      toast(`✅ Day ${dayNum} replanned!`);
      leafletMapInstance = null; // refresh map next time
    }
  } catch (e) {
    toast("❌ Replan failed: " + userFriendlyAIError(e));
  } finally {
    btn.disabled = false;
    btn.textContent = "🔄 Replan with AI";
  }
}

/* ===================================================
   SAVE & SHARE
   =================================================== */

/* ─── Save Plan ─── */
function savePlan() {
  if (!S.plan) { toast("Generate a plan first!"); return; }

  const saved = getSavedPlans();
  const plan  = S.plan;
  const p     = plan._params || {};
  const b     = plan.budget  || {};

  const entry = {
    id:       Date.now(),
    savedAt:  new Date().toISOString(),
    city:     p.city,
    days:     p.days,
    travelers:p.travelers,
    budget:   p.budget,
    perPerson:b.perPerson,
    tripTitle:plan.tripTitle,
    fitScore: plan.fitScore,
    plan:     plan
  };

  saved.unshift(entry);
  if (saved.length > MAX_SAVED) saved.splice(MAX_SAVED);
  localStorage.setItem(PLANS_STORE, JSON.stringify(saved));
  toast("💾 Plan saved! View in 📂 Plans.");
}

function getSavedPlans() {
  try { return JSON.parse(localStorage.getItem(PLANS_STORE) || "[]"); } catch { return []; }
}

function deleteSavedPlan(id) {
  const saved = getSavedPlans().filter(p => p.id !== id);
  localStorage.setItem(PLANS_STORE, JSON.stringify(saved));
  renderSavedPlansModal();
}

function loadSavedPlan(id) {
  const entry = getSavedPlans().find(p => p.id === id);
  if (!entry) return;
  S.plan = entry.plan;
  renderAll(entry.plan, entry.plan._params);
  activateTab("itinerary");
  hideModal("savedPlansModal");
  leafletMapInstance = null;
  toast("📂 Plan loaded!");
}

function renderSavedPlansModal() {
  const saved = getSavedPlans();
  const grid  = $("savedPlansGrid");
  if (!grid) return;

  if (!saved.length) {
    grid.innerHTML = `<div class="no-saves">No saved plans yet.<br>Generate a plan and click 💾 Save.</div>`;
    return;
  }

  grid.innerHTML = saved.map(s => `
    <div class="saved-plan-card">
      <div class="spcard-info">
        <div class="spcard-city">📍 ${esc(s.tripTitle||s.city)} — ${esc(s.city)}</div>
        <div class="spcard-meta">${s.days} days · ${s.travelers} students · ${inr(s.perPerson)}/person</div>
        <div class="spcard-score">🎯 ${s.fitScore||0}% fit · Saved ${new Date(s.savedAt).toLocaleDateString("en-IN")}</div>
      </div>
      <div class="spcard-actions">
        <button class="spcard-load" onclick="loadSavedPlan(${s.id})">Load</button>
        <button class="spcard-del"  onclick="deleteSavedPlan(${s.id})">🗑</button>
      </div>
    </div>`).join("");
}

/* ─── PDF Export ─── */
async function exportToPDF() {
  if (!S.plan) { toast("Generate a plan first!"); return; }
  const btn = D.pdfBtn;
  btn.disabled = true; btn.textContent = "📄 Generating…";
  toast("📄 Preparing PDF…");

  try {
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js");
    const element = D.printArea;
    const opt = {
      margin:     [10, 10, 10, 10],
      filename:   `TripWise-${S.plan._params?.city||"trip"}-${Date.now()}.pdf`,
      image:      { type:"jpeg", quality:0.95 },
      html2canvas:{ scale:2, useCORS:true },
      jsPDF:      { unit:"mm", format:"a4", orientation:"portrait" }
    };
    await window.html2pdf().from(element).set(opt).save();
    toast("📄 PDF downloaded!");
  } catch (e) {
    toast("❌ PDF failed — using print instead");
    window.print();
  } finally {
    btn.disabled = false; btn.textContent = "📄 PDF";
  }
}

/* ─── Calendar Export ─── */
function exportToCalendar() {
  if (!S.plan) { toast("Generate a plan first!"); return; }

  const plan  = S.plan;
  const p     = plan._params || {};
  const start = new Date((p.startDate || todayISO()) + "T00:00:00");

  const ics = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//TripWise AI//EN","CALSCALE:GREGORIAN"];

  (plan.days || []).forEach(day => {
    const dayDate = new Date(start);
    dayDate.setDate(dayDate.getDate() + (day.dayNumber - 1));

    (day.activities || []).filter(a => a.type !== "transit").forEach(act => {
      const [h,m]  = (act.time||"09:00").split(":").map(Number);
      const dtStart = new Date(dayDate); dtStart.setHours(h, m, 0);
      const dtEnd   = new Date(dtStart); dtEnd.setMinutes(dtEnd.getMinutes() + (act.durationMins||60));
      const fmt     = d => d.toISOString().replace(/[-:]/g,"").slice(0,15) + "Z";

      ics.push(
        "BEGIN:VEVENT",
        `DTSTART:${fmt(dtStart)}`,
        `DTEND:${fmt(dtEnd)}`,
        `SUMMARY:${(act.name||act.description||"Activity").replace(/[,;:\n]/g," ")}`,
        `DESCRIPTION:${(act.description||"").replace(/[,;:\n]/g," ").slice(0,200)}`,
        `LOCATION:${p.city}, India`,
        `END:VEVENT`
      );
    });
  });

  ics.push("END:VCALENDAR");

  const blob = new Blob([ics.join("\r\n")], { type:"text/calendar;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), { href:url, download:`TripWise-${p.city||"trip"}.ics` });
  a.click();
  URL.revokeObjectURL(url);
  toast("📅 Calendar file downloaded! Import into Google/Apple Calendar.");
}

/* ─── WhatsApp Share ─── */
function shareToWhatsApp() {
  if (!S.plan) { toast("Generate a plan first!"); return; }

  const plan  = S.plan;
  const p     = plan._params || {};
  const b     = plan.budget  || {};
  const stops = (plan.mapStops||[]).slice(0,5).map(s=>`• ${s.name}`).join("\n");
  const tips  = (b.savingTips||[]).slice(0,2).join("\n• ");

  const text = `⚡ *TripWise AI Trip Plan*\n\n` +
    `📍 *${plan.tripTitle}*\n` +
    `🗓 ${p.days} Days in ${p.city} | ${p.travelers} Students\n` +
    `💰 ₹${(b.perPerson||0).toLocaleString("en-IN")}/person | Group: ₹${(b.groupTotal||0).toLocaleString("en-IN")}\n` +
    `🎯 AI Fit Score: ${plan.fitScore||0}%\n\n` +
    `📌 *Top Stops:*\n${stops}\n\n` +
    `💡 *Saving Tips:*\n• ${tips}\n\n` +
    `_Generated by TripWise AI (Groq + Llama 3)_ ✨`;

  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
}

/* ─── QR Code ─── */
async function copyText(text, successMsg = "Copied to clipboard!") {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    toast(successMsg);
    return true;
  } catch {
    toast("Copy failed. Select the text and copy manually.");
    return false;
  }
}

async function ensureQRCodeLibrary() {
  if (window.QRCode) return true;
  try {
    await loadScript("vendor/qrcode.min.js");
  } catch {}
  if (window.QRCode) return true;
  try {
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js");
  } catch {}
  return Boolean(window.QRCode);
}

function buildQRShareText() {
  const plan  = S.plan || {};
  const p     = plan._params || {};
  const b     = plan.budget  || {};
  const stops = (plan.mapStops || []).slice(0, 4).map(s => s.name).filter(Boolean).join(", ");

  return [
    "TripWise AI Travel Plan",
    `Trip: ${plan.tripTitle || "Trip Plan"}`,
    `Destination: ${p.city || "India"}`,
    `Duration: ${p.days || "-"} days`,
    `Students: ${p.travelers || "-"}`,
    `Per person: INR ${(b.perPerson || 0).toLocaleString("en-IN")}`,
    `Fit score: ${plan.fitScore || 0}%`,
    stops ? `Top stops: ${stops}` : "",
    `Generated: ${new Date().toLocaleDateString("en-IN")}`
  ].filter(Boolean).join("\n");
}

function slugFilePart(value) {
  return String(value || "trip").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "trip";
}

async function getQRCodeDownloadUrl(container) {
  const img = container.querySelector("img[src]");
  if (img?.src) return img.src;

  const canvas = container.querySelector("canvas");
  if (canvas) return canvas.toDataURL("image/png");

  const svg = container.querySelector("svg");
  if (!svg) return "";

  const markup = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([markup], { type: "image/svg+xml;charset=utf-8" });
  const blobUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = blobUrl;
    });
    const png = document.createElement("canvas");
    png.width = 220;
    png.height = 220;
    const ctx = png.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, png.width, png.height);
    ctx.drawImage(image, 0, 0, png.width, png.height);
    return png.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

async function generateQRCode() {
  if (!S.plan) { toast("Generate a plan first!"); return; }

  const container = $("qrContainer");
  const fallback = D.qrFallbackText;
  const text = buildQRShareText();

  container.innerHTML = "";
  fallback.textContent = text;
  fallback.classList.add("hidden");
  D.qrDownloadBtn.disabled = false;
  D.qrCopyBtn.onclick = () => copyText(text, "QR share text copied!");

  try {
    const hasQR = await ensureQRCodeLibrary();
    if (!hasQR) throw new Error("QR library unavailable");

    new QRCode(container, {
      text,
      width:         220,
      height:        220,
      colorDark:     "#111827",
      colorLight:    "#ffffff",
      correctLevel:  QRCode.CorrectLevel?.M ?? QRCode.CorrectLevel?.H
    });

    showModal("qrModal");

    D.qrDownloadBtn.onclick = async () => {
      const url = await getQRCodeDownloadUrl(container);
      if (!url) { toast("QR download is not available in this browser."); return; }
      const a = document.createElement("a");
      a.href = url;
      a.download = `TripWise-QR-${slugFilePart(S.plan?._params?.city)}.png`;
      a.click();
      toast("QR downloaded!");
    };

  } catch (e) {
    container.innerHTML = `<div class="qr-unavailable">QR image could not be generated.</div>`;
    fallback.classList.remove("hidden");
    D.qrDownloadBtn.disabled = true;
    showModal("qrModal");
    toast("QR image failed. Share text is ready to copy.");
  }
}

/* ===================================================
   STREAMING AI CHAT
   =================================================== */

function buildChatSystem() {
  const plan = S.plan;
  if (!plan) return "You are TripWise, a friendly Indian student travel assistant. Be concise and helpful.";
  const p     = plan._params || {};
  const b     = plan.budget  || {};
  const stops = (plan.mapStops || []).map(s=>s.name).slice(0,12).join(", ");

  return `You are TripWise, a friendly AI travel assistant for Indian student trips.
CURRENT PLAN: ${p.city} | ${p.days} days | ${p.travelers} students | Group Budget ₹${p.budget}
Estimated: ${inr(b.groupTotal)} | Per person: ${inr(b.perPerson)} | Remaining: ${inr(b.remaining)}
Transport: ${p.transport} | Stay: ${p.stay} | Meals: ${p.meal}
Fit Score: ${plan.fitScore}% | Trip: "${plan.tripTitle}" | Stops: ${stops}
RULES: Be concise (<200 words). Reference specific numbers. Use newlines for readability.`;
}

function addBubble(text, role) {
  const el = document.createElement("div");
  el.className = `chat-msg ${role}`;
  if (text) {
    if (role === "bot") {
      el.innerHTML = chatMarkdown(text);
    } else {
      el.textContent = text;
    }
  }
  /* #21 Timestamp */
  const ts = document.createElement("span");
  ts.className = "chat-time";
  ts.textContent = timeNow();
  el.appendChild(ts);
  /* #21 Copy button for bot messages */
  if (role === "bot" && text) {
    const copyBtn = document.createElement("button");
    copyBtn.className = "chat-msg-copy";
    copyBtn.textContent = "📋";
    copyBtn.title = "Copy message";
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(text).then(() => toast("Copied!")).catch(() => {});
    };
    el.appendChild(copyBtn);
  }
  D.chatMsgs.appendChild(el);
  D.chatMsgs.scrollTop = D.chatMsgs.scrollHeight;
  return el;
}

async function sendChat(userText) {
  if (!userText.trim()) return;
  if (S.chatStreaming) { toast("AI chat is still replying. Please wait."); return; }
  if (getRateLimitWait() > 0) {
    const msg = userFriendlyAIError(makeCooldownError());
    addBubble(msg, "err");
    toast(msg, 5200);
    return;
  }

  addBubble(userText, "user");
  S.chatHistory.push({ role:"user", content:userText });
  if (S.chatHistory.length > MAX_CHAT_TURNS * 2) {
    S.chatHistory = S.chatHistory.slice(-MAX_CHAT_TURNS * 2);
  }

  const botEl = addBubble("", "bot");
  botEl.innerHTML = `<span class="typing"><span></span><span></span><span></span></span>`;

  const messages = [
    { role:"system", content: buildChatSystem() },
    ...S.chatHistory.slice(-MAX_CHAT_TURNS * 2)
  ];

  try {
    S.chatStreaming = true;
    let full = "";
    await groqStream(messages, chunk => {
      full += chunk;
      botEl.innerHTML = chatMarkdown(full);
      /* Re-add timestamp */
      const ts = botEl.querySelector(".chat-time") || document.createElement("span");
      ts.className = "chat-time";
      ts.textContent = timeNow();
      if (!botEl.querySelector(".chat-time")) botEl.appendChild(ts);
      D.chatMsgs.scrollTop = D.chatMsgs.scrollHeight;
    });
    S.chatHistory.push({ role:"assistant", content: full });
    /* Add copy button after streaming completes */
    const copyBtn = document.createElement("button");
    copyBtn.className = "chat-msg-copy";
    copyBtn.textContent = "📋";
    copyBtn.title = "Copy message";
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(full).then(() => toast("Copied!")).catch(() => {});
    };
    botEl.appendChild(copyBtn);
  } catch (e) {
    botEl.className = "chat-msg err";
    botEl.textContent = "❌ " + userFriendlyAIError(e);
  } finally {
    S.chatStreaming = false;
  }
}

/* ===================================================
   SAMPLE TRIP
   =================================================== */

function loadSample() {
  const cities = ["Delhi","Mumbai","Jaipur","Bengaluru","Varanasi","Goa","Rishikesh","Kolkata","Manali","Hampi"];
  D.fCity.value   = cities[Math.floor(Math.random() * cities.length)];
  D.fDays.value   = String(Math.floor(Math.random() * 4) + 2);
  D.fPeople.value = String(Math.floor(Math.random() * 5) + 2);
  D.fBudget.value = String((Math.floor(Math.random() * 6) + 2) * 3000);

  const transports = ["Metro and Bus","Walk and Transit"];
  const stays      = ["Student hostel","Friends or campus stay"];
  const meals      = ["street food stalls","mix of street food and cafes"];
  D.fTransport.value = transports[Math.floor(Math.random() * transports.length)];
  D.fStay.value      = stays[Math.floor(Math.random() * stays.length)];
  D.fMeal.value      = meals[Math.floor(Math.random() * meals.length)];

  const cbs = $$("input[name='int']");
  cbs.forEach(cb => cb.checked = Math.random() > 0.45);
  if (![...$$("#planForm input[name='int']:checked")].length) { cbs[0].checked = true; cbs[1].checked = true; }

  const paces = ["relaxed","balanced","packed"];
  const pace  = paces[Math.floor(Math.random() * paces.length)];
  $$("input[name='pace']").forEach(r => r.checked = r.value === pace);

  D.fExtra.value = "";
  toast("🎲 Sample loaded — click Generate AI Plan!");
}

function openSavedPlansModal(e) {
  e?.preventDefault();
  renderSavedPlansModal();
  showModal("savedPlansModal");
}

function openSafetyTab(e) {
  e?.preventDefault();
  showScreen("appShell");
  activateTab("safety");
  setTimeout(() => D.tabSafety?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  if (!S.plan) toast("Generate a plan first to see city-specific safety details.");
}

/* ===================================================
   INIT
   =================================================== */

function init() {
  D.fDate.value = todayISO();
  if (D.copyrightYear) D.copyrightYear.textContent = String(new Date().getFullYear());

  /* Theme */
  applyTheme(localStorage.getItem(THEME_STORE) || "dark");
  D.introThemeBtn?.addEventListener("click", toggleTheme);
  D.themeToggleBtn?.addEventListener("click", toggleTheme);

  /* Intro */
  D.introCta.addEventListener("click", () => showScreen("appShell"));

  /* Mobile drawer */
  D.mobileFormToggle?.addEventListener("click", openForm);
  D.formCloseBtn?.addEventListener("click", closeForm);
  D.formOverlay?.addEventListener("click", closeForm);

  /* Mobile bottom bar */
  D.mobileGenerateBtn?.addEventListener("click", () => { closeForm(); generatePlan(); });
  D.mobilePrintBtn?.addEventListener("click",    () => { if (!S.plan) { toast("Generate a plan first!"); return; } window.print(); });
  D.mobileShareBtn?.addEventListener("click",    () => shareToWhatsApp());

  /* NLP & Voice */
  D.nlpFillBtn?.addEventListener("click", nlpAutoFill);
  D.voiceBtn?.addEventListener("click", startVoiceInput);

  /* Form */
  D.planForm.addEventListener("submit", e => { e.preventDefault(); closeForm(); generatePlan(); });
  D.sampleBtn.addEventListener("click", loadSample);

  /* Tabs */
  $$(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      activateTab(btn.dataset.tab);
      if (btn.dataset.tab === "stops" && S.plan) renderStops(S.plan, S.plan._params, 1);
    });
  });

  /* Refine */
  D.refineBtn.addEventListener("click", async () => {
    const txt = D.refineInput.value.trim();
    if (!txt) return;
    if (!S.plan) { toast("Generate a plan first!"); return; }
    D.refineInput.value = "";
    D.chatBox.classList.add("open");
    D.chatFab.setAttribute("aria-expanded","true");
    if (!D.chatMsgs.children.length) addBubble(`Hi! I'm your Llama 3 AI assistant for this ${S.plan._params?.city||""} trip. Ask me anything!`, "bot");
    await sendChat(txt);
  });
  D.refineInput.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); D.refineBtn.click(); } });

  /* Chat FAB */
  D.chatFab.addEventListener("click", () => {
    const open = D.chatBox.classList.toggle("open");
    D.chatFab.setAttribute("aria-expanded", String(open));
    if (open && !D.chatMsgs.children.length) {
      const city = S.plan?._params?.city || "your destination";
      addBubble(`Hi! I'm your Llama 3 AI travel assistant for ${city}. Ask me about budget, safety, hidden gems, food, or how to save money!`, "bot");
    }
  });

  /* Quick chat prompts */
  $$("[data-q]").forEach(btn => {
    btn.addEventListener("click", () => {
      D.chatBox.classList.add("open");
      D.chatFab.setAttribute("aria-expanded","true");
      if (!D.chatMsgs.children.length) addBubble("Hi! I'm your AI travel assistant. Ask me anything about your trip!", "bot");
      sendChat(btn.dataset.q);
    });
  });

  /* Chat form */
  D.chatForm.addEventListener("submit", e => {
    e.preventDefault();
    const txt = D.chatInput.value.trim();
    if (!txt) return;
    D.chatInput.value = "";
    sendChat(txt);
  });

  /* AI Actions Bar */
  D.summaryBtn?.addEventListener("click",   generateTripSummary);
  D.negotiateBtn?.addEventListener("click", runBudgetNegotiator);
  D.compareBtn?.addEventListener("click",   generateComparison);
  D.saveBtn?.addEventListener("click",      savePlan);
  D.calendarBtn?.addEventListener("click",  exportToCalendar);
  D.pdfBtn?.addEventListener("click",       exportToPDF);
  D.qrBtn?.addEventListener("click",        generateQRCode);
  D.waBtn?.addEventListener("click",        shareToWhatsApp);
  D.exportShareBtn?.addEventListener("click", () => {
    if (!S.plan) { toast("Generate a plan first!"); return; }
    const p = S.plan._params || {};
    const b = S.plan.budget  || {};
    const text = `⚡ My AI trip to ${p.city}: ${p.days} days, ${p.travelers} students, ${inr(b.perPerson)}/person. Planned with TripWise AI!`;
    if (navigator.share) navigator.share({ title:"TripWise AI Plan", text }).catch(()=>{});
    else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast("📋 Copied to clipboard!"));
    else toast("📋 " + text);
  });

  /* Saved Plans */
  D.savedPlansBtn?.addEventListener("click", openSavedPlansModal);
  D.savedPlansNav?.addEventListener("click", openSavedPlansModal);
  D.footerSavedPlansNav?.addEventListener("click", openSavedPlansModal);
  D.safetyNav?.addEventListener("click", openSafetyTab);
  D.footerSafetyNav?.addEventListener("click", openSafetyTab);

  /* Replan */
  D.replanSubmitBtn?.addEventListener("click", replanDay);

  /* Print */
  D.printBtn.addEventListener("click", () => {
    if (!S.plan) { toast("Generate a plan first!"); return; }
    window.print();
  });

  /* Share topbar */
  D.shareBtn?.addEventListener("click", shareToWhatsApp);

  /* Close modals on ESC */
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      $$(".modal-overlay:not(.hidden)").forEach(m => hideModal(m.id));
    }
  });

  /* ─── #24 Back to Top Button ─── */
  const backToTopBtn = $("backToTop");
  if (backToTopBtn) {
    const resultsPanel = document.querySelector(".results-panel");
    const scrollTarget = resultsPanel || window;
    const getScroll = () => resultsPanel ? resultsPanel.scrollTop : window.scrollY;

    (resultsPanel || window).addEventListener("scroll", () => {
      backToTopBtn.classList.toggle("visible", getScroll() > 400);
    }, { passive: true });

    backToTopBtn.addEventListener("click", () => {
      if (resultsPanel) resultsPanel.scrollTo({ top: 0, behavior: "smooth" });
      else window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  /* ─── #25 PWA Service Worker Registration ─── */
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

init();

/* ─── #26 Add to Home Screen (PWA Install) ─── */
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  
  const installLogo = document.getElementById("installAppLogo");
  if (installLogo) {
    installLogo.title = "Click to Install TripWise App!";
    installLogo.addEventListener("click", async () => {
      if (!deferredPrompt) {
        toast("App is already installed or cannot be installed right now.");
        return;
      }
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        toast("✅ TripWise is installing!");
      }
      deferredPrompt = null;
    });
  }
});
