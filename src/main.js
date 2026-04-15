import "./style.css";
import * as THREE from "three";
import { VRButton } from "three/examples/jsm/webxr/VRButton.js";
import { XRHandModelFactory } from "three/examples/jsm/webxr/XRHandModelFactory.js";

const scene = new THREE.Scene();
scene.background = new THREE.Color("#07111f");
scene.fog = new THREE.Fog("#07111f", 8, 30);

const worldRoot = new THREE.Group();
scene.add(worldRoot);

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

const vrButton = VRButton.createButton(renderer, {
  optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking"],
});
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
worldRoot.add(floor);

const pedestal = new THREE.Mesh(
  new THREE.CylinderGeometry(2.6, 2.9, 0.35, 48),
  new THREE.MeshStandardMaterial({
    color: "#13233d",
    metalness: 0.3,
    roughness: 0.55,
  }),
);
pedestal.position.y = -0.98;
worldRoot.add(pedestal);

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
worldRoot.add(pyramid);

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
worldRoot.add(square);

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
worldRoot.add(cylinder);

const wall = new THREE.Mesh(
  new THREE.PlaneGeometry(8.5, 4.2),
  new THREE.MeshStandardMaterial({
    color: "#142238",
    metalness: 0.22,
    roughness: 0.7,
  }),
);
wall.position.set(0, 1.2, -4.4);
worldRoot.add(wall);

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
  worldRoot.add(button);
  return button;
}

const objects = [pyramid, square, cylinder];
const palette = [
  "#fca5a5",
  "#fde68a",
  "#7dd3fc",
  "#86efac",
  "#c4b5fd",
  "#f9a8d4",
];
const wallButtons = [
  createWallButton("Piramide", -2.05, pyramid),
  createWallButton("Quadrado", 0, square),
  createWallButton("Cilindro", 2.05, cylinder),
];

const pressedKeys = new Set();
const pointer = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const direction = new THREE.Vector3();
const upAxis = new THREE.Vector3(0, 1, 0);
const tempVectorA = new THREE.Vector3();
const tempVectorB = new THREE.Vector3();
const tempVectorC = new THREE.Vector3();
const tempVectorD = new THREE.Vector3();
const tempEuler = new THREE.Euler();
const clock = new THREE.Clock();
const movementSpeed = 3.4;
const rotationSpeed = 1.45;
const pitchLimit = Math.PI * 0.42;
const pinchThreshold = 0.028;
const minWorldScale = 0.45;
const maxWorldScale = 1.9;

let hoveredButton = null;

const controlsHint = document.querySelector("#controls-hint");
if (controlsHint) {
  controlsHint.textContent =
    "Desktop: setas/WASD para mover, Shift + setas para olhar, Q/E ou PageUp/PageDown para subir e descer. VR: pinca no chao para puxar o mundo; com duas maos, gire e aproxime/afaste.";
}

const handModelFactory = new XRHandModelFactory();
const hands = [0, 1].map((index) => {
  const hand = renderer.xr.getHand(index);
  hand.userData.index = index;
  hand.add(handModelFactory.createHandModel(hand, "spheres"));
  scene.add(hand);
  return {
    hand,
    pinchWorld: new THREE.Vector3(),
    thumbWorld: new THREE.Vector3(),
    indexWorld: new THREE.Vector3(),
    isPinching: false,
  };
});

const xrGesture = {
  mode: null,
  handIndex: -1,
  pivotLocal: new THREE.Vector3(),
  startWorldPosition: new THREE.Vector3(),
  startWorldScale: 1,
  startWorldYaw: 0,
  startHandWorld: new THREE.Vector3(),
  startMidpoint: new THREE.Vector3(),
  startDistance: 0,
  startAngle: 0,
};

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

function setShapeColor(shape) {
  const color = palette[Math.floor(Math.random() * palette.length)];
  shape.material.color.set(color);
  shape.material.emissive.set(color);
}

function updateDesktopButtonHover(event) {
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
}

function getPinchPose(handState) {
  const thumb = handState.hand.joints?.["thumb-tip"];
  const index = handState.hand.joints?.["index-finger-tip"];

  if (!thumb || !index || !thumb.visible || !index.visible) {
    handState.isPinching = false;
    return false;
  }

  thumb.getWorldPosition(handState.thumbWorld);
  index.getWorldPosition(handState.indexWorld);

  handState.pinchWorld
    .copy(handState.thumbWorld)
    .add(handState.indexWorld)
    .multiplyScalar(0.5);

  handState.isPinching =
    handState.thumbWorld.distanceTo(handState.indexWorld) < pinchThreshold;

  return handState.isPinching;
}

function isNearFloor(worldPoint) {
  floor.getWorldPosition(tempVectorA);
  return Math.abs(worldPoint.y - tempVectorA.y) < 0.38 * worldRoot.scale.x;
}

function startSingleHandGesture(handState) {
  xrGesture.mode = "drag";
  xrGesture.handIndex = handState.hand.userData.index;
  xrGesture.startHandWorld.copy(handState.pinchWorld);
  xrGesture.startWorldPosition.copy(worldRoot.position);
}

function startTwoHandGesture(activeHands) {
  const left = activeHands[0];
  const rightHand = activeHands[1];

  xrGesture.mode = "two-hand";
  xrGesture.handIndex = -1;
  xrGesture.startWorldPosition.copy(worldRoot.position);
  xrGesture.startWorldScale = worldRoot.scale.x;
  xrGesture.startWorldYaw = worldRoot.rotation.y;
  xrGesture.startMidpoint
    .copy(left.pinchWorld)
    .add(rightHand.pinchWorld)
    .multiplyScalar(0.5);
  xrGesture.startDistance = Math.max(
    left.pinchWorld.distanceTo(rightHand.pinchWorld),
    0.001,
  );
  xrGesture.startAngle = Math.atan2(
    rightHand.pinchWorld.x - left.pinchWorld.x,
    rightHand.pinchWorld.z - left.pinchWorld.z,
  );

  worldRoot.updateMatrixWorld(true);
  xrGesture.pivotLocal.copy(xrGesture.startMidpoint);
  worldRoot.worldToLocal(xrGesture.pivotLocal);
}

function clearXRGesture() {
  xrGesture.mode = null;
  xrGesture.handIndex = -1;
}

function updateSingleHandGesture(handState) {
  tempVectorA.copy(handState.pinchWorld).sub(xrGesture.startHandWorld);
  worldRoot.position.copy(xrGesture.startWorldPosition).add(tempVectorA);
}

function updateTwoHandGesture(activeHands) {
  const left = activeHands[0];
  const rightHand = activeHands[1];
  const currentMidpoint = tempVectorA
    .copy(left.pinchWorld)
    .add(rightHand.pinchWorld)
    .multiplyScalar(0.5);
  const currentDistance = Math.max(
    left.pinchWorld.distanceTo(rightHand.pinchWorld),
    0.001,
  );
  const currentAngle = Math.atan2(
    rightHand.pinchWorld.x - left.pinchWorld.x,
    rightHand.pinchWorld.z - left.pinchWorld.z,
  );

  const nextScale = THREE.MathUtils.clamp(
    xrGesture.startWorldScale * (currentDistance / xrGesture.startDistance),
    minWorldScale,
    maxWorldScale,
  );

  worldRoot.scale.setScalar(nextScale);
  worldRoot.rotation.y =
    xrGesture.startWorldYaw + (currentAngle - xrGesture.startAngle);
  worldRoot.position.copy(xrGesture.startWorldPosition);
  worldRoot.updateMatrixWorld(true);

  tempVectorB
    .copy(xrGesture.pivotLocal)
    .applyMatrix4(worldRoot.matrixWorld);

  worldRoot.position.add(currentMidpoint.sub(tempVectorB));
}

function updateXRGestures() {
  const activeHands = hands.filter(getPinchPose);

  if (activeHands.length === 2) {
    if (xrGesture.mode !== "two-hand") {
      startTwoHandGesture(activeHands);
    }

    updateTwoHandGesture(activeHands);
    return;
  }

  if (activeHands.length === 1 && isNearFloor(activeHands[0].pinchWorld)) {
    if (
      xrGesture.mode !== "drag" ||
      xrGesture.handIndex !== activeHands[0].hand.userData.index
    ) {
      startSingleHandGesture(activeHands[0]);
    }

    updateSingleHandGesture(activeHands[0]);
    return;
  }

  clearXRGesture();
}

window.addEventListener("resize", onWindowResize);
window.addEventListener("keydown", (event) => onKeyChange(event, true));
window.addEventListener("keyup", (event) => onKeyChange(event, false));
renderer.domElement.addEventListener("pointermove", updateDesktopButtonHover);
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

  if (hit) {
    setShapeColor(hit.object.userData.shape);
  }
});

renderer.xr.addEventListener("sessionend", clearXRGesture);

updateCameraTransform();

renderer.setAnimationLoop(() => {
  const delta = Math.min(clock.getDelta(), 0.05);

  if (!renderer.xr.isPresenting) {
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

    updateCameraTransform();
  } else {
    updateXRGestures();
  }

  const elapsed = clock.elapsedTime;
  pyramid.rotation.y += 0.006;
  square.rotation.y += 0.009;
  cylinder.rotation.y += 0.008;

  objects.forEach((mesh, index) => {
    mesh.position.y += Math.sin(elapsed * 1.6 + index * 0.8) * 0.0018;
  });

  renderer.render(scene, camera);
});
