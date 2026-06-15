/* ═══════════════════════════════════════════
   TripWise — Express Backend Server
   Proxies Groq API calls to protect API key
   ═══════════════════════════════════════════ */

const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_KEY = process.env.GROQ_API_KEY;
const APP_RATE_LIMIT_PER_MINUTE = Number(process.env.APP_RATE_LIMIT_PER_MINUTE || 18);
const DEFAULT_RETRY_AFTER_MS = Number(process.env.GROQ_DEFAULT_RETRY_AFTER_MS || 30000);
const GROQ_TIMEOUT_MS = Number(process.env.GROQ_TIMEOUT_MS || 90000);

const clientBuckets = new Map();
let groqLimitedUntil = 0;

function retryAfterText(ms) {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

function getClientId(req) {
  return String(req.headers["x-forwarded-for"] || req.ip || req.socket.remoteAddress || "local")
    .split(",")[0]
    .trim();
}

function parseRetryAfterHeader(value) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : 0;
}

function parseRetryFromMessage(text = "") {
  const match = String(text).match(/try again in\s+([\d.]+)\s*(ms|milliseconds?|s|sec|secs|seconds?|m|mins|minutes?)/i);
  if (!match) return 0;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return 0;
  const unit = match[2].toLowerCase();
  if (unit.startsWith("m") && unit !== "ms") return value * 60000;
  if (unit === "ms" || unit.startsWith("millisecond")) return value;
  return value * 1000;
}

function parseErrorPayload(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: text || "Groq request failed" } };
  }
}

function getRetryAfterMs(response, bodyText) {
  return parseRetryAfterHeader(response.headers.get("retry-after")) ||
    parseRetryFromMessage(bodyText) ||
    DEFAULT_RETRY_AFTER_MS;
}

function enforceProxyLimits(req, res) {
  const now = Date.now();
  if (now < groqLimitedUntil) {
    const retryAfterMs = groqLimitedUntil - now;
    res.set("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
    res.status(429).json({
      error: {
        message: `Groq rate limit reached. Please retry in ${retryAfterText(retryAfterMs)}.`,
        status: 429,
        retryAfterMs
      }
    });
    return true;
  }

  const id = getClientId(req);
  const bucket = clientBuckets.get(id) || { count: 0, resetAt: now + 60000 };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + 60000;
  }

  if (bucket.count >= APP_RATE_LIMIT_PER_MINUTE) {
    const retryAfterMs = bucket.resetAt - now;
    res.set("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
    res.status(429).json({
      error: {
        message: `Too many AI requests. Please retry in ${retryAfterText(retryAfterMs)}.`,
        status: 429,
        retryAfterMs
      }
    });
    return true;
  }

  bucket.count += 1;
  clientBuckets.set(id, bucket);
  return false;
}

function fetchGroq(body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);

  return fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GROQ_KEY}`
    },
    body: JSON.stringify(body),
    signal: controller.signal
  }).finally(() => clearTimeout(timer));
}

async function sendGroqError(response, res) {
  const errBody = await response.text();
  const payload = parseErrorPayload(errBody);

  if (response.status === 429) {
    const retryAfterMs = getRetryAfterMs(response, errBody);
    groqLimitedUntil = Math.max(groqLimitedUntil, Date.now() + retryAfterMs);
    payload.error = payload.error || {};
    payload.error.message = payload.error.message || `Groq rate limit reached. Please retry in ${retryAfterText(retryAfterMs)}.`;
    payload.error.status = 429;
    payload.error.retryAfterMs = retryAfterMs;
    res.set("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
  }

  return res.status(response.status).json(payload);
}

/* ─── Middleware ─── */
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

/* ─── Health Check ─── */
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

/* ─── Non-Streaming Chat Completion ─── */
app.post("/api/chat", async (req, res) => {
  if (!GROQ_KEY) {
    return res.status(500).json({ error: { message: "Server API key not configured" } });
  }
  if (enforceProxyLimits(req, res)) return;

  try {
    const response = await fetchGroq(req.body);

    if (!response.ok) {
      return sendGroqError(response, res);
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("Chat proxy error:", err.message);
    res.status(502).json({ error: { message: err.name === "AbortError" ? "Groq request timed out" : err.message } });
  }
});

/* ─── Streaming Chat Completion ─── */
app.post("/api/stream", async (req, res) => {
  if (!GROQ_KEY) {
    return res.status(500).json({ error: { message: "Server API key not configured" } });
  }
  if (enforceProxyLimits(req, res)) return;

  try {
    const response = await fetchGroq({ ...req.body, stream: true });

    if (!response.ok) {
      return sendGroqError(response, res);
    }

    /* Pipe SSE stream to client */
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const reader = response.body.getReader();

    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          res.end();
          break;
        }
        res.write(Buffer.from(value));
      }
    };

    pump().catch(() => res.end());

    /* Clean up if client disconnects */
    req.on("close", () => {
      reader.cancel().catch(() => {});
    });
  } catch (err) {
    console.error("Stream proxy error:", err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: { message: err.name === "AbortError" ? "Groq request timed out" : err.message } });
    } else {
      res.end();
    }
  }
});

/* ─── Start Server ─── */
app.listen(PORT, () => {
  console.log(`\n  ✦ TripWise server running at http://localhost:${PORT}\n`);
});
