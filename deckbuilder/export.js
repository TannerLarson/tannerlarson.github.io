/**
 * Moxfield-importable decklist text.
 * @param {{ name: string }[]} commanders
 * @param {{ name: string, qty: number }[]} mainboard
 */
export function formatMoxfield(commanders, mainboard) {
  const lines = ["// Commander"];
  for (const c of commanders) {
    lines.push(`1 ${c.name}`);
  }
  lines.push("", "// Deck");
  for (const card of mainboard) {
    lines.push(`${card.qty} ${card.name}`);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Trigger a browser download of decklist.txt.
 * @param {string} text
 * @param {string} [filename]
 */
export function downloadDecklist(text, filename = "decklist.txt") {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
