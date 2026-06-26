// K-Town Pit Que — Auto-Poster Server
// Deploy to Railway, Render, or any Node.js host
// Run: npm install && node server.js

import express from "express";
import cron from "node-cron";
import Anthropic from "@anthropic-ai/sdk";
import { createCanvas, loadImage } from "canvas";
import fetch from "node-fetch";
import FormData from "form-data";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

// ─── CONFIG ─────────────────────────────────────────────────────────────────
// Set these as environment variables on your host (never hardcode secrets)
const CONFIG = {
  anthropicKey:   process.env.ANTHROPIC_API_KEY,
  fbPageId:       process.env.FB_PAGE_ID,
  fbAccessToken:  process.env.FB_ACCESS_TOKEN,
  igAccountId:    process.env.IG_ACCOUNT_ID,
  logoPath:       path.join(__dirname, "logo.png"),  // drop your logo.png here
  // Cron schedule: "0 11 * * 2,4,6" = 11am on Tue, Thu, Sat
  cronSchedule:   process.env.CRON_SCHEDULE || "0 11 * * 2,4,6",
  port:           process.env.PORT || 3000,
};

// ─── THEMES ─────────────────────────────────────────────────────────────────
const THEMES = [
  { id: "weekend",   label: "Weekend Smoke Teaser",  emoji: "🔥" },
  { id: "menu",      label: "Menu Highlight",         emoji: "🍖" },
  { id: "behind",    label: "Behind the Pit",         emoji: "👨‍🍳" },
  { id: "hype",      label: "Customer Hype",          emoji: "🙌" },
  { id: "quote",     label: "BBQ Culture Quote",      emoji: "💬" },
  { id: "countdown", label: "Smoke is Rising",        emoji: "⏰" },
  { id: "community", label: "Community Love",         emoji: "❤️"  },
];

const SPONSOR_TAGS = [
  "@Kingsford", "@WeberGrills", "@Traeger",
  "@SuckleBusters", "@KosmosQ", "@BBQGuys", "@BBQPitMasters",
];

// Track which theme to use next
let themeIndex = 0;
const logFile = path.join(__dirname, "post-log.json");
const readLog = () => fs.existsSync(logFile) ? JSON.parse(fs.readFileSync(logFile)) : [];
const writeLog = (log) => fs.writeFileSync(logFile, JSON.stringify(log, null, 2));

// ─── STEP 1: GENERATE CAPTION ────────────────────────────────────────────────
async function generateCaption(theme) {
  const client = new Anthropic({ apiKey: CONFIG.anthropicKey });
  const tags = SPONSOR_TAGS.sort(() => 0.5 - Math.random()).slice(0, 3).join(" ");
  const prompt = `Write an engaging BBQ social media post for K-Town Pit Que with theme: "${theme.label}".
Be punchy, authentic, and hype-filled. 2-3 sentences of post text, then a blank line, then 8-10 relevant hashtags including #KTownPitQue #BBQ #SmokeSeason, then a blank line, then naturally work in these brand tags: ${tags}.
Keep the entire thing under 2200 characters (Instagram limit).`;

  const msg = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 600,
    system: "You are the social media voice for K-Town Pit Que, a BBQ side business. Write authentic, punchy, real-feeling posts — never corporate.",
    messages: [{ role: "user", content: prompt }],
  });
  return msg.content.map(b => b.text || "").join("");
}

// ─── STEP 2: RENDER IMAGE WITH LOGO ─────────────────────────────────────────
async function renderImage(caption, theme) {
  const W = 1080, H = 1080;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0,   "#1a0a00");
  grad.addColorStop(0.4, "#3d1500");
  grad.addColorStop(0.7, "#6b2500");
  grad.addColorStop(1,   "#1a0a00");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Ember particles
  for (let i = 0; i < 80; i++) {
    ctx.beginPath();
    ctx.arc(Math.random() * W, Math.random() * H, Math.random() * 3 + 1, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${210 + Math.random()*45|0},${80 + Math.random()*60|0},0,${(0.2 + Math.random()*0.5).toFixed(2)})`;
    ctx.fill();
  }

  // Text overlay area
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(0, H * 0.50, W, H * 0.50);

  // Logo
  if (fs.existsSync(CONFIG.logoPath)) {
    const logo = await loadImage(CONFIG.logoPath);
    const size = 340;
    ctx.drawImage(logo, (W - size) / 2, 50, size, size);
  } else {
    // Fallback text logo
    ctx.fillStyle = "#D4A017";
    ctx.font = "bold 64px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("K-TOWN", W / 2, 160);
    ctx.fillStyle = "#8B1A1A";
    ctx.fillText("PIT QUE", W / 2, 240);
  }

  // Caption text (first line only for image)
  const firstLine = caption.split("\n")[0] || "";
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 44px sans-serif";
  ctx.textAlign = "center";
  wrapText(ctx, firstLine, W / 2, H * 0.60, W - 100, 56).slice(0, 4);

  // Hashtags line
  const hashLine = caption.split("\n").find(l => l.includes("#")) || "";
  ctx.fillStyle = "#D4A017";
  ctx.font = "28px sans-serif";
  wrapText(ctx, hashLine, W / 2, H * 0.82, W - 100, 36).slice(0, 2);

  // Bottom brand tagline
  ctx.strokeStyle = "#D4A017";
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(80, H - 68); ctx.lineTo(W - 80, H - 68); ctx.stroke();
  ctx.fillStyle = "#D4A017";
  ctx.font = "bold 34px sans-serif";
  ctx.fillText("WHERE YOU'RE THE PITMASTER", W / 2, H - 30);

  return canvas.toBuffer("image/jpeg", { quality: 0.92 });
}

function wrapText(ctx, text, x, startY, maxW, lineH) {
  const words = text.split(" ");
  let line = "", y = startY;
  const lines = [];
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y); lines.push(line);
      line = w; y += lineH;
    } else line = test;
  }
  if (line) { ctx.fillText(line, x, y); lines.push(line); }
  return lines;
}

// ─── STEP 3: UPLOAD IMAGE TO FACEBOOK ───────────────────────────────────────
async function uploadToFacebook(imgBuffer, caption) {
  // Upload photo to Facebook Page
  const fd = new FormData();
  fd.append("source", imgBuffer, { filename: "post.jpg", contentType: "image/jpeg" });
  fd.append("caption", caption);
  fd.append("access_token", CONFIG.fbAccessToken);

  const res = await fetch(`https://graph.facebook.com/v19.0/${CONFIG.fbPageId}/photos`, {
    method: "POST", body: fd,
  });
  const data = await res.json();
  if (!data.id) throw new Error(`FB upload failed: ${JSON.stringify(data)}`);
  return data.id;
}

// ─── STEP 4: POST TO INSTAGRAM ───────────────────────────────────────────────
// Instagram requires a publicly accessible image URL.
// Option A (recommended): upload to your own server's /public folder and serve it.
// Option B: upload to a temp image host like Cloudinary (add cloudinary SDK if preferred).
async function postToInstagram(imgBuffer, caption) {
  // Save image temporarily and serve it via express static
  const tmpName = `post_${Date.now()}.jpg`;
  const tmpPath = path.join(__dirname, "public", tmpName);
  fs.mkdirSync(path.join(__dirname, "public"), { recursive: true });
  fs.writeFileSync(tmpPath, imgBuffer);

  const publicUrl = `${process.env.PUBLIC_URL}/public/${tmpName}`;

  // Create IG media container
  const createRes = await fetch(
    `https://graph.facebook.com/v19.0/${CONFIG.igAccountId}/media?` +
    new URLSearchParams({ image_url: publicUrl, caption, access_token: CONFIG.fbAccessToken }),
    { method: "POST" }
  );
  const { id: containerId, error: e1 } = await createRes.json();
  if (!containerId) throw new Error(`IG container failed: ${JSON.stringify(e1)}`);

  // Wait for container to be ready
  await new Promise(r => setTimeout(r, 5000));

  // Publish
  const pubRes = await fetch(
    `https://graph.facebook.com/v19.0/${CONFIG.igAccountId}/media_publish?` +
    new URLSearchParams({ creation_id: containerId, access_token: CONFIG.fbAccessToken }),
    { method: "POST" }
  );
  const { id: postId, error: e2 } = await pubRes.json();
  if (!postId) throw new Error(`IG publish failed: ${JSON.stringify(e2)}`);

  // Clean up temp file after 60s
  setTimeout(() => fs.existsSync(tmpPath) && fs.unlinkSync(tmpPath), 60000);
  return postId;
}

// ─── MAIN POST PIPELINE ──────────────────────────────────────────────────────
async function runPostPipeline(manualThemeId = null) {
  const theme = manualThemeId
    ? THEMES.find(t => t.id === manualThemeId) || THEMES[themeIndex % THEMES.length]
    : THEMES[themeIndex % THEMES.length];
  themeIndex++;

  console.log(`\n[${new Date().toISOString()}] Starting post: ${theme.label}`);

  try {
    console.log("  Generating caption...");
    const caption = await generateCaption(theme);

    console.log("  Rendering image...");
    const imgBuffer = await renderImage(caption, theme);

    console.log("  Posting to Facebook...");
    const fbId = await uploadToFacebook(imgBuffer, caption);

    console.log("  Posting to Instagram...");
    const igId = await postToInstagram(imgBuffer, caption);

    const entry = { ts: new Date().toISOString(), theme: theme.label, fbId, igId, captionSnippet: caption.slice(0, 100) };
    const log = readLog();
    log.unshift(entry);
    writeLog(log.slice(0, 100));

    console.log(`  ✅ Done! FB: ${fbId} | IG: ${igId}`);
    return { ok: true, ...entry };
  } catch (err) {
    console.error("  ❌ Pipeline error:", err.message);
    const log = readLog();
    log.unshift({ ts: new Date().toISOString(), theme: theme.label, error: err.message });
    writeLog(log.slice(0, 100));
    return { ok: false, error: err.message };
  }
}

// ─── CRON SCHEDULER ─────────────────────────────────────────────────────────
cron.schedule(CONFIG.cronSchedule, () => {
  console.log(`[CRON] Firing scheduled post (${CONFIG.cronSchedule})`);
  runPostPipeline();
}, { timezone: "America/New_York" });

console.log(`[CRON] Scheduler active: ${CONFIG.cronSchedule} (America/New_York)`);

// ─── REST API ────────────────────────────────────────────────────────────────
app.use("/public", express.static(path.join(__dirname, "public")));

// Health check
app.get("/", (req, res) => res.json({ status: "K-Town Pit Que Auto-Poster is running 🔥", cron: CONFIG.cronSchedule }));

// Manually trigger a post (optional theme)
app.post("/post", async (req, res) => {
  const { themeId } = req.body;
  const result = await runPostPipeline(themeId);
  res.json(result);
});

// View post log
app.get("/log", (req, res) => res.json(readLog()));

// List themes
app.get("/themes", (req, res) => res.json(THEMES));

app.listen(CONFIG.port, () => console.log(`Server running on port ${CONFIG.port}`));
