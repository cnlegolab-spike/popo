const currentGroup = getCurrentGroup();
initRemoteState();

let state = loadState();
state.view = "overall";

const els = {
  groupLabel: document.querySelector("#groupLabel"),
  roundButtons: document.querySelector("#roundButtons"),
  tableHead: document.querySelector("#tableHead"),
  tableBody: document.querySelector("#tableBody"),
  searchInput: document.querySelector("#searchInput"),
  viewMode: document.querySelector("#viewMode"),
  viewTitle: document.querySelector("#viewTitle"),
  viewSubtitle: document.querySelector("#viewSubtitle"),
  importJson: document.querySelector("#importJson"),
  fileInput: document.querySelector("#fileInput"),
  storageStatus: document.querySelector("#storageStatus")
};

document.title = `레고에듀케이션 STEAMedu 청라센터 ${currentGroup.label} 학생용 랭킹`;
els.groupLabel.textContent = currentGroup.label;

function ensureStorageStatusElement() {
  if (els.storageStatus) return;
  const actions = document.querySelector(".actions");
  if (!actions) return;

  const status = document.createElement("span");
  status.className = "storage-status";
  status.id = "storageStatus";
  status.textContent = "Local only";
  actions.insertBefore(status, els.importJson || actions.firstChild);
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
    els.storageStatus.title = "This page is showing shared live data.";
    return;
  }
  if (status.enabled) {
    els.storageStatus.textContent = "Cloud connecting";
    els.storageStatus.title = "Firebase is configured, but the connection is not ready yet.";
    return;
  }

  els.storageStatus.textContent = "Local only";
  els.storageStatus.title = "Firebase is not configured, so this device is not seeing shared data.";
}

ensureStorageStatusElement();

function filteredRows(rows) {
  const keyword = els.searchInput.value.trim().toLowerCase();
  return keyword
    ? rows.filter((row) => row.name.toLowerCase().includes(keyword) || String(row.id).includes(keyword))
    : rows;
}

function renderRoundButtons() {
  els.roundButtons.innerHTML = "";
  for (let round = 1; round <= ROUND_COUNT; round += 1) {
    const button = document.createElement("button");
    button.className = `round-btn ${round === state.selectedRound ? "active" : ""}`;
    button.textContent = `${round}R`;
    button.addEventListener("click", () => {
      state.selectedRound = round;
      state.view = "round";
      els.viewMode.value = "round";
      render();
    });
    els.roundButtons.appendChild(button);
  }
}

function renderTable() {
  const mode = els.viewMode.value;
  state.view = mode;
  const rows = filteredRows(rankedPlayers(state, mode));

  els.viewTitle.textContent = mode === "overall" ? `${currentGroup.label} 합산 순위` : `${currentGroup.label} ${state.selectedRound}라운드 순위`;
  els.viewSubtitle.textContent = mode === "overall"
    ? "10개 라운드 점수를 합산한 순위입니다."
    : `${state.selectedRound}라운드 점수 기준 순위입니다.`;

  if (mode === "overall") {
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
    `).join("") : `<tr><td class="empty" colspan="13">아직 표시할 참가자가 없습니다.</td></tr>`;
    return;
  }

  els.tableHead.innerHTML = `
    <tr>
      <th>순위</th><th>참가자</th><th class="score">${state.selectedRound}R 점수</th><th class="score">총점</th>
    </tr>
  `;
  els.tableBody.innerHTML = rows.length ? rows.map((row) => `
    <tr>
      <td class="rank ${rankClass(row.rank)}">${row.rank}</td>
      <td class="player">${row.id}. ${escapeHtml(row.name)}</td>
      <td class="score"><strong>${formatScore(row.roundScore)}</strong></td>
      <td class="score"><strong>${formatScore(row.total)}</strong></td>
    </tr>
  `).join("") : `<tr><td class="empty" colspan="4">아직 표시할 참가자가 없습니다.</td></tr>`;
}

function render() {
  renderRoundButtons();
  renderTable();
}

els.searchInput.addEventListener("input", renderTable);
els.viewMode.addEventListener("change", renderTable);
els.importJson.addEventListener("click", () => els.fileInput.click());

els.fileInput.addEventListener("change", async () => {
  const file = els.fileInput.files[0];
  if (!file) return;
  try {
    state = normalizeState(JSON.parse(await file.text()));
    render();
  } catch {
    alert("파일을 읽을 수 없습니다.");
  } finally {
    els.fileInput.value = "";
  }
});

window.addEventListener("ranking-storage-status", (event) => {
  renderStorageStatus(event.detail);
});

renderStorageStatus();
render();

subscribeRemoteState((nextState) => {
  const selectedRound = state.selectedRound;
  state = normalizeState(nextState);
  state.selectedRound = selectedRound;
  render();
});
