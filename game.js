import { auth, db } from "./firebase.js";
import { signOut, onAuthStateChanged, updateProfile } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc, updateDoc, getDoc, getDocs, collection } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* =========================================================
   BEKS GAME — CLEAN GAME ENGINE
   Existing public function names are preserved.
   Flow: participant -> team -> one question -> score -> next participant
         -> next NEW question -> winner -> games/wins -> Firebase
========================================================= */

let questions = [[], [], [], [], []];
let currentUserUid = null;
let currentCell = null;
let currentValue = 0;
let teamCount = 0;
let teamsData = [];
let gameInProgress = false;
let gameHistory = [];
const HISTORY_DISABLED = true;
let userTimer = 10;
let timer = null;
let timeLeft = 0;
let currentUserTopicId = null;
let userTopics = [];
let pointStep = 100;
let pointMode = "fixed";
let pendingIntroTopic = null;
let participants = [];
let currentQuestionMultiplier = 1;
let currentQuestionItem = null;
let currentTurnIndex = 0;
let currentQuestionActive = false;
let gameFinalized = false;
let confettiFrame = null;
let winnerTimer = null;
let currentTopicQuestionIndex = 0;
let currentTopicQuestions = [];

/*
 * Ishtirokchisiz ("solo") o'yin
 * statistikasi — jamoa bo'lmasa
 * ham to'g'ri/xato javoblar
 * shu yerda sanaladi.
 */
let soloStats = {
  correct: 0,
  wrong: 0
};

/*
 * ===============================================
 * DUEL REJIMI — ikki ishtirokchi bir vaqtda,
 * ekranning ikki tomonidan (biri 180° aylantirilgan)
 * turli tasodifiy savollarga javob beradi.
 * ===============================================
 */
let duelActive = false;

/*
 * Har bir tomon (A va B) endi mavzudagi
 * BARCHA savollarni oladi (o'zining alohida
 * aralashtirilgan nusxasida) va bir-biriga
 * bog'liq bo'lmagan holda, o'z tezligida
 * ishlaydi — biri ikkinchisini kutmaydi.
 */
let duelTotalRounds = 0;
let duelTimeLeft = 0;

let duelPlayers = {
  a: null,
  b: null
};

let duelRound = {
  a: {
    pool: [],
    index: 0,
    item: null,
    correct: "",
    answered: false,
    finished: false,
    startedAt: 0,
    timer: null,
    timeLeft: 0
  },
  b: {
    pool: [],
    index: 0,
    item: null,
    correct: "",
    answered: false,
    finished: false,
    startedAt: 0,
    timer: null,
    timeLeft: 0
  }
};

let duelStats = {
  a: { correct: 0, wrong: 0, totalTimeMs: 0 },
  b: { correct: 0, wrong: 0, totalTimeMs: 0 }
};

const $ = id => document.getElementById(id);
const clickSound = $("clickSound");
const winnerSound = $("winnerSound");

function normalizeName(name) {
  return String(name ?? "").toLowerCase().replace(/\s+/g, "").replace(/[^\w]/g, "");
}

function escapeHtml(value) {
  const d = document.createElement("div");
  d.textContent = String(value ?? "");
  return d.innerHTML;
}

function PARTICIPANTS_KEY() {
  return "participants_" + (currentUserUid || "guest");
}

function getGameHistoryLSKey() {
  return currentUserUid ? "gameHistory_" + currentUserUid : "gameHistory_guest";
}

function getUserTopicsLSKey() {
  return "userTopics_" + (currentUserUid || "guest");
}

function getUserDocRef() {
  return currentUserUid && db ? doc(db, "users", currentUserUid) : null;
}

function normalizeParticipant(participant) {
  return {
    id: participant.id ?? "p_" + Date.now() + Math.random(),
    name: String(participant.name ?? "Noma'lum"),
    wins: Math.max(0, Number(participant.wins) || 0),
    games: Math.max(0, Number(participant.games) || 0),
    image: participant.image || ""
  };
}

function mergeParticipantStats(localList, remoteList) {
  const merged = new Map();

  [...localList, ...remoteList].forEach(participant => {
    const normalized = normalizeParticipant(participant);
    const key = String(normalized.id) || normalizeName(normalized.name);
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, normalized);
      return;
    }

    merged.set(key, {
      ...existing,
      ...normalized,
      name: normalized.name || existing.name,
      wins: Math.max(existing.wins, normalized.wins),
      games: Math.max(existing.games, normalized.games),
      image: normalized.image || existing.image
    });
  });

  return [...merged.values()];
}

/* ================= SETTINGS ================= */

function initSettings() {
  pointStep = parseInt(localStorage.getItem("pointStep"), 10) || 100;
  pointMode = localStorage.getItem("pointMode") || "fixed";

  if ($("pointStepInput")) {
    $("pointStepInput").value = pointStep;
  }

  if ($("pointModeSelect")) {
    $("pointModeSelect").value = pointMode;
  }
}

function updatePointSettings() {
  const step = parseInt($("pointStepInput")?.value, 10);
  const mode = $("pointModeSelect")?.value || "fixed";

  if (!Number.isFinite(step) || step < 1) {
    return alert("Ball noto'g'ri!");
  }

  pointStep = step;
  pointMode = mode;

  localStorage.setItem("pointStep", String(step));
  localStorage.setItem("pointMode", mode);

  renderBoard();
}

window.updatePointSettings = updatePointSettings;

function updatePointStep() {
  const value = parseInt($("pointStepInput")?.value, 10);

  if (Number.isFinite(value) && value > 0) {
    pointStep = value;
    localStorage.setItem("pointStep", String(value));
    renderBoard();
  }
}

window.updatePointStep = updatePointStep;

function updateTimer() {
  const value = parseInt($("timerInput")?.value, 10);

  userTimer =
    Number.isFinite(value) && value > 0
      ? Math.min(value, 300)
      : 10;

  if ($("timerInput")) {
    $("timerInput").value = userTimer;
  }

  clearInterval(timer);
}

window.updateTimer = updateTimer;

/* ================= PARTICIPANTS ================= */

async function saveParticipants() {
  localStorage.setItem(
    PARTICIPANTS_KEY(),
    JSON.stringify(participants)
  );

  const ref = getUserDocRef();

  if (!ref) return;

  try {
    await setDoc(
      ref,
      { participants },
      { merge: true }
    );
  } catch (e) {
    console.warn("Participant Firebase save:", e);
  }
}

async function loadParticipants() {
  const local = localStorage.getItem(
    PARTICIPANTS_KEY()
  );

  try {
    participants = local ? JSON.parse(local) : [];
  } catch {
    participants = [];
  }

  if (!Array.isArray(participants)) {
    participants = [];
  }

  participants = participants.map(normalizeParticipant);

  renderParticipants();

  const ref = getUserDocRef();

  if (!ref) return;

  try {
    const snap = await getDoc(ref);

    const remote = snap.exists()
      ? snap.data().participants
      : null;

    if (Array.isArray(remote)) {
      participants = mergeParticipantStats(
        participants,
        remote
      );

      localStorage.setItem(
        PARTICIPANTS_KEY(),
        JSON.stringify(participants)
      );

      renderParticipants();
    }
  } catch (e) {
    console.warn("loadParticipants:", e);
  }
}

function addParticipant() {
  const raw = prompt("Ishtirokchi ismi:");

  if (!raw) return;

  const name = raw.trim();

  if (!name) return;

  if (
    participants.some(
      p =>
        normalizeName(p.name) ===
        normalizeName(name)
    )
  ) {
    return alert(
      "Bu ishtirokchi allaqachon mavjud!"
    );
  }

  participants.push({
    id: "p_" + Date.now(),
    name,
    wins: 0,
    games: 0,
    image: ""
  });

  saveParticipants();
  renderParticipants();
}

window.addParticipant = addParticipant;

function findParticipant(ref) {
  if (!ref) return null;

  return (
    participants.find(
      p =>
        String(p.id) === String(ref) ||
        normalizeName(p.name) ===
          normalizeName(ref)
    ) || null
  );
}

window.editParticipant = async function(oldName) {
  const p = findParticipant(oldName);

  if (!p) return;

  const newName = prompt(
    "Yangi ism:",
    p.name
  );

  if (!newName?.trim()) return;

  p.name = newName.trim();

  gameHistory.forEach(g =>
    (g.teams || []).forEach(t => {
      if (
        String(t.participantId) === String(p.id) ||
        normalizeName(t.name) ===
          normalizeName(oldName)
      ) {
        t.name = p.name;
      }
    })
  );

  await saveParticipants();
  await persistHistory();

  renderParticipants();
  renderGameHistory();
};

async function mergeParticipants(oldName, newName) {
  const oldP = findParticipant(oldName);
  const target = findParticipant(newName);

  if (
    !oldP ||
    !target ||
    oldP.id === target.id
  ) {
    return;
  }

  target.games += oldP.games;
  target.wins += oldP.wins;

  gameHistory.forEach(g =>
    (g.teams || []).forEach(t => {
      if (
        String(t.participantId) === String(oldP.id) ||
        normalizeName(t.name) ===
          normalizeName(oldP.name)
      ) {
        t.participantId = target.id;
        t.name = target.name;
      }
    })
  );

  participants = participants.filter(
    p =>
      String(p.id) !==
      String(oldP.id)
  );

  await saveParticipants();
  await persistHistory();

  renderParticipants();
  renderGameHistory();
}

async function deleteParticipantById(id) {
  const p = findParticipant(id);

  if (
    !p ||
    !confirm(`"${p.name}" ni o‘chirasizmi?`)
  ) {
    return;
  }

  participants = participants.filter(
    x =>
      String(x.id) !==
      String(p.id)
  );

  await saveParticipants();
  renderParticipants();
}

function resizeImageFile(
  file,
  maxSize = 180,
  quality = .78
) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = e => {
      const img = new Image();

      img.onload = () => {
        const scale = Math.min(
          1,
          maxSize /
            Math.max(
              img.width,
              img.height
            )
        );

        const canvas =
          document.createElement("canvas");

        canvas.width = Math.max(
          1,
          Math.round(
            img.width * scale
          )
        );

        canvas.height = Math.max(
          1,
          Math.round(
            img.height * scale
          )
        );

        const ctx =
          canvas.getContext("2d");

        ctx.drawImage(
          img,
          0,
          0,
          canvas.width,
          canvas.height
        );

        resolve(
          canvas.toDataURL(
            "image/jpeg",
            quality
          )
        );
      };

      img.onerror = reject;
      img.src = e.target.result;
    };

    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderParticipants() {
  const box = $("participantsBox");

  if (!box) return;

  box.innerHTML = "";

  /*
    Faqat o'yinga tanlangan participantlar.
    addTeamWithParticipant() teamsData ichiga
    participantId ni yozadi.
  */
  const activeIds = new Set(
  (teamsData || []).map(team =>
    String(team.participantId)
  )
);

const sorted = [...participants].sort((a, b) => {

  const aActive =
    activeIds.has(String(a.id));

  const bActive =
    activeIds.has(String(b.id));


  // Ikkalasi ham o'yinda bo'lsa:
  // LIVE BALL bo'yicha
  if (aActive && bActive) {

    const scoreA =
      getLiveParticipantScore(a.id);

    const scoreB =
      getLiveParticipantScore(b.id);

    return (
      scoreB - scoreA ||
      b.wins - a.wins ||
      a.name.localeCompare(b.name)
    );
  }


  // Faqat A o'yinda
  if (aActive && !bActive) {
    return -1;
  }


  // Faqat B o'yinda
  if (!aActive && bActive) {
    return 1;
  }


  // Ikkalasi ham o'yinda EMAS:
  // eski tizim — WINS bo'yicha
  return (
    b.wins - a.wins ||
    a.name.localeCompare(b.name)
  );
});




  sorted.forEach((p, index) => {

    /*
      Participant hozir o'yindami?
    */
    const isActive =
      activeIds.has(String(p.id));


    /*
      Ball faqat o'yindagi participantga tegishli.
    */
    const live =
      isActive
        ? getLiveParticipantScore(p.id)
        : null;


    const winRate = p.games
      ? Math.round(
          (p.wins / p.games) * 100
        )
      : 0;


    const div =
      document.createElement("div");


    /*
      ORIGINAL CLASS O'ZGARMAYDI
    */
    div.className = "participant";

    div.dataset.participantId =
      p.id;


    /*
      Tanlangan participantga mavjud
      CSS orqali active holat beriladi.
    */
    if (isActive) {
      div.classList.add("active");
    }


    div.innerHTML = `
      <div class="participantRank">
        ${index + 1}
      </div>

      <div class="participantAvatarWrap">
        <img
          class="participantAvatar"
          alt=""
          src="${p.image || avatarData(p.name)}"
        >

        <button
          class="avatarBtn"
          type="button"
          title="Rasm tanlash"
        >
          📷
        </button>

        <input
          class="avatarInput"
          type="file"
          accept="image/*"
          hidden
        >
      </div>

      <div class="participantInfo">

        <div class="participantName">
          ${escapeHtml(p.name)}
        </div>

        ${
          isActive
            ? `
              <div class="participantLiveScore">
                ${live}
                <span>ball</span>
              </div>
            `
            : ""
        }

        <div class="participantStats">
          🎮 ${p.games}
          ·
          🏆 ${p.wins}
          ·
          ${winRate}%
        </div>

      </div>

      <div class="participantActions">

        <button
          class="editParticipant"
          type="button"
          title="Tahrirlash"
        >
          ✏️
        </button>

        <button
          class="mergeParticipant"
          type="button"
          title="Birlashtirish"
        >
          🔗
        </button>

        <button
          class="deleteParticipant"
          type="button"
          title="O‘chirish"
        >
          ×
        </button>

      </div>
    `;


    /*
      PARTICIPANTNI TANLASH
    */
    /* =========================================================
   PARTICIPANT CLICK
   1-bosish  = O'YINGA QO'SHISH
   2-bosish  = O'YINDAN CHIQARISH
========================================================= */

div.addEventListener("click", (e) => {

  /* Tahrirlash / birlashtirish / o'chirish
     tugmalari bosilganda participant tanlanmasin */
  if (
    e.target.closest(".editParticipant") ||
    e.target.closest(".mergeParticipant") ||
    e.target.closest(".deleteParticipant")
  ) {
    return;
  }


  /* HOZIRGI HOLATNI TO'G'RIDAN-TO'G'RI TEKSHIRAMIZ */
  const currentTeam = teamsData.find(
    team =>
      String(team.participantId) ===
      String(p.id)
  );


  /* =======================================================
     AGAR O'YINDA BO'LSA
     YANA BOSILDI → TANLOV BEKOR
  ======================================================= */

  if (currentTeam) {

    removeTeam(currentTeam.id);

    return;
  }


  /* =======================================================
     AGAR O'YINDA BO'LMASA
     BOSILDI → TANLASH
  ======================================================= */

  addTeamWithParticipant(p);

});

    /*
      RASM TANLASH
    */
    div.querySelector(
      ".avatarBtn"
    ).onclick = e => {

      e.stopPropagation();

      div.querySelector(
        ".avatarInput"
      ).click();
    };


    /*
      RASM YUKLASH
    */
    div.querySelector(
      ".avatarInput"
    ).onchange = async e => {

      e.stopPropagation();

      const file =
        e.target.files?.[0];

      if (!file) return;

      try {

        p.image =
          await resizeImageFile(file);

        await saveParticipants();

        renderParticipants();
        renderTeams();

      } catch (err) {

        console.warn(err);

        alert(
          "Rasmni yuklashda xato!"
        );
      }
    };


    /*
      EDIT
    */
    div.querySelector(
      ".editParticipant"
    ).onclick = e => {

      e.stopPropagation();

      window.editParticipant(
        p.id
      );
    };


    /*
      MERGE
    */
    div.querySelector(
      ".mergeParticipant"
    ).onclick = async e => {

      e.stopPropagation();

      const target =
        prompt(
          `"${p.name}" ni qaysi ism bilan birlashtirasiz?`
        );

      if (target) {

        await mergeParticipants(
          p.name,
          target.trim()
        );
      }
    };


    /*
      DELETE
    */
    div.querySelector(
      ".deleteParticipant"
    ).onclick = e => {

      e.stopPropagation();

      deleteParticipantById(
        p.id
      );
    };


    box.appendChild(div);
  });


  updateParticipantsToggleButton();
}
function avatarData(name) {
  const letter =
    String(name || "?")
      .trim()
      .charAt(0)
      .toUpperCase() || "?";

  const svg = `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="128"
      height="128"
    >
      <rect
        width="100%"
        height="100%"
        rx="64"
        fill="#172b4d"
      />

      <text
        x="50%"
        y="56%"
        dominant-baseline="middle"
        text-anchor="middle"
        font-family="Arial"
        font-size="58"
        font-weight="800"
        fill="#67e8f9"
      >
        ${letter}
      </text>
    </svg>
  `;

  return (
    "data:image/svg+xml;charset=UTF-8," +
    encodeURIComponent(svg)
  );
}

function getLiveParticipantScore(
  participantId
) {
  const team = teamsData.find(
    t =>
      String(t.participantId) ===
      String(participantId)
  );

  return team ? team.score : 0;
}

function updateParticipantsToggleButton() {
  const btn =
    $("toggleParticipantsBtn");

  const box =
    $("participantsBox");

  if (!btn || !box) return;

  btn.textContent =
    box.classList.contains("expanded")
      ? `👥 ${participants.length} ishtirokchi ▲`
      : `👥 ${participants.length} ishtirokchi ▼`;
}

document.addEventListener(
  "DOMContentLoaded",
  () => {
    const btn =
      $("toggleParticipantsBtn");

    const box =
      $("participantsBox");

    btn?.addEventListener(
      "click",
      () => {
        box?.classList.toggle(
          "expanded"
        );

        updateParticipantsToggleButton();
      }
    );
  }
);

/* ================= TEAMS ================= */

window.addSelectedParticipantToTeam = addTeamWithParticipant;

function addTeamWithParticipant(
  participant
) {
  if (!participant?.id) {
    return alert(
      "Ishtirokchi ma'lumoti topilmadi!"
    );
  }

  if (
    teamsData.some(
      t =>
        String(t.participantId) ===
        String(participant.id)
    )
  ) {
    return alert(
      `"${participant.name}" allaqachon o'yinga qo'shilgan!`
    );
  }

  teamCount += 1;

  teamsData.push({
    id: teamCount,
    participantId: participant.id,
    name: participant.name,
    image: participant.image || "",
    score: 0,
    correctCount: 0,
    wrongCount: 0
  });

  renderTeams();
  renderParticipants();
}

function addTeam() {
  const input =
    $("teamNameInput");

  const name =
    input?.value?.trim();

  if (!name) {
    return addParticipant();
  }

  const p =
    findParticipant(name);

  if (p) {
    addTeamWithParticipant(p);
  } else {
    alert(
      "Avval ishtirokchini qo‘shing."
    );
  }
}

window.addTeam = addTeam;

function removeTeam(id) {
  teamsData =
    teamsData.filter(
      t => t.id !== id
    );

  renderTeams();
  renderParticipants();
}
function renderTeams() {
  const box = $("teams");

  if (!box) return;

  box.innerHTML = "";

  const sorted =
    [...teamsData].sort(
      (a, b) => b.score - a.score
    );

  sorted.forEach(
    (team, rank) => {
      const p =
        findParticipant(
          team.participantId
        );

      const div =
        document.createElement("div");

      div.className = "team";
      div.dataset.teamId =
        team.id;

      div.innerHTML = `
        <div class="liveRank">
          #${rank + 1}
        </div>

        <img
          class="teamAvatar"
          src="${
            p?.image ||
            team.image ||
            avatarData(team.name)
          }"
          alt=""
        >

        <strong>
          ${escapeHtml(team.name)}
        </strong>

        <span id="t${team.id}">
          ${team.score}
        </span>

        <div class="teamStatus">
          LIVE SCORE
        </div>

        <button
          class="closeBtn"
          type="button"
          title="O‘yindan chiqarish"
        >
          ×
        </button>
      `;

      div.querySelector(
        ".closeBtn"
      ).onclick = e => {
        e.stopPropagation();
        removeTeam(team.id);
      };

      box.appendChild(div);
    }
  );
}

/* Compatibility only:
   manual +/- UI is removed. */

function addScore() {
  console.info(
    "Manual score boshqaruvi olib tashlangan — ball variant tanlash orqali avtomatik beriladi."
  );
}

window.addScore = addScore;

function updateTeamScoreUI(team) {
  const el =
    $("t" + team.id);

  if (el) {
    el.textContent =
      team.score;
  }

  renderTeams();
  renderParticipants();
  updateTurnIndicator();
}

/* ================= TOPICS ================= */

function questionsObjectToArray(obj) {
  if (
    !obj ||
    typeof obj !== "object"
  ) {
    return [
      [],
      [],
      [],
      [],
      []
    ];
  }

  return [
    0,
    1,
    2,
    3,
    4
  ].map(
    i =>
      Array.isArray(obj[i])
        ? obj[i]
        : []
  );
}

function normalizeTopicQuestionsForStorage(source) {
  const normalized = {
    0: [],
    1: [],
    2: [],
    3: [],
    4: []
  };

  const safeSource =
    Array.isArray(source)
      ? source
      : questionsObjectToArray(
          source
        );

  safeSource.forEach(
    (category, index) => {
      const list =
        Array.isArray(category)
          ? category
          : [];

      normalized[index] =
        list.map(item => {
          if (!item || typeof item !== "object") {
            return item;
          }

          return {
            ...item,
            wrongAnswers:
              Array.isArray(item.wrongAnswers)
                ? item.wrongAnswers.map(value =>
                    String(value ?? "").trim()
                  )
                : []
          };
        });
    }
  );

  return normalized;
}

function syncCurrentTopicQuestionsToUserTopics() {
  if (!currentUserTopicId) {
    return;
  }

  const topic =
    userTopics.find(
      t => t.id === currentUserTopicId
    );

  if (!topic) {
    return;
  }

  const source =
    Array.isArray(questions)
      ? questions
      : questionsObjectToArray(
          questions
        );

  const normalized =
    normalizeTopicQuestionsForStorage(
      source
    );

  topic.questions = normalized;
  currentTopicQuestions =
    Object.values(normalized).flat();
}

async function saveTopics() {
  syncCurrentTopicQuestionsToUserTopics();

  localStorage.setItem(
    getUserTopicsLSKey(),
    JSON.stringify(userTopics)
  );

  const ref = getUserDocRef();

  if (!ref || !navigator.onLine) {
    console.warn(
      "saveTopics: Firestore skip (offline or no auth)."
    );
    return false;
  }

  try {
    const safeTopics = JSON.parse(
      JSON.stringify(userTopics)
    ).map(topic => ({
      ...topic,
      questions: normalizeTopicQuestionsForStorage(
        topic.questions
      )
    }));

    await setDoc(
      ref,
      { topics: safeTopics },
      { merge: true }
    );
    return true;
  } catch (e) {
    console.error(
      "saveTopics Firebase xatosi:",
      e
    );

    alert(
      "DIQQAT: savollar Firebase'ga saqlanmadi!\n\n" +
      "Xatolik: " + (e?.message || e) + "\n\n" +
      "Ehtimoliy sabab: mavzudagi savollar juda ko'p " +
      "bo'lib, Firestore hujjat hajmi chegarasidan " +
      "(taxminan 1MB) oshib ketgan bo'lishi mumkin. " +
      "Bu holatda ba'zi savollarni alohida mavzularga " +
      "bo'lib saqlash tavsiya etiladi."
    );

    return false;
  }
}

async function loadTopicsSafe() {
  try {
    const local =
      localStorage.getItem(
        getUserTopicsLSKey()
      );

    userTopics =
      local
        ? JSON.parse(local)
        : [];
  } catch {
    userTopics = [];
  }

  renderUserTopics();

  const ref =
    getUserDocRef();

  if (!ref) return;

  try {
    const snap =
      await getDoc(ref);

    const remote =
      snap.exists()
        ? snap.data().topics
        : null;

    if (Array.isArray(remote)) {
      userTopics =
        remote;

      localStorage.setItem(
        getUserTopicsLSKey(),
        JSON.stringify(remote)
      );

      renderUserTopics();
    }
  } catch (e) {
    console.warn(
      "Topics load:",
      e
    );
  }
}

function renderUserTopics() {

  /*
   * "Mening mavzularim" paneli olib
   * tashlandi — endi mavzular faqat
   * savollar maydonida (board) va
   * Excel maqsad tanlovida ko'rinadi,
   * shu ikkalasi shu yerda sinxronlanadi.
   */

  renderBoard();
  renderExcelTargetOptions();
}

async function addUserTopic() {
  const input =
    $("newUserTopicTitle");

  const title =
    input?.value?.trim();

  if (!title) {
    return alert(
      "Mavzu nomini kiriting!"
    );
  }

  userTopics.push({
    id:
      "topic_" +
      Date.now(),

    title,

    questions: {
      0: [],
      1: [],
      2: [],
      3: [],
      4: []
    },

    createdAt:
      Date.now()
  });

  input.value = "";

  renderUserTopics();

  await saveTopics();
  await loadOtherTopics();
}

window.addUserTopic =
  addUserTopic;

function selectUserTopic(
  topicId
) {

  const topic =
    userTopics.find(
      t =>
        t.id === topicId
    );

  if (!topic) return;

  currentUserTopicId =
    topicId;

  localStorage.setItem(
    "lastTopicId",
    topicId
  );

  questions =
    questionsObjectToArray(
      topic.questions
    );

  /*
   * QUESTION BOARD
   */
  renderBoard();

  /*
   * Mening mavzularim panelidagi
   * eski tanlovni ham yangilaymiz
   */
  renderUserTopics();
}

window.selectUserTopic =
  selectUserTopic;

function restoreLastTopic() {
  const id =
    localStorage.getItem(
      "lastTopicId"
    );

  if (id) {
    selectUserTopic(id);
  }
}

async function editUserTopicTitle(
  topicId
) {
  const topic =
    userTopics.find(
      t => t.id === topicId
    );

  if (!topic) return;

  const title =
    prompt(
      "Yangi mavzu nomi:",
      topic.title
    );

  if (!title?.trim()) return;

  topic.title =
    title.trim();

  renderUserTopics();

  await saveTopics();
}

window.editUserTopicTitle =
  editUserTopicTitle;

async function deleteUserTopic(
  topicId
) {
  if (
    !confirm(
      "Mavzu o‘chirilsinmi?"
    )
  ) {
    return;
  }

  userTopics =
    userTopics.filter(
      t => t.id !== topicId
    );

  if (
    currentUserTopicId ===
    topicId
  ) {
    currentUserTopicId =
      null;
  }

  renderUserTopics();

  await saveTopics();
}

window.deleteUserTopic =
  deleteUserTopic;

function renderExcelTargetOptions() {

  const select =
    $("userTopicExcelTarget");

  if (!select) return;

  const prevValue =
    select.value;

  select.innerHTML = "";

  if (!userTopics.length) {

    const opt =
      document.createElement("option");

    opt.value = "";
    opt.textContent =
      "Avval mavzu yarating";

    select.appendChild(opt);

    select.disabled = true;

    return;
  }

  select.disabled = false;

  userTopics.forEach(topic => {

    const opt =
      document.createElement("option");

    opt.value = topic.id;
    opt.textContent =
      topic.title;

    select.appendChild(opt);

  });

  const stillExists =
    userTopics.some(
      t => t.id === prevValue
    );

  const fallback =
    currentUserTopicId &&
    userTopics.some(
      t => t.id === currentUserTopicId
    )
      ? currentUserTopicId
      : userTopics[
          userTopics.length - 1
        ].id;

  select.value =
    stillExists
      ? prevValue
      : fallback;
}

async function importExcelForUserTopic() {

  const targetId =
    $("userTopicExcelTarget")
      ?.value ||
    currentUserTopicId;

  if (!targetId) {
    return alert(
      "Avval mavzuni tanlang!"
    );
  }

  const file =
    $("userTopicExcelInput")
      ?.files?.[0];

  if (!file) {
    return alert(
      "Excel fayl tanlanmadi!"
    );
  }

  const topic =
    userTopics.find(
      t =>
        t.id ===
        targetId
    );

  if (!topic) return;

  const reader =
    new FileReader();

  reader.onload =
    async e => {
      const workbook =
        XLSX.read(
          new Uint8Array(
            e.target.result
          ),
          {
            type: "array"
          }
        );

      const sheet =
        workbook.Sheets[
          workbook.SheetNames[0]
        ];

      const rows =
        XLSX.utils.sheet_to_json(
          sheet,
          {
            defval: ""
          }
        );

      topic.questions = {
        0: [],
        1: [],
        2: [],
        3: [],
        4: []
      };

      let index = 0;

      rows.forEach(r => {

  const q =
    r.Question ??
    r.question ??
    r.QUESTION ??
    "";

  const a =
    r.Answer ??
    r.answer ??
    r.ANSWER ??
    "";

  if (!String(q).trim() || !String(a).trim()) {
    return;
  }

  let cat =
    index % 5;

  const c =
    Number(
      r.Category ??
      r.category ??
      r.CATEGORY
    );

  if (
    c >= 1 &&
    c <= 5
  ) {
    cat = c - 1;
  }

  /*
   * 3-4-5 USTUNLARDAGI NOTO'G'RI JAVOBLAR
   */
  const wrongAnswers = [
    r["Wrong Answer 1"],
    r["Wrong Answer 2"],
    r["Wrong Answer 3"]
  ]
    .map(
      value =>
        String(
          value ?? ""
        ).trim()
    )
    .filter(Boolean);

  topic.questions[
    cat
  ].push({

    q:
      String(q).trim(),

    a:
      String(a).trim(),

    wrongAnswers:
      wrongAnswers

  });

  index++;
});

      questions =
        questionsObjectToArray(
          topic.questions
        );

      renderUserTopics();
      renderBoard();

      const saved =
        await saveTopics();

      if (saved) {
        alert(
          "Excel muvaffaqiyatli yuklandi va saqlandi!"
        );
      } else {
        alert(
          "Excel yuklandi, lekin Firebase'ga saqlashda muammo bo'ldi " +
          "(yuqoridagi xabarga qarang). Savollar shu qurilmada " +
          "(localStorage) saqlandi, lekin boshqa qurilmada yoki " +
          "sahifa keshi tozalansa yo'qolishi mumkin."
        );
      }
    };

  reader.readAsArrayBuffer(
    file
  );
}

window.importExcelForUserTopic =
  importExcelForUserTopic;

/* ================= BOARD ================= */

/* =========================
   TOPIC BOARD
========================= */

/* =========================
   TOPIC BOARD
========================= */

function renderBoard() {

  const board = $("board");

  if (!board) return;

  board.innerHTML = "";

  if (
    !Array.isArray(userTopics) ||
    !userTopics.length
  ) {
    board.innerHTML = `
      <div class="topicBoardEmpty">
        📚 Hozircha mavzu mavjud emas
      </div>
    `;
    return;
  }

  userTopics.forEach(topic => {

    const card =
      document.createElement("div");

    card.className =
      "topicBoardCard";

    if (
      topic.id ===
      currentUserTopicId
    ) {
      card.classList.add("selected");
    }

    const total =
      Object.values(
        topic.questions || {}
      ).reduce(
        (sum, category) =>
          sum +
          (
            Array.isArray(category)
              ? category.length
              : 0
          ),
        0
      );

    card.innerHTML = `
      <div class="topicBoardIcon">
        📚
      </div>

      <div class="topicBoardInfo">

        <strong>
          ${escapeHtml(topic.title)}
        </strong>

        <span>
          ${total} ta savol
        </span>

        ${
          topic.id === currentUserTopicId
            ? `
              <small>
                ✓ TANLANGAN
              </small>
            `
            : ""
        }

      </div>

      <div class="topicBoardCardActions">
        <button type="button" class="cardIconBtn editBtn" title="Tahrirlash">✏️</button>
        <button type="button" class="cardIconBtn deleteBtn" title="O‘chirish">🗑️</button>
      </div>

      <div class="topicStartOverlay">
        <span>▶</span>
        <strong>O‘YINNI BOSHLASH</strong>
      </div>
    `;

    card.onclick = () => {

      openTopicIntro(
        topic
      );

    };

    const editBtn =
      card.querySelector(".editBtn");

    if (editBtn) {
      editBtn.onclick = e => {
        e.stopPropagation();
        editUserTopicTitle(topic.id);
      };
    }

    const deleteBtn =
      card.querySelector(".deleteBtn");

    if (deleteBtn) {
      deleteBtn.onclick = e => {
        e.stopPropagation();
        deleteUserTopic(topic.id);
      };
    }

    board.appendChild(card);

  });
}

/* ================= TOPIC INTRO / PLAY MODAL ================= */

function openTopicIntro(topic) {

  if (!topic) return;

  if (gameFinalized) return;

  pendingIntroTopic = topic;

  const titleEl =
    $("introTopicTitle");

  if (titleEl) {
    titleEl.textContent =
      topic.title ||
      "O‘yin haqida";
  }

  renderIntroParticipants();
  renderIntroRules();

  const modal =
    $("topicIntroModal");

  if (modal) {

    modal.style.display =
      "flex";

    modal.classList.add(
      "show"
    );

  }
}

function renderIntroParticipants() {

  const box =
    $("introParticipants");

  if (!box) return;

  box.innerHTML = "";

  if (!teamsData.length) {

    box.innerHTML = `
      <span class="introEmpty">
        Hozircha ishtirokchi yo‘q
      </span>
    `;

    return;
  }

  teamsData.forEach(team => {

    const card =
      document.createElement("div");

    card.className =
      "introParticipantCard";

    card.innerHTML = `
      <img
        class="introAvatar"
        src="${
          team.image ||
          avatarData(team.name)
        }"
        alt=""
      >
      <span>
        ${escapeHtml(team.name)}
      </span>
    `;

    box.appendChild(card);

  });
}

function renderIntroRules() {

  const box =
    $("introRules");

  if (!box) return;

  const step =
    Number(pointStep) || 100;

  const isSolo =
    !teamsData.length;

  box.innerHTML = isSolo
    ? `
      <ul class="introRulesList">
        <li>
          🧠 Ishtirokchi tanlanmagan — <strong>yakka (solo) rejimda</strong> mashq qilasiz
        </li>
        <li>
          🔀 Barcha savollar tasodifiy tartibda beriladi
        </li>
        <li>
          📊 O‘yin oxirida nechta to‘g‘ri va nechta xato javob berganingiz statistikasi ko‘rsatiladi
        </li>
        <li>
          ⏱ Har bir savolga javob berish uchun belgilangan vaqt beriladi
        </li>
      </ul>
    `
    : `
      <ul class="introRulesList">
        <li>
          ✅ To‘g‘ri javob — <strong>+${step} ball</strong>
        </li>
        <li>
          ❌ Noto‘g‘ri javob yoki vaqt tugashi — <strong>−${step} ball</strong>
        </li>
        <li>
          🔥 Savol oldida "2x", "3x" kabi belgi bo‘lsa, o‘sha savol uchun ball shuncha marta ko‘payadi
        </li>
        <li>
          ⏱ Har bir savolga javob berish uchun belgilangan vaqt beriladi, vaqt tugasa ball ayiriladi
        </li>
      </ul>
    `;
}

function closeTopicIntroModal() {

  const modal =
    $("topicIntroModal");

  if (modal) {

    modal.style.display =
      "none";

    modal.classList.remove(
      "show"
    );

  }

  pendingIntroTopic = null;
}

window.closeTopicIntroModal =
  closeTopicIntroModal;

function confirmStartTopicGame() {

  if (!pendingIntroTopic) return;

  const topic =
    pendingIntroTopic;

  closeTopicIntroModal();

  selectUserTopic(
    topic.id
  );

  startTopicGame(
    topic
  );
}

/* =========================================================
   DUEL REJIMI
========================================================= */

function createGuestDuelTeam(name) {
  return {
    id: "guest_" + Date.now() + "_" + Math.random().toString(36).slice(2),
    participantId: null,
    name,
    image: "",
    score: 0,
    correctCount: 0,
    wrongCount: 0
  };
}

function confirmStartDuel() {

  if (!pendingIntroTopic) return;

  let playerA = null;
  let playerB = null;

  if (teamsData.length === 2) {

    playerA = teamsData[0];
    playerB = teamsData[1];

  } else if (teamsData.length === 1) {

    /*
     * 1 ta ishtirokchi tanlangan —
     * ikkinchisi avtomatik
     * mehmon sifatida qo'shiladi.
     */
    playerA = teamsData[0];
    playerB =
      createGuestDuelTeam(
        "Ishtirokchi 2"
      );

  } else if (teamsData.length === 0) {

    /*
     * Ishtirokchi tanlanmagan —
     * ikkalasi ham avtomatik
     * "Ishtirokchi 1"/"Ishtirokchi 2"
     * nomi bilan boshlanadi.
     */
    playerA =
      createGuestDuelTeam(
        "Ishtirokchi 1"
      );

    playerB =
      createGuestDuelTeam(
        "Ishtirokchi 2"
      );

  } else {

    alert(
      "Duel uchun 2 ta ishtirokchi tanlang (yoki hech kimni tanlamang)!"
    );

    return;
  }

  const topic =
    pendingIntroTopic;

  closeTopicIntroModal();

  selectUserTopic(
    topic.id
  );

  startDuel(
    topic,
    playerA,
    playerB
  );
}

window.confirmStartDuel =
  confirmStartDuel;

function startDuel(topic, playerA, playerB) {

  if (!topic) return;

  /*
   * Mavzudagi barcha savollarni
   * bitta massivga yig'ib,
   * tasodifiy tartibga solamiz.
   */
  let pool = [];

  Object.values(
    topic.questions || {}
  ).forEach(category => {

    if (!Array.isArray(category)) {
      return;
    }

    category.forEach(item => {
      if (item) pool.push(item);
    });

  });

  if (pool.length < 2) {

    alert(
      "Duel uchun mavzuda kamida 2 ta savol bo‘lishi kerak!"
    );

    return;
  }

  /*
   * Har ikkala tomon ham mavzudagi
   * BARCHA savollarni oladi — lekin
   * har biri o'zining mustaqil
   * aralashtirilgan tartibida, shu
   * sabab ular bir xil vaqtda bir xil
   * savolga duch kelmaydi.
   */
  duelTotalRounds = pool.length;

  duelRound.a = {
    pool: shuffleArray(pool.slice()),
    index: 0,
    item: null,
    correct: "",
    answered: false,
    finished: false,
    startedAt: 0,
    timer: null,
    timeLeft: 0
  };

  duelRound.b = {
    pool: shuffleArray(pool.slice()),
    index: 0,
    item: null,
    correct: "",
    answered: false,
    finished: false,
    startedAt: 0,
    timer: null,
    timeLeft: 0
  };

  duelPlayers = {
    a: playerA || teamsData[0],
    b: playerB || teamsData[1]
  };

  duelStats = {
    a: { correct: 0, wrong: 0, totalTimeMs: 0 },
    b: { correct: 0, wrong: 0, totalTimeMs: 0 }
  };

  duelActive = true;

  updateDuelStatsUI();

  /*
   * Ishtirokchilar ma'lumotlari
   */
  const pa =
    findParticipant(
      duelPlayers.a.participantId
    );

  const pb =
    findParticipant(
      duelPlayers.b.participantId
    );

  if ($("duelAImg")) {
    $("duelAImg").src =
      pa?.image ||
      duelPlayers.a.image ||
      avatarData(duelPlayers.a.name);
  }

  if ($("duelBImg")) {
    $("duelBImg").src =
      pb?.image ||
      duelPlayers.b.image ||
      avatarData(duelPlayers.b.name);
  }

  if ($("duelAName")) {
    $("duelAName").textContent =
      duelPlayers.a.name;
  }

  if ($("duelBName")) {
    $("duelBName").textContent =
      duelPlayers.b.name;
  }

  if ($("duelRoundTotal")) {
    $("duelRoundTotal").textContent =
      duelTotalRounds;
  }

  const modal =
    $("duelModal");

  if (modal) {
    modal.style.display =
      "flex";
  }

  renderDuelSideRound("a");
  renderDuelSideRound("b");

  updateDuelRoundLabel();
}

function updateDuelRoundLabel() {

  const label =
    $("duelRoundNow");

  if (!label) return;

  /*
   * Ikkala tomon mustaqil
   * ravishda ilgarilagani uchun,
   * har birining o'z progressi
   * alohida ko'rsatiladi.
   */
  const aNow =
    Math.min(
      duelRound.a.index + 1,
      duelTotalRounds
    );

  const bNow =
    Math.min(
      duelRound.b.index + 1,
      duelTotalRounds
    );

  label.textContent =
    "A " + aNow + "/" + duelTotalRounds +
    "   •   B " + bNow + "/" + duelTotalRounds;
}

function renderDuelSideRound(side) {

  if (!duelActive) return;

  const state =
    duelRound[side];

  if (state.finished) return;

  const item =
    state.pool[state.index];

  if (!item) {
    state.finished = true;
    checkDuelBothFinished();
    return;
  }

  state.item = item;

  state.correct =
    String(
      item.a ??
      item.answer ??
      ""
    ).trim();

  state.answered = false;
  state.startedAt = Date.now();

  renderDuelSide(side, item);

  updateDuelRoundLabel();

  updateDuelStatsUI();

  startDuelRoundTimer(side);
}

function checkDuelBothFinished() {

  if (
    duelRound.a.finished &&
    duelRound.b.finished
  ) {
    finishDuel();
  }
}

function renderDuelSide(side, item) {

  const qBox =
    $(
      side === "a"
        ? "duelAQText"
        : "duelBQText"
    );

  const optBox =
    $(
      side === "a"
        ? "duelAAnswers"
        : "duelBAnswers"
    );

  if (!qBox || !optBox) return;

  qBox.textContent =
    item.q ??
    item.question ??
    "";

  const correct =
    duelRound[side].correct;

  const options =
    buildAnswerOptions(
      correct,
      item
    );

  optBox.innerHTML = "";

  options.forEach(
    (answer, i) => {

      const btn =
        document.createElement(
          "button"
        );

      btn.type = "button";
      btn.className =
        "answerOption duelAnswerBtn";

      btn.dataset.answer =
        answer;

      btn.innerHTML = `
        <span class="answerLetter">
          ${String.fromCharCode(
            65 + i
          )}
        </span>
        <span class="answerText"></span>
      `;

      btn.querySelector(
        ".answerText"
      ).textContent =
        answer;

      btn.onclick = () =>
        handleDuelAnswer(
          side,
          btn,
          answer,
          correct
        );

      optBox.appendChild(
        btn
      );
    }
  );
}

function startDuelRoundTimer(side) {

  const state =
    duelRound[side];

  clearInterval(
    state.timer
  );

  state.timeLeft =
    userTimer || 10;

  const el =
    $(
      side === "a"
        ? "duelATimer"
        : "duelBTimer"
    );

  if (el) {
    el.textContent =
      state.timeLeft;
  }

  state.timer = setInterval(
    () => {

      state.timeLeft--;

      if (el) {
        el.textContent =
          Math.max(
            0,
            state.timeLeft
          );
      }

      if (state.timeLeft <= 0) {

        clearInterval(
          state.timer
        );

        /*
         * Vaqt tugasa, shu
         * tomon javob bermagan
         * bo'lsa avtomatik xato
         * deb hisoblanadi — bu
         * boshqa tomonga ta'sir
         * qilmaydi.
         */
        if (!state.answered) {
          resolveDuelSide(
            side,
            false,
            true
          );
        }

      }

    },
    1000
  );
}

function handleDuelAnswer(
  side,
  button,
  selected,
  correct
) {

  if (
    !duelActive ||
    duelRound[side].answered
  ) {
    return;
  }

  const isCorrect =
    String(selected).trim() ===
    String(correct).trim();

  const optBox =
    $(
      side === "a"
        ? "duelAAnswers"
        : "duelBAnswers"
    );

  optBox
    ?.querySelectorAll(
      ".duelAnswerBtn"
    )
    .forEach(btn => {

      btn.disabled = true;

      const value =
        String(
          btn.dataset.answer ??
          ""
        ).trim();

      if (
        value ===
        String(correct).trim()
      ) {
        btn.classList.add(
          "correct"
        );
      }

      if (
        btn === button &&
        !isCorrect
      ) {
        btn.classList.add(
          "wrong"
        );
      }

    });

  resolveDuelSide(
    side,
    isCorrect,
    false
  );
}

function resolveDuelSide(
  side,
  isCorrect,
  timedOut
) {

  if (duelRound[side].answered) {
    return;
  }

  duelRound[side].answered =
    true;

  const timeMs =
    timedOut
      ? (userTimer || 10) * 1000
      : Date.now() -
        duelRound[side].startedAt;

  duelStats[side].totalTimeMs +=
    timeMs;

  if (isCorrect) {
    duelStats[side].correct++;
  } else {
    duelStats[side].wrong++;
  }

  /*
   * Vaqt tugab javob berilmagan
   * bo'lsa ham, to'g'ri javobni
   * ko'rsatib qo'yamiz.
   */
  if (timedOut) {

    const optBox =
      $(
        side === "a"
          ? "duelAAnswers"
          : "duelBAnswers"
      );

    optBox
      ?.querySelectorAll(
        ".duelAnswerBtn"
      )
      .forEach(btn => {

        btn.disabled = true;

        const value =
          String(
            btn.dataset.answer ??
            ""
          ).trim();

        if (
          value ===
          duelRound[side].correct
        ) {
          btn.classList.add(
            "correct"
          );
        }

      });
  }

  updateDuelStatsUI();

  /*
   * Har bir tomon o'z javobidan
   * so'ng, IKKINCHI TOMONNI
   * KUTMASDAN, qisqa pauzadan
   * keyin darhol o'zining
   * navbatdagi savoliga o'tadi.
   */
  clearInterval(
    duelRound[side].timer
  );

  setTimeout(
    () => {

      if (!duelActive) return;

      duelRound[side].index++;

      if (
        duelRound[side].index >=
        duelRound[side].pool.length
      ) {
        duelRound[side].finished = true;
        checkDuelBothFinished();
      } else {
        renderDuelSideRound(side);
      }

    },
    1200
  );
}

function updateDuelStatsUI() {

  if ($("duelACorrect")) {
    $("duelACorrect").textContent =
      duelStats.a.correct;
  }

  if ($("duelAWrong")) {
    $("duelAWrong").textContent =
      duelStats.a.wrong;
  }

  if ($("duelBCorrect")) {
    $("duelBCorrect").textContent =
      duelStats.b.correct;
  }

  if ($("duelBWrong")) {
    $("duelBWrong").textContent =
      duelStats.b.wrong;
  }

  updateDuelProgressBar();
}

function updateDuelProgressBar() {

  const step =
    Number(pointStep) || 100;

  const scoreA =
    duelStats.a.correct * step -
    duelStats.a.wrong * step;

  const scoreB =
    duelStats.b.correct * step -
    duelStats.b.wrong * step;

  const diff =
    scoreA - scoreB;

  /*
   * 5 ball farqida "yo'l"
   * to'liq to'lgan bo'ladi.
   */
  const maxDiff =
    step * 5;

  const ratio =
    Math.max(
      -1,
      Math.min(
        1,
        diff / maxDiff
      )
    );

  const percent =
    Math.abs(ratio) * 50;

  const fillA =
    $("duelProgressFillA");

  const fillB =
    $("duelProgressFillB");

  const pctA =
    ratio > 0
      ? percent
      : 0;

  const pctB =
    ratio < 0
      ? percent
      : 0;

  if (fillA) {
    fillA.style.height =
      pctA + "%";
    fillA.style.width =
      pctA + "%";
  }

  if (fillB) {
    fillB.style.height =
      pctB + "%";
    fillB.style.width =
      pctB + "%";
  }
}

function finishDuel() {

  duelActive = false;

  clearInterval(duelRound.a.timer);
  clearInterval(duelRound.b.timer);

  const modal =
    $("duelModal");

  if (modal) {
    modal.style.display =
      "none";
  }

  /*
   * G'olibni aniqlaymiz:
   * ko'proq to'g'ri javob —
   * teng bo'lsa, tezroq javob
   * bergan g'olib bo'ladi.
   */
  const a = duelStats.a;
  const b = duelStats.b;

  let winnerSide = null;

  if (a.correct !== b.correct) {
    winnerSide =
      a.correct > b.correct
        ? "a"
        : "b";
  } else if (
    a.totalTimeMs !==
    b.totalTimeMs
  ) {
    winnerSide =
      a.totalTimeMs <
      b.totalTimeMs
        ? "a"
        : "b";
  }

  /*
   * Umumiy ball tizimiga
   * ham qo'shib qo'yamiz —
   * statistikalar boshqa
   * ekranlar bilan mos bo'lsin.
   */
  const step =
    Number(pointStep) || 100;

  const teamA =
    duelPlayers.a;

  const teamB =
    duelPlayers.b;

  if (teamA) {
    teamA.score +=
      a.correct * step -
      a.wrong * step;

    teamA.correctCount =
      (teamA.correctCount || 0) +
      a.correct;

    teamA.wrongCount =
      (teamA.wrongCount || 0) +
      a.wrong;

    updateTeamScoreUI(
      teamA
    );
  }

  if (teamB) {
    teamB.score +=
      b.correct * step -
      b.wrong * step;

    teamB.correctCount =
      (teamB.correctCount || 0) +
      b.correct;

    teamB.wrongCount =
      (teamB.wrongCount || 0) +
      b.wrong;

    updateTeamScoreUI(
      teamB
    );
  }

  showDuelResult(
    winnerSide,
    a,
    b
  );
}

function showDuelResult(
  winnerSide,
  a,
  b
) {

  const box =
    $("duelResultContent");

  if (!box) return;

  const nameA =
    duelPlayers.a?.name || "A";

  const nameB =
    duelPlayers.b?.name || "B";

  const secA =
    (a.totalTimeMs / 1000).toFixed(1);

  const secB =
    (b.totalTimeMs / 1000).toFixed(1);

  const winnerText =
    winnerSide === "a"
      ? `🏆 ${escapeHtml(nameA)} g‘olib!`
      : winnerSide === "b"
      ? `🏆 ${escapeHtml(nameB)} g‘olib!`
      : "🤝 Durrang!";

  box.innerHTML = `
    <div class="duelResultWinner">
      ${winnerText}
    </div>

    <div class="duelResultGrid">

      <div class="duelResultCard${
        winnerSide === "a"
          ? " isDuelWinner"
          : ""
      }">
        <strong>${escapeHtml(nameA)}</strong>
        <span>✅ ${a.correct} to‘g‘ri &nbsp; ❌ ${a.wrong} xato</span>
        <span>⏱ ${secA} soniya</span>
      </div>

      <div class="duelResultCard${
        winnerSide === "b"
          ? " isDuelWinner"
          : ""
      }">
        <strong>${escapeHtml(nameB)}</strong>
        <span>✅ ${b.correct} to‘g‘ri &nbsp; ❌ ${b.wrong} xato</span>
        <span>⏱ ${secB} soniya</span>
      </div>

    </div>
  `;

  const modal =
    $("duelResultModal");

  if (modal) {
    modal.style.display =
      "flex";
  }

  playWinSound();
}

function closeDuelResultModal() {

  const modal =
    $("duelResultModal");

  if (modal) {
    modal.style.display =
      "none";
  }
}

window.closeDuelResultModal =
  closeDuelResultModal;

function exitDuel() {

  duelActive = false;

  clearInterval(duelRound.a.timer);
  clearInterval(duelRound.b.timer);

  const modal =
    $("duelModal");

  if (modal) {
    modal.style.display =
      "none";
  }
}

function startTopicGame(topic) {

  if (!topic) return;

  if (gameFinalized) return;

  currentUserTopicId =
    topic.id;

  localStorage.setItem(
    "lastTopicId",
    topic.id
  );

  /*
   * Tanlangan mavzudagi barcha
   * savollarni bitta massivga yig‘amiz
   */
  currentTopicQuestions = [];

  Object.values(
    topic.questions || {}
  ).forEach(category => {

    if (!Array.isArray(category)) {
      return;
    }

    category.forEach(item => {

      if (item) {
        currentTopicQuestions.push(item);
      }

    });

  });

  if (!currentTopicQuestions.length) {

    alert(
      "Bu mavzuda savollar mavjud emas!"
    );

    return;
  }

  /*
   * Har o'yinda savollar
   * tasodifiy tartibda beriladi.
   */
  currentTopicQuestions =
    shuffleArray(
      currentTopicQuestions
    );

  /*
   * Solo statistikasini
   * yangi o'yin uchun tozalaymiz.
   */
  soloStats = {
    correct: 0,
    wrong: 0
  };

  /*
   * Hozirgi savoldan boshlaymiz
   */
  currentTopicQuestionIndex = 0;

  /*
   * Eski answer-options tizimi
   * uchun questionsni ham yangilaymiz.
   */
  questions = [
    currentTopicQuestions
  ];

  /*
   * Birinchi savol
   */
  openTopicQuestion();
}

function openTopicQuestion() {

  if (
    !currentTopicQuestions.length
  ) {
    return;
  }

  const item =
    currentTopicQuestions[
      currentTopicQuestionIndex
    ];

  if (!item) {

    declareWinner();

    return;
  }

  /*
   * Ball tizimi saqlanadi.
   */
  const score =
    Number(pointStep) || 100;

  /*
   * Eski openQ modal tizimini
   * ishlatamiz.
   *
   * Virtual cell kerak emas.
   */
  openQ(
    null,
    item,
    score
  );
}
/* ================= QUESTION ENGINE ================= */

function getAllAnswers() {
  const out = [];

  const cats =
    Array.isArray(questions)
      ? questions
      : Object.values(
          questions || {}
        );

  cats.forEach(
    cat =>
      (cat || []).forEach(
        item => {
          const a =
            String(
              item?.a ??
              item?.answer ??
              ""
            ).trim();

          if (a) {
            out.push(a);
          }
        }
      )
  );

  return [
    ...new Set(out)
  ];
}

function shuffleArray(arr) {
  const a = [...arr];

  for (
    let i = a.length - 1;
    i > 0;
    i--
  ) {
    const j =
      Math.floor(
        Math.random() *
          (i + 1)
      );

    [
      a[i],
      a[j]
    ] = [
      a[j],
      a[i]
    ];
  }

  return a;
}

function buildAnswerOptions(
  correctAnswer,
  questionItem
) {

  const correct =
    String(
      correctAnswer ?? ""
    ).trim();

  if (!correct) {
    return [];
  }

  const correctKey =
    correct.toLowerCase();

  /*
   * ==========================================
   * 1. EXCEL 3-4-5 USTUNLARDAGI JAVOBLAR
   * ==========================================
   */

  const manualWrong =
    Array.isArray(
      questionItem?.wrongAnswers
    )
      ? questionItem.wrongAnswers
          .map(
            answer =>
              String(
                answer ?? ""
              ).trim()
          )
          .filter(Boolean)
      : [];


  const wrongAnswers = [];


  /*
   * Excel'dan berilgan noto'g'ri
   * javoblarni qo'shamiz
   */

  manualWrong.forEach(
    answer => {

      const key =
        answer.toLowerCase();

      if (!key) {
        return;
      }

      if (
        key === correctKey
      ) {
        return;
      }

      if (
        wrongAnswers.some(
          x =>
            x.toLowerCase() ===
            key
        )
      ) {
        return;
      }

      wrongAnswers.push(
        answer
      );
    }
  );


  /*
   * ==========================================
   * 2. AGAR 3 TA TO'LMAGAN BO'LSA
   *    ESKI TIZIMDAGI KABI BOSHQA
   *    SAVOLLARDAN JAVOB OLAMIZ
   * ==========================================
   */

  if (
    wrongAnswers.length < 3
  ) {

    const fallback =
      getAllAnswers()
        .filter(
          answer => {

            const key =
              String(
                answer
              ).trim()
                .toLowerCase();

            if (!key) {
              return false;
            }

            if (
              key ===
              correctKey
            ) {
              return false;
            }

            return !wrongAnswers.some(
              x =>
                x.toLowerCase() ===
                key
            );
          }
        );


    const shuffled =
      shuffleArray(
        fallback
      );


    for (
      const answer
      of shuffled
    ) {

      if (
        wrongAnswers.length >= 3
      ) {
        break;
      }

      wrongAnswers.push(
        answer
      );
    }
  }


  /*
   * ==========================================
   * 3. TO'G'RI + 3 TA NOTO'G'RI
   * ==========================================
   */

  return shuffleArray([
    correct,
    ...wrongAnswers.slice(
      0,
      3
    )
  ]);
}

function ensureAnswerOptionsUI() {
  const modalBox =
    document.querySelector(
      "#modal .questionBox"
    );

  if (!modalBox) return null;

  let container =
    $("answerOptions");

  if (!container) {
    container =
      document.createElement(
        "div"
      );

    container.id =
      "answerOptions";

    container.className =
      "answerOptions";

    const q =
      $("qText");

    q?.parentNode?.insertBefore(
      container,
      q.nextSibling
    );

    if (!q) {
      modalBox.appendChild(
        container
      );
    }
  }

  return container;
}

function renderAnswerOptions(
  options,
  correctAnswer
) {
  const box =
    ensureAnswerOptionsUI();

  if (!box) return;

  box.innerHTML = "";

  options.forEach(
    (answer, i) => {
      const btn =
        document.createElement(
          "button"
        );

      btn.type =
        "button";

      btn.className =
        "answerOption";

      btn.dataset.answer =
        answer;

      btn.innerHTML = `
        <span class="answerLetter">
          ${String.fromCharCode(
            65 + i
          )}
        </span>

        <span class="answerText"></span>
      `;

      btn.querySelector(
        ".answerText"
      ).textContent =
        answer;

      btn.onclick =
        () =>
          handleAnswerSelection(
            btn,
            answer,
            correctAnswer
          );

      box.appendChild(
        btn
      );
    }
  );
}

function updateTurnIndicator() {

  const el =
    $("questionParticipants");

  const sideBox =
    $("participantsSideBox");

  const wrap =
    document.querySelector(
      ".questionModalWrap"
    );

  if (!el) return;

  if (!teamsData.length) {

    /*
     * Ishtirokchi tanlanmagan
     * bo'lsa (solo rejim),
     * o'ng panelni umuman
     * ko'rsatmaymiz — savol
     * qutisi butun kenglikni
     * egallaydi.
     */
    if (sideBox) {
      sideBox.style.display =
        "none";
    }

    wrap?.classList.add(
      "soloMode"
    );

    el.innerHTML = "";

    return;
  }

  if (sideBox) {
    sideBox.style.display =
      "";
  }

  wrap?.classList.remove(
    "soloMode"
  );

  /*
   * Ball bo'yicha (eng yuqoridan)
   * saralanadi — jonli reyting
   * ko'rinishida. Navbatdagi
   * ishtirokchi alohida belgi
   * bilan ajratiladi.
   */
  const sorted =
    [...teamsData].sort(
      (a, b) =>
        (b.score || 0) -
        (a.score || 0)
    );

  const cardsHtml = sorted
    .map(team => {

      const isCurrent =
        teamsData[
          currentTurnIndex
        ] === team;

      const p =
        findParticipant(
          team.participantId
        );

      return `
        <div class="qParticipantCard${
          isCurrent
            ? " isCurrentTurn"
            : ""
        }">

          <div class="qParticipantAvatar">
            <img
              src="${
                p?.image ||
                team.image ||
                avatarData(team.name)
              }"
              alt=""
            >
          </div>

          <div class="qParticipantInfo">

            <strong class="qParticipantName">
              ${escapeHtml(team.name)}
            </strong>

            <span class="qParticipantScore">
              ${Number(team.score || 0)} ball
            </span>

          </div>

          ${
            isCurrent
              ? `<span class="turnBadge">NAVBAT</span>`
              : ""
          }

        </div>
      `;

    })
    .join("");

  el.innerHTML =
    cardsHtml;
}

function getNextUnusedCell() {
  return [
    ...document.querySelectorAll(
      "#board .cell"
    )
  ].find(
    c =>
      !c.classList.contains(
        "used"
      )
  ) || null;
}

function getCellQuestion(cell) {
  const cells = [
    ...document.querySelectorAll(
      "#board .cell"
    )
  ];

  const index =
    cells.indexOf(cell);

  if (index < 0) {
    return null;
  }

  const row =
    Math.floor(
      index / 5
    );

  const col =
    index % 5;

  const cats =
    Array.isArray(questions)
      ? questions
      : Object.values(
          questions || {}
        );

  return (
    cats[col]?.[row] ||
    null
  );
}

function openQ(
  cell,
  item,
  score
) {

  if (!item) {
    return;
  }

  if (gameFinalized) {
    return;
  }

  clearInterval(timer);

  /*
   * Yangi topic tizimida
   * haqiqiy .cell yo‘q.
   */
  currentCell = null;

  currentValue =
    Number(score) || 0;

  currentQuestionItem =
    item;

  currentQuestionMultiplier =
    1;

  currentQuestionActive =
    true;

  gameInProgress =
    true;

  let questionText =
    String(
      item.q ??
      item.question ??
      ""
    );

  const match =
    questionText.match(
      /^\s*(\d+)x\s*/i
    );

  if (match) {

    currentQuestionMultiplier =
      Math.max(
        1,
        parseInt(
          match[1],
          10
        )
      );

    questionText =
      questionText.replace(
        /^\s*\d+x\s*/i,
        ""
      );

    showBonusEffect(
      currentValue,
      currentQuestionMultiplier
    );

    playBonusSound();
  }

  if ($("qText")) {

    $("qText").textContent =
      questionText;

  }

  $("aText")?.classList.add(
    "hidden"
  );

  renderAnswerOptions(
    buildAnswerOptions(
      item.a ??
      item.answer
    ),
    item.a ??
    item.answer
  );

  updateTurnIndicator();

  const modal =
    $("modal");

  if (modal) {

    modal.style.display =
      "flex";

    modal.classList.add(
      "show"
    );

  }

  clickSound
    ?.play()
    .catch(() => {});

  startTimer();
}

function startTimer() {
  clearInterval(timer);

  timeLeft =
    Math.max(
      1,
      Number(userTimer) || 10
    );

  const el =
    $("timer");

  if (el) {
    el.textContent =
      timeLeft;
  }

  timer =
    setInterval(
      () => {
        timeLeft--;

        if (el) {
          el.textContent =
            timeLeft;

          el.classList.remove(
            "timer-animate"
          );

          void el.offsetWidth;

          el.classList.add(
            "timer-animate"
          );

          if (
            timeLeft <= 3 &&
            timeLeft > 0
          ) {
            el.classList.add(
              "timer-last"
            );
          }
        }

        if (
          timeLeft <= 0
        ) {
          clearInterval(
            timer
          );

          handleTimeExpired();
        }
      },
      1000
    );
}

function handleAnswerSelection(
  button,
  selectedAnswer,
  correctAnswer
) {
  if (
    !currentQuestionActive
  ) {
    return;
  }

  clearInterval(timer);

  /*
   * Ishtirokchi tanlanmagan
   * bo'lsa ham (solo rejim)
   * javob ishlashi kerak.
   */
  const team =
    teamsData[
      currentTurnIndex
    ] || null;

  const selected =
    String(
      selectedAnswer ?? ""
    ).trim();

  const correct =
    String(
      correctAnswer ?? ""
    ).trim();

  const isCorrect =
    selected === correct;

  document
    .querySelectorAll(
      "#answerOptions .answerOption"
    )
    .forEach(btn => {
      btn.disabled =
        true;

      const value =
        String(
          btn.dataset.answer ??
          ""
        ).trim();

      if (
        value ===
        correct
      ) {
        btn.classList.add(
          "correct"
        );
      }

      if (
        btn === button &&
        !isCorrect
      ) {
        btn.classList.add(
          "wrong"
        );
      }
    });

  const points =
    isCorrect
      ? currentValue *
        currentQuestionMultiplier
      : -currentValue;

  if (team) {

    team.score +=
      points;

    if (isCorrect) {
      team.correctCount =
        (team.correctCount || 0) + 1;
    } else {
      team.wrongCount =
        (team.wrongCount || 0) + 1;
    }

    updateTeamScoreUI(
      team
    );

  } else {

    if (isCorrect) {
      soloStats.correct++;
    } else {
      soloStats.wrong++;
    }

  }

  showAnswerResult(
    isCorrect,
    points,
    team
  );

  setTimeout(
    () =>
      finishCurrentQuestionAndAdvance(),
    2600
  );
}

function handleTimeExpired() {
    if (
    !currentQuestionActive
  ) {
    return;
  }

  const team =
    teamsData[
      currentTurnIndex
    ] || null;

  const correct =
    String(
      currentQuestionItem?.a ??
      currentQuestionItem?.answer ??
      ""
    ).trim();

  document
    .querySelectorAll(
      "#answerOptions .answerOption"
    )
    .forEach(btn => {
      btn.disabled =
        true;

      if (
        String(
          btn.dataset.answer ??
          ""
        ).trim() ===
        correct
      ) {
        btn.classList.add(
          "correct"
        );
      }
    });

  if (team) {

    team.score -=
      currentValue;

    team.wrongCount =
      (team.wrongCount || 0) + 1;

    updateTeamScoreUI(
      team
    );

  } else {

    soloStats.wrong++;

  }

  const a =
    $("aText");

  if (a) {
    a.textContent =
      `⏰ Vaqt tugadi! −${currentValue} ball`;

    a.classList.remove(
      "hidden"
    );
  }

  setTimeout(
    () =>
      finishCurrentQuestionAndAdvance(),
    2600
  );
}

function showAnswerResult(
  isCorrect,
  points,
  team
) {
  const a =
    $("aText");

  if (!a) return;

  a.textContent =
    team
      ? `${
          isCorrect
            ? "✅ To‘g‘ri!"
            : "❌ Xato!"
        } ${
          points > 0
            ? "+"
            : ""
        }${points} ball — ${team.name}`
      : `${
          isCorrect
            ? "✅ To‘g‘ri!"
            : "❌ Xato!"
        }`;

  a.classList.remove(
    "hidden"
  );
}

function finishCurrentQuestionAndAdvance() {

  if (!currentQuestionActive) {
    return;
  }

  clearInterval(timer);

  currentQuestionActive =
    false;

  currentQuestionItem =
    null;

  currentCell =
    null;

  currentQuestionMultiplier =
    1;

  /*
   * Keyingi ishtirokchi
   */
  currentTurnIndex =
    teamsData.length
      ? (
          currentTurnIndex + 1
        ) %
        teamsData.length
      : 0;

  /*
   * Keyingi savol
   */
  currentTopicQuestionIndex++;

  /*
   * Barcha savollar tugagan bo‘lsa
   */
  if (
    currentTopicQuestionIndex >=
    currentTopicQuestions.length
  ) {

    closeModal(false);

    declareWinner();

    return;
  }

  /*
   * Keyingi savolni ochamiz
   */
  openTopicQuestion();
}

function allQuestionsUsed() {

  return (
    currentTopicQuestions.length > 0 &&
    currentTopicQuestionIndex >=
      currentTopicQuestions.length
  );

}

function finishQuestionRound() {
  finishCurrentQuestionAndAdvance();
}

function moveToNextParticipant() {
  finishCurrentQuestionAndAdvance();
}

function prepareNextParticipantTurn() {
  finishCurrentQuestionAndAdvance();
}

function showAnswer() {
  clearInterval(timer);

  const correct =
    String(
      currentQuestionItem?.a ??
      currentQuestionItem?.answer ??
      ""
    ).trim();

  document
    .querySelectorAll(
      "#answerOptions .answerOption"
    )
    .forEach(btn => {
      btn.disabled =
        true;

      if (
        String(
          btn.dataset.answer ??
          ""
        ).trim() ===
        correct
      ) {
        btn.classList.add(
          "correct"
        );
      }
    });

  const a =
    $("aText");

  if (a) {
    a.textContent =
      `💡 To‘g‘ri javob: ${correct}`;

    a.classList.remove(
      "hidden"
    );
  }
}

window.showAnswer =
  showAnswer;

window.handleTimeExpired =
  handleTimeExpired;

/* =========================================================
   CLOSE / PAUSE QUESTION
   Savol yopiladi, lekin savol YO'QOLMAYDI.
   Keyingi savol tanlansa o'yin davom etadi.
========================================================= */

function closeModal() {
  // Timer to'xtaydi
  clearInterval(timer);

  // O'yin vaqtincha pauza
  gameInProgress = false;

  // Savol oynasini yopish
  const modal = document.getElementById("modal");

  if (modal) {
    modal.style.display = "none";
  }

  // Variantlarni tozalash
  const answerOptions = document.getElementById("answerOptions");

  if (answerOptions) {
    answerOptions.innerHTML = "";
  }

  // Javob matnini yashirish
  const answerText = document.getElementById("aText");

  if (answerText) {
    answerText.classList.add("hidden");
    answerText.innerText = "";
  }

  console.log("⏸ Savol yopildi — o'yin pauzada.");
}
function showBonusEffect(
  points,
  multiplier
) {
  const el =
    $("bonusEffect");

  if (!el) return;

  el.textContent =
    `🔥 ${multiplier}X BONUS (${points * multiplier}) 🔥`;

  el.classList.remove(
    "hidden"
  );

  setTimeout(
    () =>
      el.classList.add(
        "hidden"
      ),
    1500
  );
}

function playBonusSound() {
  const s =
    $("bonusSound");

  s?.play().catch(
    () => {}
  );
}

/* ================= HISTORY / WINNER / FIREBASE ================= */

async function persistHistory() {
  const key =
    getGameHistoryLSKey();

  gameHistory = [];

  localStorage.setItem(
    key,
    JSON.stringify(
      gameHistory
    )
  );

  const ref =
    getUserDocRef();

  if (!ref || HISTORY_DISABLED || !navigator.onLine) return;

  try {
    await setDoc(
      ref,
      { gameHistory },
      { merge: true }
    );
  } catch (e) {
    console.warn(
      "history save:",
      e
    );
  }
}

async function clearGameHistoryAndDisableStorage() {
  gameHistory = [];

  const key =
    getGameHistoryLSKey();

  localStorage.setItem(
    key,
    JSON.stringify([])
  );

  await saveParticipants();

  const ref =
    getUserDocRef();

  if (ref && navigator.onLine) {
    try {
      await setDoc(
        ref,
        { gameHistory: [] },
        { merge: true }
      );
    } catch (e) {
      console.warn(
        "history clear:",
        e
      );
    }
  }

  renderGameHistory();
  renderParticipants();
}

window.clearGameHistoryAndDisableStorage =
  clearGameHistoryAndDisableStorage;

async function saveGameResult(
  sortedTeams
) {
  if (HISTORY_DISABLED) {
    return {
      id:
        "game_" +
        Date.now(),
      date:
        new Date().toISOString(),
      teams:
        sortedTeams.map(
          t => ({
            id: t.id,
            participantId:
              t.participantId ||
              null,
            name: t.name,
            score: t.score,
            image:
              t.image || "",
            correctCount:
              t.correctCount || 0,
            wrongCount:
              t.wrongCount || 0
          })
        ),
      synced: true
    };
  }

  const result = {
    id:
      "game_" +
      Date.now(),

    date:
      new Date().toISOString(),

    teams:
      sortedTeams.map(
        t => ({
          id: t.id,
          participantId:
            t.participantId ||
            null,
          name: t.name,
          score: t.score,
          image:
            t.image || "",
          correctCount:
            t.correctCount || 0,
          wrongCount:
            t.wrongCount || 0
        })
      ),

    synced: false
  };

  gameHistory.push(
    result
  );

  await persistHistory();

  result.synced =
    true;

  return result;
}

async function updateParticipantsStats(
  sortedTeams
) {
  const played =
    new Set(
      sortedTeams
        .map(
          t =>
            String(
              t.participantId
            )
        )
        .filter(Boolean)
    );

  const winnerId =
    sortedTeams[0]
      ?.participantId;

  participants =
    participants.map(
      p => {
        if (
          !played.has(
            String(p.id)
          )
        ) {
          return p;
        }

        return {
          ...p,

          games:
            (Number(
              p.games
            ) || 0) + 1,

          wins:
            String(p.id) ===
            String(winnerId)
              ? (
                  Number(
                    p.wins
                  ) || 0
                ) + 1
              : (
                  Number(
                    p.wins
                  ) || 0
                )
        };
      }
    );

  await saveParticipants();

  renderParticipants();
}

function recalculateStatsFromHistory() {
  if (
    HISTORY_DISABLED ||
    !Array.isArray(gameHistory) ||
    !gameHistory.length
  ) {
    if (Array.isArray(participants) && participants.length) {
      saveParticipants();
      renderParticipants();
    }
    return;
  }

  const byId = {};

  gameHistory.forEach(
    game => {
      const sorted =
        [...(
          game.teams ||
          []
        )].sort(
          (a, b) =>
            Number(b.score) -
            Number(a.score)
        );

      const winnerId =
        sorted[0]
          ?.participantId;

      (
        game.teams ||
        []
      ).forEach(t => {
        const key =
          t.participantId != null
            ? String(
                t.participantId
              )
            : normalizeName(
                t.name
              );

        if (!byId[key]) {
          byId[key] = {
            id:
              t.participantId ??
              key,

            name:
              t.name,

            games: 0,
            wins: 0,

            image:
              t.image || ""
          };
        }

        byId[key].games++;

        if (
          winnerId != null
            ? String(
                t.participantId
              ) ===
              String(
                winnerId
              )
            : normalizeName(
                t.name
              ) ===
              normalizeName(
                sorted[0]
                  ?.name
              )
        ) {
          byId[key].wins++;
        }
      });
    }
  );

  participants =
    Object.values(byId);

  saveParticipants();
  renderParticipants();
}

window.recalculateStatsFromHistory =
  recalculateStatsFromHistory;

async function declareWinner() {
  if (gameFinalized) {
    return;
  }

  gameFinalized =
    true;

  gameInProgress =
    false;

  clearInterval(timer);

  /*
   * ISHTIROKCHISIZ (SOLO) YAKUN
   */
  if (!teamsData.length) {

    showSoloResultModal();

    return;
  }

  const sorted =
    [...teamsData].sort(
      (a, b) =>
        b.score - a.score
    );

  try {
    await saveGameResult(
      sorted
    );

    await updateParticipantsStats(
      sorted
    );

    renderGameHistory();

    showWinnerModal(
      sorted
    );
  } catch (e) {
    console.error(
      "Winner save error:",
      e
    );
  }
}

function showSoloResultModal() {

  const modal =
    $("winnerModal");

  const text =
    $("winnerText");

  const rest =
    $("restWinners");

  if (!modal) return;

  const total =
    soloStats.correct +
    soloStats.wrong;

  const percent =
    total
      ? Math.round(
          (soloStats.correct /
            total) *
            100
        )
      : 0;

  text.innerHTML = `
    <div class="winnerHero soloHero">
      <div class="winnerCrown">
        🎯 O‘YIN YAKUNLANDI
      </div>

      <div>
        Yakka (solo) natija
      </div>

      <small>
        ✅ ${soloStats.correct} to‘g‘ri &nbsp; ❌ ${soloStats.wrong} xato &nbsp; (${percent}%)
      </small>
    </div>
  `;

  rest.innerHTML = "";

  modal.style.display =
    "flex";

  playWinSound();
  launchConfetti();

  clearTimeout(
    winnerTimer
  );

  winnerTimer =
    setTimeout(
      () => {
        modal.style.display =
          "none";

        stopConfetti();
        resetBoardOnly();
      },
      12000
    );
}

function renderGameHistory() {
  const box =
    $("historyList");

  if (!box) return;

  box.innerHTML = "";

  if (HISTORY_DISABLED) {
    box.innerHTML = `
      <div class="historyItem emptyHistory">
        <strong>O‘yin tarixi o‘chirilgan</strong>
        <span class="date">Mavjud emas</span>
      </div>
    `;
    return;
  }

  [
    ...gameHistory
  ]
    .reverse()
    .forEach(
      (
        game,
        reverseIndex
      ) => {
        const index =
          gameHistory.length -
          reverseIndex;

        const div =
          document.createElement(
            "div"
          );

        div.className =
          "historyItem";

        div.innerHTML = `
          <strong>
            ${index}-o‘yin
          </strong>

          <span class="date">
            ${new Date(
              game.date
            ).toLocaleDateString()}
          </span>

          <span class="time">
            ${new Date(
              game.date
            ).toLocaleTimeString()}
          </span>

          ${
            (
              game.teams ||
              []
            )
              .map(
                t =>
                  `<div class="teamScore">
                    ${escapeHtml(
                      t.name
                    )}: ${t.score}
                    ${
                      (t.correctCount != null || t.wrongCount != null)
                        ? `<span class="teamScoreStats">✅${t.correctCount || 0} ❌${t.wrongCount || 0}</span>`
                        : ""
                    }
                  </div>`
              )
              .join("")
          }
        `;

        const close =
          document.createElement(
            "button"
          );

        close.className =
          "closeBtn";

        close.textContent =
          "×";

        close.onclick =
          async () => {
            if (
              !confirm(
                "Bu o‘yin natijasi o‘chirilsinmi?"
              )
            ) {
              return;
            }

            gameHistory =
              gameHistory.filter(
                g =>
                  g.id !==
                    game.id &&
                  g.date !==
                    game.date
              );

            await persistHistory();

            renderGameHistory();
          };

        div.appendChild(
          close
        );

        box.appendChild(
          div
        );
      }
    );
}

async function loadGameHistorySafe() {
  const key =
    getGameHistoryLSKey();

  try {
    gameHistory =
      JSON.parse(
        localStorage.getItem(
          key
        )
      ) || [];
  } catch {
    gameHistory = [];
  }

  renderGameHistory();

  const ref =
    getUserDocRef();

  if (!ref) return;

  try {
    const snap =
      await getDoc(ref);

    const remote =
      snap.exists()
        ? snap.data()
            .gameHistory
        : null;

    if (
      Array.isArray(
        remote
      )
    ) {
      gameHistory =
        remote;

      localStorage.setItem(
        key,
        JSON.stringify(
          remote
        )
      );

      renderGameHistory();
    }
  } catch (e) {
    console.warn(
      "history load:",
      e
    );
  }
}

function showWinnerModal(
  sorted
) {
  const modal =
    $("winnerModal");

  const text =
    $("winnerText");

  const rest =
    $("restWinners");

  if (
    !modal ||
    !sorted.length
  ) {
    return;
  }

  const winner =
    sorted[0];

  const p =
    findParticipant(
      winner.participantId
    );

  const img =
    p?.image ||
    winner.image ||
    avatarData(
      winner.name
    );

  text.innerHTML = `
    <div class="winnerHero">
      <img
        class="winnerAvatar"
        src="${img}"
        alt=""
      >

      <div>
        <div class="winnerCrown">
          🏆 G‘OLIB
        </div>

        <div>
          ${escapeHtml(
            winner.name
          )}
        </div>

        <small>
          ${winner.score} ball
        </small>

        <div class="winnerStats">
          ✅ ${winner.correctCount || 0} to‘g‘ri &nbsp; ❌ ${winner.wrongCount || 0} xato
        </div>
      </div>
    </div>
  `;

  rest.innerHTML =
    sorted
      .slice(1)
      .map(
        (t, i) => {
          const tp =
            findParticipant(
              t.participantId
            );

          return `
            <div class="winnerRow">
              <span>
                #${i + 2}
              </span>

              <img
                src="${
                  tp?.image ||
                  t.image ||
                  avatarData(
                    t.name
                  )
                }"
                alt=""
              >

              <strong>
                ${escapeHtml(
                  t.name
                )}
              </strong>

              <b>
                ${t.score}
              </b>

              <span class="winnerRowStats">
                ✅${t.correctCount || 0} ❌${t.wrongCount || 0}
              </span>
            </div>
          `;
        }
      )
      .join("");

  modal.style.display =
    "flex";

  playWinSound();
  launchConfetti();

  clearTimeout(
    winnerTimer
  );

  winnerTimer =
    setTimeout(
      () => {
        modal.style.display =
          "none";

        stopConfetti();
        resetBoardOnly();
      },
      12000
    );
}

function playWinSound() {
  winnerSound
    ?.play()
    .catch(
      () => {}
    );
}

function launchConfetti() {
  const canvas =
    $("confetti");

  if (!canvas) return;

  stopConfetti();

  canvas.width =
    innerWidth;

  canvas.height =
    innerHeight;

  const ctx =
    canvas.getContext(
      "2d"
    );

  const ps =
    Array.from(
      {
        length: 140
      },
      () => ({
        x:
          Math.random() *
          canvas.width,

        y:
          -Math.random() *
          canvas.height,

        r:
          2 +
          Math.random() *
            5,

        v:
          2 +
          Math.random() *
            4,

        h:
          Math.random() *
          360
      })
    );

  const draw = () => {
    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    ps.forEach(
      p => {
        ctx.fillStyle =
          `hsl(${p.h},95%,60%)`;

        ctx.fillRect(
          p.x,
          p.y,
          p.r,
          p.r * 2
        );

        p.y += p.v;

        if (
          p.y >
          canvas.height
        ) {
          p.y = -10;
        }
      }
    );

    confettiFrame =
      requestAnimationFrame(
        draw
      );
  };

  draw();
}

function stopConfetti() {
  if (
    confettiFrame
  ) {
    cancelAnimationFrame(
      confettiFrame
    );
  }

  confettiFrame =
    null;

  const c =
    $("confetti");

  c
    ?.getContext("2d")
    ?.clearRect(
      0,
      0,
      c.width,
      c.height
    );
}

/* ================= RESET / SHUFFLE ================= */

function resetBoardOnly() {

  clearInterval(timer);

  currentTopicQuestionIndex = 0;

  currentQuestionActive = false;
  currentQuestionItem = null;
  currentCell = null;
  currentQuestionMultiplier = 1;

  gameFinalized = false;
  gameInProgress = false;

  currentTurnIndex = 0;

  teamsData.forEach(
    t => {
      t.score = 0;
      t.correctCount = 0;
      t.wrongCount = 0;
    }
  );

  soloStats = {
    correct: 0,
    wrong: 0
  };

  /*
   * Tanlangan mavzu bo‘yicha
   * savollarni qayta tayyorlaymiz
   */
  if (currentUserTopicId) {

    const topic =
      userTopics.find(
        t =>
          t.id ===
          currentUserTopicId
      );

    if (topic) {

      currentTopicQuestions = [];

      Object.values(
        topic.questions || {}
      ).forEach(category => {

        if (!Array.isArray(category)) {
          return;
        }

        category.forEach(item => {

          if (item) {
            currentTopicQuestions.push(
              item
            );
          }

        });

      });

      questions = [
        currentTopicQuestions
      ];
    }
  }

  renderTeams();
  renderParticipants();
  renderBoard();
}

window.resetBoardOnly =
  resetBoardOnly;

async function shuffleTopicQuestions() {

  if (!currentUserTopicId) {

    alert(
      "Avval mavzuni tanlang!"
    );

    return;
  }

  const topic =
    userTopics.find(
      t =>
        t.id ===
        currentUserTopicId
    );

  if (!topic) {
    return;
  }

  const allQuestions = [];

  Object.values(
    topic.questions || {}
  ).forEach(category => {

    if (!Array.isArray(category)) {
      return;
    }

    category.forEach(item => {

      if (item) {
        allQuestions.push(item);
      }

    });

  });

  if (allQuestions.length < 2) {

    alert(
      "Aralashtirish uchun savollar yetarli emas!"
    );

    return;
  }

  /*
   * Fisher-Yates
   */
  for (
    let i =
      allQuestions.length - 1;
    i > 0;
    i--
  ) {

    const j =
      Math.floor(
        Math.random() *
        (i + 1)
      );

    [
      allQuestions[i],
      allQuestions[j]
    ] = [
      allQuestions[j],
      allQuestions[i]
    ];

  }

  /*
   * MUHIM TUZATISH: savollarni
   * "shuffled" degan yangi kalitga
   * emas, balki 0-4 ustunlarga qaytadan
   * (aralashtirilgan tartibda) taqsimlab
   * saqlaymiz — aks holda boshqa joylarda
   * (masalan Excel eksport, board render)
   * ishlatiladigan 0-4 formatidan
   * uzilib qolib, keyingi saqlashlarda
   * savollar "yo'qolib qolgandek"
   * ko'rinar edi.
   */
  const reshuffled = {
    0: [],
    1: [],
    2: [],
    3: [],
    4: []
  };

  allQuestions.forEach(
    (item, i) => {
      reshuffled[i % 5].push(item);
    }
  );

  topic.questions = reshuffled;

  currentTopicQuestions =
    allQuestions;

  questions = [
    allQuestions
  ];

  currentTopicQuestionIndex =
    0;

  await saveTopics();

  renderUserTopics();

  renderBoard();

}

function shuffleQuestionsByButton() {
  shuffleTopicQuestions();
}

window.shuffleTopicQuestions =
  shuffleTopicQuestions;

window.shuffleQuestionsByButton =
  shuffleQuestionsByButton;

/* ================= OTHER TOPICS ================= */

let otherTopics = [];

async function loadOtherTopics() {
  if (
    !db ||
    !currentUserUid
  ) {
    return;
  }

  try {
    otherTopics = [];

    const snap =
      await getDocs(
        collection(
          db,
          "users"
        )
      );

    snap.docs.forEach(
      d => {
        if (
          d.id ===
          currentUserUid
        ) {
          return;
        }

        const data =
          d.data();

        if (
          Array.isArray(
            data.topics
          )
        ) {
          data.topics.forEach(
            t =>
              otherTopics.push({
                ...t,
                ownerId:
                  d.id,
                ownerName:
                  data.displayName ||
                  "Noma'lum"
              })
          );
        }
      }
    );

    renderOtherTopics("");
  } catch (e) {
    console.warn(
      "other topics:",
      e
    );
  }
}

function renderOtherTopics(
  filterText = ""
) {
  const box =
    $("otherTopicPanel");

  if (!box) return;

  box.innerHTML = "";

  const list =
    otherTopics.filter(
      t =>
        String(
          t.title || ""
        )
          .toLowerCase()
          .includes(
            filterText.toLowerCase()
          )
    );

  if (!list.length) {
    box.innerHTML =
      "<p>🔎 Mavzu topilmadi</p>";

    return;
  }

  list.forEach(
    topic => {
      const d =
        document.createElement(
          "div"
        );

      d.className =
        "topicCard otherTopic";

      const total =
        Object.values(
          topic.questions ||
            {}
        ).reduce(
          (s, c) =>
            s +
            (Array.isArray(c)
              ? c.length
              : 0),
          0
        );

      d.innerHTML = `
        <strong>
          ${escapeHtml(
            topic.title
          )}
        </strong>

        <span>
          ${total} ta savol
        </span>

        <small>
          👤 ${escapeHtml(
            topic.ownerName
          )}
        </small>
      `;

      d.onclick =
        () =>
          copyOtherTopicToMine(
            topic
          );

      box.appendChild(d);
    }
  );
}

async function copyOtherTopicToMine(
  topic
) {
  if (!topic) return;

  const copy = {
    ...topic,
    id:
      "topic_" +
      Date.now(),

    createdAt:
      Date.now()
  };

  delete copy.ownerId;
  delete copy.ownerName;

  userTopics.push(
    copy
  );

  renderUserTopics();

  await saveTopics();

  alert(
    `✅ "${topic.title}" mavzusi ko‘chirildi!`
  );
}

window.loadOtherTopics =
  loadOtherTopics;

window.copyOtherTopicToMine =
  copyOtherTopicToMine;

$("otherTopicSearchInput")
  ?.addEventListener(
    "input",
    e =>
      renderOtherTopics(
        e.target.value.trim()
      )
  );

/* ================= CHART ================= */

function renderStatsChart() {
  const ctx =
    $("statsChart");

  if (
    !ctx ||
    typeof Chart ===
      "undefined"
  ) {
    return;
  }

  new Chart(
    ctx,
    {
      type: "bar",

      data: {
        labels:
          participants.map(
            p => p.name
          ),

        datasets: [
          {
            label:
              "G‘alabalar",

            data:
              participants.map(
                p => p.wins
              )
          }
        ]
      }
    }
  );
}

window.renderStatsChart =
  renderStatsChart;

/* ================= PROFILE ================= */

const accountBtn =
  $("accountBtn");

const accountModal =
  $("accountModal");

const displayNameInput =
  $("displayNameInput");

const saveProfileBtn =
  $("saveProfileBtn");

accountBtn?.addEventListener(
  "click",
  () => {
    if (
      displayNameInput
    ) {
      displayNameInput.value =
        auth.currentUser
          ?.displayName ||
        "";
    }

    if (
      accountModal
    ) {
      accountModal.style.display =
        "flex";
    }
  }
);

window.closeAccountModal =
  () => {
    if (
      accountModal
    ) {
      accountModal.style.display =
        "none";
    }
  };

$("introPlayBtn")?.addEventListener(
  "click",
  () => {
    confirmStartTopicGame();
  }
);

$("introDuelBtn")?.addEventListener(
  "click",
  () => {
    confirmStartDuel();
  }
);

$("duelExitBtn")?.addEventListener(
  "click",
  () => {
    exitDuel();
  }
);

saveProfileBtn?.addEventListener(
  "click",
  async () => {
    const name =
      displayNameInput
        ?.value?.trim();

    if (!name) {
      return alert(
        "Iltimos ism kiriting!"
      );
    }

    try {
      await updateProfile(
        auth.currentUser,
        {
          displayName:
            name
        }
      );

      const ref =
        getUserDocRef();

      if (ref) {
        await updateDoc(
          ref,
          {
            displayName:
              name
          }
        );
      }

      window.closeAccountModal();
    } catch (e) {
      console.error(e);

      alert(
        "Xatolik yuz berdi"
      );
    }
  }
);

$("logoutBtn")
  ?.addEventListener(
    "click",
    () =>
      signOut(auth)
        .then(
          () =>
            location.href =
              "index.html"
        )
  );

/* ================= INIT ================= */

onAuthStateChanged(
  auth,
  async user => {
    if (!user) {
      location.href =
        "index.html";

      return;
    }

    currentUserUid =
      user.uid;

    localStorage.setItem(
      "uid",
      currentUserUid
    );

    await loadParticipants();

    await loadGameHistorySafe();

    await loadTopicsSafe();

    initSettings();

    restoreLastTopic();

    renderBoard();

    renderTeams();

    await loadOtherTopics();
  }
);

/* ================= TEMPLATE DOWNLOAD ================= */

$("downloadTemplateBtn")
  ?.addEventListener(
    "click",
    () => {
      const wb =
        XLSX.utils.book_new();

      const ws =
        XLSX.utils.aoa_to_sheet(
          [
            [
  "Question",
  "Answer",
  "Wrong Answer 1",
  "Wrong Answer 2",
  "Wrong Answer 3"
],

[
  "Savol matni",
  "To'g'ri javob",
  "Noto'g'ri javob 1",
  "Noto'g'ri javob 2",
  "Noto'g'ri javob 3"
],

[
  "Savol matni",
  "To'g'ri javob",
  "Noto'g'ri javob 1",
  "Noto'g'ri javob 2",
  "Noto'g'ri javob 3"
]
          ]
        );

      XLSX.utils.book_append_sheet(
        wb,
        ws,
        "Shablon"
      );

      XLSX.writeFile(
        wb,
        "BeksGame_Shablon.xlsx"
      );
    }
  );

/* Final public exports (single place to avoid duplicates) */
window.openQ = openQ;
window.closeModal = closeModal;
window.addTeamWithParticipant = addTeamWithParticipant;
window.addSelectedParticipantToTeam = addTeamWithParticipant;
window.addScore = addScore;