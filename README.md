# WhatsApp Label Contact Exporter

Chrome or Edge extension for exporting the contacts listed under the label you currently have open in WhatsApp Web.

## Exported fields

- number
- countrycode
- name
- lastContactedDate
- labelName

## What it does

- Runs on `https://web.whatsapp.com/`
- Reads the currently opened label view in the left pane
- Finds the actual scrollable contact list inside the WhatsApp sidebar and scrolls it to collect all contacts under that label
- Exports CSV or JSON

## Important limitations

- This implementation depends on the current WhatsApp Web DOM structure. If WhatsApp changes their markup, selectors may need to be adjusted.
- `lastContactedDate` is exported from the timestamp text visible in the list row. WhatsApp often shows locale-specific values such as `Yesterday`, `10:42 AM`, or a short date instead of a normalized ISO date.
- `countrycode` is inferred from the extracted phone number using common calling-code prefixes.
- Rows without an extractable phone number are skipped, because `number` is a required export field.
- If WhatsApp does not expose the label name cleanly in the page markup, use the popup's `Label override` field.

## Load the extension

1. Open Chrome or Edge.
2. Go to the extensions page.
3. Enable Developer mode.
4. Choose `Load unpacked`.
5. Select this folder.

## Use it

1. Open WhatsApp Web and wait for it to finish loading.
2. Open the label whose contacts you want to export.
3. Click the extension icon.
4. If needed, fill in `Label override`.
5. Click `Scan label` to verify the preview.
6. Click `Export CSV` or `Export JSON`.

## Files

- `manifest.json`: extension manifest
- `popup.html`, `popup.css`, `popup.js`: popup UI and export logic
- `content.js`: WhatsApp Web scraping logic