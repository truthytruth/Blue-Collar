// ==========================================
// TEXAS HOLD'EM CALCULATOR
// Ported from the "Texas Hold'em Calculator" section of app.py.
// ==========================================

import {
  parseCard, CardParseError, cardToDisplay, cardToCruncherFormat,
  cardToNotation, describeHand, getBestHandDetails, compareScores,
  stripLinePrefix,
} from "./shared.js";

// Splits the 52-line card list into 8 players' hole cards (2 each) and the
// 5-card board, matching the Python protocol exactly: lines 0-15 are hole
// cards, and the LAST 5 lines of the 52-line block are the board.
export function splitCardLines(lines) {
  if (lines.length < 52) {
    throw new CardParseError(
      `Error: Input contains fewer than 52 lines (found ${lines.length}).`
    );
  }
  const cardLines = lines.slice(-52);
  const playersData = new Map();
  let currentLine = 0;
  for (let p = 1; p <= 8; p++) {
    playersData.set(`Seat ${p}`, [cardLines[currentLine], cardLines[currentLine + 1]]);
    currentLine += 2;
  }
  const boardInput = cardLines.slice(47, 52);
  return { cardLines, playersData, boardInput };
}

function cardKey(c) { return `${c.rank}${c.suit}`; }

// Parses the board + all 8 hands, checks deck integrity (no duplicate
// cards across all 52 lines), and computes each seat's best hand. Throws
// CardParseError on any parse failure or duplicate — results are never
// partial.
export function computePokerResults(cardLines, playersData, boardInput) {
  const boardParsed = boardInput.map(parseCard);

  const allDeckCards = cardLines.map(parseCard);
  const seen = new Map();
  for (const c of allDeckCards) {
    const k = cardKey(c);
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  const duplicates = [...seen.entries()]
    .filter(([, count]) => count > 1)
    .map(([k]) => allDeckCards.find((c) => cardKey(c) === k));
  if (duplicates.length) {
    const dupStr = duplicates.map((c) => cardToDisplay(c.rank, c.suit)).join(", ");
    throw new CardParseError(
      `Duplicate card(s) found in the deck data: ${dupStr}. This usually ` +
      "means the giveaway data is corrupted or wasn't a full unique deck " +
      "— results are not shown until this is resolved."
    );
  }

  const playerResults = new Map();
  for (const [name, holdInput] of playersData) {
    const holdParsed = holdInput.map(parseCard);
    const { score, combo } = getBestHandDetails([...holdParsed, ...boardParsed]);
    const bestComboSorted = [...combo].sort((a, b) => b.rank - a.rank);
    playerResults.set(name, {
      hold: holdInput,
      holdParsed,
      score,
      handType: describeHand(score),
      bestComboRaw: bestComboSorted,
    });
  }

  let bestScore = null;
  let winners = [];
  for (const [name, data] of playerResults) {
    if (bestScore === null || compareScores(data.score, bestScore) > 0) {
      bestScore = data.score;
      winners = [name];
    } else if (compareScores(data.score, bestScore) === 0) {
      winners.push(name);
    }
  }

  return { boardParsed, playerResults, winners };
}

// Builds the Facebook post text, matching the Python fb_text format:
// winner banner, hole cards in seat order, board, then hands (with the
// 5-card combo) in seat order.
export function buildPokerFacebookText(playersData, playerResults, winners, boardParsed, seatDisplayName) {
  const w = playerResults.get(winners[0]);
  let text = "🏆 BC Hold'em Results 🏆\n\n";
  if (winners.length > 1) {
    text += `🤝 Tied Pot (${winners.length}-Way Chop) — ${w.handType}\n`;
    text += `Winners: ${winners.map(seatDisplayName).join(", ")}\n\n`;
  } else {
    text += `🥇 ${seatDisplayName(winners[0])} — ${w.handType}\n\n`;
  }

  text += "🂠 HOLE CARDS (Seat Order):\n";
  let seatI = 1;
  for (const name of playersData.keys()) {
    const data = playerResults.get(name);
    const holeStr = data.holdParsed.map((c) => cardToDisplay(c.rank, c.suit)).join(" ");
    text += `${seatI}. ${seatDisplayName(name)} — ${holeStr}\n`;
    seatI++;
  }

  const boardDisplay = boardParsed.map((c) => cardToDisplay(c.rank, c.suit)).join(" ");
  text += `\nBoard: ${boardDisplay}\n`;

  text += "\n📋 HANDS (Seat Order):\n\n";
  const handLines = [];
  seatI = 1;
  for (const name of playersData.keys()) {
    const data = playerResults.get(name);
    const bestStr = data.bestComboRaw.map((c) => cardToDisplay(c.rank, c.suit)).join(" ");
    handLines.push(`${seatI}. ${seatDisplayName(name)} — ${data.handType} (${bestStr})`);
    seatI++;
  }
  text += handLines.join("\n\n") + "\n";

  return text;
}

export function buildPokerCruncherText(playersData, boardInput) {
  let text = "PokerCruncher-Advanced-iPhone V.17.1.2\n\n";
  let seatI = 1;
  for (const [, holdInput] of playersData) {
    const c1 = cardToCruncherFormat(holdInput[0]);
    const c2 = cardToCruncherFormat(holdInput[1]);
    text += `Player ${seatI}:  [${c1}${c2}]\n`;
    seatI++;
  }
  const cruncherBoard = boardInput.map(cardToCruncherFormat).join(" ");
  text += `\nBoard:  [${cruncherBoard}]\n`;
  text += "Deal To:  River\n";
  text += "Dead Cards:  {}\n\nNotes:";
  return text;
}

// Builds the tab-separated spreadsheet row: Date | Game # | Pot | Winning
// Hand | Winner | Player 1..8 | Community.
export function buildPokerSheetRow(todayStr, gameNumber, potValue, playerResults, winners, boardParsed, seatDisplayName) {
  const w = playerResults.get(winners[0]);
  const winnerText = winners.map(seatDisplayName).join(", ");
  const communityStr = boardParsed.map((c) => cardToNotation(c.rank, c.suit)).join(" ");
  const seatColumns = [];
  for (let i = 1; i <= 8; i++) {
    const data = playerResults.get(`Seat ${i}`);
    seatColumns.push(data.holdParsed.map((c) => cardToNotation(c.rank, c.suit)).join(" "));
  }
  return [todayStr, gameNumber, potValue, w.handType, winnerText, ...seatColumns, communityStr].join("\t");
}
