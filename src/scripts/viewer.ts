import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';

const DEFAULT_POINT_SIZE = 0.005;
const BACKGROUND_COLOR = 0x111111;

let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let controls: OrbitControls;
let currentPoints: THREE.Points | null = null;
let animationId: number | null = null;
let container: HTMLElement;
let pointSizeMultiplier = 1.0;
let hasPerPointScale = false;
let lastPointCount = 0;

let flyMode = false;
let flyYaw = 0;
let flyPitch = 0;
const flyKeys: Record<string, boolean> = {};
const FLY_SPEED_BASE = 1.0;
let flySpeed = FLY_SPEED_BASE;
let clockDelta = 0;
const clock = new THREE.Clock();
let rightMouseDown = false;
let gridMesh: THREE.Mesh | null = null;

export function initViewer(containerEl: HTMLElement): void {
  container = containerEl;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND_COLOR);

  camera = new THREE.PerspectiveCamera(
    75,
    container.clientWidth / container.clientHeight,
    0.0001,
    100000
  );

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight, false);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.enablePan = true;
  controls.screenSpacePanning = true;

  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: THREE.MOUSE.PAN,
  };

  camera.position.set(0, 0, 3);
  controls.update();

  const FLY_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e', ' ']);

  renderer.domElement.addEventListener('mousedown', (e) => {
    if (e.button === 2) rightMouseDown = true;
  });
  renderer.domElement.addEventListener('mouseup', (e) => {
    if (e.button === 2) {
      rightMouseDown = false;
      if (flyMode) exitFlyMode();
    }
  });
  renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

  renderer.domElement.addEventListener('mousemove', (e) => {
    if (!flyMode || !rightMouseDown) return;
    flyYaw -= e.movementX * 0.002;
    flyPitch -= e.movementY * 0.002;
    flyPitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, flyPitch));
    updateFlyCameraRotation();
  });

  window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    flyKeys[key] = true;
    if (key === 'shift') flySpeed = FLY_SPEED_BASE * 3;
    if (FLY_KEYS.has(key) && rightMouseDown && !flyMode) {
      enterFlyMode();
    }
  });
  window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    flyKeys[key] = false;
    if (key === 'shift') flySpeed = FLY_SPEED_BASE;
    if (flyMode && ![...FLY_KEYS].some((k) => flyKeys[k])) {
      exitFlyMode();
    }
  });

  window.addEventListener('resize', onResize);
  clock.start();
  animate();
}

function enterFlyMode(): void {
  flyMode = true;
  controls.saveState();
  controls.enabled = false;
  const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  flyYaw = euler.y;
  flyPitch = euler.x;
}

function exitFlyMode(): void {
  flyMode = false;
  controls.enabled = true;
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  controls.target.copy(camera.position).add(dir.multiplyScalar(2));
  controls.update();
}

function updateFlyCameraRotation(): void {
  const q = new THREE.Quaternion();
  q.setFromEuler(new THREE.Euler(flyPitch, flyYaw, 0, 'YXZ'));
  camera.quaternion.copy(q);
}

function updateFlyMovement(dt: number): void {
  if (!flyMode) return;

  const speed = flySpeed * dt;
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const worldUp = new THREE.Vector3(0, 1, 0);

  if (flyKeys['w']) camera.position.addScaledVector(forward, speed);
  if (flyKeys['s']) camera.position.addScaledVector(forward, -speed);
  if (flyKeys['d']) camera.position.addScaledVector(right, speed);
  if (flyKeys['a']) camera.position.addScaledVector(right, -speed);
  if (flyKeys['e'] || flyKeys[' ']) camera.position.addScaledVector(worldUp, speed);
  if (flyKeys['q']) camera.position.addScaledVector(worldUp, -speed);
}

export function unloadPointCloud(): void {
  if (currentPoints) {
    scene.remove(currentPoints);
    currentPoints.geometry.dispose();
    if (currentPoints.material instanceof THREE.Material) {
      currentPoints.material.dispose();
    }
    currentPoints = null;
  }
  if (gridMesh) {
    scene.remove(gridMesh);
    gridMesh.geometry.dispose();
    (gridMesh.material as THREE.Material).dispose();
    gridMesh = null;
  }
  lastPointCount = 0;
}

export function getPointCount(): number {
  return lastPointCount;
}

export async function loadPointCloudFromBuffer(
  buffer: ArrayBuffer,
  onProgress?: (msg: string) => void,
): Promise<void> {
  unloadPointCloud();
  pointSizeMultiplier = 1.0;

  onProgress?.('Parsing geometry…');

  const loader = new PLYLoader();
  const geometry = loader.parse(buffer);

  onProgress?.('Processing colors…');

  if (geometry.hasAttribute('color')) {
    const colorAttr = geometry.getAttribute('color');
    const arr = colorAttr.array as Float32Array;
    let maxVal = 0;
    const len = Math.min(arr.length, 3000);
    for (let i = 0; i < len; i++) { if (arr[i] > maxVal) maxVal = arr[i]; }
    if (maxVal > 1.5) {
      const scale = 1 / 255;
      for (let i = 0; i < arr.length; i++) arr[i] *= scale;
      colorAttr.needsUpdate = true;
    }
  }

  hasPerPointScale = geometry.hasAttribute('scalar_scale');

  if (hasPerPointScale) {
    const scaleAttr = geometry.getAttribute('scalar_scale');
    const count = scaleAttr.count;
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      sizes[i] = Math.exp(scaleAttr.getX(i));
    }
    geometry.setAttribute('pointScale', new THREE.BufferAttribute(sizes, 1));
  }

  onProgress?.('Aligning…');
  autoAlignGeometry(geometry);

  geometry.computeBoundingBox();
  const minY = geometry.boundingBox!.min.y;
  const posAttr2 = geometry.getAttribute('position');
  const arr2 = posAttr2.array as Float32Array;
  for (let i = 1; i < arr2.length; i += 3) {
    arr2[i] -= minY;
  }
  posAttr2.needsUpdate = true;

  onProgress?.('Building renderer…');
  const hasColors = geometry.hasAttribute('color');
  const material = buildMaterial(hasColors);

  const points = new THREE.Points(geometry, material);
  scene.add(points);
  currentPoints = points;

  lastPointCount = geometry.getAttribute('position').count;

  geometry.computeBoundingSphere();
  const radius = geometry.boundingSphere!.radius;

  if (radius > 0) {
    flySpeed = radius * 0.5;
    updateGrid(radius);

    camera.near = radius * 0.00001;
    camera.far = radius * 100;
    camera.updateProjectionMatrix();

    geometry.computeBoundingBox();
    const centerY = geometry.boundingBox ? (geometry.boundingBox.max.y + geometry.boundingBox.min.y) / 2 : 0;
    const maxY = geometry.boundingBox ? geometry.boundingBox.max.y : radius;
    controls.target.set(0, centerY, 0);
    controls.minDistance = 0;
    controls.maxDistance = radius * 10;
    controls.zoomSpeed = 3.0;

    camera.position.set(0, Math.max(centerY, maxY * 0.5), radius * 2.0);
    controls.update();
    controls.saveState();
  }

  onProgress?.('Point cloud loaded');
}

function autoAlignGeometry(geometry: THREE.BufferGeometry): void {
  const posAttr = geometry.getAttribute('position');
  const arr = posAttr.array as Float32Array;
  const n = posAttr.count;

  geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;
  const cx = (bb.max.x + bb.min.x) / 2;
  const cy = (bb.max.y + bb.min.y) / 2;
  const cz = (bb.max.z + bb.min.z) / 2;
  for (let i = 0; i < n; i++) {
    arr[i * 3] -= cx;
    arr[i * 3 + 1] -= cy;
    arr[i * 3 + 2] -= cz;
  }

  const step = Math.max(1, Math.floor(n / 50000));
  let cov_xx = 0, cov_xz = 0, cov_zz = 0;
  for (let i = 0; i < n; i += step) {
    const x = arr[i * 3], z = arr[i * 3 + 2];
    cov_xx += x * x;
    cov_xz += x * z;
    cov_zz += z * z;
  }

  const angle = 0.5 * Math.atan2(2 * cov_xz, cov_xx - cov_zz);
  const cosA = Math.cos(-angle), sinA = Math.sin(-angle);
  for (let i = 0; i < n; i++) {
    const x = arr[i * 3], z = arr[i * 3 + 2];
    arr[i * 3] = x * cosA - z * sinA;
    arr[i * 3 + 2] = x * sinA + z * cosA;
  }

  posAttr.needsUpdate = true;
}

function updateGrid(radius: number): void {
  if (gridMesh) {
    scene.remove(gridMesh);
    gridMesh.geometry.dispose();
    (gridMesh.material as THREE.Material).dispose();
    gridMesh = null;
  }

  const gridScale = radius * 0.5;
  const gridMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uScale: { value: gridScale },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uScale;
      varying vec3 vWorldPos;
      void main() {
        vec2 coord = vWorldPos.xz / uScale;
        vec2 grid = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
        float line = min(grid.x, grid.y);
        float alpha = 1.0 - min(line, 1.0);

        // Fade out with distance from origin
        float dist = length(vWorldPos.xz);
        float fade = 1.0 - smoothstep(uScale * 3.0, uScale * 8.0, dist);

        alpha *= fade * 0.25;
        if (alpha < 0.005) discard;
        gl_FragColor = vec4(vec3(0.4), alpha);
      }
    `,
  });

  const planeSize = radius * 200;
  const planeGeo = new THREE.PlaneGeometry(planeSize, planeSize);
  planeGeo.rotateX(-Math.PI / 2);
  gridMesh = new THREE.Mesh(planeGeo, gridMat);
  gridMesh.position.y = 0;
  gridMesh.renderOrder = -1;
  scene.add(gridMesh);
}

function onResize(): void {
  if (!container || !camera || !renderer) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (w === 0 || h === 0) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}

let lastW = 0, lastH = 0;

function animate(): void {
  animationId = requestAnimationFrame(animate);
  clockDelta = clock.getDelta();

  const w = container.clientWidth;
  const h = container.clientHeight;
  if (w > 0 && h > 0 && (w !== lastW || h !== lastH)) {
    lastW = w;
    lastH = h;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  if (flyMode) {
    updateFlyMovement(clockDelta);
  } else {
    controls.update();
  }

  renderer.render(scene, camera);
}

export function disposeViewer(): void {
  if (animationId !== null) cancelAnimationFrame(animationId);
  window.removeEventListener('resize', onResize);
  unloadPointCloud();
  renderer?.dispose();
  controls?.dispose();
}

export function setPointSize(size: number): void {
  if (!currentPoints) return;
  pointSizeMultiplier = size;
  if (hasPerPointScale && currentPoints.material instanceof THREE.ShaderMaterial) {
    currentPoints.material.uniforms.uSizeMultiplier.value = size;
  } else if (currentPoints.material instanceof THREE.PointsMaterial) {
    currentPoints.material.size = size;
  }
}

export function hasScalarScale(): boolean {
  return hasPerPointScale;
}

function buildMaterial(hasColors: boolean): THREE.Material {
  if (hasPerPointScale) {
    return new THREE.ShaderMaterial({
      uniforms: { uSizeMultiplier: { value: pointSizeMultiplier } },
      vertexShader: `
        attribute float pointScale;
        ${hasColors ? 'varying vec3 vColor;' : ''}
        uniform float uSizeMultiplier;
        void main() {
          ${hasColors ? 'vColor = color;' : ''}
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          float dist = -mvPosition.z;
          float attenuation = 300.0 / max(dist, 0.001);
          float desired = pointScale * uSizeMultiplier * attenuation;
          float minSize = 2.0 * uSizeMultiplier;
          gl_PointSize = max(desired, minSize);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        ${hasColors ? 'varying vec3 vColor;' : ''}
        void main() {
          ${hasColors ? 'gl_FragColor = vec4(vColor, 1.0);' : 'gl_FragColor = vec4(1.0);'}
        }
      `,
      vertexColors: hasColors,
    });
  }
  return new THREE.PointsMaterial({
    size: DEFAULT_POINT_SIZE,
    vertexColors: hasColors,
    sizeAttenuation: true,
  });
}

