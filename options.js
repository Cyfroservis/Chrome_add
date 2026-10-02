const DEFAULTS = {
  idleMinutes: 5,
  collapseGroups: true,
  minimizeWindows: true,
  restoreGroups: true,
  restoreWindows: true,
  noRestoreAfterMinutes: 0,
  switchToLastTab: true
};

chrome.storage.local.get(DEFAULTS, (s) => {
  document.getElementById('idleMinutes').value = s.idleMinutes;
  document.getElementById('collapseGroups').checked = s.collapseGroups;
  document.getElementById('minimizeWindows').checked = s.minimizeWindows;
  document.getElementById('restoreGroups').checked = s.restoreGroups;
  document.getElementById('restoreWindows').checked = s.restoreWindows;
  document.getElementById('noRestoreAfterMinutes').value = s.noRestoreAfterMinutes;
  document.getElementById('switchToLastTab').checked = s.switchToLastTab;
});

document.getElementById('save').addEventListener('click', () => {
  const minutes = Math.max(1, parseInt(document.getElementById('idleMinutes').value, 10) || 5);
  const noRestore = Math.max(0, parseInt(document.getElementById('noRestoreAfterMinutes').value, 10) || 0);
  chrome.storage.local.set({
    noRestoreAfterMinutes: noRestore,
    switchToLastTab: document.getElementById('switchToLastTab').checked,
    idleMinutes: minutes,
    collapseGroups: document.getElementById('collapseGroups').checked,
    minimizeWindows: document.getElementById('minimizeWindows').checked,
    restoreGroups: document.getElementById('restoreGroups').checked,
    restoreWindows: document.getElementById('restoreWindows').checked
  }, () => {
    document.getElementById('idleMinutes').value = minutes;
    document.getElementById('noRestoreAfterMinutes').value = noRestore;
    const st = document.getElementById('status');
    st.textContent = 'Збережено';
    setTimeout(() => { st.textContent = ''; }, 1500);
  });
});
