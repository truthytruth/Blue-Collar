// ==========================================
// NUMBERS DRAW (KENO-STYLE)
// Ported from the "Numbers Draw" section of app.py.
// ==========================================

export const KENO_NUM_SEATS = 10;
export const KENO_NUMS_PER_SEAT = 5;
export const KENO_POOL_SIZE = 50;
export const KENO_DRAWN_COUNT = 15;

// Validates parsed seat claims (from parseSeatClaims in shared.js) against
// the Keno rules: every seat needs exactly KENO_NUMS_PER_SEAT numbers, all
// within 1-KENO_POOL_SIZE, and no number claimed by more than one seat.
// Returns { seatNumbers, errors } — seatNumbers is a Map(seatNum -> number[])
// only populated when there are zero errors, mirroring the Python flow
// where results are never shown until every claim parses cleanly.
export function validateKenoClaims(nameMap, numbersMap, claimLines) {
  const seatNumbers = new Map();
  const errors = [];

  function displayName(seatNum) {
    return nameMap.get(seatNum) || `Seat ${seatNum}`;
  }

  for (let seatI = 1; seatI <= KENO_NUM_SEATS; seatI++) {
    const nums = numbersMap.get(seatI) || [];
    if (nums.length !== KENO_NUMS_PER_SEAT) {
      errors.push(
        `${displayName(seatI)}: expected ${KENO_NUMS_PER_SEAT} numbers, found ` +
        `${nums.length} (from: '${claimLines[seatI - 1] ?? ""}')`
      );
      continue;
    }
    const outOfRange = nums.filter((n) => n < 1 || n > KENO_POOL_SIZE);
    if (outOfRange.length) {
      errors.push(
        `${displayName(seatI)}: number(s) ${JSON.stringify(outOfRange)} are ` +
        `outside the 1-${KENO_POOL_SIZE} pool.`
      );
      continue;
    }
    seatNumbers.set(seatI, nums);
  }

  const allClaimed = [...seatNumbers.values()].flat();
  const seenCounts = new Map();
  for (const n of allClaimed) seenCounts.set(n, (seenCounts.get(n) || 0) + 1);
  const duplicates = [...seenCounts.entries()]
    .filter(([, c]) => c > 1)
    .map(([n]) => n)
    .sort((a, b) => a - b);
  if (duplicates.length) {
    errors.push(
      `Number(s) claimed by more than one seat: ${JSON.stringify(duplicates)}. ` +
      "Each number must belong to exactly one seat — fix the claims before " +
      "calculating."
    );
  }

  return { seatNumbers: errors.length ? new Map() : seatNumbers, errors };
}

// Parses the final round's raw entries into numbers, in draw order. Throws
// a plain Error (with the offending entry) on the first unparseable entry,
// mirroring the Python behavior of refusing to show partial/corrupt results.
export function parseFinalRoundNumbers(finalRoundRawEntries) {
  const numbers = [];
  for (const raw of finalRoundRawEntries) {
    const match = String(raw).match(/\d+/);
    if (!match) {
      throw new Error(`Couldn't parse a number from entry: '${raw}'`);
    }
    numbers.push(Number(match[0]));
  }
  return numbers;
}

// Computes per-seat match results and the winner (with earliest-draw-
// position tiebreak) from validated seat claims + the drawn numbers.
export function computeKenoResults(seatNumbers, nameMap, drawnNumbers) {
  const drawPosition = new Map();
  drawnNumbers.forEach((num, i) => drawPosition.set(num, i + 1));

  function displayName(seatNum) {
    return nameMap.get(seatNum) || `Seat ${seatNum}`;
  }

  const seatResults = new Map();
  for (let seatI = 1; seatI <= KENO_NUM_SEATS; seatI++) {
    const nums = seatNumbers.get(seatI);
    const matched = nums
      .filter((n) => drawPosition.has(n))
      .sort((a, b) => drawPosition.get(a) - drawPosition.get(b));
    seatResults.set(seatI, {
      numbers: nums,
      matched,
      matchCount: matched.length,
      earliestPosition: matched.length ? drawPosition.get(matched[0]) : null,
    });
  }

  const ranked = [...seatResults.entries()].sort((a, b) => {
    const [, da] = a;
    const [, db] = b;
    if (db.matchCount !== da.matchCount) return db.matchCount - da.matchCount;
    const epa = da.earliestPosition ?? KENO_DRAWN_COUNT + 1;
    const epb = db.earliestPosition ?? KENO_DRAWN_COUNT + 1;
    return epa - epb;
  });
  const [winnerSeat, winnerData] = ranked[0];

  return { seatResults, winnerSeat, winnerData, displayName };
}

// Builds the Facebook post text, matching the Python fb_text2 format
// exactly.
export function buildKenoFacebookText(seatResults, winnerSeat, winnerData, drawnNumbers, displayName) {
  let text = "🎯 BC Numbers Draw Results 🎯\n\n";
  let matchLabel = `${winnerData.matchCount}/${KENO_NUMS_PER_SEAT} Match`;
  if (winnerData.matchCount === KENO_NUMS_PER_SEAT) matchLabel += " — Perfect Card! 🔥";
  text += `🥇 ${displayName(winnerSeat)} — ${matchLabel}\n`;
  text += `Numbers: ${winnerData.numbers.join(", ")}\n`;
  text += `Matched: ${winnerData.matched.length ? winnerData.matched.join(", ") : "None"}\n\n`;
  text += `🎱 Drawn Numbers (in order): ${drawnNumbers.join(", ")}\n`;
  text += "\n📋 All Seats:\n\n";

  const seatLines = [];
  for (let seatI = 1; seatI <= KENO_NUM_SEATS; seatI++) {
    const data = seatResults.get(seatI);
    const matchedStr = data.matched.length ? data.matched.join(", ") : "none";
    seatLines.push(
      `${displayName(seatI)}: ${data.numbers.join(", ")} → ` +
      `${data.matchCount}/${KENO_NUMS_PER_SEAT} matches (${matchedStr})`
    );
  }
  text += seatLines.join("\n\n");
  return text;
}
