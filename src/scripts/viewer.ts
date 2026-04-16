import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';

const POINT_SIZE = 0.005;
const BACKGROUND_COLOR = 0x111111;

let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let controls: OrbitControls;
let currentPoints: THREE.Points | null = null;
let animationId: number | null = null;
let container: HTMLElement;

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
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;

  camera.position.set(0, 0, 3);
  controls.update();

  window.addEventListener('resize', onResize);
  animate();
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
}

export function loadPointCloudFromBuffer(
  buffer: ArrayBuffer,
  onProgress?: (msg: string) => void
): void {
  unloadPointCloud();

  onProgress?.('Parsing point cloud…');

  const loader = new PLYLoader();
  const geometry = loader.parse(buffer);

  const material = new THREE.PointsMaterial({
    size: POINT_SIZE,
    vertexColors: true,
    sizeAttenuation: true,
  });

  geometry.center();
  const points = new THREE.Points(geometry, material);
  scene.add(points);
  currentPoints = points;

  geometry.computeBoundingSphere();
  const radius = geometry.boundingSphere!.radius;

  if (radius > 0) {
    camera.near = 0.0001;
    camera.far = 100000;
    camera.updateProjectionMatrix();

    controls.target.set(0, 0, 0);
    controls.minDistance = 0;
    controls.maxDistance = Infinity;
    controls.zoomSpeed = 3.0;

    camera.position.set(0, 0, radius * 2.0);
    controls.update();
    controls.saveState();
  }

  onProgress?.('Point cloud loaded');
}

function onResize(): void {
  if (!container || !camera || !renderer) return;
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
}

function animate(): void {
  animationId = requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

export function disposeViewer(): void {
  if (animationId !== null) {
    cancelAnimationFrame(animationId);
  }
  window.removeEventListener('resize', onResize);
  unloadPointCloud();
  renderer?.dispose();
  controls?.dispose();
}

export function setPointSize(size: number): void {
  if (currentPoints && currentPoints.material instanceof THREE.PointsMaterial) {
    currentPoints.material.size = size;
  }
}
