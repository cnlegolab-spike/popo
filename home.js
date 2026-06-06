initRemoteState();

function ensureHomeStorageStatus() {
  const hero = document.querySelector(".home-hero");
  if (!hero) return null;

  let status = document.querySelector("#storageStatus");
  if (status) return status;

  status = document.createElement("span");
  status.className = "storage-status home-storage-status";
  status.id = "storageStatus";
  status.textContent = "Cloud setup required";
  hero.insertBefore(status, hero.firstElementChild);
  return status;
}

function renderHomeStorageStatus(status = getRemoteStatus()) {
  const el = ensureHomeStorageStatus();
  if (!el) return;

  el.classList.toggle("is-connected", status.enabled && status.connected && !status.error);
  el.classList.toggle("is-error", Boolean(status.error));

  if (status.error) {
    el.textContent = status.enabled ? "Cloud error" : "Cloud setup required";
    el.title = status.error;
    return;
  }
  if (status.enabled && status.connected) {
    el.textContent = "Cloud connected";
    el.title = "All devices will use the same shared ranking data.";
    return;
  }
  if (status.enabled) {
    el.textContent = "Cloud connecting";
    el.title = "Firebase is configured, but the connection is not ready yet.";
    return;
  }

  el.textContent = remoteStorageRequired() ? "Cloud setup required" : "Local only";
}

window.addEventListener("ranking-storage-status", (event) => {
  renderHomeStorageStatus(event.detail);
});

renderHomeStorageStatus();
