const ADMIN_PASSWORD = "1234";
const currentGroup = getCurrentGroup();
initRemoteState();

function initAdminLock() {
  const lock = document.querySelector("#adminLock");
  const form = document.querySelector("#adminLockForm");
  const password = document.querySelector("#adminPassword");
  const error = document.querySelector("#adminLockError");
  if (!lock || !form || !password || !error) return;

  const unlock = () => {
    document.body.classList.remove("admin-locked");
    lock.classList.add("is-unlocked");
  };

  document.body.classList.add("admin-locked");

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (password.value === ADMIN_PASSWORD) {
      unlock();
      return;
    }
    password.value = "";
    password.focus();
    error.textContent = "비밀번호가 올바르지 않습니다.";
  });
}

initAdminLock();

let state = loadState();

function mergeRemoteState(nextState) {
  const selectedRound = state.selectedRound;
  const view = state.view;
  state = normalizeState(nextState);
  state.selectedRound = selectedRound;
  state.view = view;
}

const els = {
  groupLabel: document.querySelector("#groupLabel"),
  homeLink: document.querySelector("#homeLink"),
  studentLink: document.querySelector("#studentLink"),
  roundButtons: document.querySelector("#roundButtons"),
  tableHead: document.querySelector("#tableHead"),
  tableBody: document.querySelector("#tableBody"),
  searchInput: document.querySelector("#searchInput"),
  sortMode: document.querySelector("#sortMode"),
  clearRound: document.querySelector("#clearRound"),
  activePlayers: document.querySelector("#activePlayers"),
  filledScores: document.querySelector("#filledScores"),
  topName: document.querySelector("#topName"),
  topScore: document.querySelector("#topScore"),
  playerSelect: document.querySelector("#playerSelect"),
  nameInput: document.querySelector("#nameInput"),
  nameFocus: document.querySelector("#nameFocus"),
  nameSave: document.querySelector("#nameSave"),
  nameList: document.querySelector("#nameList"),
  viewTitle: document.querySelector("#viewTitle"),
  viewSubtitle: document.querySelector("#viewSubtitle"),
  exportJson: document.querySelector("#exportJson"),
  importJson: document.querySelector("#importJson"),
  exportCsv: document.querySelector("#exportCsv"),
  fileInput: document.querySelector("#fileInput"),
  resetAll: document.querySelector("#resetAll"),
  copyStudentLink: document.querySelector("#copyStudentLink"),
  storageStatus: document.querySelector("#storageStatus")
};

document.title = `레고에듀케이션 STEAMedu 청라센터 ${currentGroup.label} 관리자`;
els.groupLabel.textContent = currentGroup.label;
els.homeLink.href = "./index.html";
els.studentLink.href = pageUrl("student.html");

function ensureStorageStatusElement() {
  if (els.storageStatus) return;
  const actions = document.querySelector(".actions");
  if (!actions) return;

  const status = document.createElement("span");
  status.className = "storage-status";
  status.id = "storageStatus";
  status.textContent = "Local only";
  actions.insertBefore(status, els.copyStudentLink || actions.firstChild);
  els.storageStatus = status;
}

function renderStorageStatus(status = getRemoteStatus()) {
  if (!els.storageStatus) return;
  document.body.classList.toggle("storage-unavailable", remoteStorageRequired() && (!status.enabled || Boolean(status.error)));
  els.storageStatus.classList.toggle("is-connected", status.enabled && status.connected && !status.error);
  els.storageStatus.classList.toggle("is-error", Boolean(status.error));

  if (status.error) {
    els.storageStatus.textContent = status.enabled ? "Cloud error" : "Cloud setup required";
    els.storageStatus.title = status.error;
    return;
  }
  if (status.enabled && status.connected) {
    els.storageStatus.textContent = "Cloud connected";
    els.storageStatus.title = "All visitors are using the same shared data.";
    return;
  }
  if (status.enabled) {
    els.storageStatus.textContent = "Cloud connecting";
    els.storageStatus.title = "Firebase is configured, but the connection is not ready yet.";
    return;
  }

  els.storageStatus.textContent = "Local only";
  els.storageStatus.title = "Firebase is not configured, so each device keeps separate data.";
}

ensureStorageStatusElement();

function filteredRows(rows) {
  const keyword = els.searchInput.value.trim().toLowerCase();
  let next = keyword
    ? rows.filter((row) => row.name.toLowerCase().includes(keyword) || String(row.id).includes(keyword))
    : rows;
  if (els.sortMode.value === "name") {
    next = [...next].sort((a, b) => a.name.localeCompare(b.name, "ko") || a.id - b.id);
  }
  if (els.sortMode.value === "score") {
    const key = state.view === "round" ? "roundScore" : "total";
    next = [...next].sort((a, b) => b[key] - a[key] || a.id - b.id);
  }
  return next;
}

function renderRoundButtons() {
  els.roundButtons.innerHTML = "";
  for (let round = 1; round <= ROUND_COUNT; round += 1) {
    const button = document.createElement("button");
    button.className = `round-btn ${round === state.selectedRound ? "active" : ""}`;
    button.textContent = `${round}R`;
    button.addEventListener("click", () => {
      if (!canWriteSharedState("change round")) return;
      state.selectedRound = round;
      state.view = "round";
      saveState(state);
      render();
    });
    els.roundButtons.appendChild(button);
  }
}

function renderTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.view === state.view);
  });
}

function renderStats() {
  const active = visiblePlayers(state);
  const filled = active.reduce((count, player) => count + player.scores.filter(scoreFilled).length, 0);
  const top = rankedPlayers(state, "overall")[0];
  els.activePlayers.textContent = active.length;
  els.filledScores.textContent = filled;
  els.topName.textContent = top?.name || "-";
  els.topScore.textContent = top ? formatScore(top.total) : "0.0";
}

function renderPlayerControls() {
  const selectedId = Number(els.playerSelect.value) || 1;
  els.playerSelect.innerHTML = state.players.map((player) => {
    const label = player.name ? `${player.id}. ${escapeHtml(player.name)}` : `${player.id}. 이름 없음`;
    return `<option value="${player.id}">${label}</option>`;
  }).join("");
  els.playerSelect.value = String(Math.min(selectedId, PLAYER_COUNT));

  els.nameList.innerHTML = state.players.map((player) => {
    const name = player.name ? escapeHtml(player.name) : `<span class="muted">이름 없음</span>`;
    return `<div class="name-row"><span>${player.id}</span><strong>${name}</strong></div>`;
  }).join("");
}

function renderTable() {
  const rows = state.view === "round"
    ? filteredRows(rankedPlayers(state, "round", true))
    : filteredRows(rankedPlayers(state, "overall"));

  els.viewTitle.textContent = state.view === "overall" ? `${currentGroup.label} 합산 순위` : `${currentGroup.label} 점수 입력`;
  els.viewSubtitle.textContent = state.view === "overall"
    ? "이름이 입력된 참가자의 10개 라운드 합산 순위를 표시합니다."
    : "참가자 이름과 1R부터 10R까지의 점수를 표에서 바로 입력할 수 있습니다.";

  if (state.view === "overall") {
    els.tableHead.innerHTML = `
      <tr>
        <th>순위</th><th>참가자</th><th class="score">총점</th>
        ${Array.from({ length: ROUND_COUNT }, (_, index) => `<th class="score">${index + 1}R</th>`).join("")}
      </tr>
    `;
    els.tableBody.innerHTML = rows.length ? rows.map((row) => `
      <tr>
        <td class="rank ${rankClass(row.rank)}">${row.rank}</td>
        <td class="player">${row.id}. ${escapeHtml(row.name)}</td>
        <td class="score"><strong>${formatScore(row.total)}</strong></td>
        ${row.scores.map((score) => `<td class="score">${scoreFilled(score) ? formatScore(score) : "-"}</td>`).join("")}
      </tr>
    `).join("") : `<tr><td class="empty" colspan="13">아직 이름이 입력된 참가자가 없습니다.</td></tr>`;
    return;
  }

  els.tableHead.innerHTML = `
    <tr>
      <th>번호</th><th>이름</th>
      ${Array.from({ length: ROUND_COUNT }, (_, index) => `<th class="score">${index + 1}R</th>`).join("")}
      <th class="score">총점</th>
    </tr>
  `;
  els.tableBody.innerHTML = rows.length ? rows.map((row) => `
    <tr>
      <td class="rank">${row.id}</td>
      <td class="name-input">
        <input type="text" value="${escapeHtml(row.name)}" placeholder="이름 입력" data-name-player-id="${row.id}">
      </td>
      ${row.scores.map((score, index) => `
        <td class="score-input">
          <input type="number" step="0.1" value="${escapeHtml(score)}" placeholder="0.0" data-score-player-id="${row.id}" data-round-index="${index}">
        </td>
      `).join("")}
      <td class="score"><strong>${formatScore(row.total)}</strong></td>
    </tr>
  `).join("") : `<tr><td class="empty" colspan="13">표시할 참가자가 없습니다.</td></tr>`;
}

function render() {
  renderRoundButtons();
  renderTabs();
  renderStats();
  renderPlayerControls();
  renderTable();
}

function exportCsv() {
  const header = ["순위", "참가자 번호", "이름", "총점", ...Array.from({ length: ROUND_COUNT }, (_, index) => `${index + 1}R`)];
  const lines = rankedPlayers(state, "overall").map((row) => [
    row.rank,
    row.id,
    row.name,
    formatScore(row.total),
    ...row.scores.map((score) => scoreFilled(score) ? formatScore(score) : "")
  ]);
  const csv = [header, ...lines].map((row) => (
    row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")
  )).join("\n");
  download(`${currentGroup.label}-ranking.csv`, "\ufeff" + csv, "text/csv;charset=utf-8");
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    if (!canWriteSharedState("change view")) return;
    state.view = tab.dataset.view;
    saveState(state);
    render();
  });
});

els.tableBody.addEventListener("input", (event) => {
  if (!canWriteSharedState("save score")) {
    render();
    return;
  }

  const scoreInput = event.target.closest("input[data-score-player-id]");
  const nameInput = event.target.closest("input[data-name-player-id]");
  const playerId = Number(scoreInput?.dataset.scorePlayerId || nameInput?.dataset.namePlayerId);
  const player = state.players.find((item) => item.id === playerId);
  if (!player) return;

  if (scoreInput) {
    const roundIndex = Number(scoreInput.dataset.roundIndex);
    if (roundIndex >= 0 && roundIndex < ROUND_COUNT) {
      player.scores[roundIndex] = scoreInput.value;
    }
  }
  if (nameInput) player.name = nameInput.value.trim();

  saveState(state);
  renderStats();
  renderPlayerControls();
});

els.tableBody.addEventListener("change", (event) => {
  if (!canWriteSharedState("save score")) {
    render();
    return;
  }

  const scoreInput = event.target.closest("input[data-score-player-id]");
  if (scoreInput && scoreInput.value !== "") {
    scoreInput.value = Number(scoreInput.value).toFixed(1);
    const player = state.players.find((item) => item.id === Number(scoreInput.dataset.scorePlayerId));
    const roundIndex = Number(scoreInput.dataset.roundIndex);
    if (player && roundIndex >= 0 && roundIndex < ROUND_COUNT) {
      player.scores[roundIndex] = scoreInput.value;
      saveState(state);
    }
  }
  if (event.target.closest("input[data-score-player-id], input[data-name-player-id]")) render();
});

els.searchInput.addEventListener("input", renderTable);
els.sortMode.addEventListener("change", renderTable);

els.clearRound.addEventListener("click", () => {
  if (!canWriteSharedState("clear round")) return;
  if (!confirm(`${currentGroup.label} ${state.selectedRound}라운드 점수를 모두 비울까요?`)) return;
  visiblePlayers(state).forEach((player) => {
    player.scores[state.selectedRound - 1] = "";
  });
  saveState(state);
  render();
});

els.nameFocus.addEventListener("click", () => {
  const player = state.players.find((item) => item.id === Number(els.playerSelect.value));
  els.nameInput.value = player?.name || "";
  els.nameInput.focus();
});

els.nameSave.addEventListener("click", () => {
  if (!canWriteSharedState("save name")) return;
  const player = state.players.find((item) => item.id === Number(els.playerSelect.value));
  if (!player) return;
  player.name = els.nameInput.value.trim();
  saveState(state);
  render();
});

els.exportJson.addEventListener("click", () => {
  download(`${currentGroup.label}-ranking.json`, JSON.stringify(normalizeState(state), null, 2), "application/json;charset=utf-8");
});

els.exportCsv.addEventListener("click", exportCsv);
els.importJson.addEventListener("click", () => els.fileInput.click());

els.fileInput.addEventListener("change", async () => {
  const file = els.fileInput.files[0];
  if (!file) return;
  try {
    const nextState = normalizeState(JSON.parse(await file.text()));
    if (!canWriteSharedState("import data")) return;
    state = nextState;
    saveState(state);
    render();
  } catch {
    alert("파일을 읽을 수 없습니다.");
  } finally {
    els.fileInput.value = "";
  }
});

els.copyStudentLink.addEventListener("click", async () => {
  if (!canWriteSharedState("copy live student link")) return;
  const url = makeShareUrl(state);
  try {
    await navigator.clipboard.writeText(url);
    alert(`${currentGroup.label} 학생용 링크를 복사했습니다.`);
  } catch {
    prompt(`${currentGroup.label} 학생용 링크입니다. 복사해서 공유하세요.`, url);
  }
});

els.resetAll.addEventListener("click", () => {
  if (!canWriteSharedState("reset data")) return;
  if (!confirm(`${currentGroup.label}의 모든 이름과 점수를 처음 상태로 되돌릴까요?`)) return;
  state = defaultState();
  saveState(state);
  render();
});

window.addEventListener("ranking-storage-status", (event) => {
  renderStorageStatus(event.detail);
});

renderStorageStatus();
render();

subscribeRemoteState((nextState) => {
  mergeRemoteState(nextState);
  render();
}, {
  onEmpty: () => saveState(state, { immediate: true })
});
