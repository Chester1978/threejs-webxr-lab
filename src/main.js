import "./style.css";
import * as THREE from "three";
import { VRButton } from "three/examples/jsm/webxr/VRButton.js";

const scene = new THREE.Scene();
scene.background = new THREE.Color("#07111f");
scene.fog = new THREE.Fog("#07111f", 8, 30);

const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.1,
  100,
);

const cameraState = {
  position: new THREE.Vector3(0, 2.4, 6.6),
  yaw: 0,
  pitch: -0.28,
};

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

const vrButton = VRButton.createButton(renderer);
const vrButtonSlot = document.querySelector("#vr-button-slot");
vrButton.classList.add("vr-entry");
vrButtonSlot?.appendChild(vrButton);

const ambientLight = new THREE.HemisphereLight("#b7d0ff", "#1b2538", 1.8);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight("#ffffff", 2.4);
keyLight.position.set(4, 7, 5);
scene.add(keyLight);

const fillLight = new THREE.PointLight("#8db6ff", 18, 18, 2);
fillLight.position.set(-3.5, 2.8, 3);
scene.add(fillLight);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(14, 80),
  new THREE.MeshStandardMaterial({
    color: "#0f1b2e",
    metalness: 0.15,
    roughness: 0.88,
  }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -1.15;
scene.add(floor);

const pedestal = new THREE.Mesh(
  new THREE.CylinderGeometry(2.6, 2.9, 0.35, 48),
  new THREE.MeshStandardMaterial({
    color: "#13233d",
    metalness: 0.3,
    roughness: 0.55,
  }),
);
pedestal.position.y = -0.98;
scene.add(pedestal);

const pyramid = new THREE.Mesh(
  new THREE.ConeGeometry(0.75, 1.3, 4),
  new THREE.MeshStandardMaterial({
    color: "#fca5a5",
    emissive: "#4b1616",
    metalness: 0.25,
    roughness: 0.35,
  }),
);
pyramid.position.set(-1.35, -0.15, 0.2);
pyramid.rotation.y = Math.PI * 0.25;
scene.add(pyramid);

const square = new THREE.Mesh(
  new THREE.BoxGeometry(1.2, 1.2, 0.18),
  new THREE.MeshStandardMaterial({
    color: "#fde68a",
    emissive: "#493d0e",
    metalness: 0.2,
    roughness: 0.45,
  }),
);
square.position.set(0, -0.1, 0);
scene.add(square);

const cylinder = new THREE.Mesh(
  new THREE.CylinderGeometry(0.52, 0.52, 1.45, 40),
  new THREE.MeshStandardMaterial({
    color: "#7dd3fc",
    emissive: "#143445",
    metalness: 0.32,
    roughness: 0.3,
  }),
);
cylinder.position.set(1.35, 0.02, -0.18);
scene.add(cylinder);

const objects = [pyramid, square, cylinder];
const palette = ["#fca5a5", "#fde68a", "#7dd3fc", "#86efac", "#c4b5fd", "#f9a8d4"];
const pressedKeys = new Set();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const direction = new THREE.Vector3();
const upAxis = new THREE.Vector3(0, 1, 0);
const pointer = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const clock = new THREE.Clock();
const movementSpeed = 3.4;
const rotationSpeed = 1.45;
const pitchLimit = Math.PI * 0.42;

const wall = new THREE.Mesh(
  new THREE.PlaneGeometry(8.5, 4.2),
  new THREE.MeshStandardMaterial({
    color: "#142238",
    metalness: 0.22,
    roughness: 0.7,
  }),
);
wall.position.set(0, 1.2, -4.4);
scene.add(wall);

function makeButtonTexture(label) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#1a2942";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "#8db6ff";
  ctx.lineWidth = 8;
  ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);

  ctx.fillStyle = "#f2f7ff";
  ctx.font = "700 54px Segoe UI";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function createWallButton(label, x, shape) {
  const button = new THREE.Mesh(
    new THREE.PlaneGeometry(1.7, 0.64),
    new THREE.MeshStandardMaterial({
      map: makeButtonTexture(label),
      color: "#ffffff",
      emissive: "#142640",
      emissiveIntensity: 0.55,
      metalness: 0.08,
      roughness: 0.5,
    }),
  );

  button.position.set(x, 1.25, -4.35);
  button.userData = { shape };
  scene.add(button);
  return button;
}

const wallButtons = [
  createWallButton("Piramide", -2.05, pyramid),
  createWallButton("Quadrado", 0, square),
  createWallButton("Cilindro", 2.05, cylinder),
];
let hoveredButton = null;

const controlsHint = document.querySelector("#controls-hint");
if (controlsHint) {
  controlsHint.textContent =
    "Setas: mover | Shift + setas: girar/inclinar | W A S D: mover | Q/E ou PageUp/PageDown: subir/descer";
}

function updateCameraTransform() {
  direction.set(0, 0, -1);
  direction.applyEuler(
    new THREE.Euler(cameraState.pitch, cameraState.yaw, 0, "YXZ"),
  );

  camera.position.copy(cameraState.position);
  camera.lookAt(cameraState.position.clone().add(direction));
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function onKeyChange(event, isPressed) {
  const key = event.key;

  if (
    [
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "w",
      "a",
      "s",
      "d",
      "q",
      "e",
      "PageUp",
      "PageDown",
      "Shift",
    ].includes(key)
  ) {
    event.preventDefault();
  }

  if (isPressed) {
    pressedKeys.add(key);
  } else {
    pressedKeys.delete(key);
  }
}

window.addEventListener("resize", onWindowResize);
window.addEventListener("keydown", (event) => onKeyChange(event, true));
window.addEventListener("keyup", (event) => onKeyChange(event, false));
renderer.domElement.addEventListener("pointermove", (event) => {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(wallButtons);
  const nextHovered = hits[0]?.object ?? null;

  if (hoveredButton === nextHovered) {
    return;
  }

  if (hoveredButton) {
    hoveredButton.scale.set(1, 1, 1);
    hoveredButton.material.emissiveIntensity = 0.55;
  }

  hoveredButton = nextHovered;

  if (hoveredButton) {
    hoveredButton.scale.set(1.06, 1.06, 1.06);
    hoveredButton.material.emissiveIntensity = 1;
  }
});

renderer.domElement.addEventListener("pointerleave", () => {
  if (!hoveredButton) {
    return;
  }

  hoveredButton.scale.set(1, 1, 1);
  hoveredButton.material.emissiveIntensity = 0.55;
  hoveredButton = null;
});

renderer.domElement.addEventListener("pointerdown", (event) => {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(wallButtons);
  const hit = hits[0];

  if (!hit) {
    return;
  }

  const shape = hit.object.userData.shape;
  const color = palette[Math.floor(Math.random() * palette.length)];
  shape.material.color.set(color);
  shape.material.emissive.set(color);
});

updateCameraTransform();

renderer.setAnimationLoop(() => {
  const delta = Math.min(clock.getDelta(), 0.05);
  const shiftPressed = pressedKeys.has("Shift");

  if (shiftPressed) {
    if (pressedKeys.has("ArrowLeft")) {
      cameraState.yaw += rotationSpeed * delta;
    }
    if (pressedKeys.has("ArrowRight")) {
      cameraState.yaw -= rotationSpeed * delta;
    }
    if (pressedKeys.has("ArrowUp")) {
      cameraState.pitch = Math.min(
        pitchLimit,
        cameraState.pitch + rotationSpeed * delta,
      );
    }
    if (pressedKeys.has("ArrowDown")) {
      cameraState.pitch = Math.max(
        -pitchLimit,
        cameraState.pitch - rotationSpeed * delta,
      );
    }
  } else {
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() > 0) {
      forward.normalize();
    } else {
      forward.set(0, 0, -1);
    }

    right.crossVectors(forward, upAxis).normalize();

    if (pressedKeys.has("ArrowUp") || pressedKeys.has("w")) {
      cameraState.position.addScaledVector(forward, movementSpeed * delta);
    }
    if (pressedKeys.has("ArrowDown") || pressedKeys.has("s")) {
      cameraState.position.addScaledVector(forward, -movementSpeed * delta);
    }
    if (pressedKeys.has("ArrowLeft") || pressedKeys.has("a")) {
      cameraState.position.addScaledVector(right, -movementSpeed * delta);
    }
    if (pressedKeys.has("ArrowRight") || pressedKeys.has("d")) {
      cameraState.position.addScaledVector(right, movementSpeed * delta);
    }
  }

  if (pressedKeys.has("e") || pressedKeys.has("PageUp")) {
    cameraState.position.y += movementSpeed * delta;
  }
  if (pressedKeys.has("q") || pressedKeys.has("PageDown")) {
    cameraState.position.y -= movementSpeed * delta;
  }

  const elapsed = clock.elapsedTime;
  pyramid.rotation.y += 0.006;
  square.rotation.y += 0.009;
  cylinder.rotation.y += 0.008;

  objects.forEach((mesh, index) => {
    mesh.position.y += Math.sin(elapsed * 1.6 + index * 0.8) * 0.0018;
  });

  updateCameraTransform();
  renderer.render(scene, camera);
});
