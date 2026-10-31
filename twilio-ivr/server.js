require("dotenv").config();
const express    = require("express");
const bodyParser = require("body-parser");
const fs         = require("fs");
const path       = require("path");

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader("ngrok-skip-browser-warning", "true");
  next();
});

// ─────────────────────────────────────────────
// PHC DATA
// ─────────────────────────────────────────────
const PHC = {
  name    : "PHC Armori",
  open    : "08:00",
  close   : "16:00",
  doctors : ["Dr. Anjali Deshmukh", "Dr. Rahul Kulkarni"],
  medicines: {
    available  : ["IFA", "ORS", "Paracetamol 500mg", "Metformin 500mg"],
    outOfStock : ["Amoxicillin"],
  },
  slots: ["09:00–09:20", "10:00–10:20", "11:00–11:20"],
};

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function twimlLang(lang) {
  // language attribute not used — plain <Say> works on trial accounts
  return "";
}

function say(text, lang) {
  return `<Say>${esc(text)}</Say>`;
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// URL-encode a param value AND XML-escape for safe use in TwiML action= attributes
function eu(s) {
  return esc(encodeURIComponent(String(s ?? "")));
}

function tomorrow() {
  return new Date(Date.now() + 86400000).toISOString().slice(0, 10);
}

function wrap(inner) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
}

// ─────────────────────────────────────────────
// GENERAL MENU SCRIPTS  (original menu — doctor info / medicine / appt / referral)
// ─────────────────────────────────────────────
const GENERAL = {
  mr: {
    greeting : (name) => `Namaskar${name ? " " + name + " tai" : ""}. Mi JanVaani ahe, ${PHC.name} cha AI sahayak. JanArogya Maharashtra.`,
    menu     : "Ek daba — doctor aani OPD veles. Don daba — aushadh. Teen daba — appointment. Chaar daba — referral status. Shoonya daba — punha aika.",
    noInput  : "Konacha input nahi mila. Punha call kara. Dhanyavad.",
    bye      : "JanArogya JanVaani. Dhanyavad aani nirogi raha.",
    invalid  : "Chukicha option. Punha try kara.",
    opt1     : () => `${PHC.name} aaj ${PHC.open} te ${PHC.close} paryant suru aahe. Duty var: ${PHC.doctors.join(" aani ")}.`,
    opt2     : () => `Upalabdh: ${PHC.medicines.available.join(", ")}. Stockout: ${PHC.medicines.outOfStock.join(", ")}.`,
    opt4     : () => `Aapla referral ${PHC.name} kade register aahe. ASHA lavakar update deil. Tatkal: 108.`,
    slotMenu : "Ek daba — Uddya 9 vajata. Don daba — 10 vajata. Teen daba — 11 vajata.",
    slotOk   : (slot, date) => `Appointment ${date} la ${slot} la book jhali. SMS yenar. Veles ya. Dhanyavad.`,
  },
  hi: {
    greeting : (name) => `Namaste${name ? " " + name : ""}. Main JanVaani hoon, ${PHC.name} ka AI sahayak. JanArogya Maharashtra.`,
    menu     : "Ek dabaye — doctor. Do dabaye — dawaa. Teen dabaye — appointment. Chaar dabaye — referral. Shoonya — dobara suniye.",
    noInput  : "Koi input nahi. Dobara call karein. Dhanyavaad.",
    bye      : "JanArogya JanVaani. Dhanyavaad aur swasth rahiye.",
    invalid  : "Galat option. Dobara try karein.",
    opt1     : () => `${PHC.name} ${PHC.open} se ${PHC.close} tak khula. Duty: ${PHC.doctors.join(" aur ")}.`,
    opt2     : () => `Upalabdh: ${PHC.medicines.available.join(", ")}. Nahi hai: ${PHC.medicines.outOfStock.join(", ")}.`,
    opt4     : () => `Aapka referral register hai. ASHA update denge. Zaroorat par 108.`,
    slotMenu : "Ek — Kal 9 baje. Do — 10 baje. Teen — 11 baje.",
    slotOk   : (slot, date) => `Appointment ${date} ${slot} par book ho gayi. SMS aayega. Samay par aayein.`,
  },
  en: {
    greeting : (name) => `Hello${name ? " " + name : ""}. I am JanVaani, AI assistant of ${PHC.name}. JanArogya Maharashtra.`,
    menu     : "Press 1 doctor. Press 2 medicine. Press 3 appointment. Press 4 referral. Press 0 repeat.",
    noInput  : "No input. Please call again. Thank you.",
    bye      : "JanArogya JanVaani. Thank you and stay healthy.",
    invalid  : "Invalid option. Try again.",
    opt1     : () => `${PHC.name} open ${PHC.open}–${PHC.close}. On duty: ${PHC.doctors.join(", ")}.`,
    opt2     : () => `Available: ${PHC.medicines.available.join(", ")}. Out of stock: ${PHC.medicines.outOfStock.join(", ")}.`,
    opt4     : () => `Your referral is registered. ASHA will update you. Emergency: 108.`,
    slotMenu : "Press 1 for 9 AM. Press 2 for 10 AM. Press 3 for 11 AM.",
    slotOk   : (slot, date) => `Appointment booked on ${date} at ${slot}. SMS sent. Please attend.`,
  },
};

// ─────────────────────────────────────────────
// FOLLOW-UP CALL SCRIPTS
// ─────────────────────────────────────────────

// Gender-aware honorific — no "tai" for males
function honorific(name, sex, lang) {
  if (!name) return "";
  if (sex === "M") {
    return lang === "mr" ? ` ${name} dada` : lang === "hi" ? ` ${name} bhai` : ` ${name}`;
  }
  return lang === "mr" ? ` ${name} tai` : lang === "hi" ? ` ${name} ji` : ` ${name}`;
}

const FOLLOWUP = {
  mr: {
    greeting : (name, ashaName, complaint, sex = "F") =>
      `Namaskar${honorific(name, sex, "mr")}. ` +
      `ASHA ${ashaName || "karyakarta"} tumchya ghara aali hoti. ` +
      `Tumhi sangitale hote — ${complaint || "takrar"}. ` +
      `Aata kasa vatate?`,
    menu     :
      "Ek daba — abhi takrar aahe, doctor kade janyache aahe. " +
      "Don daba — bare aahe, PHC bhet ghyaychi aahe. " +
      "Teen daba — sab theek aahe.",
    noInput  : "Konacha input nahi mila. Punha call kara. Dhanyavad.",
    resp1    : "Samjhalo. PHC Armori madhe aapli appointment book keli jaail. ASHA sahay kartil. Tatkal 108 var call kara.",
    resp2    : "Chhaan. PHC Armori madhe slot book karto. SMS milel. Veles ya.",
    resp3    : "Khoop chhaan! Nirogi raha. Parat kaahi lavale tar ASHA yetil.",
    bye      : "JanArogya JanVaani. Dhanyavad aani nirogi raha.",
    invalid  : "Chukicha button. Punha eka vel aika.",
  },
  hi: {
    greeting : (name, ashaName, complaint, sex = "F") =>
      `Namaste${honorific(name, sex, "hi")}. ` +
      `ASHA ${ashaName || "karyakarta"} aapke ghar aayi thi. ` +
      `Aapne bataya tha — ${complaint || "takleef"}. ` +
      `Ab kaisa feel ho raha hai?`,
    menu     :
      "Ek dabaye — abhi takleef hai, doctor ke paas jaana hai. " +
      "Do dabaye — theek hai, PHC jana chahta hoon. " +
      "Teen dabaye — sab theek hai.",
    noInput  : "Koi input nahi. Dobara call karein. Dhanyavaad.",
    resp1    : "Samjha. PHC Armori mein aapki appointment book ki jaayegi. ASHA madad karenge. Zaroorat par 108 karein.",
    resp2    : "Achha. PHC Armori mein slot book kar lete hain. SMS aayega. Samay par aayein.",
    resp3    : "Bahut achha! Swasth rahiye. Zaroorat par ASHA phir aayenge.",
    bye      : "JanArogya JanVaani. Dhanyavaad aur swasth rahiye.",
    invalid  : "Galat button. Ek baar phir suniye.",
  },
  en: {
    greeting : (name, ashaName, complaint, sex = "F") =>
      `Hello${name ? " " + name : ""}. ` +
      `ASHA worker ${ashaName || ""} visited your home. ` +
      `You mentioned — ${complaint || "health concern"}. ` +
      `How are you feeling now?`,
    menu     :
      "Press 1 — still unwell, need doctor. " +
      "Press 2 — better, want PHC visit. " +
      "Press 3 — all fine.",
    noInput  : "No input received. Please call again. Thank you.",
    resp1    : "Understood. We will book an appointment at PHC Armori. Your ASHA worker will assist. For emergency call 108.",
    resp2    : "Great. We will book a PHC slot. You will receive an SMS. Please attend.",
    resp3    : "Wonderful! Stay healthy. Your ASHA worker will follow up if needed.",
    bye      : "JanArogya JanVaani. Thank you and stay healthy.",
    invalid  : "Invalid input. Please listen again.",
  },
};

// ─────────────────────────────────────────────
// RESPONSE STORE
// ─────────────────────────────────────────────
const RESPONSES_FILE = path.join(__dirname, "responses.json");

function loadResponses() {
  if (!fs.existsSync(RESPONSES_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(RESPONSES_FILE, "utf8")); }
  catch { return []; }
}

function saveResponse(entry) {
  const all = loadResponses();
  all.push(entry);
  fs.writeFileSync(RESPONSES_FILE, JSON.stringify(all, null, 2), "utf8");
  console.log("✅ Saved:", JSON.stringify(entry));
}

function updateResponse(callSid, patch) {
  const all = loadResponses();
  const idx = all.findIndex((r) => r.callSid === callSid);
  if (idx !== -1) {
    Object.assign(all[idx], patch);
    fs.writeFileSync(RESPONSES_FILE, JSON.stringify(all, null, 2), "utf8");
  } else {
    saveResponse({ callSid, ...patch });
  }
}

// ─────────────────────────────────────────────
// ══════════════════════════════════════════════
//  FOLLOW-UP CALL ROUTES
// ══════════════════════════════════════════════
// ─────────────────────────────────────────────

/**
 * POST /followup-voice
 *
 * Entry point — first ask language preference in all 3 langs,
 * then greet in chosen language with patient name, complaint, gender-aware honorific.
 *
 * Query params: name, ashaName, complaint, sex, visitId
 */
app.post("/followup-voice", (req, res) => {
  const {
    name = "", ashaName = "", complaint = "", visitId = "", sex = "F",
  } = req.query;

  const callSid = req.body.CallSid || "unknown";
  const base    = process.env.WEBHOOK_BASE_URL;

  console.log(`📞 /followup-voice — SID:${callSid} name:${name} sex:${sex} complaint:${complaint}`);

  saveResponse({
    timestamp: new Date().toISOString(), callSid,
    type: "followup", caller: req.body.From || "unknown", to: req.body.To || "unknown",
    patientName: name, ashaName, complaint, visitId, sex,
    lang: null, patientResponse: null, intent: "lang_select", finalStatus: null, duration: null,
  });

  const langUrl =
    `${base}/followup-lang` +
    `?name=${eu(name)}&ashaName=${eu(ashaName)}` +
    `&complaint=${eu(complaint)}&visitId=${eu(visitId)}&sex=${eu(sex)}`;

  // Spoken in all 3 langs so every patient understands
  const prompt =
    "Press 1 for English. " +
    "Hindi ke liye 2 dabaye. " +
    "Marathi saathi 3 daba.";

  // Repeat 3 times so patient has time to press
  const twiml = wrap(`
    <Gather numDigits="1" action="${langUrl}" method="POST" timeout="20" finishOnKey="">
      <Say>Press 1 for English. Hindi ke liye 2 dabaye. Marathi saathi 3 daba.</Say>
      <Say>Press 1 for English. Hindi ke liye 2 dabaye. Marathi saathi 3 daba.</Say>
      <Say>Press 1 for English. Hindi ke liye 2 dabaye. Marathi saathi 3 daba.</Say>
    </Gather>
    <Redirect method="POST">${langUrl}</Redirect>
  `);

  res.type("text/xml").send(twiml);
});

/**
 * POST /followup-lang
 *
 * Patient pressed 1 (English) / 2 (Hindi) / 3 (Marathi).
 * Greet in chosen language with name + complaint, then ask follow-up question.
 */
app.post("/followup-lang", (req, res) => {
  const {
    name = "", ashaName = "", complaint = "", visitId = "", sex = "F",
  } = req.query;

  const digit   = req.body.Digits || req.query.Digits || "3";  // default Marathi
  const callSid = req.body.CallSid || "unknown";
  const base    = process.env.WEBHOOK_BASE_URL;

  // 1 → en, 2 → hi, 3 → mr (default Marathi)
  const lang = digit === "1" ? "en" : digit === "2" ? "hi" : "mr";
  const s    = FOLLOWUP[lang];

  console.log(`🌐 /followup-lang — lang:${lang} SID:${callSid}`);

  updateResponse(callSid, { lang, intent: "greeting" });

  const answerUrl =
    `${base}/followup-answer` +
    `?lang=${eu(lang)}&name=${eu(name)}&ashaName=${eu(ashaName)}` +
    `&complaint=${eu(complaint)}&visitId=${eu(visitId)}&sex=${eu(sex)}`;

  const twiml = wrap(`
    <Gather numDigits="1" action="${answerUrl}" method="POST" timeout="20" finishOnKey="">
      ${say(s.greeting(name, ashaName, complaint, sex), lang)}
      ${say(s.menu, lang)}
      ${say(s.menu, lang)}
    </Gather>
    <Redirect method="POST">${answerUrl}</Redirect>
  `);

  res.type("text/xml").send(twiml);
});

/**
 * POST /followup-answer
 * Patient responded to the follow-up question.
 * 1 = still unwell → book PHC appointment + SMS
 * 2 = better, wants visit → book slot + SMS
 * 3 = all fine → log + close
 */
app.post("/followup-answer", (req, res) => {
  const { lang = "mr", name = "", ashaName = "", complaint = "", visitId = "", sex = "F" } = req.query;
  const digit   = req.body.Digits  || "";
  const callSid = req.body.CallSid || "unknown";
  const caller  = req.body.From    || "unknown";
  const s       = FOLLOWUP[lang] || FOLLOWUP.mr;

  console.log(`✅ /followup-answer — digit: ${digit}, lang: ${lang}, CallSid: ${callSid}`);

  let responseLabel = "";
  let responseText  = "";
  let bookSlot      = false;

  if (digit === "1") {
    responseLabel = "unwell_needs_doctor";
    responseText  = s.resp1;
    bookSlot      = true;
  } else if (digit === "2") {
    responseLabel = "wants_phc_visit";
    responseText  = s.resp2;
    bookSlot      = true;
  } else if (digit === "3") {
    responseLabel = "all_ok";
    responseText  = s.resp3;
  } else {
    // Invalid — replay question
    const base      = process.env.WEBHOOK_BASE_URL;
    const answerUrl = `${base}/followup-answer?lang=${eu(lang)}&name=${eu(name)}&ashaName=${eu(ashaName)}&complaint=${eu(complaint)}&visitId=${eu(visitId)}&sex=${eu(sex)}`;
    const twiml = wrap(`
      ${say(s.invalid, lang)}
      <Gather numDigits="1" action="${answerUrl}" method="POST" timeout="10">
        ${say(s.menu, lang)}
      </Gather>
      ${say(s.noInput, lang)}
    `);
    return res.type("text/xml").send(twiml);
  }

  updateResponse(callSid, {
    digit           : digit,
    patientResponse : digit,
    responseLabel,
    intent          : "followup_answered",
    caller,
    visitId,
  });

  // Book appointment if needed
  const slot = PHC.slots[0]; // earliest available slot
  const date = tomorrow();
  if (bookSlot) {
    sendSms(caller, lang, slot, date, name, "followup");
  }

  const twiml = wrap(`
    ${say(responseText, lang)}
    ${say(s.bye, lang)}
  `);

  res.type("text/xml").send(twiml);
});

// ─────────────────────────────────────────────
// ══════════════════════════════════════════════
//  GENERAL MENU ROUTES  (original — unchanged)
// ══════════════════════════════════════════════
// ─────────────────────────────────────────────

// Simple test route — no Gather, just Say
app.post("/simple-test", (req, res) => {
  console.log("✅ /simple-test hit — CallSid:", req.body.CallSid);
  res.type("text/xml").send(wrap("<Say>Hello. JanVaani test call. This is working. Goodbye.</Say><Hangup/>"));
});

/**
 * POST /voice
 * General menu entry point (doctor info / medicine / appointment / referral).
 */
app.post("/voice", (req, res) => {
  const lang    = req.query.lang || "mr";
  const name    = req.query.name || "";
  const callSid = req.body.CallSid || "unknown";
  const base    = process.env.WEBHOOK_BASE_URL;
  const s       = GENERAL[lang] || GENERAL.mr;

  console.log(`📞 /voice — CallSid: ${callSid}, lang: ${lang}, name: ${name}`);

  saveResponse({
    timestamp   : new Date().toISOString(),
    callSid,
    type        : "general",
    caller      : req.body.From || "unknown",
    to          : req.body.To   || "unknown",
    patientName : name,
    lang,
    digit       : null,
    intent      : "initiated",
    finalStatus : null,
    duration    : null,
  });

  const actionUrl = `${base}/handle-input?lang=${eu(lang)}&name=${eu(name)}`;

  const twiml = wrap(`
    <Gather numDigits="1" action="${actionUrl}" method="POST" timeout="10">
      ${say(s.greeting(name), lang)}
      ${say(s.menu, lang)}
    </Gather>
    ${say(s.noInput, lang)}
  `);

  res.type("text/xml").send(twiml);
});

/**
 * POST /handle-input
 * General menu DTMF handler.
 */
app.post("/handle-input", (req, res) => {
  const lang    = req.query.lang || "mr";
  const name    = req.query.name || "";
  const digit   = req.body.Digits  || "";
  const callSid = req.body.CallSid || "unknown";
  const caller  = req.body.From    || "unknown";
  const base    = process.env.WEBHOOK_BASE_URL;
  const s       = GENERAL[lang] || GENERAL.mr;

  console.log(`🔢 /handle-input — digit: ${digit}, CallSid: ${callSid}`);

  let twiml = "";
  let intent = "";

  if (digit === "1") {
    intent = "doctor_info";
    updateResponse(callSid, { digit, intent, caller });
    twiml = wrap(say(s.opt1(), lang) + say(s.bye, lang));

  } else if (digit === "2") {
    intent = "medicine_info";
    updateResponse(callSid, { digit, intent, caller });
    twiml = wrap(say(s.opt2(), lang) + say(s.bye, lang));

  } else if (digit === "3") {
    intent = "appointment";
    updateResponse(callSid, { digit, intent, caller });
    const bookUrl = `${base}/book-slot?lang=${eu(lang)}&name=${eu(name)}`;
    twiml = wrap(`
      <Gather numDigits="1" action="${bookUrl}" method="POST" timeout="10">
        ${say(s.slotMenu, lang)}
      </Gather>
      ${say(s.bye, lang)}
    `);

  } else if (digit === "4") {
    intent = "referral_status";
    updateResponse(callSid, { digit, intent, caller });
    twiml = wrap(say(s.opt4(), lang) + say(s.bye, lang));

  } else if (digit === "0") {
    intent = "repeat_menu";
    updateResponse(callSid, { digit, intent, caller });
    twiml = wrap(`<Redirect method="POST">${base}/voice?lang=${eu(lang)}&name=${eu(name)}</Redirect>`);

  } else {
    intent = "invalid";
    updateResponse(callSid, { digit, intent, caller });
    twiml = wrap(
      say(s.invalid, lang) +
      `<Redirect method="POST">${base}/voice?lang=${eu(lang)}&name=${eu(name)}</Redirect>`,
    );
  }

  res.type("text/xml").send(twiml);
});

/**
 * POST /book-slot
 * General menu — patient selects appointment slot.
 */
app.post("/book-slot", (req, res) => {
  const lang    = req.query.lang || "mr";
  const name    = req.query.name || "";
  const digit   = req.body.Digits  || "1";
  const callSid = req.body.CallSid || "unknown";
  const caller  = req.body.From    || "unknown";
  const s       = GENERAL[lang] || GENERAL.mr;

  const idx  = Math.max(0, Math.min(parseInt(digit, 10) - 1, PHC.slots.length - 1));
  const slot = PHC.slots[idx];
  const date = tomorrow();

  console.log(`📅 /book-slot — slot: ${slot}, CallSid: ${callSid}`);

  updateResponse(callSid, { digit: `3-${digit}`, intent: "appointment_booked", slot, date, caller });
  sendSms(caller, lang, slot, date, name, "general");

  res.type("text/xml").send(wrap(say(s.slotOk(slot, date), lang)));
});

// ─────────────────────────────────────────────
// SHARED ROUTES
// ─────────────────────────────────────────────

/** POST /status — Twilio call status callback */
app.post("/status", (req, res) => {
  const { CallSid, CallStatus, Duration } = req.body;
  console.log(`📊 /status — SID: ${CallSid}, Status: ${CallStatus}, Duration: ${Duration}s`);
  updateResponse(CallSid, { finalStatus: CallStatus, duration: Duration });
  res.sendStatus(200);
});

/** GET /responses — raw JSON */
app.get("/responses", (req, res) => {
  res.json(loadResponses());
});

/** GET /responses/html — visual call log */
app.get("/responses/html", (req, res) => {
  const rows = loadResponses();

  const badge = (intent) => {
    const MAP = {
      followup_answered   : "#d1fae5|#065f46",
      appointment_booked  : "#d1fae5|#065f46",
      unwell_needs_doctor : "#fee2e2|#991b1b",
      doctor_info         : "#dbeafe|#1e40af",
      medicine_info       : "#fef3c7|#92400e",
      referral_status     : "#ede9fe|#5b21b6",
      initiated           : "#f3f4f6|#6b7280",
      lang_select         : "#f3f4f6|#6b7280",
      invalid             : "#fee2e2|#991b1b",
    };
    const [bg, color] = (MAP[intent] || "#f3f4f6|#6b7280").split("|");
    return `<span style="background:${bg};color:${color};padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600">${intent || "—"}</span>`;
  };

  const responseLabel = (r) => {
    if (!r.responseLabel) return "—";
    const MAP = {
      unwell_needs_doctor : "🔴 Still unwell",
      wants_phc_visit     : "🟡 Wants PHC visit",
      all_ok              : "🟢 All fine",
    };
    return MAP[r.responseLabel] || r.responseLabel;
  };

  const tableRows = rows.slice().reverse().map((r) => `
    <tr>
      <td>${r.timestamp?.slice(0, 19).replace("T", " ") || "—"}</td>
      <td><b>${r.type === "followup" ? "🔁 Follow-up" : "📋 General"}</b></td>
      <td>${r.patientName || "—"}</td>
      <td>${r.lang || "—"}</td>
      <td>${badge(r.intent)}</td>
      <td>${responseLabel(r)}</td>
      <td>${r.slot ? `${r.slot} · ${r.date}` : "—"}</td>
      <td>${r.finalStatus || "—"} ${r.duration ? `(${r.duration}s)` : ""}</td>
    </tr>`).join("");

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="30">
  <title>JanVaani — Call Logs</title>
  <style>
    body  { font-family:system-ui,sans-serif; padding:2rem; background:#f7f4ee; }
    h1    { color:#0c2a1c; margin-bottom:.5rem; }
    p.sub { color:#666; font-size:13px; margin-bottom:1rem; }
    table { border-collapse:collapse; width:100%; background:white; border-radius:12px;
            overflow:hidden; box-shadow:0 1px 4px rgba(0,0,0,.08); }
    th    { background:#0c2a1c; color:#f4efe6; padding:10px 14px; text-align:left;
            font-size:11px; text-transform:uppercase; letter-spacing:.05em; }
    td    { padding:10px 14px; font-size:13px; border-bottom:1px solid #f0ebe2; }
    tr:last-child td { border-bottom:none; }
    tr:hover td { background:#faf8f3; }
  </style>
</head>
<body>
  <h1>📞 JanVaani — JanArogya MH</h1>
  <p class="sub">${rows.length} total calls · auto-refresh 30s · <a href="/responses">JSON</a></p>
  <table>
    <thead><tr>
      <th>Time</th><th>Type</th><th>Patient</th><th>Lang</th>
      <th>Intent</th><th>Patient Response</th><th>Slot</th><th>Status</th>
    </tr></thead>
    <tbody>
      ${tableRows || "<tr><td colspan='8' style='text-align:center;color:#999;padding:2rem'>No calls yet.</td></tr>"}
    </tbody>
  </table>
</body>
</html>`);
});

// ─────────────────────────────────────────────
// SMS HELPER
// ─────────────────────────────────────────────
const SMS_TEMPLATES = {
  general: {
    mr : (name, slot, date) => `JanArogya: ${name ? name + " tai, " : ""}${PHC.name} appointment ${date} la ${slot} la book jhali. JanVaani. Veles ya.`,
    hi : (name, slot, date) => `JanArogya: ${name ? name + " ji, " : ""}${PHC.name} appointment ${date} ${slot}. JanVaani. Samay par aayein.`,
    en : (name, slot, date) => `JanArogya: ${PHC.name} appointment on ${date} at ${slot}${name ? " for " + name : ""}. JanVaani. Please attend.`,
  },
  followup: {
    mr : (name, slot, date) => `JanArogya: ${name ? name + " tai, " : ""}aapli takrar nondli. PHC Armori appointment ${date} la ${slot} la. ASHA sahay kartil.`,
    hi : (name, slot, date) => `JanArogya: ${name ? name + " ji, " : ""}aapki takleef darj ki gayi. PHC Armori appointment ${date} ${slot}. ASHA madad karenge.`,
    en : (name, slot, date) => `JanArogya: ${name ? name + ", " : ""}your concern is noted. PHC Armori appointment on ${date} at ${slot}. ASHA will assist.`,
  },
};

async function sendSms(to, lang, slot, date, name, type = "general") {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_FROM_NUMBER;

  const tmpl = (SMS_TEMPLATES[type] || SMS_TEMPLATES.general)[lang] || SMS_TEMPLATES.general.mr;
  const body = tmpl(name, slot, date);

  if (!sid || !token || !from) {
    console.log(`[SMS demo] → ${to}: ${body}`);
    return;
  }

  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  try {
    const resp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method  : "POST",
        headers : { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${auth}` },
        body    : new URLSearchParams({ To: to, From: from, Body: body }).toString(),
      },
    );
    const data = await resp.json();
    console.log(`📱 SMS sent — SID: ${data.sid}, To: ${to}`);
  } catch (err) {
    console.error("❌ SMS error:", err.message);
  }
}

// ─────────────────────────────────────────────
// START
// ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const base = process.env.WEBHOOK_BASE_URL || `http://localhost:${PORT}`;
  console.log(`\n🚀 JanVaani IVR server — http://localhost:${PORT}`);
  console.log(`\n   Follow-up call routes:`);
  console.log(`   POST ${base}/followup-voice    — language select`);
  console.log(`   POST ${base}/followup-lang     — greeting + question`);
  console.log(`   POST ${base}/followup-answer   — save patient response`);
  console.log(`\n   General menu routes:`);
  console.log(`   POST ${base}/voice             — general menu`);
  console.log(`   POST ${base}/handle-input      — DTMF handler`);
  console.log(`   POST ${base}/book-slot         — appointment booking`);
  console.log(`\n   Shared:`);
  console.log(`   POST ${base}/status            — call status callback`);
  console.log(`   GET  ${base}/responses/html    — visual call log`);
  console.log(`   GET  ${base}/responses         — JSON log\n`);
});
