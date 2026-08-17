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
let userTimer = 10;
let timer = null;
let timeLeft = 0;
let currentUserTopicId = null;
let userTopics = [];
let pointStep = 100;
let pointMode = "fixed";
let participants = [];
let currentQuestionMultiplier = 1;
let currentQuestionItem = null;
let currentTurnIndex = 0;
let currentQuestionActive = false;
let gameFinalized = false;
let confettiFrame = null;
let winnerTimer = null;

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

function addSelectedParticipantToTeam(
  participant
) {
  addTeamWithParticipant(
    participant
  );
}

window.addSelectedParticipantToTeam =
  addSelectedParticipantToTeam;

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
    score: 0
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

async function saveTopics() {
  localStorage.setItem(
    getUserTopicsLSKey(),
    JSON.stringify(userTopics)
  );

  const ref =
    getUserDocRef();

  if (!ref) return;

  try {
    await setDoc(
      ref,
      { topics: userTopics },
      { merge: true }
    );
  } catch (e) {
    console.warn(e);
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
  const container =
    $("userTopicPanel");

  if (!container) return;

  container.innerHTML = "";

  userTopics.forEach(
    topic => {
      const div =
        document.createElement("div");

      div.className =
        "topicCard";

      const total =
        Object.values(
          topic.questions || {}
        ).reduce(
          (s, c) =>
            s +
            (Array.isArray(c)
              ? c.length
              : 0),
          0
        );

      div.innerHTML = `
        <strong>
          ${escapeHtml(
            topic.title
          )}
        </strong>

        <span>
          ${total} ta savol
        </span>

        <div class="topicActions">
          <button class="editBtn">
            ✏️
          </button>

          <button class="deleteBtn">
            🗑
          </button>
        </div>
      `;

      div.onclick =
        () =>
          selectUserTopic(
            topic.id
          );

      div.querySelector(
        ".editBtn"
      ).onclick = e => {
        e.stopPropagation();
        editUserTopicTitle(
          topic.id
        );
      };

      div.querySelector(
        ".deleteBtn"
      ).onclick = e => {
        e.stopPropagation();
        deleteUserTopic(
          topic.id
        );
      };

      container.appendChild(
        div
      );
    }
  );
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
      t => t.id === topicId
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

  renderBoard();
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

async function importExcelForUserTopic() {
  if (!currentUserTopicId) {
    return alert(
      "Avval topic tanlang!"
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
        currentUserTopicId
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

function renderBoard() {

  const topicNameEl = $("currentTopicName");

if (topicNameEl) {

  const currentTopic =
    userTopics.find(
      t => t.id === currentUserTopicId
    );

  topicNameEl.textContent =
    currentTopic
      ? ` — ${currentTopic.title}`
      : "";

}
  const board =
    $("board");

  if (!board) return;

  board.innerHTML = "";

  const cats =
    Array.isArray(questions)
      ? questions
      : Object.values(
          questions || {}
        );

  const maxRows =
    Math.max(
      0,
      ...cats.map(
        c => c.length
      )
    );

  for (
    let r = 0;
    r < maxRows;
    r++
  ) {
    for (
      let c = 0;
      c < 5;
      c++
    ) {
      const item =
        cats[c]?.[r];

      const cell =
        document.createElement(
          "div"
        );

      cell.className =
        "cell";

      if (!item) {
        cell.classList.add(
          "used"
        );
      } else {
        const score =
          pointMode === "fixed"
            ? pointStep
            : (r + 1) *
              pointStep;

        cell.textContent =
          score;

        cell.onclick =
          () =>
            openQ(
              cell,
              item,
              score
            );
      }

      board.appendChild(
        cell
      );
    }
  }
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
   * 1. EXCEL 3-4-5 USTUNLARIDAGI JAVOBLAR
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
      "#modal .modal-box"
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

function ensureTurnIndicatorUI() {
  const modalBox =
    document.querySelector(
      "#modal .modal-box"
    );

  if (!modalBox) return null;

  let el =
    $("currentTurnIndicator");

  if (!el) {
    el =
      document.createElement(
        "div"
      );

    el.id =
      "currentTurnIndicator";

    el.className =
      "currentTurnIndicator";

    const top =
      modalBox.querySelector(
        ".questionTop"
      );

    top
      ? top.insertBefore(
          el,
          top.firstChild
        )
      : modalBox.prepend(el);
  }

  return el;
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
    ensureTurnIndicatorUI();

  const team =
    teamsData[
      currentTurnIndex
    ];

  if (!el) return;

  if (!team) {
    el.textContent =
      "👤 Ishtirokchi yo‘q";

    return;
  }

  el.innerHTML = `
  <span class="turnLabel">
    NAVBAT
  </span>

  <div class="turnParticipant">

    <div class="turnParticipantImage">
      <img
        src="${
          findParticipant(team.participantId)?.image ||
          team.image ||
          avatarData(team.name)
        }"
        alt=""
      >
    </div>

    <div class="turnParticipantData">

      <strong class="turnParticipantName">
        ${escapeHtml(team.name)}
      </strong>

      <span class="turnParticipantPoints">
        ${Number(team.score || 0)} ball
      </span>

    </div>

  </div>
`;
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
  if (
    !cell ||
    cell.classList.contains(
      "used"
    ) ||
    !item
  ) {
    return;
  }

  if (!teamsData.length) {
    return alert(
      "Avval ishtirokchi qo‘shing!"
    );
  }

  if (gameFinalized) return;

  clearInterval(timer);

  currentCell =
    cell;

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
    item.answer,
    item
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

window.openQ =
  openQ;

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
    !currentQuestionActive ||
    !teamsData[
      currentTurnIndex
    ]
  ) {
    return;
  }

  clearInterval(timer);

  const team =
    teamsData[
      currentTurnIndex
    ];

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

  team.score +=
    points;

  updateTeamScoreUI(
    team
  );

  showAnswerResult(
    isCorrect,
    points,
    team
  );

  setTimeout(
    () =>
      finishCurrentQuestionAndAdvance(),
    850
  );
}

function handleTimeExpired() {
    if (
    !currentQuestionActive ||
    !teamsData[
      currentTurnIndex
    ]
  ) {
    return;
  }

  const team =
    teamsData[
      currentTurnIndex
    ];

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

  team.score -=
    currentValue;

  updateTeamScoreUI(
    team
  );

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
    850
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
    `${
      isCorrect
        ? "✅ To‘g‘ri!"
        : "❌ Xato!"
    } ${
      points > 0
        ? "+"
        : ""
    }${points} ball — ${team.name}`;

  a.classList.remove(
    "hidden"
  );
}

function finishCurrentQuestionAndAdvance() {
  if (
    !currentQuestionActive
  ) {
    return;
  }

  clearInterval(timer);

  if (currentCell) {
    currentCell.classList.add(
      "used"
    );

    currentCell.textContent =
      "";
  }

  currentQuestionActive =
    false;

  currentQuestionItem =
    null;

  currentCell =
    null;

  currentQuestionMultiplier =
    1;

  if (allQuestionsUsed()) {
    closeModal(false);
    declareWinner();
    return;
  }

  currentTurnIndex =
    teamsData.length
      ? (
          currentTurnIndex + 1
        ) %
        teamsData.length
      : 0;

  const nextCell =
    getNextUnusedCell();

  const nextItem =
    getCellQuestion(
      nextCell
    );

  if (
    !nextCell ||
    !nextItem
  ) {
    declareWinner();
    return;
  }

  const nextScore =
    Number(
      nextCell.textContent
    ) || pointStep;

  openQ(
    nextCell,
    nextItem,
    nextScore
  );
}

function allQuestionsUsed() {
  const cells = [
    ...document.querySelectorAll(
      "#board .cell"
    )
  ];

  return (
    cells.length > 0 &&
    cells.every(
      c =>
        c.classList.contains(
          "used"
        )
    )
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
            t.image || ""
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
  if (
    gameFinalized ||
    !teamsData.length
  ) {
    return;
  }

  gameFinalized =
    true;

  gameInProgress =
    false;

  clearInterval(timer);

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

  document
    .querySelectorAll(
      "#board .cell"
    )
    .forEach(cell => {
      cell.classList.remove(
        "used"
      );

      const q =
        getCellQuestion(
          cell
        );

      if (q) {
        const index =
          [
            ...document.querySelectorAll(
              "#board .cell"
            )
          ].indexOf(cell);

        const row =
          Math.floor(
            index / 5
          );

        cell.textContent =
          pointMode ===
          "fixed"
            ? pointStep
            : (row + 1) *
              pointStep;
      } else {
        cell.classList.add(
          "used"
        );
      }
    });

  teamsData.forEach(
    t =>
      (t.score = 0)
  );

  gameFinalized =
    false;

  gameInProgress =
    false;

  currentTurnIndex =
    0;

  renderTeams();
  renderParticipants();
}

window.resetBoardOnly =
  resetBoardOnly;

function shuffleTopicQuestions() {
  const all =
    (
      Array.isArray(
        questions
      )
        ? questions
        : Object.values(
            questions || {}
          )
    ).flat();

  if (!all.length) {
    return alert(
      "Savollar mavjud emas!"
    );
  }

  const shuffled =
    shuffleArray(all);

  const next = [
    [],
    [],
    [],
    [],
    []
  ];

  shuffled.forEach(
    (q, i) =>
      next[
        i % 5
      ].push(q)
  );

  questions =
    next;

  const topic =
    userTopics.find(
      t =>
        t.id ===
        currentUserTopicId
    );

  if (topic) {
    topic.questions =
      next;

    saveTopics();
  }

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

window.openQ =
  openQ;

window.closeModal =
  closeModal;

window.addTeamWithParticipant =
  addTeamWithParticipant;

window.addScore =
  addScore;