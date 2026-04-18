declare global {
  interface Window {
    __ENV_API_BASE__?: string;
    __ENV_API_KEY__?: string;
  }
}

function getApiBase(): string {
  if (import.meta.env.DEV) {
    return '/api-proxy';
  }
  if (window.__ENV_API_BASE__) {
    return window.__ENV_API_BASE__.replace(/\/+$/, '');
  }
  return 'https://api.00224466.xyz/echo3d';
}

let apiKey = '';

export function setApiKey(key: string): void {
  apiKey = key;
}

export function getApiKey(): string {
  return apiKey;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }
  return headers;
}

export async function login(password: string): Promise<boolean> {
  const res = await fetch(`${getApiBase()}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ password }),
  });
  if (res.status === 401) return false;
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const data = await res.json();
  return data.authenticated === true;
}

export interface CaptureListItem {
  id: string;
  folder: string;
  raw_images: number;
  preprocessed_images: number;
}

export interface CaptureDetail {
  id: string;
  folder: string;
  raw_images: string[];
  preprocessed_images: string[];
  pointclouds: string[];
}

export interface PointCloudInfo {
  filename: string;
  size_bytes: number;
  url: string;
}

export interface PointCloudsResponse {
  capture_id: string;
  pointclouds: PointCloudInfo[];
  chunks: PointCloudInfo[];
  draco_chunks: PointCloudInfo[];
  colmap_available?: boolean;
  colmap_url?: string | null;
  colmap_size_bytes?: number | null;
}

export interface ResolvedPointCloud {
  view: PointCloudInfo;
  download: PointCloudInfo;
  colmap_available: boolean;
  colmap_url: string | null;
  colmap_size_bytes: number | null;
}

export function resolvePointCloud(resp: PointCloudsResponse): ResolvedPointCloud | null {
  const ply = resp.pointclouds.find(p => p.filename.endsWith('.ply'));
  if (!ply) return null;
  return {
    view: ply,
    download: ply,
    colmap_available: !!resp.colmap_available,
    colmap_url: resp.colmap_url || null,
    colmap_size_bytes: resp.colmap_size_bytes || null,
  };
}

export async function fetchCaptures(): Promise<CaptureListItem[]> {
  const res = await fetch(`${getApiBase()}/captures`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to fetch captures: ${res.status}`);
  const data = await res.json();
  return data.captures;
}

export async function fetchCaptureDetail(captureId: string): Promise<CaptureDetail> {
  const res = await fetch(`${getApiBase()}/captures/${captureId}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to fetch capture detail: ${res.status}`);
  return res.json();
}

export async function fetchPointClouds(captureId: string): Promise<PointCloudsResponse> {
  const res = await fetch(`${getApiBase()}/captures/${captureId}/pointclouds`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to fetch point clouds: ${res.status}`);
  return res.json();
}

export async function fetchPointCloudData(
  captureId: string,
  filename: string,
  onProgress?: (fraction: number) => void,
): Promise<ArrayBuffer> {
  const res = await fetch(
    `${getApiBase()}/captures/${captureId}/pointclouds/${filename}`,
    { headers: authHeaders() },
  );
  if (!res.ok) throw new Error(`Failed to download point cloud: ${res.status}`);

  const contentLength = res.headers.get('Content-Length');
  if (!onProgress || !contentLength || !res.body) {
    return res.arrayBuffer();
  }

  const total = parseInt(contentLength, 10);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(received / total);
  }

  const buf = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.length;
  }
  return buf.buffer;
}

export async function fetchColmapZip(
  captureId: string,
  onProgress?: (fraction: number) => void,
  knownTotalBytes?: number | null,
): Promise<ArrayBuffer> {
  const prodBase = (window.__ENV_API_BASE__ || 'https://api.00224466.xyz/echo3d').replace(/\/+$/, '');
  const res = await fetch(
    `${prodBase}/captures/${captureId}/pointclouds/colmap.zip`,
    { headers: authHeaders() },
  );
  if (!res.ok) throw new Error(`Failed to download COLMAP zip: ${res.status}`);

  const clHeader = res.headers.get('Content-Length');
  const total = clHeader ? parseInt(clHeader, 10) : (knownTotalBytes || 0);

  if (!onProgress || !total || !res.body) {
    return res.arrayBuffer();
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(received / total);
  }

  const buf = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.length;
  }
  return buf.buffer;
}

