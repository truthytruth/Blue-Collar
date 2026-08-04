// ==========================================
// SHARED HELPERS
// Ported from app.py — logic should match 1:1. Any deviation here is a bug.
// ==========================================

// Random.org's giveaway API doesn't send CORS headers permitting direct
// browser access (confirmed via live browser testing — the raw fetch call
// fails with a CORS error every time). RELAY_URL points at a small
// Cloudflare Worker that forwards the request server-to-server (no CORS
// restriction between two servers) and hands the response back with the
// headers a browser needs to accept it. Update this after deploying the
// Worker — see relay-worker.js for the Worker's own code.
const RELAY_URL = "https://bc-relay.truthytruth.workers.dev";

export function extractGiveawayKey(linkOrCode) {
  const codeInput = linkOrCode.trim();
  if (codeInput.includes("giveaways.random.org/verify/")) {
    const afterVerify = codeInput.split("verify/").pop();
    return afterVerify.replace(/\/+$/, "").split("?")[0];
  }
  return codeInput;
}

// Calls the Random.org giveaway API (via the relay). Returns
// { result, error } — exactly one of the two is null.
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
    response = await fetch(RELAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return { result: null, error: `Network error contacting the relay: ${e.message}` };
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
  2: "2", 3: "3", 4: "4", 5: "5", 6: "6",
