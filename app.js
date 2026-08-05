import { fetchGiveaway, parseSeatNames, parseSeatClaims, CardParseError } from "./shared.js";
import {
  splitCardLines, computePokerResults, buildPokerFacebookText,
  buildPokerCruncherText, buildPokerSheetRow,
} from "./poker.js";
import {
  KENO_NUM_SEATS, validateKenoClaims, parseFinalRoundNumbers,
  computeKenoResults, buildKenoFacebookText,
} from "./keno.js";
import {
  FLIP_GAME_LIBRARY, buildParticipantNames, evaluateRounds, computeStandings,
  detectJackpot, detectDonkeyJackpot, buildFlipFacebookText, buildFlipSheetRow,
} from "./flip.js";

// ---------- Remove any previously-installed service worker/cache ----------
// This app used to cache itself for offline use. That's been removed —
// every real action needs the Fetch button (which needs internet) anyway,
// so offline caching served no purpose. On devices that installed the old
// version, actively unregister it and clear its cache rather than just
// stopping new registrations, since a stale orphaned service worker is
// exactly what caused the "buttons don't work" / "changes don't show up"
// confusion earlier.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) registration.unregister();
  });
}
if (window.caches) {
  caches.keys().then((keys) => keys.forEach((key) => caches.delete(key)));
}

// ---------- Navigation ----------
const SCREENS = ["menu", "poker", "keno", "flip"];

function navigateTo(name) {
  window.location.hash = name;
}

function renderScreen() {
  const name = (window.location.hash || "#menu").slice(1);
  const target = SCREENS.includes(name) ? name : "menu";
  for (const s of SCREENS) {
    document.getElementById(`screen-${s}`).hidden = s !== target;
  }
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", renderScreen);
document.addEventListener("DOMContentLoaded", () => {
  renderScreen();
  document.querySelectorAll("[data-nav]").forEach((el) => {
    el.addEventListener("click", () => navigateTo(el.dataset.nav));
  });
  initPoker();
  initKeno();
  initFlip();
});

// ---------- Shared render helpers ----------
function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function renderAlert(container, type, message) {
  const div = document.createElement("div");
  div.className = `alert alert-${type}`;
  div.textContent = message;
  container.appendChild(div);
}

function clearAlerts(container) {
  container.innerHTML = "";
}

// Renders a labeled, copyable text block (mirrors st.code + a copy button,
// since there's no native "copy" affordance for a <pre> block).
function renderResultBlock(container, title, text) {
  const block = document.createElement("div");
  block.className = "result-block";

  const h3 = document.createElement("h3");
  h3.textContent = title;
  block.appendChild(h3);

  const box = document.createElement("div");
  box.className = "result-box";

  const copyBtn = document.createElement("button");
  copyBtn.className = "copy-btn";
  copyBtn.textContent = "Copy";
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = "Copied ✓";
      copyBtn.classList.add("copied");
      setTimeout(() => {
        copyBtn.textContent = "Copy";
        copyBtn.classList.remove("copied");
      }, 1500);
    } catch (e) {
      copyBtn.textContent = "Select text manually";
    }
  });
  box.appendChild(copyBtn);

  const pre = document.createElement("pre");
  pre.textContent = text;
  box.appendChild(pre);

  block.appendChild(box);
  container.appendChild(block);
}

function renderDownloadButton(container, filename, contents) {
  const btn = document.createElement("button");
  btn.className = "btn btn-ghost";
  btn.textContent = "⬇️ Download results (.txt)";
  btn.addEventListener("click", () => {
    const blob = new Blob([contents], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  });
  container.appendChild(btn);
}

// ==========================================
// POKER
// ==========================================
function initPoker() {
  const linkInput = document.getElementById("poker-link");
  const cardsInput = document.getElementById("poker-cards");
  const seatNamesInput = document.getElementById("poker-seat-names");
  const gameNumberInput = document.getElementById("poker-game-number");
  const potInput = document.getElementById("poker-pot");
  const alerts = document.getElementById("poker-alerts");
  const results = document.getElementById("poker-results");
  const fetchBtn = document.getElementById("poker-fetch-btn");

  // Holds the FULL fetched card list (all entries from the final round —
  // 52 real cards plus whatever unused filler sits between the hole cards
  // and the board). Computation needs the full list for the deck-integrity
  // check; the visible textarea only shows the 16 hole cards + 5 board
  // cards, since that's the part worth a human double-checking.
  let fetchedCardLines = null;

  fetchBtn.addEventListener("click", async () => {
    clearAlerts(alerts);
    const link = linkInput.value.trim();
    if (!link) {
      renderAlert(alerts, "warn", "Please enter a valid link or code first.");
      return;
    }
    fetchBtn.disabled = true;
    fetchBtn.textContent = "Fetching...";
    const { result, error } = await fetchGiveaway(link);
    fetchBtn.disabled = false;
    fetchBtn.textContent = "Fetch & Calculate from Link";

    if (error) {
      renderAlert(alerts, "error", error);
      return;
    }
    const entries = result.entries || [];
    const roundsHeld = result.roundsHeld || [];
    if (!roundsHeld.length) {
      renderAlert(alerts, "error", "No rounds found in this giveaway record.");
      return;
    }
    const finalRoundIndices = roundsHeld[roundsHeld.length - 1];
    const finalCards = finalRoundIndices.map((i) => String(entries[i]));
    if (finalCards.length < 52) {
      renderAlert(alerts, "warn",
        `Heads up: the final round only has ${finalCards.length} entries — an ` +
        "8-player game needs 52 (16 hole cards + 5 board). Double-check this " +
        "is the right giveaway before calculating."
      );
    }
    fetchedCardLines = finalCards;

    const holeCardsPreview = finalCards.slice(0, 16);
    const boardPreview = finalCards.slice(-5);
    cardsInput.value = holeCardsPreview.join("\n") + "\n\n" + boardPreview.join("\n");

    linkInput.value = "";
    renderAlert(alerts, "success", `Successfully pulled Final Round (${finalCards.length} entries)!`);
    runPoker();
  });

  function seatDisplayNameFactory() {
    const seatNameMap = parseSeatNames(seatNamesInput.value, 8);
    return (seatKey) => {
      const seatNum = parseInt(seatKey.split(" ")[1], 10);
      return seatNameMap.get(seatNum) || seatKey;
    };
  }

  function runPoker() {
    clearAlerts(alerts);
    results.innerHTML = "";
    if (!fetchedCardLines) return;

    const lines = fetchedCardLines.map((l) => l.trim()).filter((l) => l);

    let split;
    try {
      split = splitCardLines(lines);
    } catch (e) {
      if (e instanceof CardParseError) {
        renderAlert(alerts, "error", e.message);
        return;
      }
      throw e;
    }

    const seatDisplayName = seatDisplayNameFactory();

    let computed;
    try {
      computed = computePokerResults(split.cardLines, split.playersData, split.boardInput);
    } catch (e) {
      if (e instanceof CardParseError) {
        renderAlert(alerts, "error",
          `Couldn't parse the card data: ${e.message}. Please check the input ` +
          "and try again — results are not shown until every card parses cleanly."
        );
        return;
      }
      throw e;
    }

    const { boardParsed, playerResults, winners } = computed;

    // Preview, same purpose as the Streamlit expander: catch a misparse
    // before the Facebook text gets posted publicly.
    const preview = document.createElement("details");
    preview.className = "preview";
    const summary = document.createElement("summary");
    summary.textContent = "🔍 Preview parsed cards (check before posting)";
    preview.appendChild(summary);
    let seatI = 1;
    for (const name of split.playersData.keys()) {
      const data = playerResults.get(name);
      const holeStr = data.holdParsed.map((c) => `${c.rank}${c.suit}`).join(" ");
      const line = document.createElement("div");
      line.className = "preview-line";
      line.textContent = `${seatDisplayName(name)}: ${holeStr} → ${data.handType}`;
      preview.appendChild(line);
      seatI++;
    }
    results.appendChild(preview);

    const fbText = buildPokerFacebookText(split.playersData, playerResults, winners, boardParsed, seatDisplayName);
    const cruncherText = buildPokerCruncherText(split.playersData, split.boardInput);
    const sheetRow = buildPokerSheetRow(
      todayStr(), gameNumberInput.value, potInput.value,
      playerResults, winners, boardParsed, seatDisplayName
    );

    renderResultBlock(results, "Facebook Post Format", fbText);
    renderResultBlock(results, "PokerCruncher Format", cruncherText);
    renderResultBlock(results, "Spreadsheet Row (Tab-Separated)", sheetRow);
    renderDownloadButton(results, `poker_results_${todayStr()}.txt`, `${fbText}\n\n${cruncherText}\n\n${sheetRow}`);
  }
}

// ==========================================
// KENO
// ==========================================
function initKeno() {
  const claimsInput = document.getElementById("keno-claims");
  const linkInput = document.getElementById("keno-link");
  const alerts = document.getElementById("keno-alerts");
  const results = document.getElementById("keno-results");
  const fetchBtn = document.getElementById("keno-fetch-btn");

  fetchBtn.addEventListener("click", async () => {
    clearAlerts(alerts);
    results.innerHTML = "";

    const link = linkInput.value.trim();
    const claimsText = claimsInput.value;
    if (!link) {
      renderAlert(alerts, "warn", "Please enter a valid verification link.");
      return;
    }
    if (!claimsText.trim()) {
      renderAlert(alerts, "warn", "Please paste in the seat names & numbers first.");
      return;
    }

    const claimLines = claimsText.trim().split("\n").filter((l) => l.trim());
    if (claimLines.length < KENO_NUM_SEATS) {
      renderAlert(alerts, "error",
        `Need ${KENO_NUM_SEATS} seats' worth of claims (one line each) — found ${claimLines.length}.`
      );
      return;
    }

    const { nameMap, numbersMap } = parseSeatClaims(claimsText, KENO_NUM_SEATS);
    const { seatNumbers, errors } = validateKenoClaims(nameMap, numbersMap, claimLines);
    if (errors.length) {
      renderAlert(alerts, "error", "Couldn't validate the seat claims:\n\n" + errors.map((e) => `- ${e}`).join("\n"));
      return;
    }

    fetchBtn.disabled = true;
    fetchBtn.textContent = "Fetching...";
    const { result, error } = await fetchGiveaway(link);
    fetchBtn.disabled = false;
    fetchBtn.textContent = "Fetch & Calculate Draw";

    if (error) {
      renderAlert(alerts, "error", error);
      return;
    }
    const entries = result.entries || [];
    const roundsHeld = result.roundsHeld || [];
    if (!roundsHeld.length) {
      renderAlert(alerts, "error", "No rounds found in this giveaway record.");
      return;
    }
    const finalRoundIndices = roundsHeld[roundsHeld.length - 1];
    if (finalRoundIndices.length < 15) {
      renderAlert(alerts, "warn",
        `Heads up: the final round only has ${finalRoundIndices.length} entries — ` +
        "need at least 15 to determine the draw. Double-check this is the right giveaway."
      );
    }

    let drawnNumbers;
    try {
      const finalRoundRaw = finalRoundIndices.map((i) => entries[i]);
      const allNumbers = parseFinalRoundNumbers(finalRoundRaw);
      drawnNumbers = allNumbers.slice(0, 15);
    } catch (e) {
      renderAlert(alerts, "error", `${e.message}. Results are not shown until every entry parses cleanly.`);
      return;
    }

    const { seatResults, winnerSeat, winnerData, displayName } = computeKenoResults(seatNumbers, nameMap, drawnNumbers);
    const fbText = buildKenoFacebookText(seatResults, winnerSeat, winnerData, drawnNumbers, displayName);

    linkInput.value = "";
    renderResultBlock(results, "Facebook Post Format", fbText);
    renderDownloadButton(results, `numbers_draw_results_${todayStr()}.txt`, fbText);
  });
}

// ==========================================
// FLIP
// ==========================================
function initFlip() {
  const select = document.getElementById("flip-game-select");
  const cashField = document.getElementById("flip-cash-field");
  const cashValueInput = document.getElementById("flip-cash-value");
  const roundsInput = document.getElementById("flip-custom-rounds");
  const breakevenInput = document.getElementById("flip-custom-breakeven");
  const progressiveInput = document.getElementById("flip-custom-progressive");
  const linkInput = document.getElementById("flip-link");
  const alerts = document.getElementById("flip-alerts");
  const results = document.getElementById("flip-results");
  const fetchBtn = document.getElementById("flip-fetch-btn");

  for (const name of Object.keys(FLIP_GAME_LIBRARY)) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  }

  function applyTemplateDefaults() {
    const cfg = FLIP_GAME_LIBRARY[select.value];
    cashField.hidden = cfg.payoutType !== "cash";
    roundsInput.value = cfg.rounds;
    breakevenInput.value = cfg.breakeven;
    progressiveInput.checked = cfg.progressive;
  }
  select.addEventListener("change", applyTemplateDefaults);
  applyTemplateDefaults();

  fetchBtn.addEventListener("click", async () => {
    clearAlerts(alerts);
    results.innerHTML = "";

    const link = linkInput.value.trim();
    if (!link) {
      renderAlert(alerts, "warn", "Please enter a valid verification link.");
      return;
    }

    const selectedGameName = select.value;
    const cfg = FLIP_GAME_LIBRARY[selectedGameName];
    const customRounds = parseInt(roundsInput.value, 10) || cfg.rounds;
    const customBreakeven = parseInt(breakevenInput.value, 10) || cfg.breakeven;
    const customProgressive = progressiveInput.checked;
    const cashValuePerPoint = parseFloat(cashValueInput.value) || 0;

    fetchBtn.disabled = true;
    fetchBtn.textContent = "Fetching...";
    const { result, error } = await fetchGiveaway(link);
    fetchBtn.disabled = false;
    fetchBtn.textContent = "Fetch & Calculate Flip Game";

    if (error) {
      renderAlert(alerts, "error", error);
      return;
    }
    const entries = result.entries || [];
    const roundsHeld = result.roundsHeld || [];
    if (entries.length < 10) {
      renderAlert(alerts, "warn",
        `Heads up: this giveaway only has ${entries.length} entries — flip games ` +
        "always run with 10 players. Double-check this is the right giveaway."
      );
    }

    const participantNames = buildParticipantNames(entries);
    if (roundsHeld.length < customRounds) {
      renderAlert(alerts, "warn",
        `Notice: Giveaway contains ${roundsHeld.length} rounds, evaluating ` +
        `available rounds up to ${customRounds}.`
      );
    }

    const { evalRounds, roundWinners, spotWins, maxStreaks } = evaluateRounds(roundsHeld, customRounds);
    const { standings, numericDiffs } = computeStandings(spotWins, customBreakeven);
    const jackpotResult = cfg.jackpotType === "donkey"
      ? detectDonkeyJackpot(customProgressive, evalRounds, roundWinners, spotWins, maxStreaks, participantNames)
      : detectJackpot(customProgressive, evalRounds, maxStreaks, spotWins, roundWinners, participantNames);

    if (jackpotResult.message) {
      renderAlert(alerts, "info", "💰 Jackpot payout amount isn't calculated here — pay out from the pool total you're tracking separately.");
    }

    const fbText = buildFlipFacebookText(selectedGameName, jackpotResult.message, participantNames, standings, numericDiffs, cfg, cashValuePerPoint);
    const sheetRow = buildFlipSheetRow(todayStr(), jackpotResult, participantNames, standings);

    linkInput.value = "";
    renderResultBlock(results, "Facebook Post Format", fbText);
    renderResultBlock(results, "Google Workbook Format (Tab-Separated)", sheetRow);
    renderDownloadButton(results, `flip_results_${todayStr()}.txt`, `${fbText}\n\n${sheetRow}`);
  });
}
