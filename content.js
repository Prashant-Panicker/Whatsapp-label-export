// Runs in ISOLATED world — handles all IndexedDB access directly.
// No MAIN world bridge needed; IDB is accessible from ISOLATED world.

const COUNTRY_CALLING_CODES = [
  "998","996","995","994","993","992","977","976","975","974","973","972","971","970",
  "968","967","966","965","964","963","962","961","960","886","880","856","855","853",
  "852","850","692","691","690","689","688","687","686","685","683","682","681","680",
  "679","678","677","676","675","674","673","672","670","599","598","597","596","595",
  "594","593","592","591","590","509","508","507","506","505","504","503","502","501",
  "500","423","421","420","389","387","386","385","383","382","381","380","378","377",
  "376","375","374","373","372","371","370","359","358","357","356","355","354","353",
  "352","351","350","299","298","297","291","290","269","268","267","266","265","264",
  "263","262","261","260","258","257","256","255","254","253","252","251","250","249",
  "248","247","246","245","244","243","242","241","240","239","238","237","236","235",
  "234","233","232","231","230","229","228","227","226","225","224","223","222","221",
  "220","218","216","213","212","211","98","95","94","93","92","91","90","86","84",
  "82","81","66","65","64","63","62","61","60","58","57","56","55","54","53","52",
  "51","49","48","47","46","45","44","43","41","40","39","36","34","33","32","31",
  "30","27","20","7","1"
];

function splitCountryCode(digits) {
  for (const code of COUNTRY_CALLING_CODES) {
    if (digits.startsWith(code) && digits.length > code.length + 4) return code;
  }
  return "";
}

function normalizeWhitespace(v) {
  return (v || "").replace(/\s+/g, " ").trim();
}

// ── IndexedDB helpers ──────────────────────────────────────────────────────
function openModelStorage() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("model-storage");
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(new Error("Failed to open model-storage: " + e.target.error));
  });
}

function getAllFromStore(db, storeName) {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = e => reject(new Error("Read failed on " + storeName + ": " + e.target.error));
    } catch (e) {
      reject(new Error("Transaction failed on " + storeName + ": " + e.message));
    }
  });
}

function phoneFromCus(raw) {
  if (!raw) return null;
  const match = String(raw).match(/^(\d+)@c\.us$/);
  if (match) return match[1];
  const digits = String(raw).replace(/\D/g, "");
  return digits.length >= 7 ? digits : null;
}

// ── Core logic ─────────────────────────────────────────────────────────────
async function getLabels() {
  const db = await openModelStorage();
  try {
    const rows = await getAllFromStore(db, "label");
    return rows.map(l => ({
      id: String(l.id),
      name: normalizeWhitespace(l.name || ""),
      colorIndex: l.colorIndex
    }));
  } finally {
    db.close();
  }
}

async function buildContacts(label) {
  const db = await openModelStorage();
  try {
    // 1. All label associations
    const allAssoc = await getAllFromStore(db, "label-association");
    const lidSet = new Set(
      allAssoc
        .filter(a => String(a.labelId) === label.id && a.type === "jid")
        .map(a => String(a.associationId))
    );

    if (!lidSet.size) {
      return { labelName: label.name, contacts: [], skippedNoPhone: 0 };
    }

    // 2. Contact map: lid → contact record
    const allContacts = await getAllFromStore(db, "contact");
    const contactMap = new Map();
    for (const c of allContacts) {
      if (c.id) contactMap.set(String(c.id), c);
    }

    // 3. Chat map: lid → chat record (for timestamps + name fallback)
    const allChats = await getAllFromStore(db, "chat");
    const chatMap = new Map();
    for (const ch of allChats) {
      if (ch.id) chatMap.set(String(ch.id), ch);
    }

    // 4. Build result
    const contacts = [];
    let skippedNoPhone = 0;

    for (const lid of lidSet) {
      const contact = contactMap.get(lid);
      const chat = chatMap.get(lid);

      // Resolve phone number
      let digits = null;
      if (contact?.phoneNumber) digits = phoneFromCus(contact.phoneNumber);
      if (!digits && chat?.id && String(chat.id).endsWith("@c.us")) digits = phoneFromCus(chat.id);

      if (!digits) { skippedNoPhone++; continue; }

      const name = normalizeWhitespace(
        contact?.name || contact?.shortName || contact?.pushname || chat?.name || ""
      );

      let lastContactedDate = "";
      const ts = chat?.t || 0;
      if (ts > 1000000) {
        const d = new Date(ts * 1000);
        lastContactedDate = `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
      }

      contacts.push({
        number: `+${digits}`,
        countrycode: splitCountryCode(digits),
        name,
        lastContactedDate,
        labelName: label.name
      });
    }

    contacts.sort((a, b) =>
      `${a.name}|${a.number}`.toLowerCase().localeCompare(`${b.name}|${b.number}`.toLowerCase())
    );

    return { labelName: label.name, contacts, skippedNoPhone };
  } finally {
    db.close();
  }
}

async function collectLabelContacts(labelOverride) {
  const allLabels = await getLabels();

  let target = null;
  if (labelOverride) {
    target = allLabels.find(l => l.name.toLowerCase() === labelOverride.toLowerCase());
  }
  if (!target) {
    throw new Error(
      `Label not found. Available: ${allLabels.map(l => l.name).join(", ") || "none"}.`
    );
  }

  return buildContacts(target);
}

async function inspectStore() {
  const db = await openModelStorage();
  const results = { errors: [] };
  try {
    const labels = await getAllFromStore(db, "label");
    results.labelCount = labels.length;
    results.labels = labels.map(l => ({ id: l.id, name: l.name }));
  } catch (e) { results.errors.push("label: " + e.message); }
  try {
    const assoc = await getAllFromStore(db, "label-association");
    results.associationCount = assoc.length;
    results.sampleAssociation = assoc.slice(0, 3);
  } catch (e) { results.errors.push("label-association: " + e.message); }
  try {
    const contacts = await getAllFromStore(db, "contact");
    results.contactCount = contacts.length;
    results.sampleContact = contacts.find(c => c.phoneNumber) || contacts[0] || null;
  } catch (e) { results.errors.push("contact: " + e.message); }
  try {
    const chats = await getAllFromStore(db, "chat");
    results.chatCount = chats.length;
  } catch (e) { results.errors.push("chat: " + e.message); }
  db.close();
  return results;
}

// ── Message listener from popup ────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const validTypes = ["collect-label-contacts", "get-all-labels", "inspect-store"];
  if (!validTypes.includes(message?.type)) return false;

  (async () => {
    try {
      if (message.type === "get-all-labels") {
        const labels = await getLabels();
        sendResponse({ ok: true, labels });
      } else if (message.type === "collect-label-contacts") {
        const result = await collectLabelContacts(message.labelOverride || "");
        sendResponse({ ok: true, ...result });
      } else if (message.type === "inspect-store") {
        const inspection = await inspectStore();
        sendResponse({ ok: true, inspection });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message || String(err) });
    }
  })();

  return true; // keep channel open for async response
});

console.log("[LabelExport] content.js ready — using IndexedDB directly.");
