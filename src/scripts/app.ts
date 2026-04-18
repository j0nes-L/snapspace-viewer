import { setApiKey, login, fetchCaptures, fetchPointClouds, fetchPointCloudData, fetchColmapZip, resolvePointCloud } from './api';
import type { CaptureListItem, PointCloudInfo, ResolvedPointCloud } from './api';
import { initViewer, loadPointCloudFromBuffer, unloadPointCloud, setPointSize, hasScalarScale, getPointCount } from './viewer';

const loginScreen = document.getElementById('login-screen')!;
const appScreen = document.getElementById('app-screen')!;
const loginForm = document.getElementById('login-form') as HTMLFormElement;
const loginPassword = document.getElementById('login-password') as HTMLInputElement;
const loginError = document.getElementById('login-error')!;
const loginBtn = document.getElementById('login-btn') as HTMLButtonElement;
const loginRemember = document.getElementById('login-remember') as HTMLInputElement;
const sessionList = document.getElementById('session-list')!;
const viewerContainer = document.getElementById('viewer')!;
const statusEl = document.getElementById('status')!;
const refreshBtn = document.getElementById('refresh-btn')!;
const sidebarEl = document.getElementById('sidebar')!;
const toggleBtn = document.getElementById('sidebar-toggle')!;
const logoutBtn = document.getElementById('logout-btn')!;
const viewerEmpty = viewerContainer.querySelector('.viewer-empty')!;
const viewerLoading = document.getElementById('viewer-loading')!;
const viewerProgress = document.getElementById('viewer-progress')!;
const pointSizeControl = document.getElementById('point-size-control')!;
const pointSizeSlider = document.getElementById('point-size-slider') as HTMLInputElement;
const downloadBtn = document.getElementById('download-btn')!;
const downloadColmapBtn = document.getElementById('download-colmap-btn')!;

let lastLoadedBuffer: ArrayBuffer | null = null;
let lastLoadedFilename: string | null = null;
let lastDownloadCaptureId: string | null = null;
let lastDownloadPc: PointCloudInfo | null = null;
let prefetchedDownloadBuffer: ArrayBuffer | null = null;
let colmapAvailable = false;
let colmapSizeBytes: number | null = null;

pointSizeSlider.addEventListener('input', () => {
  setPointSize(parseFloat(pointSizeSlider.value));
});

downloadBtn.addEventListener('click', async () => {
  if (!lastDownloadCaptureId || !lastDownloadPc) return;
  const btn = downloadBtn as HTMLButtonElement;
  btn.disabled = true;
  const origText = btn.textContent;
  try {
    let buffer: ArrayBuffer;
    if (prefetchedDownloadBuffer) {
      buffer = prefetchedDownloadBuffer;
    } else {
      btn.textContent = 'Downloading…';
      buffer = await fetchPointCloudData(lastDownloadCaptureId, lastDownloadPc.filename);
    }
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = lastDownloadPc.filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  } catch (err) {
    setStatus(`Download error: ${err instanceof Error ? err.message : err}`);
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
});

downloadColmapBtn.addEventListener('click', async () => {
  if (!lastDownloadCaptureId || !colmapAvailable) return;
  const btn = downloadColmapBtn as HTMLButtonElement;
  btn.disabled = true;
  const origText = btn.textContent;
  try {
    btn.textContent = 'Downloading… 0%';
    const buffer = await fetchColmapZip(lastDownloadCaptureId, (f) => {
      btn.textContent = `Downloading… ${Math.round(f * 100)}%`;
    }, colmapSizeBytes);
    const blob = new Blob([buffer], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = `Capture_${lastDownloadCaptureId}_colmap.zip`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  } catch (err) {
    setStatus(`COLMAP download error: ${err instanceof Error ? err.message : err}`);
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
});


const REMEMBER_KEY = 'rb_remember_pw';
const SESSION_KEY = 'rb_logged_in';
const SPINNER = '<div class="spinner"></div>';

let viewerInitialised = false;
let selectedPcKey: string | null = null;

toggleBtn.addEventListener('click', () => {
  sidebarEl.classList.toggle('collapsed');
});

refreshBtn.addEventListener('click', () => {
  selectedPcKey = null;
  lastLoadedBuffer = null;
  lastLoadedFilename = null;
  lastDownloadCaptureId = null;
  lastDownloadPc = null;
  prefetchedDownloadBuffer = null;
  colmapAvailable = false;
  colmapSizeBytes = null;
  downloadColmapBtn.classList.add('hidden');
  unloadPointCloud();
  pointSizeControl.classList.add('hidden');
  viewerEmpty.classList.remove('hidden');
  setStatus('');
  loadSessions();
});

logoutBtn.addEventListener('click', () => {
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(REMEMBER_KEY);
  window.location.reload();
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = loginPassword.value.trim();
  if (!pw) return;

  loginBtn.disabled = true;
  loginBtn.textContent = '…';
  loginError.classList.add('hidden');
  loginError.textContent = '';

  try {
    const ok = await login(pw);
    if (ok) {
      sessionStorage.setItem(SESSION_KEY, '1');
      if (loginRemember.checked) {
        localStorage.setItem(REMEMBER_KEY, pw);
      } else {
        localStorage.removeItem(REMEMBER_KEY);
      }
      showApp();
    } else {
      loginError.textContent = 'Falsches Passwort.';
      loginError.classList.remove('hidden');
      loginPassword.focus();
    }
  } catch (err: unknown) {
    loginError.textContent = `Fehler: ${err instanceof Error ? err.message : err}`;
    loginError.classList.remove('hidden');
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Login';
  }
});

const hasSession = sessionStorage.getItem(SESSION_KEY);
const remembered = localStorage.getItem(REMEMBER_KEY);

const envKey = (window.__ENV_API_KEY__ || '').trim();
if (envKey) {
  setApiKey(envKey);
}

if (hasSession) {
  showApp();
} else if (remembered) {
  autoLogin(remembered);
} else {
  showLogin();
}

async function autoLogin(pw: string): Promise<void> {
  try {
    const ok = await login(pw);
    if (ok) {
      sessionStorage.setItem(SESSION_KEY, '1');
      showApp();
      return;
    }
  } catch {
  }
  loginPassword.value = pw;
  loginRemember.checked = true;
  showLogin();
}

function showLogin(): void {
  appScreen.classList.add('hidden');
  loginScreen.classList.remove('hidden');
}

function showApp(): void {
  loginScreen.classList.add('hidden');
  appScreen.classList.remove('hidden');

  if (window.innerWidth <= 768) {
    sidebarEl.classList.add('collapsed');
  }

  if (!viewerInitialised) {
    initViewer(viewerContainer as HTMLElement);
    viewerInitialised = true;
  }


  loadSessions();
}

async function loadSessions(): Promise<void> {
  sessionList.innerHTML = SPINNER;
  setStatus('');

  try {
    const captures = await fetchCaptures();

    if (captures.length === 0) {
      sessionList.innerHTML = '<div class="empty-state">No captures available.</div>';
      return;
    }

    sessionList.innerHTML = '';

    const results = await Promise.all(
      captures.map(async (c) => {
        try {
          const resp = await fetchPointClouds(c.id);
          const resolved = resolvePointCloud(resp);
          return { capture: c, resolved };
        } catch {
          return { capture: c, resolved: null as ResolvedPointCloud | null };
        }
      })
    );

    for (const { capture, resolved } of results) {
      if (!resolved) continue;
      renderPcItem(capture.id, resolved);
    }

    if (sessionList.children.length === 0) {
      sessionList.innerHTML = '<div class="empty-state">No point clouds available.</div>';
    }
  } catch {
    sessionList.innerHTML = '<div class="empty-state">No captures available.</div>';
  }
}

function renderPcItem(captureId: string, resolved: ResolvedPointCloud): void {
  const el = document.createElement('button');
  el.className = 'list-item';
  const sizeMB = (resolved.view.size_bytes / (1024 * 1024)).toFixed(1);
  el.innerHTML = `
    <div class="item-title">${captureId}</div>
    <div class="item-meta">${sizeMB} MB</div>
  `;
  el.addEventListener('click', () => selectPointCloud(captureId, resolved, el));
  sessionList.appendChild(el);
}

async function selectPointCloud(
  captureId: string,
  resolved: ResolvedPointCloud,
  el: HTMLButtonElement,
): Promise<void> {
  const pc = resolved.view;
  const pcKey = `${captureId}/${pc.filename}`;
  if (selectedPcKey === pcKey) {
    return;
  }

  sessionList.querySelectorAll('.list-item').forEach((item) => item.classList.remove('active'));
  el.classList.add('active');
  selectedPcKey = pcKey;

  if (window.innerWidth <= 768) {
    sidebarEl.classList.add('collapsed');
  }

  setStatus('Downloading point cloud…');
  viewerEmpty.classList.add('hidden');
  viewerProgress.textContent = '0 %';
  viewerLoading.classList.remove('hidden');
  try {
    const buffer = await fetchPointCloudData(captureId, pc.filename, (f) => {
      viewerProgress.textContent = `Downloading… ${Math.round(f * 100)} %`;
    });
    if (selectedPcKey !== pcKey) return;

    viewerProgress.textContent = 'Parsing…';

    await new Promise(r => setTimeout(r, 50));
    await loadPointCloudFromBuffer(buffer, (msg) => {
      viewerProgress.textContent = msg;
      setStatus(msg);
    });
    lastLoadedBuffer = buffer;
    lastLoadedFilename = pc.filename;
    lastDownloadCaptureId = captureId;
    lastDownloadPc = resolved.download;
    prefetchedDownloadBuffer = buffer;
    pointSizeControl.classList.remove('hidden');

    const dlSizeMB = (resolved.download.size_bytes / (1024 * 1024)).toFixed(0);
    (downloadBtn as HTMLButtonElement).textContent = `⤓ .ply (${dlSizeMB} MB)`;

    colmapAvailable = resolved.colmap_available;
    colmapSizeBytes = resolved.colmap_size_bytes;
    if (colmapAvailable) {
      const colmapMB = colmapSizeBytes ? (colmapSizeBytes / (1024 * 1024)).toFixed(0) : '?';
      (downloadColmapBtn as HTMLButtonElement).textContent = `⤓ COLMAP (${colmapMB} MB)`;
      downloadColmapBtn.classList.remove('hidden');
    } else {
      downloadColmapBtn.classList.add('hidden');
    }

    const count = getPointCount();
    const countStr = count >= 1_000_000
      ? `${(count / 1_000_000).toFixed(1)}M points`
      : count >= 1_000
        ? `${(count / 1_000).toFixed(0)}K points`
        : `${count} points`;
    const metaEl = el.querySelector('.item-meta');
    if (metaEl) {
      const sizeMB = (pc.size_bytes / (1024 * 1024)).toFixed(1);
      metaEl.textContent = `${sizeMB} MB · ${countStr}`;
    }

    if (hasScalarScale()) {
      pointSizeSlider.min = '0.1';
      pointSizeSlider.max = '5';
      pointSizeSlider.step = '0.1';
      pointSizeSlider.value = '1';
    } else {
      pointSizeSlider.min = '0.001';
      pointSizeSlider.max = '0.05';
      pointSizeSlider.step = '0.001';
      pointSizeSlider.value = '0.005';
    }

    setStatus(`${pc.filename} loaded`);
  } catch (err: unknown) {
    selectedPcKey = null;
    el.classList.remove('active');
    setStatus(`Error: ${err instanceof Error ? err.message : err}`);
  } finally {
    viewerLoading.classList.add('hidden');
  }
}

function setStatus(msg: string): void {
  statusEl.textContent = msg;
}
