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
 * Copy decklist text to the clipboard.
 * @param {string} text
 */
export async function copyDecklist(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Fallback for older browsers / non-secure contexts
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}
