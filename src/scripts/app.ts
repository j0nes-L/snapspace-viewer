import { setApiKey, login, fetchCaptures, fetchPointClouds, fetchPointCloudData, fetchColmapZip, fetchMeshGlb, checkMeshAvailability, resolvePointCloud, deleteCapture, clearPointCloudsCache } from './api';
import type { CaptureListItem, PointCloudInfo, ResolvedPointCloud, UserRole } from './api';
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
const downloadMeshBtn = document.getElementById('download-mesh-btn')!;

const pointCloudCache = new Map<string, ArrayBuffer>();

let lastLoadedBuffer: ArrayBuffer | null = null;
let lastLoadedFilename: string | null = null;
let lastDownloadCaptureId: string | null = null;
let lastDownloadPc: PointCloudInfo | null = null;
let prefetchedDownloadBuffer: ArrayBuffer | null = null;
let colmapAvailable = false;
let colmapSizeBytes: number | null = null;
let meshAvailable = false;
let meshSizeBytes: number | null = null;

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
    a.download = `Capture_${lastDownloadCaptureId}_pointcloud.ply`;
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

downloadMeshBtn.addEventListener('click', async () => {
  if (!lastDownloadCaptureId || !meshAvailable) return;
  const btn = downloadMeshBtn as HTMLButtonElement;
  btn.disabled = true;
  const origText = btn.textContent;
  try {
    btn.textContent = 'Downloading… 0%';
    const buffer = await fetchMeshGlb(lastDownloadCaptureId, (f) => {
      btn.textContent = `Downloading… ${Math.round(f * 100)}%`;
    }, meshSizeBytes);
    const blob = new Blob([buffer], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = `Capture_${lastDownloadCaptureId}_mesh.glb`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  } catch (err) {
    setStatus(`Mesh download error: ${err instanceof Error ? err.message : err}`);
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
});


const REMEMBER_KEY = 'rb_remember_pw';
const SESSION_KEY = 'rb_logged_in';
const ROLE_KEY = 'rb_role';
const SPINNER = '<div class="spinner"></div>';

let viewerInitialised = false;
let selectedPcKey: string | null = null;
let userRole: UserRole = 'viewer';

function isAdmin(): boolean {
  return userRole === 'admin';
}

toggleBtn.addEventListener('click', () => {
  sidebarEl.classList.toggle('collapsed');
});

refreshBtn.addEventListener('click', () => {
  clearPointCloudsCache();
  loadSessions();
});

logoutBtn.addEventListener('click', () => {
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(ROLE_KEY);
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
    const result = await login(pw);
    if (result.ok) {
      userRole = result.role ?? 'viewer';
      sessionStorage.setItem(SESSION_KEY, '1');
      sessionStorage.setItem(ROLE_KEY, userRole);
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
  userRole = (sessionStorage.getItem(ROLE_KEY) as UserRole) || 'viewer';
  showApp();
} else if (remembered) {
  autoLogin(remembered);
} else {
  showLogin();
}

async function autoLogin(pw: string): Promise<void> {
  try {
    const result = await login(pw);
    if (result.ok) {
      userRole = result.role ?? 'viewer';
      sessionStorage.setItem(SESSION_KEY, '1');
      sessionStorage.setItem(ROLE_KEY, userRole);
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

    captures.sort((a, b) => b.id.localeCompare(a.id));

    const skeletons = captures.map((c, i) => {
      const el = renderSkeletonItem(c.id);
      el.style.animationDelay = `${Math.min(i * 25, 400)}ms`;
      sessionList.appendChild(el);
      return { capture: c, el };
    });

    const CONCURRENCY = 10;
    let idx = 0;
    let rendered = 0;

    const worker = async (): Promise<void> => {
      while (idx < skeletons.length) {
        const { capture, el } = skeletons[idx++];
        try {
          const resp = await fetchPointClouds(capture.id);
          const resolved = resolvePointCloud(resp);
          if (resolved) {
            upgradeSkeletonItem(el, capture.id, resolved);
            rendered++;
            const pcKey = `${capture.id}/${resolved.view.filename}`;
            if (selectedPcKey === pcKey) {
              el.classList.add('active');
              updateDownloadButtons(capture.id, resolved);
            }
          } else {
            el.remove();
          }
        } catch {
          el.remove();
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, skeletons.length) }, () => worker())
    );

    if (rendered === 0) {
      sessionList.innerHTML = '<div class="empty-state">No point clouds available.</div>';
    }
  } catch {
    sessionList.innerHTML = '<div class="empty-state">No captures available.</div>';
  }
}

function parseCaptureDate(captureId: string): string {
  const m = captureId.match(/(\d{4})[\-_]?(\d{2})[\-_]?(\d{2})[\-_T]?(\d{2})[\-:_]?(\d{2})[\-:_]?(\d{2})/);
  if (m) {
    const [, y, mo, d, h, mi, s] = m;
    return `${d}.${mo}.${y} · ${h}:${mi}:${s}`;
  }
  return captureId;
}

function renderSkeletonItem(captureId: string): HTMLButtonElement {
  const el = document.createElement('button');
  el.className = 'list-item enter is-skeleton';
  el.disabled = true;
  el.innerHTML = `
    <div class="item-content">
      <div class="item-title">${parseCaptureDate(captureId)}</div>
      <div class="item-meta"><span class="skeleton-bar"></span></div>
    </div>
    ${isAdmin() ? '<div class="item-delete item-delete-skeleton"></div>' : ''}
  `;
  return el;
}

function upgradeSkeletonItem(
  el: HTMLButtonElement,
  captureId: string,
  resolved: ResolvedPointCloud,
): void {
  el.classList.remove('is-skeleton');
  el.disabled = false;
  const sizeMB = (resolved.view.size_bytes / (1024 * 1024)).toFixed(1);
  const deleteBtn = isAdmin()
    ? '<div class="item-delete btn btn-icon" title="Delete capture"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></div>'
    : '';
  el.innerHTML = `
    <div class="item-content">
      <div class="item-title">${parseCaptureDate(captureId)}</div>
      <div class="item-meta">${sizeMB} MB</div>
    </div>
    ${deleteBtn}
  `;
  attachItemHandlers(el, captureId, resolved);
}

function attachItemHandlers(
  el: HTMLButtonElement,
  captureId: string,
  resolved: ResolvedPointCloud,
): void {
  el.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('.item-delete')) return;
    selectPointCloud(captureId, resolved, el);
  });
  const deleteEl = el.querySelector('.item-delete');
  if (!deleteEl || !isAdmin()) return;
  deleteEl.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(`Delete Capture "${captureId}" ?`)) return;
    try {
      await deleteCapture(captureId);
      if (selectedPcKey === `${captureId}/${resolved.view.filename}`) {
        selectedPcKey = null;
        unloadPointCloud();
        viewerEmpty.classList.remove('hidden');
        downloadBtn.classList.add('hidden');
        downloadColmapBtn.classList.add('hidden');
        downloadMeshBtn.classList.add('hidden');
        pointSizeControl.classList.add('hidden');
        setStatus('');
      }
      el.remove();
      if (sessionList.children.length === 0) {
        sessionList.innerHTML = '<div class="empty-state">No point clouds available.</div>';
      }
    } catch (err) {
      setStatus(`Delete error: ${err instanceof Error ? err.message : err}`);
    }
  });
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

  viewerEmpty.classList.add('hidden');
  viewerProgress.textContent = '0 %';
  viewerLoading.classList.remove('hidden');
  try {
    let buffer: ArrayBuffer;
    const cacheKey = `${captureId}/${pc.filename}`;
    if (pointCloudCache.has(cacheKey)) {
      setStatus('Loading from cache…');
      viewerProgress.textContent = 'Cached';
      buffer = pointCloudCache.get(cacheKey)!;
    } else {
      setStatus('Downloading point cloud…');
      buffer = await fetchPointCloudData(captureId, pc.filename, (f) => {
        viewerProgress.textContent = `Downloading… ${Math.round(f * 100)} %`;
      });
      pointCloudCache.set(cacheKey, buffer);
    }
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

    await updateDownloadButtons(captureId, resolved);

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

    setStatus(`Loaded Point Cloud for Capture_${captureId}`);
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

async function updateDownloadButtons(captureId: string, resolved: ResolvedPointCloud): Promise<void> {
  lastDownloadCaptureId = captureId;
  lastDownloadPc = resolved.download;

  const dlSizeMB = (resolved.download.size_bytes / (1024 * 1024)).toFixed(0);
  (downloadBtn as HTMLButtonElement).textContent = `⤓ .ply (${dlSizeMB} MB)`;
  downloadBtn.classList.remove('hidden');

  colmapAvailable = resolved.colmap_available;
  colmapSizeBytes = resolved.colmap_size_bytes;
  if (colmapAvailable) {
    const colmapMB = colmapSizeBytes ? (colmapSizeBytes / (1024 * 1024)).toFixed(0) : '?';
    (downloadColmapBtn as HTMLButtonElement).textContent = `⤓ COLMAP (${colmapMB} MB)`;
    downloadColmapBtn.classList.remove('hidden');
  } else {
    downloadColmapBtn.classList.add('hidden');
  }

  const meshInfo = await checkMeshAvailability(captureId);
  meshAvailable = meshInfo.available;
  meshSizeBytes = meshInfo.size_bytes;
  if (meshAvailable) {
    const meshMB = meshSizeBytes ? (meshSizeBytes / (1024 * 1024)).toFixed(0) : '?';
    (downloadMeshBtn as HTMLButtonElement).textContent = `⤓ .glb (${meshMB} MB)`;
    downloadMeshBtn.classList.remove('hidden');
  } else {
    downloadMeshBtn.classList.add('hidden');
  }
}

