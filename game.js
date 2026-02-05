import { auth, db } from "./firebase.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  doc,
  setDoc,
  updateDoc,
  arrayUnion,
  getDoc,
  getDocs,
  collection
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";


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
let preparedQuestions = null;
let gameInProgress = false;
let gameHistory = [];
let userTimer = 10;
let timer, timeLeft;
let currentUserTopicId = null;
let userTopics = [];

/* =====================
   FIRESTORE HELPERS
===================== */
function getUserDocRef() {
  if (!currentUserUid || !db) return null;
  return doc(db, "users", currentUserUid);
}

/* =====================
   LOCAL STORAGE KEYS
===================== */
function getUserTopicsLSKey() {
  return "userTopics_" + currentUserUid;
}
function getGameHistoryLSKey() {
  const uid = localStorage.getItem("uid") || currentUserUid || "guest";
  return "gameHistory_" + uid;
}



/* =====================
   QUESTIONS HELPERS
===================== */
function questionsObjectToArray(obj) {
  if (!obj || typeof obj !== "object") return [[], [], [], [], []];
  return [
    Array.isArray(obj[0]) ? obj[0] : [],
    Array.isArray(obj[1]) ? obj[1] : [],
    Array.isArray(obj[2]) ? obj[2] : [],
    Array.isArray(obj[3]) ? obj[3] : [],
    Array.isArray(obj[4]) ? obj[4] : []
  ];
}

/* =====================
   TOPICS
===================== */
async function saveTopics() {
  localStorage.setItem(getUserTopicsLSKey(), JSON.stringify(userTopics));
  const ref = getUserDocRef();
  if (!ref) return;
  try {
    await setDoc(ref, { topics: userTopics }, { merge: true });
    console.log("✅ Topics Firebase-ga saqlandi");
  } catch (e) {
    console.error("❌ Topics Firebase-ga saqlashda xato:", e);
  }
}

async function loadTopicsSafe() {
  userTopics = [];
  const localData = localStorage.getItem(getUserTopicsLSKey());
  if (localData) {
    try { userTopics = JSON.parse(localData); } catch { userTopics = []; }
  }

  const ref = getUserDocRef();
  if (!ref) return;
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const fbTopics = snap.data().topics;
      if (Array.isArray(fbTopics)) {
        userTopics = fbTopics;
        localStorage.setItem(getUserTopicsLSKey(), JSON.stringify(fbTopics));
      }
    }
    console.log("📥 Topics from Firebase:", userTopics);
  } catch (e) {
    console.error("Topic load error:", e);
  }
}

function renderUserTopics() {
  const container = document.getElementById("userTopicPanel");
  if (!container) return;
  container.innerHTML = "";

  userTopics.forEach(topic => {
    const div = document.createElement("div");
    div.className = "topicCard";
    div.id = topic.id;

    const totalQs = Object.values(topic.questions).reduce(
      (sum, cat) => sum + (Array.isArray(cat) ? cat.length : 0), 0
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

    div.querySelector(".editBtn").onclick = e => { e.stopPropagation(); editUserTopicTitle(topic.id); };
    div.querySelector(".deleteBtn").onclick = e => { e.stopPropagation(); deleteUserTopic(topic.id); };

    container.appendChild(div);
  });
}

async function addUserTopic() {
  const input = document.getElementById("newUserTopicTitle");
  const title = input.value.trim();
  if (!title) return alert("Mavzu nomini kiriting!");

  const topic = {
    id: "topic_" + Date.now(),
    title,
    questions: { 0: [], 1: [], 2: [], 3: [], 4: [] },
    createdAt: Date.now()
  };

  userTopics.push(topic);
  input.value = "";
  renderUserTopics();
  await saveTopics();
  alert("Mavzu qo‘shildi ✅");
}

function selectUserTopic(topicId) {
  const topic = userTopics.find(t => t.id === topicId);
  if (!topic) return;

  currentUserTopicId = topicId;
  localStorage.setItem("lastTopicId", topicId);
  questions = questionsObjectToArray(topic.questions);
  renderBoard();
}

function restoreLastTopic() {
  const lastId = localStorage.getItem("lastTopicId");
  if (!lastId) return;
  const topic = userTopics.find(t => t.id === lastId);
  if (!topic) return;

  currentUserTopicId = topic.id;
  questions = questionsObjectToArray(topic.questions);
  renderBoard();
}

async function editUserTopicTitle(topicId) {
  const topic = userTopics.find(t => t.id === topicId);
  if (!topic) return;
  const title = prompt("Yangi mavzu nomi:", topic.title);
  if (!title) return;
  topic.title = title.trim();
  renderUserTopics();
  await saveTopics();
}

async function deleteUserTopic(topicId) {
  if (!confirm("Mavzu o‘chirilsinmi?")) return;
  userTopics = userTopics.filter(t => t.id !== topicId);
  if (currentUserTopicId === topicId) currentUserTopicId = null;
  renderUserTopics();
  await saveTopics();
}

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

    questions = questionsObjectToArray(topic.questions);
    renderUserTopics();
    renderBoard();
    await saveTopics();
    alert("Excel muvaffaqiyatli yuklandi!");
  };
  reader.readAsArrayBuffer(file);
}

/* =====================
   BOARD
===================== */
function renderBoard() {
  const board = document.getElementById("board");
  board.innerHTML = "";
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
   MODAL + TIMER + AUDIO
===================== */
let currentQuestionMultiplier = 1;
const clickSound = document.getElementById("clickSound");
const winnerSound = document.getElementById("winnerSound");

function openQ(cell, item) {
  gameInProgress = true;
  if (cell.classList.contains("used")) return;
  currentCell = cell;
  currentValue = parseInt(cell.innerText);
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
  if (clickSound) clickSound.play().catch(()=>{});
  startTimer();
}

function showBonusEffect(points, multiplier) {
  const el = document.getElementById("bonusEffect");
  el.innerText = `🔥 ${multiplier}X BONUS (${points*multiplier}) 🔥`;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 1500);
}

function playBonusSound() {
  const sound = document.getElementById("bonusSound");
  if (!sound) return;
  sound.currentTime = 0;
  sound.play().catch(()=>{});
}

function startTimer() {
  timeLeft = userTimer;
  const timerEl = document.getElementById("timer");
  const sound = document.getElementById("tickSound");
  timerEl.innerText = timeLeft;
  timerEl.classList.remove("timer-last");

  timer = setInterval(()=>{
    timeLeft--;
    timerEl.innerText = timeLeft;
    timerEl.classList.remove("timer-animate");
    void timerEl.offsetWidth;
    timerEl.classList.add("timer-animate");

    if(timeLeft <= 3 && timeLeft > 0) { timerEl.classList.add("timer-last"); sound.currentTime=0; sound.play(); }
    if(timeLeft <=0) { clearInterval(timer); timerEl.innerText="Vaqt tugadi!"; showAnswer(); }
  },1000);
}

function showAnswer() {
  clearInterval(timer);
  document.getElementById("aText").classList.remove("hidden");
}

function closeModal() {
  clearInterval(timer);
  if(currentCell) { currentCell.classList.add("used"); currentCell.innerText=""; }
  document.getElementById("modal").style.display="none";
}

function updateTimer() {
  let val = parseInt(document.getElementById("timerInput").value);
  if(isNaN(val) || val<1) val=10;
  userTimer = val;
  alert(`Savol vaqti ${userTimer} sekundga o‘zgartirildi!`);
}
window.updateTimer = updateTimer;

/* =====================
   TEAMS + SCORES
===================== */
function addTeam() {
  const input = document.getElementById("teamNameInput");
  let name = input.value.trim();
  if (!name) name = "Team " + (teamCount+1);

  teamCount++;
  const teamId = teamCount;
  teamsData.push({ id: teamId, name, score: 0 });

  const div = document.createElement("div");
  div.className="team";
  div.id="team_" + teamId;
  div.innerHTML=`
    ${name}<br>
    <span id="t${teamId}">0</span>
    <div class="scoreBtns">
      <button class="plusBtn" onclick="addScore(${teamId},1)">+</button>
      <button class="minusBtn" onclick="addScore(${teamId},-1)">-</button>
    </div>
  `;
  const closeBtn=document.createElement("button");
  closeBtn.className="closeBtn";
  closeBtn.innerText="×";
  closeBtn.onclick=()=>{ teamsData = teamsData.filter(t=>t.id!==teamId); div.remove(); };
  div.appendChild(closeBtn);
  document.getElementById("teams").appendChild(div);
  input.value="";
}

function addScore(id, sign) {
  const team = teamsData.find(t => t.id === id);
  if(!team) return;

  // Agar minus bo'lsa multiplikatorni 1 deb olamiz
  const multiplier = sign > 0 ? currentQuestionMultiplier : 1;
  const points = currentValue * multiplier * sign;
  team.score += points;

  const el = document.getElementById("t"+id);
  if(el) el.innerText = team.score;

  // Qo‘shishdan keyin multiplikatorni reset qilamiz
  currentQuestionMultiplier = 1;

  const all = document.querySelectorAll(".cell").length;
  const used = document.querySelectorAll(".cell.used").length;
  if(all===used) declareWinner();
}

/* =====================
   WINNER + GAME HISTORY
===================== */
function playWinSound() {
  if(!winnerSound) return;
  winnerSound.currentTime=0;
  winnerSound.play().catch(()=>{});
}


async function saveGameResult(sortedTeams) {
  if (!currentUserUid || !db) return;

  const result = {
    date: new Date().toISOString(),
    teams: sortedTeams.map(t => ({ name: t.name, score: t.score }))
  };

  // =========================
  // 1️⃣ LOCAL STORAGE
  // =========================
  const key = getUserHistoryLSKey();
  let history = JSON.parse(localStorage.getItem(key)) || [];
  history.push(result);
  localStorage.setItem(key, JSON.stringify(history));

  // 🔹 Global o‘zgaruvchini yangilaymiz
  gameHistory = history;

  // =========================
  // 2️⃣ FIREBASE (users/{uid} ichida)
  // =========================
  const ref = getUserDocRef();
  if (!ref) return;

  try {
    const snap = await getDoc(ref);

    if (snap.exists()) {
      await updateDoc(ref, {
        gameHistory: arrayUnion(result)
      });
    } else {
      await setDoc(ref, {
        gameHistory: [result]
      });
    }

    console.log("✅ Game history Firebase-ga saqlandi");
  } catch (err) {
    console.error("❌ Game history save error:", err);
  }


}


async function declareWinner() {
  if(!teamsData.length) return;

  const sorted = [...teamsData].sort((a,b)=>b.score-a.score);

  await saveGameResult(sorted);
  await renderGameHistory();   // 🔥 DARHOL KO‘RINADI

  showWinnerModal(sorted);
  gameInProgress=false;
  playWinSound();
  launchConfetti();
}

async function loadGameHistorySafe() {
  if (!currentUserUid || !db) return;

  const key = getGameHistoryLSKey();
  let history = [];

  try {
    const ref = getUserDocRef();
    const snap = await getDoc(ref);

    if (snap.exists() && Array.isArray(snap.data().gameHistory)) {
      history = snap.data().gameHistory;
      localStorage.setItem(key, JSON.stringify(history)); // localga ham yozamiz
      console.log("📥 Game history Firebase’dan yuklandi:", history);
    } else {
      console.log("ℹ️ Firebase’da history yo‘q");
    }
  } catch (err) {
    console.error("Firebase’dan history olishda xato:", err);
  }

  gameHistory = history;
  renderGameHistory();
}



async function renderGameHistory() {
  const historyBox = document.getElementById("historyList");
  if (!historyBox) return;

  const key = getUserHistoryLSKey(); 
  let gameHistory = JSON.parse(localStorage.getItem(key)) || [];

  // 🔹 Agar LocalStorage bo‘sh bo‘lsa — Firebase’dan olamiz
  if (gameHistory.length === 0 && currentUserUid && db) {
    try {
      const ref = getUserDocRef();
      const docSnap = await getDoc(ref);

      if (docSnap.exists() && Array.isArray(docSnap.data().gameHistory)) {
        gameHistory = docSnap.data().gameHistory;
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
      ${game.teams
        .map(t => `<div class="teamScore">${t.name}: ${t.score}</div>`)
        .join("")}
    `;

    // ❌ O‘chirish tugmasi (X)
    const closeBtn = document.createElement("button");
    closeBtn.className = "closeBtn";
    closeBtn.innerText = "×";

    closeBtn.onclick = async () => {
      if (!confirm("Bu o‘yin natijasi o‘chirilsinmi?")) return;

      // 1️⃣ Massivdan olib tashlaymiz
      gameHistory.splice(index, 1);

      // 2️⃣ LocalStorage yangilaymiz
      localStorage.setItem(key, JSON.stringify(gameHistory));

      // 3️⃣ Firebase’ni YANGIDAN YOZAMIZ (eng ishonchli usul)
      const ref = getUserDocRef();
      if (ref) {
        try {
          await setDoc(ref, { gameHistory: gameHistory }, { merge: true });
          console.log("✅ Firebase history yangilandi");
        } catch (err) {
          console.error("❌ Firebase history o‘chirishda xato:", err);
        }
      }

      // 4️⃣ UI ni qayta chizamiz
      renderGameHistory();
    };

    div.appendChild(closeBtn);
    historyBox.appendChild(div);
  });
}



/* =====================
   WINNER MODAL + CONFETTI
===================== */
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

  // 🎵 Winner sound
  if (winnerSound) {
    winnerSound.currentTime = 0;
    winnerSound.play().catch(e => console.log(e));
  }

  // 🎉 CONFETTI START
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

  // ⏳ 15 SEKUNDAN KEYIN O‘ZI YOPILSIN + RESTART
  setTimeout(() => {
    confettiRunning = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    winnerModal.style.display = "none";

    // 🔁 O‘YINNI RESTART QILAMIZ
    resetBoardOnly();

  }, 15000);
}


/* =====================
   INIT
===================== */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  currentUserUid = user.uid;
  localStorage.setItem("uid", currentUserUid); // 🔥 YANGI QATOR
  console.log("UID:", currentUserUid);

  await loadTopicsSafe();      
  renderUserTopics();
  restoreLastTopic();

  await loadGameHistorySafe(); // ✅ BU YERDA ICHIDA RENDER BOR

  renderBoard();

  await loadOtherTopics();
});

// Account modal
const accountBtn = document.getElementById("accountBtn");
const accountModal = document.getElementById("accountModal");
const displayNameInput = document.getElementById("displayNameInput");
const saveProfileBtn = document.getElementById("saveProfileBtn");

accountBtn.onclick = () => {
    displayNameInput.value = auth.currentUser.displayName || "";
    accountModal.style.display = "flex";
};

window.closeAccountModal = () => {
    accountModal.style.display = "none";
};

// Saqlash tugmasi
saveProfileBtn.onclick = async () => {
    const newName = displayNameInput.value.trim();
    if (!newName) return alert("Iltimos, ism kiriting!");
    try {
        await updateDoc(getUserDocRef(), { displayName: newName });
        
        accountModal.style.display = "none";
    } catch (err) {
        console.error("❌ Profil saqlashda xato:", err);
        alert("Xatolik yuz berdi!");
    }
};




function resetBoardOnly() {
  const allCells = document.querySelectorAll(".cell");
  const qCategories = Object.values(questions);
  const maxRows = Math.max(...qCategories.map(c => c.length));

  allCells.forEach((cell, index) => {
    cell.classList.remove("used");

    const row = Math.floor(index / 5);
    const col = index % 5;

    // Haqiqiy savol bor yoki yo‘qligini tekshiramiz
    if (qCategories[col] && qCategories[col][row]) {
      cell.innerText = (row + 1) * 100;
    } else {
      cell.innerText = "";
      cell.classList.add("used"); // bo‘sh katakni ishlatilgan deb belgilaymiz
    }
  });

  // Teamlar score’ni nolga tushiramiz
  teamsData.forEach(t => {
    t.score = 0;
    const el = document.getElementById("t" + t.id);
    if (el) el.innerText = "0";
  });

  gameInProgress = false;
}

function shuffleTopicQuestions() {
  if (!questions || questions.length === 0) {
    alert("Avval savollarni yuklang!");
    return;
  }

  // 1️⃣ Barcha savollarni bitta massivga yig‘amiz
  let allQuestions = [];
  // Har bir kategoriya
  for (let i = 0; i < 5; i++) {
    const cat = questions[i] || [];
    allQuestions.push(...cat);
  }

  if (allQuestions.length === 0) {
    alert("Savollar mavjud emas!");
    return;
  }

  // 2️⃣ Fisher-Yates shuffle
  for (let i = allQuestions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allQuestions[i], allQuestions[j]] = [allQuestions[j], allQuestions[i]];
  }

  // 3️⃣ 5 kategoriya bo‘yicha qayta taqsimlash
  const newQuestions = [{}, {}, {}, {}, {}]; // Excel import qilingan shaklga mos
  for (let i = 0; i < 5; i++) newQuestions[i] = [];

  allQuestions.forEach((q, idx) => {
    const cat = idx % 5;
    newQuestions[cat].push(q);
  });

  // 4️⃣ Global questions massivini yangilash
  questions = newQuestions;

  // 5️⃣ Board ni qayta chizamiz
  renderBoard();

  alert("Savollar muvaffaqiyatli aralashtirildi!");
}

// 🔹 HTML dagi 🔀 tugma uchun wrapper
function shuffleQuestionsByButton() {
  shuffleTopicQuestions();
}

let otherTopics = [];

async function loadOtherTopics() {
  if (!db || !currentUserUid) return;

  otherTopics = [];

  try {
    const usersSnap = await getDocs(collection(db, "users"));

    const userMap = {}; // userId → displayName xaritasi
    for (const userDoc of usersSnap.docs) {
      const data = userDoc.data();
      userMap[userDoc.id] = data.displayName || "Noma’lum foydalanuvchi";

      if (userDoc.id === currentUserUid) continue; // o‘zingiznikini chiqarma

      if (Array.isArray(data.topics)) {
        data.topics.forEach(topic => {
          otherTopics.push({
            ...topic,
            ownerId: userDoc.id,
            ownerName: data.displayName || "Noma’lum foydalanuvchi" // 🔹 displayName qo‘shildi
          });
        });
      }
    }

    renderOtherTopics("");
    console.log("✅ Other topics loaded:", otherTopics);

  } catch (err) {
    console.error("❌ loadOtherTopics:", err);
  }
}


function renderOtherTopics(filterText = "") {
  const container = document.getElementById("otherTopicPanel");
  if (!container) return;

  container.innerHTML = "";

  const filtered = otherTopics.filter(t =>
    t.title.toLowerCase().includes(filterText.toLowerCase())
  );

  if (filtered.length === 0) {
    container.innerHTML = "<p>🔎 Mavzu topilmadi</p>";
    return;
  }

  filtered.forEach(topic => {
  const div = document.createElement("div");
  div.className = "topicCard otherTopic"; 

  const totalQs = Object.values(topic.questions).reduce(
    (sum, cat) => sum + (Array.isArray(cat) ? cat.length : 0),
    0
  );

  // 🔹 Bu yerda “Boshqa foydalanuvchi” o‘rniga egasining ismini chiqaramiz
  div.innerHTML = `
    <strong>${topic.title}</strong>
    <span>${totalQs} ta savol</span>
    <small style="opacity:0.7">👤 ${topic.ownerName}</small>
  `;

  div.onclick = () => copyOtherTopicToMine(topic);

  container.appendChild(div);
});

}

document.getElementById("otherTopicSearchInput")?.addEventListener("input", e => {
  renderOtherTopics(e.target.value.trim().toLowerCase());
});

async function copyOtherTopicToMine(topic) {
  if (!topic) return;

  const newTopic = {
    ...topic,
    id: "topic_" + Date.now(), // 🔹 yangi ID
    createdAt: Date.now()
  };

  // Egasi haqidagi ma’lumotni o‘chiramiz (bo‘lsa)
  delete newTopic.ownerId;

  userTopics.push(newTopic);

  renderUserTopics();
  await saveTopics();

  alert(`✅ "${topic.title}" mavzusi o‘zingizga ko‘chirildi!`);
}
window.copyOtherTopicToMine = copyOtherTopicToMine;


document.getElementById("downloadTemplateBtn").onclick = () => {
    // XLSX kutubxonasi orqali shablon yaratamiz
    const wb = XLSX.utils.book_new();

    // Bitta sheet (Questions & Answers)
     const ws_data = [
        ["Question", "Answer"], // Header
        ["Savol matni", "Javob matni"],
        ["Savol matni", "Javob matni"],
        ["Savol matni", "Javob matni"],
        ["Savol matni", "Javob matni"],
        ["Savol matni", "Javob matni"]
    ];

    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    XLSX.utils.book_append_sheet(wb, ws, "Shablon");

    // Faylni yuklash
    XLSX.writeFile(wb, "BeksGame_Shablon.xlsx");
};
// ===== FIX 1: CONFETTI ERROR =====
function launchConfetti() {
  console.log("🎉 Confetti fired (dummy)");
}

// ===== FIX 2: LOCALSTORAGE KEY ERROR =====
function getUserHistoryLSKey() {
  const uid = localStorage.getItem("uid") || "guest";
  return "gameHistory_" + uid;
}


 
/* =====================
   EXPORT TO WINDOW
===================== */
window.addUserTopic=addUserTopic;
window.selectUserTopic=selectUserTopic;
window.importExcelForUserTopic=importExcelForUserTopic;
window.editUserTopicTitle=editUserTopicTitle;
window.deleteUserTopic=deleteUserTopic;
window.openQ=openQ;
window.showAnswer=showAnswer;
window.closeModal=closeModal;
window.updateTimer=updateTimer;
window.addTeam=addTeam;
window.addScore=addScore;
window.resetBoardOnly=resetBoardOnly;
window.shuffleTopicQuestions = shuffleTopicQuestions;
window.shuffleQuestionsByButton = shuffleQuestionsByButton;
window.loadOtherTopics = loadOtherTopics;
window.copyOtherTopicToMine = copyOtherTopicToMine;