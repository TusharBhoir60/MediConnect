require("dotenv").config();
const twilio = require("twilio");

// ─────────────────────────────────────────────
// Usage:
//
//   npm run call
//     → general menu call using .env defaults
//
//   node make-call.js --type=followup --to=+91XXXXXXXXXX --name="Meera Madavi" \
//       --complaint="ANC · 28 weeks, Mild anaemia" --asha="Sunita Pawar" --visitId=v-1
//     → follow-up call with patient context
//
//   node make-call.js --type=general --lang=hi --to=+91XXXXXXXXXX
//     → general Hindi menu call
//
// Args:
//   --type      followup | general   (default: general)
//   --to        patient phone        (default: TWILIO_TO_NUMBER)
//   --name      patient name         (default: PATIENT_NAME)
//   --lang      mr | hi | en         (default: PATIENT_LANG or "mr")
//   --complaint patient complaint    (default: PATIENT_COMPLAINT)
//   --asha      ASHA worker name     (default: ASHA_NAME or "Sunita Pawar")
//   --visitId   visit ID for logging (default: "")
// ─────────────────────────────────────────────

function arg(flag) {
  const match = process.argv.find((a) => a.startsWith(`--${flag}=`));
  return match ? match.split("=").slice(1).join("=") : null;
}

const accountSid  = process.env.TWILIO_ACCOUNT_SID;
const authToken   = process.env.TWILIO_AUTH_TOKEN;
const fromNumber  = process.env.TWILIO_FROM_NUMBER;
const webhookUrl  = process.env.WEBHOOK_BASE_URL;

const type        = arg("type")      || "general";
const toNumber    = arg("to")        || process.env.TWILIO_TO_NUMBER;
const patientName = arg("name")      || process.env.PATIENT_NAME    || "";
const lang        = arg("lang")      || process.env.PATIENT_LANG    || "mr";
const complaint   = arg("complaint") || process.env.PATIENT_COMPLAINT || "";
const ashaName    = arg("asha")      || process.env.ASHA_NAME       || "Sunita Pawar";
const visitId     = arg("visitId")   || "";

// ─── Validation ───
const missing = [];
if (!accountSid) missing.push("TWILIO_ACCOUNT_SID");
if (!authToken)  missing.push("TWILIO_AUTH_TOKEN");
if (!fromNumber) missing.push("TWILIO_FROM_NUMBER");
if (!toNumber)   missing.push("TWILIO_TO_NUMBER (or --to=...)");
if (!webhookUrl) missing.push("WEBHOOK_BASE_URL");

if (missing.length) {
  console.error("❌ Missing .env values:");
  missing.forEach((m) => console.error("   •", m));
  process.exit(1);
}

if (!["mr", "hi", "en"].includes(lang)) {
  console.error(`❌ Invalid lang "${lang}". Use: mr | hi | en`);
  process.exit(1);
}

if (!["followup", "general"].includes(type)) {
  console.error(`❌ Invalid type "${type}". Use: followup | general`);
  process.exit(1);
}

// ─── Build voice URL ───
let voiceUrl;
if (type === "followup") {
  voiceUrl =
    `${webhookUrl}/followup-voice` +
    `?name=${encodeURIComponent(patientName)}` +
    `&ashaName=${encodeURIComponent(ashaName)}` +
    `&complaint=${encodeURIComponent(complaint)}` +
    `&visitId=${encodeURIComponent(visitId)}`;
} else {
  voiceUrl =
    `${webhookUrl}/voice` +
    `?lang=${lang}` +
    `&name=${encodeURIComponent(patientName)}`;
}

const statusUrl = `${webhookUrl}/status`;
const client    = twilio(accountSid, authToken);

async function makeCall() {
  const langLabel = lang === "mr" ? "मराठी" : lang === "hi" ? "हिन्दी" : "English";

  console.log("\n📞 JanVaani — Outbound call");
  console.log(`   Type      : ${type === "followup" ? "🔁 Follow-up" : "📋 General"}`);
  console.log(`   To        : ${toNumber}`);
  console.log(`   Patient   : ${patientName || "(not set)"}`);
  if (type === "followup") {
    console.log(`   ASHA      : ${ashaName}`);
    console.log(`   Complaint : ${complaint || "(not set)"}`);
    console.log(`   Visit ID  : ${visitId || "(not set)"}`);
  } else {
    console.log(`   Language  : ${langLabel}`);
  }
  console.log(`   Voice URL : ${voiceUrl}`);
  console.log(`   Status URL: ${statusUrl}\n`);

  try {
    const call = await client.calls.create({
      to                   : toNumber,
      from                 : fromNumber,
      url                  : voiceUrl,
      statusCallback       : statusUrl,
      statusCallbackMethod : "POST",
      statusCallbackEvent  : ["initiated", "ringing", "answered", "completed"],
      timeout              : 30,
    });

    console.log("✅ Call started!");
    console.log(`   Call SID : ${call.sid}`);
    console.log(`   Status   : ${call.status}`);
    console.log(`\n   View log : http://localhost:${process.env.PORT || 3000}/responses/html\n`);

  } catch (err) {
    console.error("❌ Error:", err.message);
    if (err.code)     console.error("   Code   :", err.code);
    if (err.moreInfo) console.error("   Info   :", err.moreInfo);
    process.exit(1);
  }
}

makeCall();
