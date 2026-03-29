(function () {
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

  // ── Read a chat field — WA Web uses __x_ prefix for all model properties ──
  function cf(chat, field) {
    // Try __x_ prefixed first (modern WA Web), then plain name
    return chat["__x_" + field] !== undefined ? chat["__x_" + field] : chat[field];
  }

  // ── Get window.Store, wait for it to be ready ──────────────────────────────
  function getStore() {
    const s = window.Store;
    if (s && s.Chat && s.Label) return s;
    return null;
  }

  function waitForStore(maxWaitMs = 15000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        const store = getStore();
        if (store) return resolve(store);
        if (Date.now() - start > maxWaitMs) {
          reject(new Error("window.Store not ready. Make sure WhatsApp Web is fully loaded."));
        } else {
          setTimeout(check, 500);
        }
      };
      check();
    });
  }

  // ── Get all models from a Store collection ─────────────────────────────────
  // Collections store models in ._models (object keyed by id)
  // or expose getModelsArray(). Handle both.
  function getModels(collection) {
    if (!collection) return [];
    if (typeof collection.getModelsArray === "function") {
      try {
        const arr = collection.getModelsArray();
        if (Array.isArray(arr) && arr.length > 0) return arr;
      } catch (_) {}
    }
    if (collection._models && typeof collection._models === "object") {
      return Object.values(collection._models);
    }
    return [];
  }

  // ── Get label IDs from a chat ──────────────────────────────────────────────
  // chat.labels (or __x_labels) is a plain Array of label ID strings e.g. ["20", "3"]
  function getChatLabelIds(chat) {
    const raw = cf(chat, "labels") ?? chat.labelIds ?? chat.__x_labelIds;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.map(String);
    // Backbone collection fallback
    if (raw._models) return Object.keys(raw._models).map(String);
    try { return Array.from(raw).map(l => String(l?.id !== undefined ? l.id : l)); } catch (_) { return []; }
  }

  // ── Resolve phone number from a chat ──────────────────────────────────────
  // Modern WA Web uses @lid (linked device ID) for individual chats.
  // The actual phone number lives on the contact object, not the JID.
  // We look it up via Store.Contact using the chat's contact reference.
  function resolvePhone(chat, store) {
    const chatId = cf(chat, "id");
    const serialized = chatId?._serialized || "";

    // Old format: 919876543210@c.us — extract directly
    if (serialized.endsWith("@c.us")) {
      const digits = serialized.replace(/@c\.us$/, "");
      if (/^\d{7,15}$/.test(digits)) return digits;
    }

    // New format: @lid — must look up contact to get real phone number
    // Try via the chat's contact reference first
    const chatContact = cf(chat, "contact");
    if (chatContact) {
      const phone = extractPhoneFromContact(chatContact);
      if (phone) return phone;
    }

    // Try Store.Contact.get(jid)
    if (store.Contact && serialized) {
      try {
        const contact = store.Contact.get ? store.Contact.get(serialized) : null;
        if (contact) {
          const phone = extractPhoneFromContact(contact);
          if (phone) return phone;
        }
      } catch (_) {}

      // Also search _models by lid match
      const contactModels = getModels(store.Contact);
      for (const c of contactModels) {
        const cId = cf(c, "id");
        if (cId?._serialized === serialized || cId?.lid === chatId?.user) {
          const phone = extractPhoneFromContact(c);
          if (phone) return phone;
        }
      }
    }

    return null;
  }

  function extractPhoneFromContact(contact) {
    if (!contact) return null;
    // Try id._serialized in @c.us format
    const id = cf(contact, "id") || contact.id;
    const serialized = id?._serialized || "";
    if (serialized.endsWith("@c.us")) {
      const digits = serialized.replace(/@c\.us$/, "");
      if (/^\d{7,15}$/.test(digits)) return digits;
    }
    // Try contact.phone or contact.number fields
    for (const field of ["phone", "number", "phoneNumber"]) {
      const v = contact[field] || contact["__x_" + field];
      if (v && /\d{7,}/.test(String(v))) {
        return String(v).replace(/\D/g, "");
      }
    }
    return null;
  }

  // ── Get display name for a chat ────────────────────────────────────────────
  function getChatName(chat, store) {
    const chatContact = cf(chat, "contact");
    // Contact name sources (in priority order)
    const sources = [
      chatContact && (cf(chatContact, "name") || cf(chatContact, "pushname") || cf(chatContact, "formattedName")),
      cf(chat, "name"),
      cf(chat, "formattedTitle"),
    ];
    for (const s of sources) {
      const n = normalizeWhitespace(s || "");
      if (n) return n;
    }
    return "";
  }

  // ── Get all labels ─────────────────────────────────────────────────────────
  function getAllLabels(store) {
    return getModels(store.Label).map(l => ({
      id: String(cf(l, "id") ?? l.id),
      name: normalizeWhitespace(cf(l, "name") ?? l.name ?? ""),
      color: cf(l, "color") ?? l.color
    }));
  }

  // ── Build contacts for a label ─────────────────────────────────────────────
  function buildContacts(store, label) {
    const labelId = label.id;
    const allChats = getModels(store.Chat);
    const contacts = [];
    let skippedNoPhone = 0;

    for (const chat of allChats) {
      // Skip groups
      const chatId = cf(chat, "id");
      const serialized = chatId?._serialized || "";
      if (serialized.endsWith("@g.us") || serialized.endsWith("@newsletter")) continue;
      if (cf(chat, "isGroup")) continue;

      // Check label match
      const ids = getChatLabelIds(chat);
      if (!ids.includes(labelId)) continue;

      // Resolve phone
      const digits = resolvePhone(chat, store);
      if (!digits) { skippedNoPhone++; continue; }

      const name = getChatName(chat, store);

      let lastContactedDate = "";
      const ts = cf(chat, "t") || 0;
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
  }

  // ── Collect contacts for a label ───────────────────────────────────────────
  async function collectLabelContacts(labelOverride) {
    const store = await waitForStore();
    const allLabels = getAllLabels(store);

    let target = allLabels.find(l =>
      l.name.toLowerCase() === (labelOverride || "").toLowerCase()
    );

    if (!target) {
      const headerSpan = document.querySelector("header span[dir='auto'], header ._ao3e");
      const headerText = normalizeWhitespace(headerSpan?.textContent || "");
      target = allLabels.find(l => l.name.toLowerCase() === headerText.toLowerCase());
    }

    if (!target) {
      throw new Error(`Label not found. Available: ${allLabels.map(l => l.name).join(", ") || "none"}.`);
    }

    return buildContacts(store, target);
  }

  // ── Store Inspector ────────────────────────────────────────────────────────
  function inspectStore() {
    const store = getStore();
    const results = {
      storeFound: !!store,
      chatCount: 0,
      labelCount: 0,
      contactCount: 0,
      labels: [],
      sampleChat: null,
      sampleChatLabels: null,
      sampleContact: null,
      errors: []
    };

    if (!store) {
      results.errors.push("window.Store not found");
      return results;
    }

    try {
      const labels = getAllLabels(store);
      results.labelCount = labels.length;
      results.labels = labels;
    } catch (e) { results.errors.push("Label: " + e.message); }

    try {
      const chats = getModels(store.Chat);
      results.chatCount = chats.length;
      if (chats.length) {
        const c = chats[0];
        results.sampleChat = {
          serialized: cf(c, "id")?._serialized,
          name: getChatName(c, store),
          t: cf(c, "t"),
          labels: getChatLabelIds(c)
        };

        // Find a labelled chat
        const labelled = chats.find(ch => getChatLabelIds(ch).length > 0);
        if (labelled) {
          const digits = resolvePhone(labelled, store);
          results.sampleChatLabels = {
            serialized: cf(labelled, "id")?._serialized,
            labelIds: getChatLabelIds(labelled),
            resolvedPhone: digits,
            name: getChatName(labelled, store)
          };
        }
      }
    } catch (e) { results.errors.push("Chat: " + e.message); }

    try {
      const contacts = getModels(store.Contact);
      results.contactCount = contacts.length;
      if (contacts.length) {
        const c = contacts[0];
        results.sampleContact = {
          serialized: cf(c, "id")?._serialized,
          name: cf(c, "name"),
          pushname: cf(c, "pushname"),
          phone: extractPhoneFromContact(c)
        };
      }
    } catch (e) { results.errors.push("Contact: " + e.message); }

    return results;
  }

  // ── Event bridge ───────────────────────────────────────────────────────────
  document.addEventListener("WLE_REQUEST", async (e) => {
    const { type, labelOverride } = e.detail || {};
    let result;
    try {
      if (type === "collect-label-contacts") {
        result = { ok: true, ...(await collectLabelContacts(labelOverride)) };
      } else if (type === "get-all-labels") {
        const store = await waitForStore();
        result = { ok: true, labels: getAllLabels(store) };
      } else if (type === "inspect-store") {
        result = { ok: true, inspection: inspectStore() };
      } else {
        result = { ok: false, error: "Unknown type: " + type };
      }
    } catch (err) {
      result = { ok: false, error: err.message || String(err) };
    }
    document.dispatchEvent(new CustomEvent("WLE_RESPONSE", { detail: result }));
  });

  console.log("[LabelExport] ready. Store:", !!window.Store, "Chat models:", Object.keys(window.Store?.Chat?._models || {}).length);
})();
