export type HdProfile = "dilithium" | "sphincs";
export type HdChange = "external" | "internal";

export const EBP_HD_VERSION = "ebp-hd-v1";
export const EBP_HD_PURPOSE_INDEX = 0x454250; // "EBP", safely below 2^31.
export const HARDENED_OFFSET = 0x80000000;

export type HdPathSegment = {
  label: string;
  index: number;
  hardened: boolean;
};

export type HdPath = {
  path: string;
  segments: HdPathSegment[];
  profile?: HdProfile;
  account?: number;
  change?: HdChange;
  index?: number;
};

const PROFILE_INDEX: Record<HdProfile, number> = {
  dilithium: 0,
  sphincs: 1,
};

const INDEX_PROFILE: Record<number, HdProfile> = {
  0: "dilithium",
  1: "sphincs",
};

export function profileToIndex(profile: HdProfile): number {
  return PROFILE_INDEX[profile];
}

export function changeToIndex(change: HdChange): number {
  return change === "external" ? 0 : 1;
}

export function indexToChange(index: number): HdChange {
  if (index === 0) return "external";
  if (index === 1) return "internal";
  throw new Error("HD change segment must be 0 (external) or 1 (internal)");
}

function parseSegment(token: string, position: number): HdPathSegment {
  const hardened = token.endsWith("'");
  const bare = hardened ? token.slice(0, -1) : token;
  if (position === 0) {
    if (bare !== "ebp") throw new Error("HD path must start with m/ebp'");
    if (!hardened) throw new Error("EBP purpose segment must be hardened");
    return { label: "ebp", index: EBP_HD_PURPOSE_INDEX, hardened };
  }
  if (position === 1 && (bare === "dilithium" || bare === "sphincs")) {
    if (!hardened) throw new Error("HD profile segment must be hardened");
    return { label: bare, index: profileToIndex(bare), hardened };
  }
  if (!/^\d+$/.test(bare)) {
    throw new Error(`invalid HD path segment: ${token}`);
  }
  const index = Number.parseInt(bare, 10);
  if (!Number.isSafeInteger(index) || index < 0 || index >= HARDENED_OFFSET) {
    throw new Error(`HD path segment out of range: ${token}`);
  }
  if (position === 2 && !hardened) {
    throw new Error("HD account segment must be hardened");
  }
  return { label: bare, index, hardened };
}

export function formatHdPath(input: {
  profile: HdProfile;
  account: number;
  change: HdChange;
  index: number;
}): string {
  for (
    const [name, value] of Object.entries({
      account: input.account,
      index: input.index,
    })
  ) {
    if (!Number.isInteger(value) || value < 0 || value >= HARDENED_OFFSET) {
      throw new Error(
        `HD ${name} must be an integer from 0 to ${HARDENED_OFFSET - 1}`,
      );
    }
  }
  return `m/ebp'/${input.profile}'/${input.account}'/${
    changeToIndex(input.change)
  }/${input.index}`;
}

export function parseHdPath(path: string): HdPath {
  const normalized = path.trim();
  if (!normalized.startsWith("m/")) {
    throw new Error("HD path must start with m/");
  }
  const tokens = normalized.slice(2).split("/");
  if (tokens.length !== 5) {
    throw new Error(
      "HD path must have five segments: m/ebp'/profile'/account'/change/index",
    );
  }
  const segments = tokens.map(parseSegment);
  const profile = INDEX_PROFILE[segments[1].index];
  if (!profile) {
    throw new Error("HD profile segment must be dilithium' or sphincs'");
  }
  const change = indexToChange(segments[3].index);
  return {
    path: normalized,
    segments,
    profile,
    account: segments[2].index,
    change,
    index: segments[4].index,
  };
}

export function childIndex(segment: HdPathSegment): number {
  return segment.index + (segment.hardened ? HARDENED_OFFSET : 0);
}
