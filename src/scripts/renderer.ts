import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';

const FILENAME = `${import.meta.env.BASE_URL}pointclouds/fused_scene.ply`;
const POINT_SIZE: number = 0.005;
const BACKGROUND_COLOR: number = 0x111111;

const scene = new THREE.Scene();
scene.background = new THREE.Color(BACKGROUND_COLOR);

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.1;

const loader = new PLYLoader();
const infoDiv = document.getElementById('info') as HTMLDivElement;

loader.load(
  FILENAME,
  (geometry: THREE.BufferGeometry) => {
    const material = new THREE.PointsMaterial({
      size: POINT_SIZE,
      vertexColors: true,
      sizeAttenuation: true,
    });

    geometry.center();
    const points = new THREE.Points(geometry, material);
    scene.add(points);

    geometry.computeBoundingSphere();
    const radius: number = geometry.boundingSphere!.radius;

    if (radius > 0) {
      camera.near = Math.max(0.001, radius / 1000);
      camera.far = Math.max(100, radius * 100);
      camera.updateProjectionMatrix();

      controls.target.set(0, 0, 0);
      controls.minDistance = radius * 0.1;
      controls.maxDistance = radius * 10;
      controls.zoomSpeed = 3.0;

      camera.position.set(0, 0, radius * 2.0);
      controls.update();
      controls.saveState();
    }

    infoDiv.innerText = 'Quest 3 Point Cloud Viewer';
  },
  (xhr: ProgressEvent) => {
    const percent = Math.min(100, (xhr.loaded / xhr.total) * 100).toFixed(0);
    infoDiv.innerText = `Loading point cloud: ${percent}%`;
  },
  (error: unknown) => {
    console.error('Error loading point cloud:', error);
    infoDiv.innerText = 'Error loading point cloud.';
  }
);

window.addEventListener('resize', onWindowResize, false);

function onWindowResize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate(): void {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

animate();

