const PLAYER_COUNT = 100;
const ROUND_COUNT = 10;
const STORAGE_PREFIX = "ranking-100-state-v3";
const OLD_STORAGE_KEY = "ranking-100-state-v2";
const REMOTE_PATH_PREFIX = "ranking-100";

let remoteStateRef = null;
let remoteConnectionRef = null;
let remoteSaveTimer = null;
let storageAlertShownAt = 0;
let remoteStatus = {
  enabled: false,
  connected: false,
  error: ""
};

const GROUPS = [
  { id: "steam-l2-1", label: "STEAM-L2 1Gr" },
  { id: "steam-l2-2", label: "STEAM-L2 2Gr" },
  { id: "steam-l2-3", label: "STEAM-L2 3Gr" },
  { id: "steam-l2-4", label: "STEAM-L2 4Gr" },
  { id: "steam-class-elementary-3", label: "STEAM Class 초등 3학년" },
  { id: "steam-class-elementary-4", label: "STEAM Class 초등 4학년" },
  { id: "steam-class-elementary-5", label: "STEAM Class 초등 5학년" },
  { id: "steam-class-elementary-6", label: "STEAM Class 초등 6학년" },
  { id: "steam-class-middle", label: "STEAM Class 중등" }
];

function getCurrentGroup() {
  const params = new URLSearchParams(location.search);
  const requested = params.get("group");
  return GROUPS.find((group) => group.id === requested) || GROUPS[0];
}

function groupStorageKey(group = getCurrentGroup()) {
  return `${STORAGE_PREFIX}-${group.id}`;
}

function getClientId() {
  const key = `${STORAGE_PREFIX}-client-id`;
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const next = `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(key, next);
    return next;
  } catch {
    return `client-${Math.random().toString(36).slice(2, 10)}`;
  }
}

const CLIENT_ID = getClientId();

function pageUrl(pageName, group = getCurrentGroup()) {
  const url = new URL(pageName, location.href);
  url.searchParams.set("group", group.id);
  url.hash = "";
  return url.href;
}

function defaultState() {
  return {
    selectedRound: 1,
    view: "overall",
    players: Array.from({ length: PLAYER_COUNT }, (_, index) => ({
      id: index + 1,
      name: "",
      scores: Array(ROUND_COUNT).fill("")
    }))
  };
}

function normalizeState(source) {
  const base = defaultState();
  if (!source || !Array.isArray(source.players)) return base;
  return {
    selectedRound: Math.min(Math.max(Number(source.selectedRound) || 1, 1), ROUND_COUNT),
    view: source.view === "round" ? "round" : "overall",
    players: Array.from({ length: PLAYER_COUNT }, (_, index) => {
      const player = source.players[index] || {};
      const legacyName = /^참가자\s+\d+$/.test(String(player.name || "")) ? "" : player.name;
      return {
        id: index + 1,
        name: String(legacyName || "").trim(),
        scores: Array.from({ length: ROUND_COUNT }, (__, roundIndex) => {
          const value = player.scores?.[roundIndex];
          return value === 0 || value ? String(value) : "";
        })
      };
    })
  };
}

function saveLocalState(state) {
  try {
    localStorage.setItem(groupStorageKey(), JSON.stringify(normalizeState(state)));
  } catch {
    // Local storage can fail in private browsing or restricted browser modes.
  }
}

function remoteStorageRequired() {
  return window.RANKING_REQUIRE_REMOTE_STORAGE !== false;
}

function loadState() {
  const hashState = readStateFromHash();
  if (hashState) return hashState;

  if (remoteStorageRequired() && !remoteStateRef) return defaultState();

  try {
    const groupKey = groupStorageKey();
    const raw = localStorage.getItem(groupKey) || (
      getCurrentGroup().id === GROUPS[0].id ? localStorage.getItem(OLD_STORAGE_KEY) : null
    );
    return raw ? normalizeState(JSON.parse(raw)) : defaultState();
  } catch {
    return defaultState();
  }
}

function configValueReady(value) {
  const text = String(value || "").trim();
  return Boolean(text) && !text.includes("YOUR_");
}

function getFirebaseConfig() {
  const config = window.RANKING_FIREBASE_CONFIG;
  if (!config || typeof config !== "object") return null;

  const required = ["apiKey", "databaseURL", "projectId", "appId"];
  return required.every((key) => configValueReady(config[key])) ? config : null;
}

function remotePathPrefix() {
  return String(window.RANKING_FIREBASE_PATH_PREFIX || REMOTE_PATH_PREFIX)
    .replace(/^\/+|\/+$/g, "") || REMOTE_PATH_PREFIX;
}

function remoteGroupPath(group = getCurrentGroup()) {
  return `${remotePathPrefix()}/${group.id}`;
}

function setRemoteStatus(next) {
  remoteStatus = { ...remoteStatus, ...next };
  window.dispatchEvent(new CustomEvent("ranking-storage-status", {
    detail: { ...remoteStatus }
  }));
}

function getRemoteStatus() {
  return { ...remoteStatus };
}

function storageProblemMessage(action = "save") {
  const config = getFirebaseConfig();
  if (!config) {
    return `Cannot ${action}. firebase-config.js still has placeholder values. Add your real Firebase Realtime Database config and upload it to GitHub.`;
  }
  if (typeof firebase === "undefined" || !firebase.initializeApp || !firebase.database) {
    return `Cannot ${action}. Firebase scripts did not load. Check the network connection and GitHub Pages console.`;
  }
  if (remoteStatus.error) return `Cannot ${action}. ${remoteStatus.error}`;
  if (!remoteStateRef) return `Cannot ${action}. Shared cloud database is not initialized.`;
  return "";
}

function notifyStorageProblem(action = "save") {
  const message = storageProblemMessage(action);
  if (!message) return;

  const now = Date.now();
  if (now - storageAlertShownAt > 4000) {
    storageAlertShownAt = now;
    alert(message);
  }
}

function canWriteSharedState(action = "save", options = {}) {
  if (!remoteStorageRequired()) return true;
  if (remoteStateRef && !remoteStatus.error) return true;
  if (!options.silent) notifyStorageProblem(action);
  return false;
}

function initRemoteState() {
  if (remoteStateRef) return true;

  const config = getFirebaseConfig();
  if (!config || typeof firebase === "undefined" || !firebase.initializeApp || !firebase.database) {
    setRemoteStatus({
      enabled: false,
      connected: false,
      error: remoteStorageRequired() ? storageProblemMessage() : ""
    });
    return false;
  }

  try {
    const app = firebase.apps?.length ? firebase.app() : firebase.initializeApp(config);
    const database = firebase.database(app);
    remoteStateRef = database.ref(remoteGroupPath());
    remoteConnectionRef = database.ref(".info/connected");
    setRemoteStatus({ enabled: true, connected: false, error: "" });

    remoteConnectionRef.on("value", (snapshot) => {
      setRemoteStatus({ enabled: true, connected: snapshot.val() === true, error: "" });
    });

    return true;
  } catch (error) {
    setRemoteStatus({ enabled: false, connected: false, error: error.message || "Firebase connection failed." });
    return false;
  }
}

function writeRemoteState(state) {
  if (!canWriteSharedState("save")) return Promise.resolve(false);

  const payload = {
    state: normalizeState(state),
    updatedAt: firebase.database.ServerValue.TIMESTAMP,
    updatedBy: CLIENT_ID
  };

  return remoteStateRef.set(payload)
    .then(() => {
      saveLocalState(state);
      setRemoteStatus({ enabled: true, error: "" });
      return true;
    })
    .catch((error) => {
      setRemoteStatus({ enabled: true, error: error.message || "Firebase save failed." });
      notifyStorageProblem("save");
      return false;
    });
}

function saveState(state, options = {}) {
  const normalized = normalizeState(state);

  if (!canWriteSharedState("save")) return Promise.resolve(false);

  if (!remoteStorageRequired()) saveLocalState(normalized);

  if (!remoteStateRef) return Promise.resolve(normalized);
  if (options.immediate) {
    return writeRemoteState(normalized);
  }

  clearTimeout(remoteSaveTimer);
  remoteSaveTimer = setTimeout(() => {
    writeRemoteState(normalized);
  }, 250);

  return Promise.resolve(normalized);
}

function subscribeRemoteState(onState, options = {}) {
  if (!remoteStateRef) return () => {};

  let isInitialSnapshot = true;
  const handleValue = (snapshot) => {
    const payload = snapshot.val();
    if (!payload || !payload.state) {
      if (isInitialSnapshot && typeof options.onEmpty === "function") options.onEmpty();
      isInitialSnapshot = false;
      return;
    }

    const nextState = normalizeState(payload.state);
    saveLocalState(nextState);

    if (!isInitialSnapshot && payload.updatedBy === CLIENT_ID) {
      isInitialSnapshot = false;
      return;
    }

    isInitialSnapshot = false;
    onState(nextState, payload);
  };

  const handleError = (error) => {
    setRemoteStatus({ enabled: true, error: error.message || "Firebase read failed." });
  };

  remoteStateRef.on("value", handleValue, handleError);
  return () => remoteStateRef.off("value", handleValue);
}

function readStateFromHash() {
  if (!location.hash.startsWith("#data=")) return null;
  try {
    const encoded = location.hash.slice(6);
    const json = decodeURIComponent(escape(atob(encoded)));
    return normalizeState(JSON.parse(json));
  } catch {
    return null;
  }
}

function makeShareUrl(state, pageName = "student.html") {
  const url = new URL(pageName, location.href);
  url.searchParams.set("group", getCurrentGroup().id);
  url.hash = "";

  if (!remoteStateRef && !remoteStorageRequired()) {
    const json = JSON.stringify(normalizeState(state));
    const encoded = btoa(unescape(encodeURIComponent(json)));
    url.hash = `data=${encoded}`;
  }

  return url.href;
}

function hasName(player) {
  return Boolean(String(player.name || "").trim());
}

function visiblePlayers(state) {
  return state.players.filter(hasName);
}

function scoreValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatScore(value) {
  return scoreValue(value).toFixed(1);
}

function scoreFilled(value) {
  return value !== "" && Number.isFinite(Number(value));
}

function totalScore(player) {
  return player.scores.reduce((sum, value) => sum + scoreValue(value), 0);
}

function rankedPlayers(state, mode = "overall", includeBlank = false) {
  const roundIndex = state.selectedRound - 1;
  const source = includeBlank ? state.players : visiblePlayers(state);
  const rows = source.map((player) => ({
    ...player,
    total: totalScore(player),
    roundScore: scoreValue(player.scores[roundIndex])
  }));
  const scoreKey = mode === "round" ? "roundScore" : "total";

  rows.sort((a, b) => {
    if (b[scoreKey] !== a[scoreKey]) return b[scoreKey] - a[scoreKey];
    return a.id - b.id;
  });

  let previousScore = null;
  let previousRank = 0;
  rows.forEach((row, index) => {
    const score = row[scoreKey];
    row.rank = score === previousScore ? previousRank : index + 1;
    previousScore = score;
    previousRank = row.rank;
  });
  return rows;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function rankClass(rank) {
  if (rank === 1) return "gold";
  if (rank === 2) return "silver";
  if (rank === 3) return "bronze";
  return "";
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
