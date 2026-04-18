import * as THREE from "three";
import { VRButton } from "three/examples/jsm/webxr/VRButton.js";
import { createDesktopControls } from "./desktopControls.js";
import { createSceneWorld, animateObjects } from "./scene.js";
import { createTouchPanel } from "./touchPanel.js";
import { createXRHandGestures } from "./xrHands.js";

const APP_VERSION = 12;

// --- Workaround emulador Meta XR ---
// O polyfill do emulador cria XRSessions "fake" que o constructor nativo
// XRWebGLBinding rejeita ("parameter 1 is not of type 'XRSession'").
// Esconder XRWebGLBinding forca o Three.js a usar XRWebGLLayer (fallback),
// que funciona normalmente com o polyfill.
// Tambem desativamos offerSession, que pode auto-iniciar a sessao antes do click.
if (navigator.xr) {
  navigator.xr.offerSession = undefined;
}
const _savedXRWebGLBinding = globalThis.XRWebGLBinding;
globalThis.XRWebGLBinding = undefined;

export function createApp() {
  const { scene, worldRoot, objects, merkabah } = createSceneWorld();

  const camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.05,
    100000,
  );

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);

  const vrButton = VRButton.createButton(renderer, {
    optionalFeatures: ["hand-tracking"],
  });
  const vrButtonSlot = document.querySelector("#vr-button-slot");
  vrButton.classList.add("vr-entry");
  vrButtonSlot?.appendChild(vrButton);

  const clock = new THREE.Clock();
  let latestTrackedHands = [];
  const versionTag = document.querySelector("#app-version");

  if (versionTag) {
    versionTag.textContent = `Versao ${APP_VERSION}`;
  }

  const controlsHint = document.querySelector("#controls-hint");
  if (controlsHint) {
    controlsHint.textContent =
      "Desktop: setas/WASD para mover, Shift + setas para olhar, Q/E ou PageUp/PageDown para subir e descer. VR: encoste a ponta do indicador nos botoes do painel flutuante para ativar/desativar. Coloque as palmas de frente uma para a outra e pince para ativar a linha amarela de controle do cenario (zoom, rotacao, translacao).";
  }

  const desktopControls = createDesktopControls(camera);
  const touchPanel = createTouchPanel(worldRoot);
  const xrHands = createXRHandGestures({
    renderer,
    scene,
    worldRoot,
    onFrame: (trackedHands) => {
      latestTrackedHands = trackedHands;
    },
  });

  function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  window.addEventListener("resize", onWindowResize);
  window.addEventListener("keydown", desktopControls.onKeyDown);
  window.addEventListener("keyup", desktopControls.onKeyUp);

  renderer.setAnimationLoop(() => {
    const delta = Math.min(clock.getDelta(), 0.05);

    if (renderer.xr.isPresenting) {
      xrHands.update();
      touchPanel.checkTouch(latestTrackedHands);
    } else {
      desktopControls.update(delta);
    }

    animateObjects(objects, clock.elapsedTime, merkabah);
    renderer.render(scene, camera);
  });
}
