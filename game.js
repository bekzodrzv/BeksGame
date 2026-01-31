import { auth, db } from "./firebase.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc, updateDoc, arrayUnion, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* =====================
   LOGOUT
===================== */
document.getElementById("logoutBtn")?.addEventListener("click", () => {
  signOut(auth).then(() => window.location.href = "index.html");
});


/* =====================
   GLOBAL STATE
===================== */
let questions = [[], [], [], [], []];
let currentUserUid = null;

let currentCell = null;
let currentValue = 0;


let teamCount = 0;
let teamsData = [];


let preparedQuestions = null; // topicdan kelgan savollar
let gameInProgress = false;
let gameHistory = [];
let userTimer = 10; // default 10 sekund, foydalanuvchi o‘zgartirishi mumkin
let timer, timeLeft;



/* ===============================
   USER TOPIC MANAGER
   (History, Score, Game logicga TEGMAYDI)
================================ */

/* -------- GLOBAL STATE -------- */
let userTopics = [];
let currentUserTopicId = null;


// LocalStorage save
function saveTopicsToLocal() {
  localStorage.setItem(getUserTopicsLSKey(), JSON.stringify(userTopics));
}

// Firebase save
async function saveTopicsToFirebase() {
  if (!currentUserUid || !db) return;
  try {
    // 🔹 userTopics array ichidagi har bir topic.questions object bo‘lishi kerak
    await setDoc(doc(db, "userTopics", currentUserUid), { topics: userTopics });
    console.log("Topics Firebase-ga saqlandi ✅");
  } catch (e) {
    console.error("Topics Firebase-ga saqlashda xato:", e);
  }
}



// Load topics (localStorage + Firebase fallback)
function getUserTopicsLSKey() {
  return "userTopics_" + currentUserUid;
}

async function loadTopicsSafe() {
  userTopics = [];

  console.log("🔄 Loading topics for:", currentUserUid);

  try {
    const snap = await getDoc(doc(db, "userTopics", currentUserUid));
    if (snap.exists()) {
      const fbTopics = snap.data().topics || [];
      console.log("📥 Topics from Firebase:", fbTopics);
      userTopics = fbTopics;
      localStorage.setItem(getUserTopicsLSKey(), JSON.stringify(fbTopics));
      return;
    }
  } catch (e) {
    console.error("❌ Firebase topic load error:", e);
  }

  // fallback
  const localData = localStorage.getItem(getUserTopicsLSKey());
  if (localData) {
    try {
      userTopics = JSON.parse(localData);
      console.log("📦 Topics from Local:", userTopics);
    } catch {}
  }
}



// Render topics panel
function renderUserTopics() {
  const container = document.getElementById("userTopicPanel");
  if (!container) return;

  container.innerHTML = "";

  userTopics.forEach(topic => {
    const div = document.createElement("div");
    div.className = "topicCard";
    div.id = topic.id;

const totalQs = Object.values(topic.questions).reduce(
  (sum, cat) => sum + (Array.isArray(cat) ? cat.length : 0),
  0
);

    div.innerHTML = `
      <strong>${topic.title}</strong>
      <span>${totalQs} ta savol</span>
      <div class="topicActions">
        <button class="editBtn">✏️</button>
        <button class="deleteBtn">🗑</button>
      </div>
    `;

    div.onclick = () => selectUserTopic(topic.id);

    div.querySelector(".editBtn").onclick = e => {
      e.stopPropagation();
      editUserTopicTitle(topic.id);
    };

    div.querySelector(".deleteBtn").onclick = async e => {
      e.stopPropagation();
      deleteUserTopic(topic.id);
    };

    container.appendChild(div);
  });
}

// Add new topic
async function addUserTopic() {
  const input = document.getElementById("newUserTopicTitle");
  const title = input.value.trim();
  if (!title) return alert("Mavzu nomini kiriting!");

  const topic = {
    id: "topic_" + Date.now(),
    title,
    questions: {
      0: [],
      1: [],
      2: [],
      3: [],
      4: []
    },
    createdAt: Date.now()
  };

  userTopics.push(topic);
  input.value = "";

  renderUserTopics();
  saveTopicsToLocal();
  await saveTopicsToFirebase();

  alert("Mavzu qo‘shildi ✅");
}



// Select topic
function selectUserTopic(topicId) {
  const topic = userTopics.find(t => t.id === topicId);
  if (!topic) return;

  currentUserTopicId = topicId;
  localStorage.setItem("lastTopicId", topicId);

  questions = questionsObjectToArray(topic.questions);
  renderBoard();
}

// Restore last topic
function restoreLastTopic() {
  const lastId = localStorage.getItem("lastTopicId");
  if (!lastId) return;

  const topic = userTopics.find(t => t.id === lastId);
  if (!topic) return;

  currentUserTopicId = topic.id;
  questions = questionsObjectToArray(topic.questions);
  renderBoard();
}


// Import Excel for selected topic
async function importExcelForUserTopic() {
  if (!currentUserTopicId) return alert("Avval topic tanlang!");
  const input = document.getElementById("userTopicExcelInput");
  const file = input.files[0];
  if (!file) return alert("Excel fayl tanlanmadi!");

  const topic = userTopics.find(t => t.id === currentUserTopicId);
  if (!topic) return;

  const reader = new FileReader();
  reader.onload = async function (e) {
    const data = new Uint8Array(e.target.result);
    const workbook = XLSX.read(data, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    topic.questions = { 0: [], 1: [], 2: [], 3: [], 4: [] };

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

      topic.questions[cat].push({ q: q.trim(), a: a.trim() });
    });

    questions = JSON.parse(JSON.stringify(topic.questions));

    saveTopicsToLocal();
    await saveTopicsToFirebase();
    renderUserTopics();
    renderBoard();
    if (typeof loadQuestionsForEdit === "function") loadQuestionsForEdit();

    alert("Excel muvaffaqiyatli yuklandi!");
  };
  reader.readAsArrayBuffer(file);
}

function questionsObjectToArray(qObj) {
  return [
    qObj[0] || [],
    qObj[1] || [],
    qObj[2] || [],
    qObj[3] || [],
    qObj[4] || []
  ];
}


// Delete topic
async function deleteUserTopic(topicId) {
  if (!confirm("Mavzu o‘chirilsinmi?")) return;
  userTopics = userTopics.filter(t => t.id !== topicId);
  if (currentUserTopicId === topicId) currentUserTopicId = null;

  saveTopicsToLocal();
  await saveTopicsToFirebase();
  renderUserTopics();
}

// Edit topic title
async function editUserTopicTitle(topicId) {
  const topic = userTopics.find(t => t.id === topicId);
  if (!topic) return;

  const title = prompt("Yangi mavzu nomi:", topic.title);
  if (!title) return;

  topic.title = title.trim();
  saveTopicsToLocal();
  await saveTopicsToFirebase();
  renderUserTopics();
}

/* =====================
   INIT ON LOAD
===================== */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  currentUserUid = user.uid;

  await initUserData();
});
async function initUserData() {
  await loadTopicsSafe();
  renderUserTopics();
  restoreLastTopic();

  await loadGameHistorySafe();
  renderGameHistory();

  renderBoard();
}


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
  return "gameHistory_" + currentUserUid;
}



/* =====================
   BOARD
===================== */

function renderBoard() {
  const board = document.getElementById("board");
  board.innerHTML = "";

  // 🔹 Object → Array
  const qCategories = Object.values(questions);

  const maxRows = Math.max(...qCategories.map(c => c.length));

  for (let r = 0; r < maxRows; r++) {
    for (let c = 0; c < 5; c++) {
      const category = qCategories[c] || [];
      const item = category[r];
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



function startTimer() {
  timeLeft = userTimer; // foydalanuvchi tomonidan belgilangan vaqt
  const timerEl = document.getElementById("timer");
  const sound = document.getElementById("tickSound"); // HTML audio elementi
  timerEl.innerText = timeLeft;
  timerEl.classList.remove("timer-last");

  timer = setInterval(() => {
    timeLeft--;
    timerEl.innerText = timeLeft;

    timerEl.classList.remove("timer-animate");
    void timerEl.offsetWidth;
    timerEl.classList.add("timer-animate");

    if (timeLeft <= 3 && timeLeft > 0) {
      timerEl.classList.add("timer-last");
      sound.currentTime = 0;
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

function updateTimer() {
  const input = document.getElementById("timerInput");
  let val = parseInt(input.value);
  if (isNaN(val) || val < 1) val = 10;
  userTimer = val;
  alert(`Savol vaqti ${userTimer} sekundga o‘zgartirildi!`);
}
window.updateTimer = updateTimer;



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








/* =====================
   SAVE GAME RESULT
===================== */
async function saveGameResult(sortedTeams) {
  if (!currentUserUid || !db) {
    console.error("UID yoki DB aniqlanmagan!");
    return;
  }

  const result = {
    date: new Date().toISOString(),
    teams: sortedTeams.map(t => ({ name: t.name, score: t.score }))
  };

  const key = "gameHistory_" + currentUserUid;

  // 🔹 LocalStorage ga qo‘shish
  let history = JSON.parse(localStorage.getItem(key)) || [];
  history.push(result);
  localStorage.setItem(key, JSON.stringify(history));

  // 🔹 Global massivni update qilish
  gameHistory = history;

  // 🔹 Firebase-ga saqlash arrayUnion bilan
  try {
    const ref = doc(db, "gameHistory", currentUserUid);

    // Doc mavjudligini tekshiramiz
    const docSnap = await getDoc(ref);
    if (docSnap.exists()) {
      // Agar mavjud bo‘lsa arrayUnion bilan qo‘shamiz
      await updateDoc(ref, { history: arrayUnion(result) });
    } else {
      // Agar yo‘q bo‘lsa yangi doc yaratamiz
      await setDoc(ref, { history: [result] });
    }

    console.log("Game history Firebase-ga saqlandi ✅");
  } catch (err) {
    console.error("Firebase-ga saqlashda xato:", err);
  }

  // 🔹 UI ni yangilash
  renderGameHistory();
}



async function renderGameHistory() {
  const historyBox = document.getElementById("historyList");
  if (!historyBox) return;

  const key = "gameHistory_" + currentUserUid; // 🔹 key nomini aniqladik
  let gameHistory = JSON.parse(localStorage.getItem(key)) || [];

  // 🔹 Firebase fallback
  if (gameHistory.length === 0 && currentUserUid && db) {
    try {
      const docSnap = await getDoc(doc(db, "gameHistory", currentUserUid));
      if (docSnap.exists()) {
        gameHistory = docSnap.data().history || [];
        localStorage.setItem(key, JSON.stringify(gameHistory));
      }
    } catch (err) {
      console.error("Firebase’dan history olishda xato:", err);
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
    closeBtn.onclick = async () => {
      if (!confirm("Bu o‘yin natijasi o‘chirilsinmi?")) return;

      gameHistory.splice(index, 1);

      // 🔹 LocalStorage ga yozish
      localStorage.setItem(key, JSON.stringify(gameHistory));

      // 🔹 Firebase ga yozish
      try {
        await setDoc(doc(db, "gameHistory", currentUserUid), { history: gameHistory });
        console.log("Firebase history item o‘chirildi ✅");
      } catch (err) {
        console.error("Firebase history item o‘chirishda xato:", err);
      }

      renderGameHistory();
    };

    div.appendChild(closeBtn);
    historyBox.appendChild(div);
  });
}




/* =====================
   LOAD GAME HISTORY
===================== */
function getUserHistoryLSKey() {
  return "gameHistory_" + currentUserUid;
}

async function loadGameHistorySafe() {
  gameHistory = [];

  // 🔥 1️⃣ Firebase
  try {
    const snap = await getDoc(doc(db, "gameHistory", currentUserUid));
    if (snap.exists()) {
      gameHistory = snap.data().history || [];
      localStorage.setItem(getUserHistoryLSKey(), JSON.stringify(gameHistory));
      return;
    }
  } catch (e) {
    console.error("Firebase history load error:", e);
  }

  // 🔁 2️⃣ Local fallback
  const localData = localStorage.getItem(getUserHistoryLSKey());
  if (localData) {
    try {
      gameHistory = JSON.parse(localData);
    } catch {
      gameHistory = [];
    }
  }
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




function shuffleQuestionsByButton() {
  if (!questions || questions.length === 0) {
    alert("Avval savollarni yuklang!");
    return;
  }

  // 1️⃣ barcha savollarni bitta massivga yig‘amiz
  let allQuestions = [];
  questions.forEach(cat => {
    if (Array.isArray(cat) && cat.length > 0) {
      allQuestions.push(...cat);
    }
  });

  if (allQuestions.length === 0) {
    alert("Savollar mavjud emas!");
    return;
  }

  // 2️⃣ Butun massivni aralashtiramiz
  shuffleArray(allQuestions);

  // 3️⃣ 5 kategoriya bo‘yicha qayta taqsimlash
  const newQuestions = [[], [], [], [], []];
  allQuestions.forEach((q, index) => {
    const cat = index % 5;  // 5 ustun bo‘yicha
    newQuestions[cat].push(q);
  });

  questions = newQuestions; // global massivga saqlaymiz

  renderBoard();

  if (typeof loadQuestionsForEdit === "function") {
    loadQuestionsForEdit();
  }

  alert("Savollar to‘liq random aralashtirildi!");
}
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}




/* =====================
   GLOBAL FUNCTIONS
===================== */
window.shuffleQuestionsByButton = shuffleQuestionsByButton;
window.openQ = openQ;
window.showAnswer = showAnswer;
window.closeModal = closeModal;
window.addTeam = addTeam;
window.addScore = addScore;
