// storage.js
const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, 'db');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const CONFIG_PATH = path.join(DB_DIR, 'config.json');
const LEADS_PATH  = path.join(DB_DIR, 'leads.json');

const readJSON  = (p) => { try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return null; } };
const writeJSON = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2));

function readConfig()  { return readJSON(CONFIG_PATH) || {}; }
function saveConfig(p) { const next={...readConfig(),...p}; writeJSON(CONFIG_PATH,next); return next; }

function isInstalled() { return !!readConfig().installed; }

function setAdmin(igUserId) {
  const cfg = readConfig();
  const admins = new Set([...(cfg.admins||[])]);
  admins.add(String(igUserId));
  saveConfig({ admins: Array.from(admins) });
}
function isAdmin(igUserId){
  const cfg = readConfig();
  const admins = new Set([...(cfg.admins||[])]);
  return admins.has(String(igUserId));
}

function saveLead(lead){
  const list = readJSON(LEADS_PATH) || [];
  list.push({ ...lead, ts: new Date().toISOString() });
  writeJSON(LEADS_PATH, list);
}

function composeCustomerContext(){
  const cfg = readConfig();
  const brand = cfg.brand || "our brand";
  const price = cfg.package_text
    || "Starter package £200 (≈ $250): 30–40 min session, 10 retouched photos, all RAWs, 15–30s vertical reel.";
  const included = cfg.included_text
    || "Included: 30–40 min session • 10 retouched photos • all RAWs • 15–30s vertical reel. Add-ons available.";
  const policy = cfg.policy_text
    || "Reschedule ≥24h prior; no refunds after delivery; we can adjust edits.";
  const availability = cfg.availability_text
    || "Typical availability within 7–10 days.";

  return [
    `You are the company's sales manager. Brand: ${brand}.`,
    "Never say you are an AI or Manoya. Speak as “we/our”. English only. Warm, concise, expert.",
    "Primary goal: qualify quickly; move to booking; collect contact details.",
    `Pricing: ${price}`,
    `What's included: ${included}`,
    `Policy: ${policy}`,
    `Availability: ${availability}`,
    "If info is missing, ask one specific follow-up question.",
  ].join("\n");
}

function composeOwnerContext(){
  const cfg = readConfig();
  return [
    "You are helping the business owner connect Manoya (AI Sales Manager).",
    "English only. Be practical and concise.",
    `Installed: ${cfg.installed? 'yes':'no'} | Mode: ${cfg.mode||'sandbox'}`,
    "Collect: brand name, starter package line (£200 ≈ $250 + inclusions), policy, availability.",
    "Confirm readiness for live after collecting info."
  ].join("\n");
}

module.exports = {
  readConfig, saveConfig, isInstalled,
  setAdmin, isAdmin,
  saveLead,
  composeCustomerContext, composeOwnerContext
};
