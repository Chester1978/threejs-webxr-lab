import * as THREE from "three";
import { VRButton } from "three/examples/jsm/webxr/VRButton.js";
import { createDesktopControls } from "./desktopControls.js";
import { createHeldPanel } from "./heldPanel.js";
import { createSceneWorld, animateObjects } from "./scene.js";
import { createXRHandGestures } from "./xrHands.js";

const APP_VERSION = 6;

export function createApp() {
  const { scene, worldRoot, objects, shapes, palette } = createSceneWorld();

  const camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.1,
    100,
  );

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

  const clock = new THREE.Clock();
  const pointer = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  let hoveredButton = null;
  let latestTrackedHands = [];
  const versionTag = document.querySelector("#app-version");

  if (versionTag) {
    versionTag.textContent = `Versao ${APP_VERSION}`;
  }

  const controlsHint = document.querySelector("#controls-hint");
  if (controlsHint) {
    controlsHint.textContent =
      "Desktop: setas/WASD para mover, Shift + setas para olhar, Q/E ou PageUp/PageDown para subir e descer. VR: use o raio da mao para apontar; pinca para clicar. Ative o painel movel pelo botao Painel na parede. Pincando com as duas maos ao mesmo tempo aparece a linha amarela: aproxime ou afaste as maos para mudar o zoom, mova as duas juntas para transladar o cenario, e gire a linha para rodar.";
  }

  const wallButtons = createWallButtons(worldRoot, shapes);
  const desktopControls = createDesktopControls(camera);
  const heldPanel = createHeldPanel(scene);
  const xrHands = createXRHandGestures({
    renderer,
    scene,
    worldRoot,
    interactables: () => [...wallButtons, ...heldPanel.getInteractables()],
    onHoverChange: (hoveredObjects) => {
      setHoveredButton(hoveredObjects[0] ?? null);
    },
    onSelect: (object, handState) => {
      if (!object) {
        return;
      }

      if (heldPanel.handleSelect(object)) {
        return;
      }

      if (object.userData.action === "open-panel") {
        if (heldPanel.isActive()) {
          heldPanel.close();
        } else {
          heldPanel.beginHold(handState, {
            requireOpen: false,
            persistent: true,
            handedness: "left",
          });
        }
        return;
      }

      if (
        heldPanel.isActive() &&
        handState?.hand?.userData?.handedness === heldPanel.getHolderHandedness()
      ) {
        return;
      }

      setShapeColor(object.userData.shape);
    },
    onFrame: (trackedHands) => {
      latestTrackedHands = trackedHands;
    },
  });

  function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  function setShapeColor(shape) {
    const color = palette[Math.floor(Math.random() * palette.length)];
    shape.material.color.set(color);
    shape.material.emissive.set(color);
  }

  function setHoveredButton(nextHovered) {
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

  function updateDesktopButtonHover(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(wallButtons);
    const nextHovered = hits[0]?.object ?? null;

    setHoveredButton(nextHovered);
  }

  window.addEventListener("resize", onWindowResize);
  window.addEventListener("keydown", desktopControls.onKeyDown);
  window.addEventListener("keyup", desktopControls.onKeyUp);
  renderer.domElement.addEventListener("pointermove", updateDesktopButtonHover);
  renderer.domElement.addEventListener("pointerleave", () => {
    setHoveredButton(null);
  });

  renderer.domElement.addEventListener("pointerdown", (event) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(wallButtons)[0];

    if (hit) {
      if (hit.object.userData.action === "open-panel") {
        return;
      }

      setShapeColor(hit.object.userData.shape);
    }
  });

  renderer.setAnimationLoop(() => {
    const delta = Math.min(clock.getDelta(), 0.05);

    if (renderer.xr.isPresenting) {
      xrHands.update();
      const leftHand = latestTrackedHands.find((handState) => handState.hand.userData.handedness === "left");
      const holderHand = latestTrackedHands.find(
        (handState) => handState.hand.userData.handedness === heldPanel.getHolderHandedness(),
      );

      if (
        leftHand?.isOpen &&
        leftHand.isPinching &&
        !heldPanel.isActive()
      ) {
        heldPanel.beginHold(leftHand);
      }

      if (heldPanel.isActive()) {
        const xrCamera = renderer.xr.getCamera(camera);
        if (heldPanel.isPersistent()) {
          // Wall-button-activated tablet: follows the left hand as long as it
          // is tracked, no pinch required.
          if (holderHand) {
            heldPanel.updatePose(holderHand, xrCamera);
            heldPanel.endOpenGuard();
          }
        } else if (holderHand?.isPinching) {
          heldPanel.updatePose(holderHand, xrCamera);
          heldPanel.endOpenGuard();
        } else {
          heldPanel.onHolderPinchReleased();
        }
      }
    } else {
      desktopControls.update(delta);
    }

    animateObjects(objects, clock.elapsedTime);
    renderer.render(scene, camera);
  });
}

function createWallButtons(worldRoot, shapes) {
  return [
    createWallButton(worldRoot, "Piramide", -3.1, { shape: shapes.pyramid }),
    createWallButton(worldRoot, "Quadrado", -1.02, { shape: shapes.square }),
    createWallButton(worldRoot, "Cilindro", 1.02, { shape: shapes.cylinder }),
    createWallButton(worldRoot, "Painel", 3.1, { action: "open-panel" }),
  ];
}

function createWallButton(worldRoot, label, x, userData) {
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
  button.userData = userData;
  worldRoot.add(button);
  return button;
}

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
