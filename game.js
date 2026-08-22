import { auth, db } from "./firebase.js";
import { signOut, onAuthStateChanged, updateProfile } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc, updateDoc, getDoc, getDocs, collection, writeBatch, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
let duelPool = [];
let duelRoundIndex = 0;
let duelTotalRounds = 0;
let duelTimer = null;
let duelTimeLeft = 0;

let duelPlayers = {
  a: null,
  b: null
};

let duelRound = {
  a: { item: null, correct: "", answered: false, startedAt: 0 },
  b: { item: null, correct: "", answered: false, startedAt: 0 }
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

    /*
     * Firestore "undefined"
     * qiymatlarni qabul qilmaydi
     * va bunda shovqinsiz xatolik
     * berib, statistika (wins/games)
     * saqlanmay qolishi mumkin edi.
     */
    const safeParticipants =
      JSON.parse(
        JSON.stringify(
          participants
        )
      );

    await setDoc(
      ref,
      { participants: safeParticipants },
      { merge: true }
    );
  } catch (e) {
    console.error(
      "Participant Firebase save XATOSI:",
      e
    );
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

  participants = participants.map(p => ({
    id: p.id ?? Date.now() + Math.random(),
    name: String(p.name ?? "Noma'lum"),
    wins: Number(p.wins) || 0,
    games: Number(p.games) || 0,
    image: p.image || ""
  }));

  renderParticipants();

  const ref = getUserDocRef();

  if (!ref) return;

  try {
    const snap = await getDoc(ref);

    const remote = snap.exists()
      ? snap.data().participants
      : null;

    if (Array.isArray(remote)) {
      participants = remote.map(p => ({
        id: p.id ?? Date.now() + Math.random(),
        name: String(p.name ?? "Noma'lum"),
        wins: Number(p.wins) || 0,
        games: Number(p.games) || 0,
        image: p.image || ""
      }));

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

async function resetParticipantStats(id) {

  const p =
    findParticipant(id);

  if (!p) return;

  participants =
    participants.map(x => {

      if (
        String(x.id) !==
        String(p.id)
      ) {
        return x;
      }

      return {
        ...x,
        games: 0,
        wins: 0
      };

    });

  await saveParticipants();

  renderParticipants();
}

window.resetParticipantStats =
  resetParticipantStats;

async function resetAllParticipantsStats() {

  if (!participants.length) {
    alert(
      "Hozircha ishtirokchi yo‘q."
    );
    return;
  }

  if (
    !confirm(
      "Barcha ishtirokchilarning statistikasi (o‘yin/g‘alaba soni) 0 ga tushirilsinmi? Bu amalni orqaga qaytarib bo‘lmaydi!"
    )
  ) {
    return;
  }

  participants =
    participants.map(
      x => ({
        ...x,
        games: 0,
        wins: 0
      })
    );

  await saveParticipants();

  renderParticipants();

  alert(
    "✅ Barcha ishtirokchilar statistikasi tozalandi!"
  );
}

window.resetAllParticipantsStats =
  resetAllParticipantsStats;

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
          class="resetParticipantStats"
          type="button"
          title="Statistikani 0 ga tushirish"
        >
          🔄
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
    e.target.closest(".resetParticipantStats") ||
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
      STATISTIKANI 0 GA TUSHURISH
    */
    div.querySelector(
      ".resetParticipantStats"
    ).onclick = async e => {

      e.stopPropagation();

      if (
        !confirm(
          `"${p.name}" ning statistikasi (o‘yin/g‘alaba soni) 0 ga tushirilsinmi?`
        )
      ) {
        return;
      }

      await resetParticipantStats(
        p.id
      );
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

  /*
   * MUHIM XATO TUZATILDI:
   * "Randomizer" (savollarni
   * aralashtirish) tugmasi
   * mavzuni {shuffled:[...]}
   * shaklga o'zgartirib
   * qo'yar edi, lekin bu yer
   * faqat eski 0-4 kategoriya
   * shaklini tanir edi — shu
   * sababli qayta yuklanganda
   * (boshqa brovser/qayta kirish)
   * savollar "yo'q" bo'lib
   * ko'rinar edi. Endi ikkala
   * shakl ham qo'llab-quvvatlanadi.
   */
  if (
    Array.isArray(obj.shuffled)
  ) {
    return [
      obj.shuffled,
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

async function saveTopics() {
  localStorage.setItem(
    getUserTopicsLSKey(),
    JSON.stringify(userTopics)
  );

  const ref =
    getUserDocRef();

  if (!ref) return;

  try {

    /*
     * MUHIM: Firestore "undefined"
     * qiymatlarni umuman qabul
     * qilmaydi va bunda setDoc
     * shovqinsiz (silent) xatolik
     * berib, hech narsa saqlamay
     * qo'yadi. Shu sabab avval
     * ma'lumotni JSON orqali
     * "tozalab" (undefined larsiz)
     * yuboramiz — shu Firestore'ga
     * yangi savollar saqlanmay
     * qolishining asosiy sababi edi.
     */
    const safeTopics =
      JSON.parse(
        JSON.stringify(
          userTopics
        )
      );

    await setDoc(
      ref,
      { topics: safeTopics },
      { merge: true }
    );

    /*
     * TEZLIK UCHUN MUHIM O'ZGARISH:
     * Avval "boshqalar mavzulari"ni
     * ko'rsatish uchun BARCHA
     * foydalanuvchilarning to'liq
     * hujjati (participants,
     * gameHistory bilan birga)
     * yuklab olinar edi — shu
     * sekinlikning asosiy sababi
     * edi. Endi har bir mavzu
     * alohida, yengil
     * "sharedTopics/{id}" hujjatiga
     * ham sinxronlanadi, shunda
     * boshqalar faqat shu kichik
     * kolleksiyani o'qiydi.
     */
    await syncSharedTopics(
      safeTopics
    );

  } catch (e) {

    console.error(
      "Topics Firebase save XATOSI:",
      e
    );

    alert(
      "⚠️ Mavzular/savollar serverga saqlanmadi!\n\n" +
      "Sababi: " +
      (e?.message || e) +
      "\n\nInternetni tekshirib, qayta urinib ko‘ring."
    );

  }
}

async function syncSharedTopics(
  topicsToSync
) {

  if (
    !db ||
    !currentUserUid
  ) {
    return;
  }

  const list =
    topicsToSync ||
    JSON.parse(
      JSON.stringify(
        userTopics
      )
    );

  if (!list.length) return;

  try {

    const batch =
      writeBatch(db);

    const ownerName =
      auth.currentUser
        ?.displayName ||
      "Noma'lum";

    list.forEach(t => {

      if (!t.id) return;

      batch.set(
        doc(
          db,
          "sharedTopics",
          t.id
        ),
        {
          ...t,
          ownerId:
            currentUserUid,
          ownerName
        },
        { merge: true }
      );

    });

    await batch.commit();

  } catch (e) {

    console.warn(
      "sharedTopics sync:",
      e
    );

  }
}

async function deleteSharedTopic(
  topicId
) {

  if (!db || !topicId) return;

  try {

    await deleteDoc(
      doc(
        db,
        "sharedTopics",
        topicId
      )
    );

  } catch (e) {

    console.warn(
      "sharedTopics delete:",
      e
    );

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

  /*
   * Mavzu o'chirilganda,
   * ulashilgan nusxasi ham
   * "sharedTopics" kolleksiyasidan
   * o'chirilishi kerak — aks
   * holda boshqalarga hali ham
   * ko'rinaveradi.
   */
  await deleteSharedTopic(
    topicId
  );
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

      await saveTopics();

      alert(
        "Excel muvaffaqiyatli yuklandi!"
      );
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

  pool = shuffleArray(pool);

  /*
   * Ikki tomonga BIR XIL savol
   * tushib qolmasligi uchun,
   * pool'ni ikkiga bo'lib,
   * har biriga alohida navbat
   * beramiz (A: juft, B: toq).
   */
  duelPool = pool;

  duelTotalRounds =
    Math.max(
      1,
      Math.floor(pool.length / 2)
    );

  duelRoundIndex = 0;

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

  renderDuelRound();
}

function renderDuelRound() {

  if (!duelActive) return;

  const itemA =
    duelPool[
      duelRoundIndex * 2
    ];

  const itemB =
    duelPool[
      duelRoundIndex * 2 + 1
    ];

  if (!itemA || !itemB) {
    finishDuel();
    return;
  }

  duelRound = {
    a: {
      item: itemA,
      correct: String(
        itemA.a ??
        itemA.answer ??
        ""
      ).trim(),
      answered: false,
      startedAt: Date.now()
    },
    b: {
      item: itemB,
      correct: String(
        itemB.a ??
        itemB.answer ??
        ""
      ).trim(),
      answered: false,
      startedAt: Date.now()
    }
  };

  if ($("duelRoundNow")) {
    $("duelRoundNow").textContent =
      duelRoundIndex + 1;
  }

  renderDuelSide("a", itemA);
  renderDuelSide("b", itemB);

  updateDuelStatsUI();

  startDuelRoundTimer();
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

function startDuelRoundTimer() {

  clearInterval(
    duelTimer
  );

  duelTimeLeft =
    userTimer || 10;

  const el =
    $("duelTimer");

  if (el) {
    el.textContent =
      duelTimeLeft;
  }

  duelTimer = setInterval(
    () => {

      duelTimeLeft--;

      if (el) {
        el.textContent =
          Math.max(
            0,
            duelTimeLeft
          );
      }

      if (duelTimeLeft <= 0) {

        clearInterval(
          duelTimer
        );

        /*
         * Vaqt tugasa, javob
         * bermagan tomon(lar)
         * avtomatik xato deb
         * hisoblanadi.
         */
        ["a", "b"].forEach(
          side => {

            if (
              !duelRound[side]
                .answered
            ) {
              resolveDuelSide(
                side,
                false,
                true
              );
            }

          }
        );

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
   * Ikkala tomon ham javob
   * berdimi? Berilgan bo'lsa,
   * qisqa pauzadan so'ng
   * keyingi raundga o'tamiz.
   */
  if (
    duelRound.a.answered &&
    duelRound.b.answered
  ) {

    clearInterval(
      duelTimer
    );

    setTimeout(
      () => {

        duelRoundIndex++;

        if (
          duelRoundIndex >=
          duelTotalRounds
        ) {
          finishDuel();
        } else {
          renderDuelRound();
        }

      },
      1800
    );

  }
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

  clearInterval(
    duelTimer
  );

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

  clearInterval(
    duelTimer
  );

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

  localStorage.setItem(
    key,
    JSON.stringify(
      gameHistory
    )
  );

  const ref =
    getUserDocRef();

  if (!ref) return;

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

async function saveGameResult(
  sortedTeams
) {
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

  /*
   * MUHIM TUZATISH: ishtirokchi
   * statistikasi (g'alaba/o'yin
   * soni) avval tarix saqlashga
   * ("saveGameResult") qattiq
   * bog'liq edi — agar tarix
   * saqlashda birror xatolik
   * chiqsa (tarmoq va h.k.),
   * statistika UMUMAN
   * yangilanmay qolar edi. Endi
   * ikkalasi bir-biridan mustaqil,
   * shu sabab statistika har doim
   * yangilanadi, hatto tarix
   * saqlanmasa ham.
   */
  try {
    await saveGameResult(
      sorted
    );

    renderGameHistory();
  } catch (e) {
    console.error(
      "Game history save error:",
      e
    );
  }

  try {
    await updateParticipantsStats(
      sorted
    );
  } catch (e) {
    console.error(
      "Participant stats update error:",
      e
    );
  }

  showWinnerModal(
    sorted
  );
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

            recalculateStatsFromHistory();
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
   * Muhim:
   * 5 ta ustunga bo‘lmaymiz.
   *
   * Bitta massiv sifatida
   * saqlaymiz.
   */
  topic.questions = {
    shuffled: allQuestions
  };

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

    /*
     * TEZLASHTIRISH: avval BARCHA
     * foydalanuvchilarning to'liq
     * hujjati (har birining
     * participants+gameHistory
     * bilan birga) yuklanardi —
     * bu foydalanuvchilar ko'paygan
     * sari doimiy sekinlashib
     * borar edi. Endi faqat
     * yengil "sharedTopics"
     * kolleksiyasi o'qiladi —
     * har bir hujjatda faqat
     * bitta mavzu bor, boshqa
     * hech narsa yo'q.
     */
    const snap =
      await getDocs(
        collection(
          db,
          "sharedTopics"
        )
      );

    snap.docs.forEach(
      d => {
        const data =
          d.data();

        if (
          data.ownerId ===
          currentUserUid
        ) {
          return;
        }

        otherTopics.push({
          ...data,
          id:
            data.id || d.id
        });
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

/* =========================================================
   O'QITUVCHI QULFI (TEACHER LOCK)
   O'quvchilar mavzu/ishtirokchini bilmasdan
   o'chirib yubormasligi uchun — boshqaruv
   funksiyalari PIN kod bilan qulflanadi.
========================================================= */

let teacherUnlocked = false;

function getTeacherPinKey() {
  return (
    "teacherPin_" +
    (currentUserUid || "guest")
  );
}

function getTeacherPin() {
  return localStorage.getItem(
    getTeacherPinKey()
  );
}

function setTeacherPin(pin) {
  localStorage.setItem(
    getTeacherPinKey(),
    pin
  );
}

function applyLockUI() {

  document.body.classList.toggle(
    "teacherLocked",
    !teacherUnlocked
  );

  const btn =
    $("teacherLockBtn");

  if (btn) {
    btn.textContent =
      teacherUnlocked
        ? "🔓"
        : "🔒";

    btn.title =
      teacherUnlocked
        ? "Boshqaruv ochiq — qulflash uchun bosing"
        : "Boshqaruv qulflangan — ochish uchun bosing";
  }
}

function openTeacherLockModal() {

  /*
   * Allaqachon ochiq bo'lsa —
   * PIN so'ralmasdan darhol
   * qayta qulflanadi.
   */
  if (teacherUnlocked) {
    teacherUnlocked = false;
    applyLockUI();
    return;
  }

  const hasPin =
    !!getTeacherPin();

  const title =
    $("teacherLockTitle");

  const hint =
    $("teacherLockHint");

  const input =
    $("teacherLockPinInput");

  const submitBtn =
    $("teacherLockSubmitBtn");

  if (title) {
    title.textContent =
      hasPin
        ? "Boshqaruvni ochish"
        : "PIN kod o‘rnating";
  }

  if (hint) {
    hint.textContent =
      hasPin
        ? "Boshqaruv funksiyalarini (mavzu/ishtirokchi o‘chirish, sozlamalar) ochish uchun PIN kodni kiriting."
        : "Bu birinchi marta ishlatilyapti — o‘zingiz uchun PIN kod o‘rnating. Bu kod orqali keyinchalik boshqaruvni ochasiz.";
  }

  if (input) {
    input.value = "";
  }

  if (submitBtn) {
    submitBtn.textContent =
      hasPin
        ? "Ochish"
        : "O‘rnatish";
  }

  const modal =
    $("teacherLockModal");

  if (modal) {
    modal.style.display =
      "flex";
  }

  setTimeout(
    () =>
      input?.focus(),
    50
  );
}

function closeTeacherLockModal() {

  const modal =
    $("teacherLockModal");

  if (modal) {
    modal.style.display =
      "none";
  }
}

window.closeTeacherLockModal =
  closeTeacherLockModal;

function submitTeacherLockPin() {

  const input =
    $("teacherLockPinInput");

  const pin =
    (input?.value || "").trim();

  if (!pin) {
    alert(
      "PIN kodni kiriting!"
    );
    return;
  }

  const hasPin =
    !!getTeacherPin();

  if (!hasPin) {

    if (pin.length < 4) {
      alert(
        "PIN kod kamida 4 ta belgidan iborat bo‘lsin!"
      );
      return;
    }

    setTeacherPin(pin);

    teacherUnlocked = true;

    applyLockUI();

    closeTeacherLockModal();

    alert(
      "✅ PIN kod o‘rnatildi va boshqaruv ochildi. Bu kodni eslab qoling — Profil bo‘limidan o‘zgartirishingiz mumkin!"
    );

    return;
  }

  if (pin === getTeacherPin()) {

    teacherUnlocked = true;

    applyLockUI();

    closeTeacherLockModal();

  } else {

    alert(
      "❌ PIN kod noto‘g‘ri!"
    );

  }
}

$("teacherLockBtn")?.addEventListener(
  "click",
  () => {
    openTeacherLockModal();
  }
);

$("teacherLockSubmitBtn")?.addEventListener(
  "click",
  () => {
    submitTeacherLockPin();
  }
);

$("teacherLockPinInput")?.addEventListener(
  "keydown",
  e => {
    if (e.key === "Enter") {
      submitTeacherLockPin();
    }
  }
);

$("savePinBtn")?.addEventListener(
  "click",
  () => {

    const input =
      $("teacherPinInput");

    const pin =
      (input?.value || "").trim();

    if (!pin) {
      alert(
        "Yangi PIN kodni kiriting!"
      );
      return;
    }

    if (pin.length < 4) {
      alert(
        "PIN kod kamida 4 ta belgidan iborat bo‘lsin!"
      );
      return;
    }

    setTeacherPin(pin);

    if (input) {
      input.value = "";
    }

    alert(
      "✅ Yangi PIN kod saqlandi!"
    );

  }
);

/*
 * Boshlang'ich holat — sahifa
 * har ochilganda XAVFSIZLIK
 * uchun avtomatik QULFLANGAN
 * holatda boshlanadi.
 */
applyLockUI();

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

    /*
     * Eski usulda saqlangan
     * mavzularni ("users" hujjati
     * ichida) yangi, tez ishlaydigan
     * "sharedTopics" kolleksiyasiga
     * fonda ko'chirib qo'yamiz —
     * UI'ni kutdirmaslik uchun
     * await qilinmaydi.
     */
    syncSharedTopics();
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