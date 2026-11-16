export function taggedImapStatus(line: string, tag: string): string | null {
  const space = line.indexOf(" ");
  if (space < 0 || line.slice(0, space) !== tag) return null;
  return line.slice(space + 1).match(/^(OK|NO|BAD)(?:[ \t]|$)/i)?.[1]
    .toUpperCase() ?? "BAD";
}
