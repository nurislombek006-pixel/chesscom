const STOCKFISH_URL = "https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js";

const $ = (id) => document.getElementById(id);

const PIECE_IMG = {
  wp: "https://images.chesscomfiles.com/chess-themes/pieces/neo/150/wp.png",
  wn: "https://images.chesscomfiles.com/chess-themes/pieces/neo/150/wn.png",
  wb: "https://images.chesscomfiles.com/chess-themes/pieces/neo/150/wb.png",
  wr: "https://images.chesscomfiles.com/chess-themes/pieces/neo/150/wr.png",
  wq: "https://images.chesscomfiles.com/chess-themes/pieces/neo/150/wq.png",
  wk: "https://images.chesscomfiles.com/chess-themes/pieces/neo/150/wk.png",
  bp: "https://images.chesscomfiles.com/chess-themes/pieces/neo/150/bp.png",
  bn: "https://images.chesscomfiles.com/chess-themes/pieces/neo/150/bn.png",
  bb: "https://images.chesscomfiles.com/chess-themes/pieces/neo/150/bb.png",
  br: "https://images.chesscomfiles.com/chess-themes/pieces/neo/150/br.png",
  bq: "https://images.chesscomfiles.com/chess-themes/pieces/neo/150/bq.png",
  bk: "https://images.chesscomfiles.com/chess-themes/pieces/neo/150/bk.png",
};

const META = {
  Start: { ru: "Начало", title: "начальная позиция", marker: "", text: "Листай ходы или нажимай на ход снизу." },
  Book: { ru: "Книжный", title: "книжный ход", marker: "📖", text: "Это ход из известной дебютной линии." },
  Good: { ru: "Хороший ход", title: "хороший ход", marker: "✓", text: "Хороший практический ход." },
  Excellent: { ru: "Отличный ход", title: "отличный ход", marker: "👍", text: "Очень сильный ход. Позиция почти не изменилась." },
  Best: { ru: "Лучший ход", title: "лучший ход", marker: "★", text: "Это первая линия Stockfish." },
  Miss: { ru: "Упущенная возможность", title: "упущенная возможность", marker: "✕", text: "Был более сильный шанс наказать соперника." },
  Inaccuracy: { ru: "Неточность", title: "неточность", marker: "?!", text: "Ход заметно ухудшает позицию." },
  Mistake: { ru: "Ошибка", title: "ошибка", marker: "?", text: "Серьёзное ухудшение позиции." },
  Blunder: { ru: "Зевок", title: "зевок", marker: "??", text: "Катастрофическое ухудшение позиции." },
  Great: { ru: "Замечательный ход", title: "замечательный ход", marker: "!", text: "Очень точный ход, похожий на единственный сохраняющий позицию." },
  Brilliant: { ru: "Блестящий ход", title: "блестящий ход", marker: "!!", text: "Сильная жертва материала, подтверждённая движком." },
};

const CAT_ORDER = ["Book", "Good", "Excellent", "Best", "Miss", "Inaccuracy", "Mistake", "Blunder", "Great", "Brilliant"];

let engine;
let currentResolve = null;
let currentLines = [];
let currentBest = null;
let currentDepth = 0;
let report = null;
let idx = 0;
let flipped = false;
let showBest = false;

function cpToWinProbability(cp) {
  cp = Math.max(-1200, Math.min(1200, cp));
  return (1 / (1 + Math.exp(-cp / 180))) * 100;
}
function winDrop(beforeCp, afterCp) {
  return Math.max(0, cpToWinProbability(beforeCp) - cpToWinProbability(afterCp));
}
function accuracyFromAcpl(acpl) {
  const acc = 103 * Math.exp(-0.0047 * acpl) - 3;
  return Math.max(0, Math.min(100, acc));
}
function cpText(cp) {
  if (cp >= 90000) return "M+";
  if (cp <= -90000) return "M-";
  return (cp / 100 >= 0 ? "+" : "") + (cp / 100).toFixed(2);
}
function parseScoreToWhite(line, fen) {
  let cp = 0;
  let mate = null;
  const stm = fen.split(" ")[1];
  const cpMatch = line.match(/score cp (-?\d+)/);
  const mateMatch = line.match(/score mate (-?\d+)/);
  if (mateMatch) {
    mate = parseInt(mateMatch[1], 10);
    cp = mate > 0 ? 100000 - Math.abs(mate) : -100000 + Math.abs(mate);
  } else if (cpMatch) {
    cp = parseInt(cpMatch[1], 10);
  }
  // UCI score is from side-to-move perspective in this browser engine.
  const whiteCp = stm === "w" ? cp : -cp;
  const whiteMate = mate == null ? null : (stm === "w" ? mate : -mate);
  return { whiteCp, mate: whiteMate };
}
function normalizeFen(fen) {
  const p = fen.split(" ");
  return p.slice(0, 4).join(" ");
}
function createEngine() {
  if (engine) engine.terminate();
  const blob = new Blob([`importScripts("${STOCKFISH_URL}");`], { type: "application/javascript" });
  engine = new Worker(URL.createObjectURL(blob));
  engine.onmessage = (e) => {
    const line = String(e.data || "");
    if (line.startsWith("info") && line.includes(" pv ") && line.includes(" score ")) {
      const depthMatch = line.match(/depth (\d+)/);
      const multipvMatch = line.match(/multipv (\d+)/);
      const pvMatch = line.match(/ pv (.+)$/);
      if (!depthMatch || !pvMatch) return;
      const d = parseInt(depthMatch[1], 10);
      if (d < currentDepth) return;
      currentDepth = d;
      const mpv = multipvMatch ? parseInt(multipvMatch[1], 10) : 1;
      currentLines[mpv - 1] = { raw: line, pv: pvMatch[1].trim().split(/\s+/) };
    }
    if (line.startsWith("bestmove")) {
      const bm = line.split(/\s+/)[1];
      currentBest = bm;
      if (currentResolve) {
        const res = { best: currentBest, lines: currentLines.filter(Boolean) };
        const resolve = currentResolve;
        currentResolve = null;
        resolve(res);
      }
    }
  };
  engine.postMessage("uci");
  engine.postMessage("isready");
}
function analyzeFen(fen, depth, multipv = 4) {
  return new Promise((resolve) => {
    currentResolve = resolve;
    currentLines = [];
    currentBest = null;
    currentDepth = 0;
    engine.postMessage("ucinewgame");
    engine.postMessage(`setoption name MultiPV value ${multipv}`);
    engine.postMessage(`position fen ${fen}`);
    engine.postMessage(`go depth ${depth}`);
  });
}
function buildBookSet() {
  const lines = [
    ["e4","e5","Nf3","Nc6","Bb5","a6","Ba4","Nf6","O-O","Be7","Re1","b5","Bb3","d6"],
    ["e4","e5","Nf3","Nc6","Bc4","Bc5","c3","Nf6","d4","exd4","cxd4","Bb4+"],
    ["e4","e5","Nf3","Nc6","Bc4","Nf6","Ng5","d5","exd5","Na5"],
    ["e4","c5","Nf3","d6","d4","cxd4","Nxd4","Nf6","Nc3","a6"],
    ["e4","c5","Nf3","Nc6","d4","cxd4","Nxd4","Nf6","Nc3","d6"],
    ["e4","e6","d4","d5","Nc3","Nf6","Bg5","Be7","e5","Nfd7"],
    ["e4","c6","d4","d5","Nc3","dxe4","Nxe4","Bf5"],
    ["d4","d5","c4","e6","Nc3","Nf6","Bg5","Be7","e3","O-O"],
    ["d4","Nf6","c4","g6","Nc3","Bg7","e4","d6","Nf3","O-O"],
    ["d4","Nf6","c4","e6","Nf3","b6","g3","Ba6"],
    ["c4","e5","Nc3","Nf6","Nf3","Nc6","g3","d5"],
    ["Nf3","d5","d4","Nf6","c4","e6","Nc3","Be7"],
  ];
  const set = new Set();
  for (const line of lines) {
    const ch = new Chess();
    for (const san of line) {
      const fen = normalizeFen(ch.fen());
      const m = ch.move(san, { sloppy: true });
      if (!m) break;
      set.add(`${fen}|${m.from}${m.to}${m.promotion || ""}`);
    }
  }
  return set;
}
const BOOK_SET = buildBookSet();
function isBookMove(board, move, ply) {
  if (ply > 14) return false;
  return BOOK_SET.has(`${normalizeFen(board.fen())}|${move.from}${move.to}${move.promotion || ""}`);
}
function materialValue(piece) {
  return { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 }[piece.type] || 0;
}
function materialBalance(chess, color) {
  let val = 0;
  const board = chess.board();
  for (const row of board) for (const p of row) if (p) val += (p.color === color ? 1 : -1) * materialValue(p);
  return val;
}
function isSacrifice(beforeBoard, move, actualPv) {
  const color = beforeBoard.turn();
  const before = materialBalance(beforeBoard, color);
  const b = new Chess(beforeBoard.fen());
  b.move({ from: move.from, to: move.to, promotion: move.promotion || "q" });
  let afterImmediate = materialBalance(b, color);
  if (actualPv && actualPv[0]) {
    const reply = actualPv[0];
    try { b.move({ from: reply.slice(0,2), to: reply.slice(2,4), promotion: reply[4] || undefined }); } catch {}
  }
  let afterForced = materialBalance(b, color);
  const drop = Math.max(before - afterImmediate, before - afterForced);
  return { yes: drop >= 100, cp: Math.max(0, drop) };
}
function classify({ board, move, ply, topUci, topScoresMover, bestCpMover, actualCpMover, actualPv, previousOpponentCategory }) {
  const loss = Math.max(0, bestCpMover - actualCpMover);
  const wpDrop = winDrop(bestCpMover, actualCpMover);
  const book = isBookMove(board, move, ply);
  const sac = isSacrifice(board, move, actualPv);
  const top1 = topUci[0] === move.from + move.to + (move.promotion || "");
  const top2 = topUci.slice(0,2).includes(move.from + move.to + (move.promotion || ""));
  const secondGap = topScoresMover.length > 1 ? bestCpMover - topScoresMover[1] : 0;

  if (sac.yes && top2 && actualCpMover >= -50 && loss <= 55) return ["Brilliant", `жертва материала примерно ${sac.cp} cp, ход входит в Top-1/Top-2 движка`, loss, wpDrop, sac.cp];
  if (top1 && loss <= 35 && secondGap >= 130) return ["Great", "похоже, это единственный ход, который сохранял позицию", loss, wpDrop, sac.cp];
  if (book) return ["Book", "ход найден в встроенной дебютной книге", loss, wpDrop, sac.cp];
  if (top1) return ["Best", "ход совпадает с первой линией Stockfish", loss, wpDrop, sac.cp];
  if (["Mistake", "Blunder"].includes(previousOpponentCategory) && !top1 && bestCpMover >= 220 && bestCpMover - actualCpMover >= 90 && wpDrop <= 20) return ["Miss", "соперник ошибся ранее, но этот ход не наказал ошибку максимально", loss, wpDrop, sac.cp];
  if (wpDrop < 2) return ["Excellent", `минимальная потеря оценки: ${wpDrop.toFixed(1)}%`, loss, wpDrop, sac.cp];
  if (wpDrop < 5) return ["Good", `небольшое ухудшение: ${wpDrop.toFixed(1)}%`, loss, wpDrop, sac.cp];
  if (wpDrop < 10) return ["Inaccuracy", `заметное ухудшение: ${wpDrop.toFixed(1)}%`, loss, wpDrop, sac.cp];
  if (wpDrop < 20) return ["Mistake", `серьёзное ухудшение: ${wpDrop.toFixed(1)}%`, loss, wpDrop, sac.cp];
  return ["Blunder", `катастрофическое ухудшение: ${wpDrop.toFixed(1)}%`, loss, wpDrop, sac.cp];
}
function updateProgress(done, total) {
  const p = total ? Math.round(done * 100 / total) : 0;
  $("progress").classList.remove("hidden");
  $("progressFill").style.width = p + "%";
  $("progressText").textContent = `${p}% · ${done}/${total}`;
}
async function analyzeGame() {
  if (typeof Chess === "undefined") {
    alert("Не загрузился chess.js. Проверь интернет и обнови страницу.");
    return;
  }
  createEngine();
  const pgn = $("pgnInput").value.trim();
  const depth = parseInt($("depthSelect").value, 10);
  const limit = parseInt($("limitSelect").value, 10);
  const game = new Chess();
  if (!game.load_pgn(pgn, { sloppy: true })) {
    alert("PGN не читается. Вставь одну нормальную PGN-партию.");
    return;
  }
  const headers = game.header();
  const moves = game.history({ verbose: true });
  const total = Math.min(moves.length, limit);
  const replay = new Chess();
  const stats = { White: {}, Black: {} };
  for (const k of CAT_ORDER) { stats.White[k] = 0; stats.Black[k] = 0; }
  const losses = { White: [], Black: [] };
  const positions = [{ ply: 0, fen: replay.fen(), beforeFen: replay.fen(), moveText: "Начало", side: "", key: "Start", san: "", from: "", to: "", best: "", bestUci: "", before: "+0.00", after: "+0.00", evalWhite: 0, comment: "Начальная позиция", loss: 0, wpDrop: 0, sacrifice: 0 }];
  const lastCat = { White: null, Black: null };

  $("analyzeBtn").disabled = true;
  const started = Date.now();

  for (let i = 0; i < total; i++) {
    const move = moves[i];
    const beforeFen = replay.fen();
    const color = replay.turn();
    const side = color === "w" ? "White" : "Black";
    const opponent = side === "White" ? "Black" : "White";
    const fullmove = replay.move_number ? replay.move_number() : Math.floor(i / 2) + 1;
    const prefix = color === "w" ? `${Math.floor(i / 2) + 1}.` : `${Math.floor(i / 2) + 1}...`;

    const beforeAnalysis = await analyzeFen(beforeFen, depth, 5);
    const topUci = beforeAnalysis.lines.map(l => l.pv[0]).filter(Boolean);
    const topScoresWhite = beforeAnalysis.lines.map(l => parseScoreToWhite(l.raw, beforeFen).whiteCp);
    const bestWhite = topScoresWhite[0] ?? 0;
    const bestCpMover = color === "w" ? bestWhite : -bestWhite;
    const topScoresMover = topScoresWhite.map(cp => color === "w" ? cp : -cp);

    const legalMove = replay.move({ from: move.from, to: move.to, promotion: move.promotion || "q" });
    const afterFen = replay.fen();
    const afterAnalysis = await analyzeFen(afterFen, depth, 1);
    const afterScoreWhite = afterAnalysis.lines[0] ? parseScoreToWhite(afterAnalysis.lines[0].raw, afterFen).whiteCp : 0;
    const actualCpMover = color === "w" ? afterScoreWhite : -afterScoreWhite;
    const actualPv = afterAnalysis.lines[0]?.pv || [];

    const [cat, comment, loss, wpD, sac] = classify({
      board: new Chess(beforeFen),
      move,
      ply: i,
      topUci,
      topScoresMover,
      bestCpMover,
      actualCpMover,
      actualPv,
      previousOpponentCategory: lastCat[opponent]
    });

    stats[side][cat]++;
    losses[side].push(loss);
    lastCat[side] = cat;

    let bestSan = "—";
    if (topUci[0]) {
      const tmp = new Chess(beforeFen);
      try { const bm = tmp.move({ from: topUci[0].slice(0,2), to: topUci[0].slice(2,4), promotion: topUci[0][4] || undefined }); bestSan = bm?.san || topUci[0]; } catch { bestSan = topUci[0]; }
    }

    positions.push({
      ply: i + 1,
      fen: afterFen,
      beforeFen,
      moveText: `${prefix} ${legalMove.san}`,
      side,
      key: cat,
      san: legalMove.san,
      from: move.from,
      to: move.to,
      best: bestSan,
      bestUci: topUci[0] || "",
      before: cpText(bestWhite),
      after: cpText(afterScoreWhite),
      evalWhite: afterScoreWhite,
      comment,
      loss,
      wpDrop: wpD,
      sacrifice: sac
    });
    updateProgress(i + 1, total);
  }
  const whiteAvg = losses.White.length ? losses.White.reduce((a,b)=>a+b,0) / losses.White.length : 0;
  const blackAvg = losses.Black.length ? losses.Black.reduce((a,b)=>a+b,0) / losses.Black.length : 0;
  report = {
    white: headers.White || "White",
    black: headers.Black || "Black",
    whiteElo: headers.WhiteElo || "",
    blackElo: headers.BlackElo || "",
    result: headers.Result || "*",
    event: headers.Event || "",
    depth,
    duration: Math.round((Date.now() - started) / 1000),
    total,
    stats,
    white_avg: whiteAvg,
    black_avg: blackAvg,
    white_acc: accuracyFromAcpl(whiteAvg),
    black_acc: accuracyFromAcpl(blackAvg),
    positions,
    pgn
  };
  $("analyzeBtn").disabled = false;
  $("setup").classList.add("hidden");
  $("review").classList.remove("hidden");
  idx = 0; flipped = false; showBest = false;
  renderAllStatic();
  update();
}
function squareCenterPercent(sq) {
  const file = sq.charCodeAt(0) - 97;
  const rank = parseInt(sq[1], 10) - 1;
  const displayFile = flipped ? 7 - file : file;
  const displayRank = flipped ? rank : 7 - rank;
  return { x: (displayFile + 0.5) * 12.5, y: (displayRank + 0.5) * 12.5 };
}
function renderArrow() {
  const svg = $("arrowLayer");
  svg.innerHTML = "";
  if (!showBest || !report) return;
  const pos = report.positions[idx];
  if (!pos || !pos.bestUci || pos.bestUci.length < 4 || !pos.beforeFen) return;
  const from = pos.bestUci.slice(0,2), to = pos.bestUci.slice(2,4);
  const a = squareCenterPercent(from), b = squareCenterPercent(to);
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  defs.innerHTML = `<marker id="arrowHead" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5 Z" fill="rgba(45,205,175,.78)" /></marker>`;
  svg.appendChild(defs);
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", a.x); line.setAttribute("y1", a.y); line.setAttribute("x2", b.x); line.setAttribute("y2", b.y);
  line.setAttribute("class", "best-arrow"); line.setAttribute("marker-end", "url(#arrowHead)");
  svg.appendChild(line);
}
function fenToMap(fen) {
  const rows = fen.split(" ")[0].split("/"); const map = {};
  for (let r=0;r<8;r++) { let file=0; for (const ch of rows[r]) { if ("12345678".includes(ch)) file += parseInt(ch,10); else { map["abcdefgh"[file] + (8-r)] = ch; file++; } } }
  return map;
}
function pieceKey(ch) { return (ch === ch.toUpperCase() ? "w" : "b") + ch.toLowerCase(); }
function evalToPercent(cp) { cp = Math.max(-800, Math.min(800, cp)); return 50 + (cp / 800) * 42; }
function renderBoard() {
  const board = $("board"); const pos = report.positions[idx]; const map = fenToMap(pos.fen); board.innerHTML = "";
  const ranks = flipped ? [1,2,3,4,5,6,7,8] : [8,7,6,5,4,3,2,1];
  const files = flipped ? ["h","g","f","e","d","c","b","a"] : ["a","b","c","d","e","f","g","h"];
  for (let r=0;r<8;r++) for (let f=0;f<8;f++) {
    const rank = ranks[r], file = files[f], sq = file + rank;
    const div = document.createElement("div");
    const light = ((rank + "abcdefgh".indexOf(file)) % 2 === 1);
    div.className = "square " + (light ? "light" : "dark");
    if (sq === pos.from) div.classList.add("from"); if (sq === pos.to) div.classList.add("to");
    if (map[sq]) { const img = document.createElement("img"); img.className = "piece"; img.src = PIECE_IMG[pieceKey(map[sq])]; img.alt = map[sq]; div.appendChild(img); }
    if (f === 0) { const el = document.createElement("div"); el.className = "coord-rank"; el.textContent = rank; div.appendChild(el); }
    if (r === 7) { const el = document.createElement("div"); el.className = "coord-file"; el.textContent = file; div.appendChild(el); }
    if (pos.to && sq === pos.to && pos.key !== "Start") { const b = document.createElement("div"); b.className = "badge badge-" + pos.key; b.textContent = META[pos.key].marker; div.appendChild(b); }
    board.appendChild(div);
  }
  renderArrow();
}
function renderSpeech() {
  const pos = report.positions[idx], meta = META[pos.key] || META.Good;
  $("speechTitle").textContent = pos.key === "Start" ? "Начальная позиция" : `${pos.san} — ${meta.title}`;
  $("evalPill").textContent = pos.after || "+0.00";
  let text = meta.text;
  if (pos.comment) text += " " + pos.comment + ".";
  if (pos.wpDrop) text += ` Падение шанса: ${Number(pos.wpDrop).toFixed(1)}%.`;
  if (showBest && pos.best) text += ` Лучший ход: ${pos.best}.`;
  $("speechText").textContent = text;
  $("evalPointer").style.left = evalToPercent(pos.evalWhite || 0) + "%";
}
function renderStrip() {
  const strip = $("moveStrip"); strip.innerHTML = "";
  report.positions.forEach((pos, i) => { if (!i) return; const btn = document.createElement("button"); btn.className = "move-chip" + (i === idx ? " active" : ""); btn.textContent = pos.moveText; btn.onclick = () => { idx = i; update(); }; strip.appendChild(btn); });
  setTimeout(() => { const a = strip.querySelector(".active"); if (a) a.scrollIntoView({behavior:"smooth", inline:"center", block:"nearest"}); }, 0);
}
function renderAllStatic() {
  $("playersSmall").textContent = `${report.white} — ${report.black} · ${report.result}`;
  $("whiteName").textContent = report.white + (report.whiteElo ? ` (${report.whiteElo})` : "");
  $("blackName").textContent = report.black + (report.blackElo ? ` (${report.blackElo})` : "");
  $("whiteAcc").textContent = report.white_acc.toFixed(1) + "%";
  $("blackAcc").textContent = report.black_acc.toFixed(1) + "%";
  $("whiteStats").textContent = `ACPL ${report.white_avg.toFixed(1)}`;
  $("blackStats").textContent = `ACPL ${report.black_avg.toFixed(1)}`;
  $("wAccFill").style.width = report.white_acc.toFixed(1) + "%";
  $("bAccFill").style.width = report.black_acc.toFixed(1) + "%";
  $("wAccText").textContent = report.white_acc.toFixed(1) + "%";
  $("bAccText").textContent = report.black_acc.toFixed(1) + "%";
  $("info").innerHTML = `<b>Глубина:</b> ${report.depth}<br><b>Ходов:</b> ${report.total}<br><b>Время анализа:</b> ${report.duration} сек<br><b>Результат:</b> ${report.result}`;
  const list = $("statList"); list.innerHTML = "";
  for (const k of CAT_ORDER) { const el = document.createElement("div"); el.className = "stat"; el.textContent = `${META[k].ru}: ${report.stats.White[k]}/${report.stats.Black[k]}`; list.appendChild(el); }
}
function update() { renderBoard(); renderSpeech(); renderStrip(); }
function nextMove(){ if (report && idx < report.positions.length - 1) { idx++; update(); } }
function prevMove(){ if (report && idx > 0) { idx--; update(); } }
function goStart(){ idx = 0; update(); }
function flipBoard(){ flipped = !flipped; renderBoard(); }
function toggleBest(){ showBest = !showBest; renderArrow(); renderSpeech(); }

$("analyzeBtn").onclick = analyzeGame;
$("prevBtn").onclick = prevMove;
$("nextBtn").onclick = nextMove;
$("startBtn").onclick = goStart;
$("flipBtn").onclick = flipBoard;
$("bestBtn").onclick = toggleBest;
$("backToSetup").onclick = () => { $("review").classList.add("hidden"); $("setup").classList.remove("hidden"); };
$("copyBtn").onclick = async () => { if (report?.pgn) { await navigator.clipboard.writeText(report.pgn); alert("PGN скопирован"); } };
document.addEventListener("keydown", e => { if (e.key === "ArrowRight") nextMove(); if (e.key === "ArrowLeft") prevMove(); });
