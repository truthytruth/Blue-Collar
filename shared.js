// ==========================================
// SHARED HELPERS
// Ported from app.py — logic should match 1:1. Any deviation here is a bug.
// ==========================================

const RANDOM_ORG_API_URL = "https://giveaways.random.org/api/json-rpc/2/invoke";

export function extractGiveawayKey(linkOrCode) {
  const codeInput = linkOrCode.trim();
  if (codeInput.includes("giveaways.random.org/verify/")) {
    const afterVerify = codeInput.split("verify/").pop();
    return afterVerify.replace(/\/+$/, "").split("?")[0];
  }
  return codeInput;
}

// Calls the Random.org giveaway API. Returns { result, error } — exactly
// one of the two is null. NOTE: this is a direct browser-to-Random.org
// fetch call. If Random.org's API doesn't send CORS headers permitting
// browser access, this call will fail with a CORS error that can't be
// worked around from client-side JS alone — flagged for live testing
// before this ships, since it can't be verified in a sandboxed environment.
export async function fetchGiveaway(linkOrCode) {
  const giveawayKey = extractGiveawayKey(linkOrCode);
  const payload = {
    jsonrpc: "2.0",
    method: "getGiveaway",
    params: { giveawayKey },
    id: 1,
  };

  let response;
  try {
    response = await fetch(RANDOM_ORG_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return { result: null, error: `Network error contacting Random.org: ${e.message}` };
  }

  if (!response.ok) {
    return { result: null, error: `Failed to reach API. HTTP Status: ${response.status}` };
  }

  let data;
  try {
    data = await response.json();
  } catch (e) {
    return { result: null, error: "API returned a response that wasn't valid JSON." };
  }

  if (!("result" in data)) {
    const errMsg = data.error?.message || "Unknown API error";
    return { result: null, error: `API Error: ${errMsg}` };
  }

  return { result: data.result, error: null };
}

// --- Card parsing constants ---
export const RANKS = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
  "10": 10, "T": 10, "J": 11, "Q": 12, "K": 13, "A": 14,
};
export const RANK_NAMES = {
  2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9",
  10: "10", 11: "J", 12: "Q", 13: "K", 14: "A",
};
export const RANK_WORD = {
  2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six", 7: "Seven",
  8: "Eight", 9: "Nine", 10: "Ten", 11: "Jack", 12: "Queen", 13: "King",
  14: "Ace",
};
export const RANK_PLURAL = {
  2: "Twos", 3: "Threes", 4: "Fours", 5: "Fives", 6: "Sixes",
  7: "Sevens", 8: "Eights", 9: "Nines", 10: "Tens", 11: "Jacks",
  12: "Queens", 13: "Kings", 14: "Aces",
};
export const SUIT_EMOJI = { s: "♠️", c: "♣️", h: "♥️", d: "♦️" };

export class CardParseError extends Error {}

export function stripLinePrefix(cardStr) {
  return cardStr.replace(/^\d+[.\-]\s*/, "").trim();
}

// Matches a leading keycap-number emoji, e.g. the "1️⃣" in "1️⃣ Kevin James",
// or the standalone "🔟" keycap used for ten. Keycap emoji 1-9 are digit(s)
// + optional U+FE0F (variation selector) + U+20E3 (combining enclosing
// keycap) — matching this specific sequence means other emoji in a name
// (e.g. a lion emoji) are left untouched. "🔟" is its own single codepoint.
const SEAT_NUM_EMOJI_RE = /^\s*(?:[0-9]+\uFE0F?\u20E3|\u{1F51F})\s*/u;
// Matches one or more trailing "✅" checkmarks (with optional variation
// selector) and surrounding whitespace.
const TRAILING_CHECK_RE = /(\s*✅\uFE0F?)+\s*$/u;

// Parses pasted lines like '1️⃣ Kevin James ✅' (one per seat, in seat
// order) into a Map of {seatNumber: displayName}. Returns an empty Map
// if rawText is blank, so callers can fall back to 'Seat N'.
export function parseSeatNames(rawText, maxSeats = 8) {
  const names = new Map();
  if (!rawText || !rawText.trim()) return names;
  const lines = rawText.trim().split("\n").filter((l) => l.trim());
  lines.slice(0, maxSeats).forEach((line, i) => {
    let cleaned = line.replace(SEAT_NUM_EMOJI_RE, "");
    cleaned = cleaned.replace(TRAILING_CHECK_RE, "").trim();
    if (cleaned) names.set(i + 1, cleaned);
  });
  return names;
}

// Parses combined 'name: numbers' lines like '1️⃣ Kevin James: 3, 12, 19,
// 27, 44' (one per seat, in seat order) into { nameMap, numbersMap } (both
// Maps keyed by seat number). A line with no colon is numbers-only (name
// falls back to 'Seat N'). Returns empty Maps if rawText is blank.
export function parseSeatClaims(rawText, maxSeats) {
  const nameMap = new Map();
  const numbersMap = new Map();
  if (!rawText || !rawText.trim()) return { nameMap, numbersMap };
  const lines = rawText.trim().split("\n").filter((l) => l.trim());
  lines.slice(0, maxSeats).forEach((line, i) => {
    const cleaned = line.replace(SEAT_NUM_EMOJI_RE, "");
    let namePart = "";
    let numbersPart = cleaned;
    if (cleaned.includes(":")) {
      const idx = cleaned.indexOf(":");
      namePart = cleaned.slice(0, idx);
      numbersPart = cleaned.slice(idx + 1);
    }
    namePart = namePart.replace(TRAILING_CHECK_RE, "").trim();
    if (namePart) nameMap.set(i + 1, namePart);
    const nums = (numbersPart.match(/\d+/g) || []).map(Number);
    numbersMap.set(i + 1, nums);
  });
  return { nameMap, numbersMap };
}

function parseSuit(rawSuit, originalStr) {
  const s = rawSuit.toLowerCase();
  if (s.includes("♠") || s.includes("s")) return "s";
  if (s.includes("♣") || s.includes("c")) return "c";
  if (s.includes("♥") || s.includes("h")) return "h";
  if (s.includes("♦") || s.includes("d")) return "d";
  throw new CardParseError(`Could not determine suit from card: '${originalStr}'`);
}

// Parses a card string into { rank, suit }. Throws CardParseError on
// anything that can't be confidently parsed, rather than silently
// defaulting to a value that could skew results.
export function parseCard(cardStrRaw) {
  const original = cardStrRaw;
  const cardStr = stripLinePrefix(cardStrRaw);
  if (!cardStr) throw new CardParseError(`Empty card entry (from line: '${original}')`);

  let rankStr, rawSuit;
  if (cardStr.toUpperCase().startsWith("10")) {
    rankStr = "10";
    rawSuit = cardStr.slice(2);
  } else {
    rankStr = cardStr[0].toUpperCase();
    rawSuit = cardStr.slice(1);
  }

  if (!(rankStr in RANKS)) {
    throw new CardParseError(`Unrecognized rank in card: '${original}'`);
  }
  const rank = RANKS[rankStr];
  const suit = parseSuit(rawSuit, original);
  return { rank, suit };
}

export function cardToCruncherFormat(cardStr) {
  const { rank, suit } = parseCard(cardStr);
  const rankStr = rank === 10 ? "T" : RANK_NAMES[rank];
  return `${rankStr}${suit}`;
}

export function cardToDisplay(rank, suit) {
  return `${RANK_NAMES[rank]}${SUIT_EMOJI[suit]}`;
}

export function cardToNotation(rank, suit) {
  return `${RANK_NAMES[rank]}${suit}`;
}

export const HAND_RANK_NAMES = {
  9: "Royal Flush", 8: "Straight Flush", 7: "Four of a Kind",
  6: "Full House", 5: "Flush", 4: "Straight", 3: "Three of a Kind",
  2: "Two Pair", 1: "One Pair", 0: "High Card",
};

// Turns a { rankClass, kickers } score into a descriptive label, e.g.
// 'One Pair (Jacks)', 'Full House (Aces over Kings)', 'Flush (Ace High)'.
export function describeHand(score) {
  const { rankClass, kickers } = score;
  if (rankClass === 9) return "Royal Flush";
  if (rankClass === 8) return `Straight Flush (${RANK_WORD[kickers[0]]} High)`;
  if (rankClass === 7) return `Four of a Kind (${RANK_PLURAL[kickers[0]]})`;
  if (rankClass === 6) return `Full House (${RANK_PLURAL[kickers[0]]} over ${RANK_PLURAL[kickers[1]]})`;
  if (rankClass === 5) return `Flush (${RANK_WORD[kickers[0]]} High)`;
  if (rankClass === 4) return `Straight (${RANK_WORD[kickers[0]]} High)`;
  if (rankClass === 3) return `Three of a Kind (${RANK_PLURAL[kickers[0]]})`;
  if (rankClass === 2) return `Two Pair (${RANK_PLURAL[kickers[0]]} and ${RANK_PLURAL[kickers[1]]})`;
  if (rankClass === 1) return `One Pair (${RANK_PLURAL[kickers[0]]})`;
  return `High Card (${RANK_WORD[kickers[0]]} High)`;
}

// Compares two [rankClass, kickers] scores the way Python tuple comparison
// does: rankClass first, then kickers element-by-element. Returns
// positive if a > b, negative if a < b, 0 if equal.
function compareScores(a, b) {
  if (a.rankClass !== b.rankClass) return a.rankClass - b.rankClass;
  const len = Math.max(a.kickers.length, b.kickers.length);
  for (let i = 0; i < len; i++) {
    const av = a.kickers[i] ?? -1;
    const bv = b.kickers[i] ?? -1;
    if (av !== bv) return av - bv;
  }
  return 0;
}

export function evaluate5CardHand(cards) {
  const sorted = [...cards].sort((a, b) => b.rank - a.rank);
  let ranks = sorted.map((c) => c.rank);
  const suits = sorted.map((c) => c.suit);
  const isFlush = new Set(suits).size === 1;

  let isStraight = false;
  let straightHigh = 0;
  const uniqueRanks = [...new Set(ranks)].sort((a, b) => b - a);
  if (uniqueRanks.length >= 5) {
    for (let i = 0; i <= uniqueRanks.length - 5; i++) {
      const window = uniqueRanks.slice(i, i + 5);
      if (window[0] - window[4] === 4 && window.length === 5) {
        isStraight = true;
        straightHigh = window[0];
        break;
      }
    }
    if (!isStraight && [14, 5, 4, 3, 2].every((r) => ranks.includes(r))) {
      isStraight = true;
      straightHigh = 5;
      ranks = [5, 4, 3, 2, 14];
    }
  }

  const rankCounts = new Map();
  for (const r of ranks) rankCounts.set(r, (rankCounts.get(r) || 0) + 1);
  const sortedCounts = [...rankCounts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0] - a[0];
  });
  const countsPattern = sortedCounts.map(([, count]) => count);

  if (isStraight && isFlush) {
    return straightHigh === 14
      ? { rankClass: 9, kickers: [14] }
      : { rankClass: 8, kickers: [straightHigh] };
  }
  if (arraysEqual(countsPattern, [4, 1])) {
    return { rankClass: 7, kickers: [sortedCounts[0][0], sortedCounts[1][0]] };
  }
  if (arraysEqual(countsPattern, [3, 2])) {
    return { rankClass: 6, kickers: [sortedCounts[0][0], sortedCounts[1][0]] };
  }
  if (isFlush) return { rankClass: 5, kickers: ranks };
  if (isStraight) return { rankClass: 4, kickers: [straightHigh] };
  if (arraysEqual(countsPattern, [3, 1, 1])) {
    return {
      rankClass: 3,
      kickers: [sortedCounts[0][0], sortedCounts[1][0], sortedCounts[2][0]],
    };
  }
  if (arraysEqual(countsPattern, [2, 2, 1])) {
    return {
      rankClass: 2,
      kickers: [sortedCounts[0][0], sortedCounts[1][0], sortedCounts[2][0]],
    };
  }
  if (arraysEqual(countsPattern, [2, 1, 1, 1])) {
    return {
      rankClass: 1,
      kickers: [
        sortedCounts[0][0], sortedCounts[1][0],
        sortedCounts[2][0], sortedCounts[3][0],
      ],
    };
  }
  return { rankClass: 0, kickers: ranks };
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function* combinations(arr, k) {
  const n = arr.length;
  if (k > n) return;
  const indices = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield indices.map((i) => arr[i]);
    let i = k - 1;
    while (i >= 0 && indices[i] === i + n - k) i--;
    if (i < 0) return;
    indices[i]++;
    for (let j = i + 1; j < k; j++) indices[j] = indices[j - 1] + 1;
  }
}

export function getBestHandDetails(allCards) {
  let bestScore = { rankClass: -1, kickers: [] };
  let bestCombo = [];
  for (const combo of combinations(allCards, 5)) {
    const score = evaluate5CardHand(combo);
    if (compareScores(score, bestScore) > 0) {
      bestScore = score;
      bestCombo = combo;
    }
  }
  return { score: bestScore, combo: bestCombo };
}

export { compareScores };
