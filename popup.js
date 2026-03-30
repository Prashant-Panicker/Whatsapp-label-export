const scanButton = document.getElementById("scanButton");
const csvButton = document.getElementById("csvButton");
const jsonButton = document.getElementById("jsonButton");
const loadLabelsBtn = document.getElementById("loadLabelsBtn");
const labelSelect = document.getElementById("labelSelect");
const labelOverrideInput = document.getElementById("labelOverride");
const statusLine = document.getElementById("statusLine");
const summaryLine = document.getElementById("summaryLine");
const previewSection = document.getElementById("previewSection");
const previewCount = document.getElementById("previewCount");
const preview = document.getElementById("preview");
const inspectBtn = document.getElementById("inspectBtn");
const inspectorSection = document.getElementById("inspectorSection");
const inspectorOutput = document.getElementById("inspectorOutput");

let lastResult = null;

// ── Helpers ────────────────────────────────────────────────────────────────
async function getWhatsAppTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id || !tab.url?.startsWith("https://web.whatsapp.com/")) {
    throw new Error("Open WhatsApp Web in the active tab first.");
  }
  return tab;
}

async function sendToContent(tab, message) {
  return chrome.tabs.sendMessage(tab.id, message);
}

function setStatus(msg, detail = "", type = "") {
  statusLine.textContent = msg;
  statusLine.className = "status" + (type ? ` ${type}` : "");
  summaryLine.textContent = detail;
}

function setBusy(busy) {
  scanButton.disabled = busy;
  csvButton.disabled = busy;
  jsonButton.disabled = busy;
  loadLabelsBtn.disabled = busy;
  inspectBtn.disabled = busy;
}

function getLabelName() {
  return labelOverrideInput.value.trim() || labelSelect.value || "";
}

function sanitizeFilePart(value) {
  return (value || "label").trim().replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/^-+|-+$/g, "").toLowerCase() || "label";
}

function escHtml(str) {
  return (str || "").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function toCsv(rows) {
  const headers = ["number", "countrycode", "name", "lastContactedDate", "labelName"];
  // Columns that must always be quoted as text so Excel doesn't treat them as numbers
  const alwaysQuote = new Set(["number", "countrycode"]);
  const escape = (v, h) => {
    const s = v == null ? "" : String(v);
    if (alwaysQuote.has(h) || /[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return [
    headers.join(","),
    ...rows.map(row => headers.map(h => escape(row[h], h)).join(","))
  ].join("\r\n");
}

// ── Cross-browser download ─────────────────────────────────────────────────
// chrome.downloads with blob URLs is blocked in Firefox extension popups.
// Using an anchor click works in both Chrome and Firefox.
function triggerDownload(fileName, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ── Load Labels dropdown ───────────────────────────────────────────────────
async function loadLabels() {
  setBusy(true);
  setStatus("Loading labels from WhatsApp...");
  try {
    const tab = await getWhatsAppTab();
    const res = await sendToContent(tab, { type: "get-all-labels" });
    if (!res?.ok) throw new Error(res?.error || "Failed to load labels.");

    const labels = res.labels || [];
    labelSelect.innerHTML = labels.length
      ? labels.map(l => `<option value="${escHtml(l.name)}">${escHtml(l.name)}</option>`).join("")
      : `<option value="">No labels found</option>`;

    setStatus(`${labels.length} label(s) loaded.`, "Select a label then click Scan.", "success");
  } catch (err) {
    setStatus("Failed to load labels.", err.message, "error");
  } finally {
    setBusy(false);
  }
}

loadLabelsBtn.addEventListener("click", () => loadLabels());

// Auto-load labels only — no auto-scan
loadLabels();

// ── Scan ───────────────────────────────────────────────────────────────────
scanButton.addEventListener("click", async () => {
  setBusy(true);
  setStatus("Scanning label...", "Reading from WhatsApp...");
  previewSection.style.display = "none";
  try {
    const tab = await getWhatsAppTab();
    const labelName = getLabelName();
    const res = await sendToContent(tab, { type: "collect-label-contacts", labelOverride: labelName });

    if (!res?.ok) throw new Error(res?.error || "Scan failed.");

    lastResult = res;
    renderPreview(res.contacts);
    previewSection.style.display = "block";

    const skipped = res.skippedNoPhone ? ` (${res.skippedNoPhone} skipped — no phone)` : "";
    setStatus(
      `✓ ${res.contacts.length} contact(s) found`,
      `Label: ${res.labelName}${skipped}`,
      "success"
    );
  } catch (err) {
    setStatus("Scan failed.", err.message, "error");
  } finally {
    setBusy(false);
  }
});

// ── Preview table ──────────────────────────────────────────────────────────
function renderPreview(rows) {
  previewCount.textContent = `${rows.length} contacts`;
  if (!rows.length) {
    preview.innerHTML = `<div class="muted" style="padding:8px 0">No contacts found for this label.</div>`;
    return;
  }
  const shown = rows.slice(0, 10);
  const tbody = shown.map(r => `
    <tr>
      <td title="${escHtml(r.name)}">${escHtml(r.name) || '<span class="muted">—</span>'}</td>
      <td title="${escHtml(r.number)}">${escHtml(r.number)}</td>
      <td>${escHtml(r.lastContactedDate) || '<span class="muted">—</span>'}</td>
    </tr>
  `).join("");
  preview.innerHTML = `
    <table>
      <thead><tr><th>Name</th><th>Number</th><th>Date</th></tr></thead>
      <tbody>${tbody}</tbody>
    </table>
    ${rows.length > 10 ? `<div class="hint" style="margin-top:4px">+ ${rows.length - 10} more…</div>` : ""}
  `;
}

// ── Export ─────────────────────────────────────────────────────────────────
async function doExport(format) {
  if (!lastResult?.contacts?.length) {
    setStatus("Nothing to export. Run Scan first.", "", "error");
    return;
  }
  const stem = `${sanitizeFilePart(lastResult.labelName)}-${new Date().toISOString().slice(0,10)}`;
  if (format === "csv") {
    triggerDownload(`${stem}.csv`, toCsv(lastResult.contacts), "text/csv;charset=utf-8");
    setStatus("CSV download started.", `${lastResult.contacts.length} rows.`, "success");
  } else {
    triggerDownload(`${stem}.json`, JSON.stringify(lastResult.contacts, null, 2), "application/json;charset=utf-8");
    setStatus("JSON download started.", `${lastResult.contacts.length} rows.`, "success");
  }
}

csvButton.addEventListener("click", () => doExport("csv"));
jsonButton.addEventListener("click", () => doExport("json"));

// ── Store Inspector ────────────────────────────────────────────────────────
inspectBtn.addEventListener("click", async () => {
  const isVisible = inspectorSection.style.display !== "none";
  if (isVisible) {
    inspectorSection.style.display = "none";
    inspectBtn.textContent = "🔍 Store Inspector";
    return;
  }

  setBusy(true);
  inspectBtn.textContent = "🔍 Store Inspector (loading...)";
  try {
    const tab = await getWhatsAppTab();
    const res = await sendToContent(tab, { type: "inspect-store" });

    if (!res?.ok) throw new Error(res?.error || "Inspection failed.");

    const data = res.inspection || res;
    inspectorOutput.textContent = JSON.stringify(data, null, 2);
    inspectorSection.style.display = "block";
    inspectBtn.textContent = "🔍 Store Inspector (hide)";
  } catch (err) {
    setStatus("Inspector failed.", err.message, "error");
    inspectBtn.textContent = "🔍 Store Inspector";
  } finally {
    setBusy(false);
  }
});
