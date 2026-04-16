import { setApiKey, login, fetchCaptures, fetchPointClouds, fetchPointCloudData } from './api';
import type { CaptureListItem, PointCloudInfo } from './api';
import { initViewer, loadPointCloudFromBuffer, unloadPointCloud, setPointSize } from './viewer';

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

pointSizeSlider.addEventListener('input', () => {
  setPointSize(parseFloat(pointSizeSlider.value));
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

  // Auto-collapse sidebar on mobile
  if (window.innerWidth <= 768) {
    sidebarEl.classList.add('collapsed');
  }

  if (!viewerInitialised) {
    initViewer(viewerContainer as HTMLElement);
    viewerInitialised = true;
  }

  const envKey = (window.__ENV_API_KEY__ || '').trim();
  if (envKey) {
    setApiKey(envKey);
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
          const pcs = await fetchPointClouds(c.id);
          return { capture: c, pcs };
        } catch {
          return { capture: c, pcs: [] as PointCloudInfo[] };
        }
      })
    );

    for (const { capture, pcs } of results) {
      if (pcs.length === 0) continue;
      pcs.forEach((pc) => renderPcItem(capture.id, pc));
    }

    if (sessionList.children.length === 0) {
      sessionList.innerHTML = '<div class="empty-state">No point clouds available.</div>';
    }
  } catch {
    sessionList.innerHTML = '<div class="empty-state">No captures available.</div>';
  }
}

function renderPcItem(captureId: string, pc: PointCloudInfo): void {
  const el = document.createElement('button');
  el.className = 'list-item';
  const sizeMB = (pc.size_bytes / (1024 * 1024)).toFixed(1);
  el.innerHTML = `
    <div class="item-title">${captureId}</div>
    <div class="item-meta">${pc.filename} · ${sizeMB} MB</div>
  `;
  el.addEventListener('click', () => selectPointCloud(captureId, pc, el));
  sessionList.appendChild(el);
}

async function selectPointCloud(
  captureId: string,
  pc: PointCloudInfo,
  el: HTMLButtonElement,
): Promise<void> {
  const pcKey = `${captureId}/${pc.filename}`;
  if (selectedPcKey === pcKey) {
    selectedPcKey = null;
    el.classList.remove('active');
    unloadPointCloud();
    pointSizeControl.classList.add('hidden');
    viewerEmpty.classList.remove('hidden');
    setStatus('');
    return;
  }

  sessionList.querySelectorAll('.list-item').forEach((item) => item.classList.remove('active'));
  el.classList.add('active');
  selectedPcKey = pcKey;

  // Auto-close sidebar on mobile
  if (window.innerWidth <= 768) {
    sidebarEl.classList.add('collapsed');
  }

  setStatus('Downloading point cloud…');
  viewerEmpty.classList.add('hidden');
  viewerProgress.textContent = '0 %';
  viewerLoading.classList.remove('hidden');
  try {
    const buffer = await fetchPointCloudData(captureId, pc.filename, (f) => {
      viewerProgress.textContent = `${Math.round(f * 100)} %`;
    });
    if (selectedPcKey !== pcKey) return;

    loadPointCloudFromBuffer(buffer, (msg) => setStatus(msg));
    pointSizeControl.classList.remove('hidden');
    pointSizeSlider.value = '0.005';
    setStatus(`${pc.filename} loaded`);
  } catch (err: unknown) {
    setStatus(`Error: ${err instanceof Error ? err.message : err}`);
  } finally {
    viewerLoading.classList.add('hidden');
  }
}

function setStatus(msg: string): void {
  statusEl.textContent = msg;
}
