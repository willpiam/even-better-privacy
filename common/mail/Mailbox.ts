/** Split only outside quoted names, comments and angle addresses. */
export function splitMailboxList(text: string): string[] {
  const result: string[] = [];
  let start = 0, quoted = false, escaped = false, angle = 0, comment = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && (quoted || comment)) {
      escaped = true;
      continue;
    }
    if (character === '"' && !comment) {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (character === "(") comment++;
    else if (character === ")" && comment) comment--;
    if (comment) continue;
    if (character === "<") angle++;
    else if (character === ">" && angle) angle--;
    if (!angle && /[,;\r\n]/.test(character)) {
      result.push(text.slice(start, index));
      start = index + 1;
    }
  }
  result.push(text.slice(start));
  return result;
}

export function formatMailbox(name: string, email: string): string {
  if (/[\r\n\x00-\x1f\x7f]/.test(name + email) || /[<>]/.test(email)) {
    throw new Error("Invalid mailbox header");
  }
  const display = name.trim();
  if (!display) return email;
  const encoded = /[()<>@,;:\\".\[\]]/.test(display)
    ? `"${display.replace(/[\\"]/g, "\\$&")}"`
    : display;
  return `${encoded} <${email}>`;
}
