import { auth, db } from "./firebase.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* =====================
   LOGOUT
===================== */
document.getElementById("logoutBtn")?.addEventListener("click", () => {
  signOut(auth).then(() => window.location.href = "index.html");
});

/* =====================
   DEFAULT SAVOLLAR
===================== */
const defaultQuestions = [
  
  [
    { q: "오전 nimani bildiradi?", a: "Abetgacha" },
    { q: "오후 nimani bildiradi?", a: "Tushdan keyin" },
    { q: "자기 전 tarjimasi?", a: "Uyqudan oldin" },
    { q: "아침 nimani bildiradi?", a: "Ertalab" },
    { q: "저녁 nimani bildiradi?", a: "Kechki payt" }
  ],
  [
    { q: "안녕히 주무세요 qachon?", a: "Yotishdan oldin" },
    { q: "잘 자요 nimani bildiradi?", a: "Yaxshi dam ol" },
    { q: "일 nimani bildiradi?", a: "Ish" },
    { q: "점심 nimani bildiradi?", a: "Tushlik" },
    { q: "저녁 nimani bildiradi?", a: "Kechki ovqat" }
  ],
  
];

/* =====================
   GLOBAL STATE
===================== */
let questions = [[], [], [], [], []];
let currentUserUid = null;

let currentCell = null;
let currentValue = 0;
let timer, timeLeft = 10;

let teamCount = 0;
let teamsData = [];
let gameHistory = JSON.parse(localStorage.getItem("gameHistory")) || [];

let preparedQuestions = null; // topicdan kelgan savollar
let gameInProgress = false;




/* ===============================
   USER TOPIC MANAGER
   (History, Score, Game logicga TEGMAYDI)
================================ */

/* -------- GLOBAL STATE -------- */
let userTopics = [];
let currentUserTopicId = null;

/* -------- LOCAL STORAGE -------- */
function saveTopicsToLocal() {
  localStorage.setItem("userTopics", JSON.stringify(userTopics));
}

function loadTopicsFromLocal() {
  const data = localStorage.getItem("userTopics");
  if (data) {
    try {
      userTopics = JSON.parse(data);
    } catch (e) {
      userTopics = [];
    }
  }
}

/* -------- FIREBASE (optional) -------- */
// db va currentUser mavjud bo‘lishi shart
async function saveTopicsToFirebase() {
  if (!window.currentUser || !window.db) return;
  await setDoc(doc(db, "topics", currentUser.uid), {
    topics: userTopics
  });
}

/* -------- RENDER PANEL -------- */
function renderUserTopics() {
  const container = document.getElementById("userTopicPanel");
  if (!container) return;

  container.innerHTML = "";

  userTopics.forEach(topic => {
    const div = document.createElement("div");
    div.className = "topicCard";
    div.id = topic.id;

    const totalQs = topic.questions.reduce(
      (sum, cat) => sum + cat.length, 0
    );

    div.innerHTML = `
      <strong>${topic.title}</strong>
      <span>${totalQs} ta savol</span>

      <div class="topicActions">
        <button class="editBtn">✏️</button>
        <button class="deleteBtn">🗑</button>
      </div>
    `;

    // 🔹 BOSSA – O‘YNASH
    div.onclick = () => selectUserTopic(topic.id);

    // 🔹 Tahrirlash
    div.querySelector(".editBtn").onclick = (e) => {
      e.stopPropagation(); // o‘yin boshlanmasin
      editUserTopicTitle(topic.id);
    };

    // 🔹 O‘chirish
    div.querySelector(".deleteBtn").onclick = (e) => {
      e.stopPropagation(); // o‘yin boshlanmasin
      deleteUserTopic(topic.id);
    };

    container.appendChild(div);
  });
}


/* -------- ADD TOPIC -------- */
function addUserTopic() {
  const input = document.getElementById("newUserTopicTitle");
  const title = input.value.trim();
  if (!title) return alert("Mavzu nomini kiriting!");

  const topic = {
    id: "topic_" + Date.now(),
    title,
    questions: [[], [], [], [], []],
    createdAt: Date.now()
  };

  userTopics.push(topic);
  input.value = "";

  saveTopicsToLocal();
  saveTopicsToFirebase();
  renderUserTopics();
}

/* -------- SELECT TOPIC (PLAY) -------- */
function selectUserTopic(topicId) {
  const topic = userTopics.find(t => t.id === topicId);
  if (!topic) return;

  currentUserTopicId = topicId;
  localStorage.setItem("lastTopicId", topicId);

  // 🔥 MUHIM: questions ni TO‘LIQ almashtiramiz
  questions = JSON.parse(JSON.stringify(topic.questions));

  // 🔥 ADMIN va BOARD shu questions bilan ishlaydi
  renderBoard();

  if (typeof loadQuestionsForEdit === "function") {
    loadQuestionsForEdit();
  }

  gameInProgress = false;
}

/* -------- IMPORT EXCEL -------- */
function importExcelForUserTopic() {
  if (!currentUserTopicId) {
    return alert("Avval mavzuni bosing!");
  }

  const input = document.getElementById("userTopicExcelInput");
  const file = input.files[0];
  if (!file) return alert("Excel fayl tanlanmadi!");

  const topic = userTopics.find(t => t.id === currentUserTopicId);
  if (!topic) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    const data = new Uint8Array(e.target.result);
    const workbook = XLSX.read(data, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    topic.questions = [[], [], [], [], []];
    let index = 0;

    rows.forEach(r => {
      const q = r.Question || r.question || r.QUESTION;
      const a = r.Answer || r.answer || r.ANSWER;
      if (!q || !a) return;

      let cat = index % 5;
      if (r.Category || r.category || r.CATEGORY) {
        const n = Number(r.Category || r.category || r.CATEGORY);
        if (n >= 1 && n <= 5) cat = n - 1;
      }
      index++;

      topic.questions[cat].push({
        q: q.trim(),
        a: a.trim()
      });
    });

    // agar shu topic ochiq bo‘lsa — darrov o‘yin yangilanadi
    window.questions = JSON.parse(JSON.stringify(topic.questions));
    if (typeof renderBoard === "function") renderBoard();
    if (typeof loadQuestionsForEdit === "function") {
      loadQuestionsForEdit();
    }

    saveTopicsToLocal();
    saveTopicsToFirebase();
    renderUserTopics();

    alert("Excel muvaffaqiyatli yuklandi!");
  };

  reader.readAsArrayBuffer(file);
}

/* -------- DELETE TOPIC -------- */
function deleteUserTopic(topicId) {
  if (!confirm("Mavzu o‘chirilsinmi?")) return;

  userTopics = userTopics.filter(t => t.id !== topicId);

  if (currentUserTopicId === topicId) {
    currentUserTopicId = null;
  }

  saveTopicsToLocal();
  saveTopicsToFirebase();
  renderUserTopics();
}

/* -------- EDIT TITLE -------- */
function editUserTopicTitle(topicId) {
  const topic = userTopics.find(t => t.id === topicId);
  if (!topic) return;

  const title = prompt("Yangi mavzu nomi:", topic.title);
  if (!title) return;

  topic.title = title.trim();
  saveTopicsToLocal();
  saveTopicsToFirebase();
  renderUserTopics();
}

/* -------- RESTORE LAST TOPIC -------- */
function restoreLastTopic() {
  const lastId = localStorage.getItem("lastTopicId");
  if (!lastId) return;

  const topic = userTopics.find(t => t.id === lastId);
  if (!topic) return;

  currentUserTopicId = topic.id;
  window.questions = JSON.parse(JSON.stringify(topic.questions));

  if (typeof renderBoard === "function") renderBoard();
}

/* -------- INIT -------- */
window.addEventListener("load", () => {
  loadTopicsFromLocal();
  renderUserTopics();
  restoreLastTopic();
});

/* -------- EXPORT -------- */
window.addUserTopic = addUserTopic;
window.selectUserTopic = selectUserTopic;
window.importExcelForUserTopic = importExcelForUserTopic;
window.deleteUserTopic = deleteUserTopic;
window.editUserTopicTitle = editUserTopicTitle;



/* =====================
   AUDIO
===================== */
const clickSound = document.getElementById("clickSound");
const winnerSound = document.getElementById("winnerSound");

/* =====================
   LOCAL STORAGE KEY
===================== */
function getUserLSKey() {
  return "jeopardyQuestions_" + currentUserUid;
}

/* =====================
   LOAD / SAVE QUESTIONS
===================== */
function loadQuestionsFromLocal() {
  const key = getUserLSKey();
  const data = localStorage.getItem(key);

  if (data) {
    questions = JSON.parse(data);
  } else {
    questions = JSON.parse(JSON.stringify(defaultQuestions));
    localStorage.setItem(key, JSON.stringify(questions));
  }
}

async function saveQuestions() {
  const key = getUserLSKey();
  localStorage.setItem(key, JSON.stringify(questions));

  for (let i = 0; i < questions.length; i++) {
    const ref = doc(db, "userQuestions", currentUserUid + "_cat_" + i);
    await setDoc(ref, { questions: questions[i] });
  }
}

/* =====================
   BOARD
===================== */

function renderBoard() {
  const board = document.getElementById("board");
  board.innerHTML = "";
  const maxRows = Math.max(...questions.map(c => c.length));

  for (let r = 0; r < maxRows; r++) {
    for (let c = 0; c < 5; c++) {
      const item = questions[c][r];
      const cell = document.createElement("div");
      cell.className = "cell";
      if (item) {
        cell.innerText = (r + 1) * 100;
        cell.onclick = () => openQ(cell, item);
      } else {
        cell.classList.add("used");
      }
      board.appendChild(cell);
    }
  }
}


/* =====================
   MODAL + TIMER
===================== */
let currentQuestionMultiplier = 1;

function openQ(cell, item) {
  gameInProgress = true;
  if (cell.classList.contains("used")) return;

  currentCell = cell;
  currentValue = parseInt(cell.innerText);

  // 🔥 BONUS ANIQLASH (2x / 3x / 5x)
  currentQuestionMultiplier = 1;
  let questionText = item.q;

  const match = questionText.match(/^(\d+)x\s*/i);
  if (match) {
    currentQuestionMultiplier = parseInt(match[1]);
    questionText = questionText.replace(/^(\d+)x\s*/i, "");

    showBonusEffect(currentValue, currentQuestionMultiplier);
    playBonusSound();
  }

  document.getElementById("qText").innerText = questionText;
  document.getElementById("aText").innerText = item.a;
  document.getElementById("aText").classList.add("hidden");
  document.getElementById("modal").style.display = "block";

  if (clickSound) {
    clickSound.currentTime = 0;
    clickSound.play().catch(e => console.log(e));
  }

  startTimer();
}

function showBonusEffect(points, multiplier) {
  const el = document.getElementById("bonusEffect");
  el.innerText = `🔥 ${multiplier}X BONUS (${points * multiplier}) 🔥`;
  el.classList.remove("hidden");

  setTimeout(() => {
    el.classList.add("hidden");
  }, 1500);
}
function playBonusSound() {
  const sound = document.getElementById("bonusSound");
  if (!sound) return;

  sound.currentTime = 0;
  sound.play().catch(() => {});
}




function showAnswer() {
  clearInterval(timer);
  document.getElementById("aText").classList.remove("hidden");
}

function closeModal() {
  clearInterval(timer);
  if (currentCell) {
    currentCell.classList.add("used");
    currentCell.innerText = "";
  }
  document.getElementById("modal").style.display = "none";
}


/* =====================
   TIMER
===================== */

/*function startTimer() {
  timeLeft = 10;
  const timerEl = document.getElementById("timer");
  const sound = document.getElementById("tickSound"); // HTML audio elementi

  timerEl.innerText = timeLeft;

  timer = setInterval(() => {
    timeLeft--;
    timerEl.innerText = timeLeft;

    // Oxirgi 3 sekundda tick chaladi
    if (timeLeft <= 3 && timeLeft > 0) {
      sound.currentTime = 0; // audio qaytadan boshlash
      sound.play();
    }

    // Vaqt tugaganda
    if (timeLeft <= 0) {
      clearInterval(timer);
      timerEl.innerText = "Vaqt tugadi!";
      showAnswer(); // javobni ko'rsatish
    }
  }, 1000);
}*/
function startTimer() {
  timeLeft = 10;
  const timerEl = document.getElementById("timer");
  const sound = document.getElementById("tickSound"); // HTML audio elementi
  timerEl.innerText = timeLeft;
  timerEl.classList.remove("timer-last");

  timer = setInterval(() => {
    timeLeft--;
    timerEl.innerText = timeLeft;

    // 🔥 FAQAT EFEKT (logika emas)
    timerEl.classList.remove("timer-animate");
    void timerEl.offsetWidth; // animatsiyani qayta ishga tushirish
    timerEl.classList.add("timer-animate");

    if (timeLeft <= 3 && timeLeft > 0) {
      timerEl.classList.add("timer-last");
      sound.currentTime = 0; // audio qaytadan boshlash
      sound.play()
    }

    if (timeLeft <= 0) {
      clearInterval(timer);
      timerEl.classList.remove("timer-animate", "timer-last");
      timerEl.innerText = "Vaqt tugadi!";
      showAnswer();
    }
  }, 1000);
}



/* =====================
   TEAMS
===================== */
function addTeam() {
  const input = document.getElementById("teamNameInput");
  let name = input.value.trim();
  if (!name) name = "Team " + (teamCount + 1);

  teamCount++;
  const teamId = teamCount;
  teamsData.push({ id: teamId, name, score: 0 });

  const div = document.createElement("div");
  div.className = "team";
  div.id = "team_" + teamId;

  div.innerHTML = `
    ${name}<br>
    <span id="t${teamId}">0</span>
    <div class="scoreBtns">
      <button class="plusBtn" onclick="addScore(${teamId},1)">+</button>
      <button class="minusBtn" onclick="addScore(${teamId},-1)">-</button>
    </div>
  `;

  // Close button
  const closeBtn = document.createElement("button");
  closeBtn.className = "closeBtn";
  closeBtn.innerText = "×";
  closeBtn.onclick = () => {
    const index = teamsData.findIndex(t => t.id === teamId);
    if (index !== -1) teamsData.splice(index, 1);
    div.remove();
  };
  div.appendChild(closeBtn);

  document.getElementById("teams").appendChild(div);
  input.value = "";
}



function addScore(id, sign) {
  // 1️⃣ Teamni topamiz
  const team = teamsData.find(t => t.id === id);
  if (!team) return;

  // 2️⃣ Bonusni hisoblaymiz
  const points = currentValue * currentQuestionMultiplier * sign;

  // 3️⃣ Team score yangilanadi
  team.score += points;

  // 4️⃣ DOM yangilanadi
  const el = document.getElementById("t" + id);
  el.innerText = team.score;

  // 5️⃣ Multiplier reset (faqat bitta savol uchun!)
  currentQuestionMultiplier = 1;

  // 6️⃣ G‘olibni tekshirish
  const all = document.querySelectorAll(".cell").length;
  const used = document.querySelectorAll(".cell.used").length;
  if (all === used) declareWinner();
}


/* =====================
   WINNER + CONFETTI 15s
===================== */

function declareWinner() {
  if (!teamsData.length) return;

  const sorted = [...teamsData].sort((a, b) => b.score - a.score);

  // 🔹 1️⃣ Natijani saqlash darhol
  saveGameResult(sorted);

  // 🔹 2️⃣ Winner modal va nishonlash
  showWinnerModal(sorted);
  gameInProgress = false;


  // 🔹 3️⃣ Audio va confetti
  playWinSound();
  launchConfetti();
}






// 🔹 Flag: o‘yin natijasi faqat 1 marta saqlansin
let gameSaved = false;

// =====================
// 1️⃣ O‘yin tugagach save qilish
// =====================
async function endGame(sortedTeams) {
  // Natija faqat 1 marta saqlansin
  if (!gameSaved) {
    gameSaved = true;
    await saveGameResult(sortedTeams);
  }

  // Winner modal ochish
  showWinnerModal(sortedTeams);
}

// =====================
// 2️⃣ Natijani localStorage + Firebase ga saqlash
// =====================
async function saveGameResult(sortedTeams) {
  const result = {
    date: new Date().toISOString(),
    teams: sortedTeams.map(t => ({ name: t.name, score: t.score }))
  };

  const key = getHistoryLSKey();

  // 🔹 LocalStorage
  let history = JSON.parse(localStorage.getItem(key)) || [];
  history.push(result);
  localStorage.setItem(key, JSON.stringify(history));

  // 🔹 gameHistory state ham yangilansin
  gameHistory = [...history];

  // 🔹 Firebase saqlash
  await saveGameResultFirebase(sortedTeams);

  // 🔹 UI darhol yangilansin
  renderGameHistory();
}


// =====================
// 3️⃣ History UI render
// =====================
async function renderGameHistory() {
  const historyBox = document.getElementById("historyList");
  if (!historyBox) return;

  const key = getHistoryLSKey();
  let gameHistory = JSON.parse(localStorage.getItem(key)) || [];

  // Agar localStorage bo‘sh bo‘lsa → Firebase fallback
  if (gameHistory.length === 0) {
    try {
      gameHistory = await getGameHistoryFirebase();
      if (gameHistory.length > 0) {
        localStorage.setItem(key, JSON.stringify(gameHistory));
      }
    } catch (err) {
      console.error("Firebase’dan tarixni olishda xato:", err);
    }
  }

  historyBox.innerHTML = "";

  gameHistory.forEach((game, index) => {
    const div = document.createElement("div");
    div.className = "historyItem";
    div.style.position = "relative";

    div.innerHTML = `
      <strong>${index + 1}-o‘yin</strong>
      <span class="date">${new Date(game.date).toLocaleDateString()}</span>
      <span class="time">${new Date(game.date).toLocaleTimeString()}</span>
      ${game.teams.map(t => `<div class="teamScore">${t.name}: ${t.score}</div>`).join('')}
    `;

    // Close button
    const closeBtn = document.createElement("button");
    closeBtn.className = "closeBtn";
    closeBtn.innerText = "×";
    closeBtn.onclick = () => {
      gameHistory.splice(index, 1);
      localStorage.setItem(key, JSON.stringify(gameHistory));
      renderGameHistory();
    };
    div.appendChild(closeBtn);

    historyBox.appendChild(div);
  });
}

// =====================
// 4️⃣ Winner modal + confetti
// =====================
function showWinnerModal(sorted) {
  
  const winnerModal = document.getElementById("winnerModal");
  const winnerText = document.getElementById("winnerText");
  const restWinners = document.getElementById("restWinners");
  const canvas = document.getElementById("confetti");

  winnerText.innerHTML = `🥇 ${sorted[0].name} - ${sorted[0].score} ball`;

  if (sorted.length > 1) {
    restWinners.innerHTML = sorted.slice(1)
      .map((t, i) => `#${i+2} ${t.name} - ${t.score} ball`)
      .join("<br>");
  } else {
    restWinners.innerHTML = "";
  }

  winnerModal.style.display = "block";

  // Winner sound
  if (winnerSound) {
    winnerSound.currentTime = 0;
    winnerSound.play().catch(e => console.log(e));
  }

  // Confetti
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext("2d");

  const particles = [];
  for (let i = 0; i < 200; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height - canvas.height,
      r: Math.random() * 6 + 2,
      d: Math.random() * 200,
      color: `hsl(${Math.random() * 360},100%,50%)`,
      tilt: Math.random() * 10 - 10
    });
  }

  let confettiRunning = true;

  function drawConfetti() {
    if (!confettiRunning) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      ctx.beginPath();
      ctx.fillStyle = p.color;
      ctx.moveTo(p.x + p.tilt, p.y);
      ctx.lineTo(p.x + p.tilt + p.r / 2, p.y + p.r);
      ctx.lineTo(p.x + p.tilt - p.r / 2, p.y + p.r);
      ctx.fill();

      p.y += 3;
      if (p.y > canvas.height) {
        p.y = -10;
        p.x = Math.random() * canvas.width;
      }
    });
    requestAnimationFrame(drawConfetti);
  }

  drawConfetti();

  setTimeout(() => {
    confettiRunning = false;
    winnerModal.style.display = "none";
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // ⚡ Faol savollar reset
    resetBoardOnly();

    // ✅ Keyingi o‘yin uchun flag reset
    gameSaved = false;
  }, 15000);
}

// =====================
// 5️⃣ Page load → history render
// =====================
document.addEventListener("DOMContentLoaded", () => {
  renderGameHistory();
});



/* =====================
   RESET GAME
===================== */
function resetGame() {
  if (!confirm("O‘yin reset qilinsinmi?")) return;

  // Timer to‘xtatish
  clearInterval(timer);

  // Board: cell-larni tozalash va used class-ni olib tashlash
  const cells = board.querySelectorAll(".cell");
  let idx = 0;
  const maxRows = Math.max(...questions.map(c => c.length));
  for (let r = 0; r < maxRows; r++) {
    for (let c = 0; c < questions.length; c++) {
      const item = questions[c][r];
      const cell = cells[idx];
      if (!cell) continue;

      if (item) {
        cell.innerText = (r + 1) * 100;
        cell.classList.remove("used");
      } else {
        cell.innerText = "";
        cell.classList.add("used");
      }
      idx++;
    }
  }

  // Teams
  document.getElementById("teams").innerHTML = "";
  teamsData = [];
  teamCount = 0;

  // Modals
  document.getElementById("modal").style.display = "none";
  document.getElementById("winnerModal").style.display = "none";

  // Confetti tozalash
  const canvas = document.getElementById("confetti");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Board qayta render qilinadi, lekin savollar saqlanadi
  renderBoard();
  loadQuestionsForEdit();

  alert("O‘yin reset qilindi!");
}

/* =====================
   TOPICS (TEMP)
===================== */

const topicsTemp = [
  { id: "t1", title: "Vaqt va sana" },
  { id: "t2", title: "Joylashuv" },
  { id: "t3", title: "Kundalik hayot" }
];

function renderTopics() {
  const list = document.getElementById("topicsList");
  if (!list) return;

  list.innerHTML = "";

  topicsTemp.forEach(t => {
    const div = document.createElement("div");
    div.className = "topicCard";
    div.innerText = t.title;

    div.onclick = () => {
      alert(`"${t.title}" mavzusi tanlandi (hozircha faqat ko‘rinish)`);
    };

    list.appendChild(div);
  });
}



/* =====================
   ADMIN PANEL & EXCEL
===================== */
const toggleBtn = document.getElementById("toggleAdminBtn");
const adminPanel = document.getElementById("adminPanel");

toggleBtn.addEventListener("click", () => {
  if (adminPanel.style.display === "none" || adminPanel.style.display === "") {
    adminPanel.style.display = "block";
    toggleBtn.innerText = "Admin panelni yopish";
  } else {
    adminPanel.style.display = "none";
    toggleBtn.innerText = "Admin panelni ko‘rsat";
  }
});


function addQuestion() {
  const q = document.getElementById("newQuestion").value.trim();
  const a = document.getElementById("newAnswer").value.trim();
  const cat = parseInt(document.getElementById("catSelect").value);

  if (!q || !a) return alert("Savol va javobni kiriting!");
  
  questions[cat].push({ q, a });

  renderBoard();
  loadQuestionsForEdit();

  document.getElementById("newQuestion").value = "";
  document.getElementById("newAnswer").value = "";
}



function loadQuestionsForEdit() {
  const select = document.getElementById("editCategory");
  if (!select || select.value === "") return;

  const cat = parseInt(select.value);
  const editList = document.getElementById("editList");
  editList.innerHTML = "";

  if (!questions[cat]) return;

  questions[cat].forEach((it, i) => {
    editList.innerHTML += `
      <div class="editItem">
        <input id="q_${cat}_${i}" value="${it.q}">
        <input id="a_${cat}_${i}" value="${it.a}">
        <button onclick="saveEdit(${cat},${i})">Saqlash</button>
        <button onclick="deleteQuestion(${cat},${i})">O‘chirish</button>
      </div>
    `;
  });
}

async function deleteAllQuestions() {
  const cat = parseInt(editCategory.value);
  if (isNaN(cat)) return alert("Kategoriya tanlang!");

  if (!confirm("Hamma savollar o‘chiriladi! Davom etilsinmi?")) return;

  // Hamma savollarni o‘chirish
  questions[cat] = [];

  // LocalStorage va Firebase ga saqlash
  await saveQuestions();

  // Board va editList yangilash
  renderBoard();
  loadQuestionsForEdit();

  alert("Kategoriya bo‘yicha barcha savollar o‘chirildi!");
}
// Barcha kategoriyalarni o'chirish
async function deleteAllCategoriesQuestions() {
  if (!confirm("Barcha kategoriyalardagi savollar o‘chiriladi! Davom etilsinmi?")) return;

  // Har bir kategoriya bo‘yicha savollarni tozalash
  for (let i = 0; i < questions.length; i++) {
    questions[i] = [];
  }

  // LocalStorage va Firebase ga saqlash
  await saveQuestions();

  // Board va editList yangilash
  renderBoard();
  loadQuestionsForEdit();

  alert("Barcha kategoriyalardagi savollar o‘chirildi!");
}

async function saveEdit(cat, i) {
  questions[cat][i].q = document.getElementById(`q_${cat}_${i}`).value;
  questions[cat][i].a = document.getElementById(`a_${cat}_${i}`).value;
  await saveQuestions();
  renderBoard();
}

async function deleteQuestion(cat, i) {
  questions[cat].splice(i, 1);
  await saveQuestions();
  renderBoard();
  loadQuestionsForEdit();
}
//RANDOM QILISH//
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function shuffleQuestionsByButton() {
  // 1️⃣ Bo‘sh bo‘lsa ham massivni to‘g‘ri tekshirish
  if (!questions || questions.length === 0) {
    alert("Avval savollarni yuklang!");
    return;
  }

  // 2️⃣ Har bir kategoriya array mavjudligini tekshirish
  for (let i = 0; i < questions.length; i++) {
    if (!Array.isArray(questions[i])) questions[i] = [];
  }

  // 3️⃣ Shuffle faqat bo‘sh bo‘lmagan category-larda
  questions.forEach(cat => {
    if (cat.length > 0) shuffleArray(cat);
  });

  // 4️⃣ Board va edit panel yangilash
  renderBoard();
  loadQuestionsForEdit();

  // 5️⃣ Endi alert har doim chiqadi
  alert("Savollar random aralashtirildi!");
}

//IMPORT EXCEL//
function importExcel() {
  const input = document.getElementById("excelInput");
  const file = input.files[0];
  if (!file) return alert("Excel fayl tanlanmadi");

  const reader = new FileReader();
  reader.onload = async function(e) {
    const data = new Uint8Array(e.target.result);
    const workbook = XLSX.read(data, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    if (!rows.length) return alert("Excel bo‘sh");

    // Kategoriya arraylarini bo‘sh qilish
    for (let i = 0; i < questions.length; i++) questions[i].length = 0;

    let counter = 0;
    rows.forEach(r => {
      const q = r.Question || r.question || r.QUESTION;
      const a = r.Answer || r.answer || r.ANSWER;
      if (!q || !a) return;

      let catIndex;
      if (r.Category || r.category || r.CATEGORY) {
        const num = Number(r.Category || r.category || r.CATEGORY);
        catIndex = (num >= 1 && num <= 5) ? num - 1 : counter % 5;
      } else {
        catIndex = counter % 5;
      }
      counter++;

      questions[catIndex].push({ q: q.trim(), a: a.trim() });
    });

    renderBoard();
    loadQuestionsForEdit();

    // 🔴 SAVOLLARNI LOCALSTORAGE VA FIREBASE GA SAQLASH
    await saveQuestions();

    alert("Excel’dan savollar muvaffaqiyatli yuklandi!");
  };
  reader.readAsArrayBuffer(file);
}



/* =====================
   AUTH
===================== */
onAuthStateChanged(auth, user => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  currentUserUid = user.uid;

  loadQuestionsFromLocal();
  renderBoard();
  renderTopics();

  // O'yin tarixini yuklash
  const key = getHistoryLSKey();
  if (key) {
    gameHistory = JSON.parse(localStorage.getItem(key)) || [];
    renderGameHistory();
  }
});


function getHistoryLSKey() {
  if (!currentUserUid) return null;
  return "jeopardyHistory_" + currentUserUid;
}




/* =====================
   GLOBAL FUNCTIONS
===================== */
window.shuffleQuestionsByButton = shuffleQuestionsByButton;
window.deleteAllCategoriesQuestions = deleteAllCategoriesQuestions;
window.deleteAllQuestions = deleteAllQuestions;
window.openQ = openQ;
window.showAnswer = showAnswer;
window.closeModal = closeModal;
window.addTeam = addTeam;
window.addScore = addScore;
window.addQuestion = addQuestion;
window.loadQuestionsForEdit = loadQuestionsForEdit;
window.saveEdit = saveEdit;
window.deleteQuestion = deleteQuestion;
window.resetGame = resetGame;
window.importExcel = importExcel;
window.importDefaultFromFirebase = importDefaultFromFirebase;
