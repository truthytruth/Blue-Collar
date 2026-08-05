// ==========================================
// SILVER FLIP GAME EVALUATOR
// Ported from the "Silver Flip Game" section of app.py.
// ==========================================

import { stripLinePrefix } from "./shared.js";

// payoutType + ozPerTop drive how standings are displayed. Keying off this
// explicit field (instead of matching on the game's display name) means
// renaming an entry in this table can't silently break the payout math.
export const FLIP_GAME_LIBRARY = {
  "1 OZ Silver Flip (9 Rounds)": {
    rounds: 9, breakeven: 1, progressive: false, payoutType: "standard",
  },
  "2 OZ Silver Flip (18 Rounds)": {
    rounds: 18, breakeven: 2, progressive: false, payoutType: "standard",
  },
  "Blue Collar Jackpot (27 Rounds)": {
    rounds: 27, breakeven: 3, progressive: true, payoutType: "standard",
    jackpotType: "blueCollar",
  },
  "Donkey Jackpot (27 Rounds)": {
    rounds: 27, breakeven: 3, progressive: true, payoutType: "standard",
    jackpotType: "donkey",
  },
  "1g Gold Flip (9 Rounds)": {
    rounds: 9, breakeven: 1, progressive: false, payoutType: "standard",
  },
  "Big Boy 6oz (29 Rounds)": {
    rounds: 29, breakeven: 3, progressive: true, payoutType: "oz", ozPerTop: 2,
    jackpotType: "blueCollar",
  },
  "$50 Kash Flip (19 Rounds)": {
    rounds: 19, breakeven: 2, progressive: false, payoutType: "cash",
  },
  "$100 Kash Flip (38 Rounds)": {
    rounds: 38, breakeven: 4, progressive: true, payoutType: "cash",
    jackpotType: "blueCollar",
  },
};

// Builds the { spot: name } map from the giveaway's entries (spots 1-10),
// falling back to 'Spot N' for anything blank or missing — mirrors the
// Python participant_names loop exactly.
export function buildParticipantNames(entries) {
  const participantNames = new Map();
  for (let idx = 0; idx < 10; idx++) {
    if (idx < entries.length) {
      const cleanName = stripLinePrefix(String(entries[idx]));
      participantNames.set(idx + 1, cleanName || `Spot ${idx + 1}`);
    } else {
      participantNames.set(idx + 1, `Spot ${idx + 1}`);
    }
  }
  return participantNames;
}

// Core round-by-round evaluation: wins per spot, win streaks, and the
// ordered list of round winners (spot number, or null for an empty round).
export function evaluateRounds(roundsHeld, customRounds) {
  const evalRounds = roundsHeld.length < customRounds
    ? roundsHeld
    : roundsHeld.slice(0, customRounds);

  const roundWinners = [];
  const spotWins = new Map(Array.from({ length: 10 }, (_, i) => [i + 1, 0]));
  const consecutiveStreaks = new Map(Array.from({ length: 10 }, (_, i) => [i + 1, 0]));
  const maxStreaks = new Map(Array.from({ length: 10 }, (_, i) => [i + 1, 0]));

  let lastSpot = null;
  for (const rIndices of evalRounds) {
    if (rIndices && rIndices.length) {
      const winningSpot = rIndices[0] + 1;
      roundWinners.push(winningSpot);
      spotWins.set(winningSpot, spotWins.get(winningSpot) + 1);

      if (winningSpot === lastSpot) {
        consecutiveStreaks.set(winningSpot, consecutiveStreaks.get(winningSpot) + 1);
      } else {
        consecutiveStreaks.set(winningSpot, 1);
      }
      lastSpot = winningSpot;

      if (consecutiveStreaks.get(winningSpot) > maxStreaks.get(winningSpot)) {
        maxStreaks.set(winningSpot, consecutiveStreaks.get(winningSpot));
      }
    } else {
      roundWinners.push(null);
    }
  }

  return { evalRounds, roundWinners, spotWins, consecutiveStreaks, maxStreaks };
}

// Converts win counts into +/- standings relative to the breakeven
// threshold. Returns { standings, numericDiffs } both keyed by spot.
export function computeStandings(spotWins, customBreakeven) {
  const standings = new Map();
  const numericDiffs = new Map();
  for (const [spot, wins] of spotWins) {
    const diff = wins - customBreakeven;
    numericDiffs.set(spot, diff);
    if (diff === 0) standings.set(spot, "even");
    else if (diff > 0) standings.set(spot, `+${diff}`);
    else standings.set(spot, `${diff}`);
  }
  return { standings, numericDiffs };
}

// Jackpot detection: Main (streak >=4 or >=10 total wins) voids Minor/Mini
// in the same game (an if/elif in the Python — Main is checked first and
// short-circuits the rest). Minor is "same spot wins round 1 and round 27".
// Mini is ">=7 total wins". Returns everything needed for both the
// Facebook text and the spreadsheet row.
export function detectJackpot(customProgressive, evalRounds, maxStreaks, spotWins, roundWinners, participantNames) {
  const result = {
    message: "",
    sheetLabel: "None",
    winnerText: "",
  };

  if (!(customProgressive && evalRounds.length >= 27)) return result;

  const mainHits = [];
  for (const [spot, maxS] of maxStreaks) {
    if (maxS >= 4 || spotWins.get(spot) >= 10) mainHits.push(participantNames.get(spot));
  }

  const minorHits = [];
  if (
    roundWinners.length >= 27 &&
    roundWinners[0] !== null &&
    roundWinners[0] === roundWinners[26]
  ) {
    minorHits.push(participantNames.get(roundWinners[0]));
  }

  const miniHits = [];
  for (const [spot, wins] of spotWins) {
    if (wins >= 7) miniHits.push(participantNames.get(spot));
  }

  if (mainHits.length) {
    result.sheetLabel = "Major";
    result.winnerText = mainHits.join(", ");
    result.message = `🔥🔥 MAIN JACKPOT HIT BY PLAYER(S): ${mainHits.join(", ")}! 🔥🔥\n`;
  } else if (minorHits.length || miniHits.length) {
    const labelParts = [];
    if (minorHits.length) labelParts.push("Minor");
    if (miniHits.length) labelParts.push("Mini");
    result.sheetLabel = labelParts.join(" & ");

    const winnerParts = [...minorHits, ...miniHits];
    result.winnerText = [...new Set(winnerParts)].join(", ");

    const subHits = [];
    if (minorHits.length) subHits.push("Minor Jackpot");
    if (miniHits.length) subHits.push("Mini Jackpot");
    result.message = `💎 ${subHits.join(" & ").toUpperCase()} TRIGGERED! 💎\n`;

    const detailParts = [];
    if (minorHits.length) detailParts.push(`Minor: ${minorHits.join(", ")}`);
    if (miniHits.length) detailParts.push(`Mini: ${miniHits.join(", ")}`);
    result.message += detailParts.join("  |  ") + "\n";
  }

  return result;
}

// Builds a map of spot -> array of streak lengths, one entry per separate
// maximal run of consecutive wins that spot had anywhere in the round
// sequence. Unlike maxStreaks (which only tracks each spot's single
// longest streak), this preserves every distinct streak — needed for
// Donkey Jackpot's "two separate 3-in-a-row streaks" trigger.
function computeStreakSegments(roundWinners) {
  const segments = new Map();
  let currentSpot = null;
  let currentLen = 0;

  function flush() {
    if (currentSpot !== null && currentLen > 0) {
      if (!segments.has(currentSpot)) segments.set(currentSpot, []);
      segments.get(currentSpot).push(currentLen);
    }
  }

  for (const winner of roundWinners) {
    if (winner !== null && winner === currentSpot) {
      currentLen += 1;
    } else {
      flush();
      currentSpot = winner;
      currentLen = winner !== null ? 1 : 0;
    }
  }
  flush();
  return segments;
}

// Donkey Jackpot: 27 rounds, breakeven 3. One flat jackpot (no Major/
// Minor/Mini tiers) — any of three independent triggers wins it, shared
// if more than one spot qualifies:
//
// 1. The same spot gets two separate, NON-OVERLAPPING streaks of 3+
//    consecutive wins anywhere in the run. Implemented by splitting each
//    of a spot's streaks into as many non-overlapping 3-round chunks as
//    fit (floor(streak_length / 3)) and summing across all of that
//    spot's streaks — so a single streak of 6 counts as two chunks (two
//    back-to-back 3s), but a single streak of 4 or 5 only yields one
//    chunk and does NOT satisfy this trigger on its own.
// 2. The same spot wins 4+ rounds in a row, anywhere in the run.
// 3. The same spot wins at least 4 of the last 7 rounds, AND wins the
//    very last round of the run.
export function detectDonkeyJackpot(customProgressive, evalRounds, roundWinners, spotWins, maxStreaks, participantNames) {
  const result = { message: "", sheetLabel: "None", winnerText: "" };
  if (!(customProgressive && evalRounds.length >= 27)) return result;

  const hitDetails = new Map(); // spot -> array of trigger description strings

  function recordHit(spot, description) {
    if (!hitDetails.has(spot)) hitDetails.set(spot, []);
    if (!hitDetails.get(spot).includes(description)) {
      hitDetails.get(spot).push(description);
    }
  }

  // Trigger 1: two separate, non-overlapping 3+ streaks by the same spot.
  const segments = computeStreakSegments(roundWinners);
  for (const [spot, lengths] of segments) {
    const chunkCount = lengths.reduce((sum, len) => sum + Math.floor(len / 3), 0);
    if (chunkCount >= 2) {
      recordHit(spot, "3-in-a-row twice");
    }
  }

  // Trigger 2: a single streak of 4+, anywhere in the run.
  for (const [spot, maxS] of maxStreaks) {
    if (maxS >= 4) {
      recordHit(spot, "4-in-a-row");
    }
  }

  // Trigger 3: 4+ wins in the last 7 rounds, including the last round.
  if (roundWinners.length >= 7) {
    const last7 = roundWinners.slice(-7);
    const lastRoundWinner = roundWinners[roundWinners.length - 1];
    if (lastRoundWinner !== null) {
      const winsInLast7 = last7.filter((w) => w === lastRoundWinner).length;
      if (winsInLast7 >= 4) {
        recordHit(lastRoundWinner, "4 of last 7 (incl. last round)");
      }
    }
  }

  if (hitDetails.size === 0) return result;

  const winnerNames = [...hitDetails.keys()].map((spot) => participantNames.get(spot));
  result.sheetLabel = "Donkey Jackpot";
  result.winnerText = winnerNames.join(", ");
  result.message = `🐴🔥 DONKEY JACKPOT HIT BY PLAYER(S): ${winnerNames.join(", ")}! 🔥🐴\n`;

  const detailParts = [...hitDetails.entries()].map(
    ([spot, descriptions]) => `${participantNames.get(spot)}: ${descriptions.join(" & ")}`
  );
  result.message += detailParts.join("  |  ") + "\n";

  return result;
}

function formatStandingLine(spot, name, standingStr, diff, cfg, cashValuePerPoint) {
  if (cfg.payoutType === "cash") {
    const dollarAmount = diff * cashValuePerPoint;
    let moneyStr;
    if (dollarAmount > 0) moneyStr = `+$${Math.abs(dollarAmount).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    else if (dollarAmount < 0) moneyStr = `-$${Math.abs(dollarAmount).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    else moneyStr = "$0";
    return `${spot}. ${name} (${standingStr} / ${moneyStr})\n`;
  }
  if (cfg.payoutType === "oz") {
    const ozAmount = diff * (cfg.ozPerTop ?? 1);
    let ozStr;
    if (ozAmount > 0) ozStr = `+${ozAmount} oz`;
    else if (ozAmount < 0) ozStr = `${ozAmount} oz`;
    else ozStr = "0 oz";
    return `${spot}. ${name} (${ozStr})\n`;
  }
  return `${spot}. ${name} (${standingStr})\n`;
}

// Builds the Facebook post text, matching the Python fb_flip_text format.
export function buildFlipFacebookText(selectedGameName, jackpotMessage, participantNames, standings, numericDiffs, cfg, cashValuePerPoint) {
  let text = `🪙 BC Flip Results (${selectedGameName}) 🪙\n\n`;
  if (jackpotMessage) text += jackpotMessage + "\n";
  text += "🎯 FINAL STANDINGS:\n";
  for (let spot = 1; spot <= 10; spot++) {
    text += formatStandingLine(
      spot, participantNames.get(spot), standings.get(spot),
      numericDiffs.get(spot), cfg, cashValuePerPoint
    );
  }
  return text;
}

// Builds the tab-separated spreadsheet row, matching the Python sheet_text
// format: Date | Game # | Current Jackpot (oz) | Jackpot Hit? | Jackpot
// winner | then Player Name/Result pairs for seats 1-10. Game # and
// jackpot amount are left blank for the admin to fill in by hand.
export function buildFlipSheetRow(todayStr, jackpotResult, participantNames, standings) {
  const cols = [todayStr, "", "", jackpotResult.sheetLabel, jackpotResult.winnerText];
  for (let spot = 1; spot <= 10; spot++) {
    cols.push(participantNames.get(spot));
    cols.push(standings.get(spot));
  }
  return cols.join("\t");
}
