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

  try {
    const response = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_KEY}`
      },
      body: JSON.stringify(req.body)
    });

    if (!response.ok) {
      const errBody = await response.text();
      try {
        return res.status(response.status).json(JSON.parse(errBody));
      } catch {
        return res.status(response.status).json({ error: { message: errBody } });
      }
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("Chat proxy error:", err.message);
    res.status(500).json({ error: { message: err.message } });
  }
});

/* ─── Streaming Chat Completion ─── */
app.post("/api/stream", async (req, res) => {
  if (!GROQ_KEY) {
    return res.status(500).json({ error: { message: "Server API key not configured" } });
  }

  try {
    const response = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_KEY}`
      },
      body: JSON.stringify({ ...req.body, stream: true })
    });

    if (!response.ok) {
      const errBody = await response.text();
      try {
        return res.status(response.status).json(JSON.parse(errBody));
      } catch {
        return res.status(response.status).json({ error: { message: errBody } });
      }
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
      res.status(500).json({ error: { message: err.message } });
    } else {
      res.end();
    }
  }
});

/* ─── Start Server ─── */
app.listen(PORT, () => {
  console.log(`\n  ✦ TripWise server running at http://localhost:${PORT}\n`);
});
