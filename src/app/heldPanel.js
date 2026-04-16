import * as THREE from "three";

export function createHeldPanel(scene) {
  const panelRoot = new THREE.Group();
  panelRoot.visible = false;
  scene.add(panelRoot);

  const panelBackground = new THREE.Mesh(
    new THREE.PlaneGeometry(0.44, 0.58),
    new THREE.MeshStandardMaterial({
      color: "#102033",
      emissive: "#08111c",
      emissiveIntensity: 0.8,
      metalness: 0.08,
      roughness: 0.42,
      transparent: true,
      opacity: 0.95,
    }),
  );
  panelRoot.add(panelBackground);

  const title = createPanelButton("Painel", 0.13, "#cfe3ff", "#173256");
  title.position.set(0, 0.21, 0.01);
  title.userData = { kind: "label" };
  panelRoot.add(title);

  const toggleButtons = [];
  const columns = 4;
  const rows = 5;
  const xStart = -0.15;
  const yStart = 0.1;
  const xGap = 0.1;
  const yGap = 0.085;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const index = row * columns + col;
      const button = createPanelButton(
        `T${String(index + 1).padStart(2, "0")}`,
        0.06,
        "#f2f7ff",
        "#1b3150",
      );
      button.position.set(xStart + col * xGap, yStart - row * yGap, 0.01);
      button.userData = {
        kind: "toggle",
        index,
        active: false,
      };
      toggleButtons.push(button);
      panelRoot.add(button);
      updateToggleVisual(button);
    }
  }

  const finishButton = createPanelButton("Finalizar", 0.08, "#fff2f2", "#7d1717");
  finishButton.position.set(0, -0.23, 0.01);
  finishButton.userData = { kind: "finish" };
  panelRoot.add(finishButton);

  const tempVector = new THREE.Vector3();
  const tempVector2 = new THREE.Vector3();
  const tempVector3 = new THREE.Vector3();
  let active = false;
  let persistent = false;
  let suspendedUntilRelease = false;
  let holderHandedness = null;
  let justOpened = false;

  function beginHold(handState, options = {}) {
    const requireOpen = options.requireOpen ?? true;
    const wantPersistent = options.persistent ?? false;
    const forcedHandedness = options.handedness ?? null;

    // Persistent mode is reserved for explicit UI opens (e.g. wall button);
    // it does not require an active pinch or open hand.
    if (!wantPersistent) {
      if (
        suspendedUntilRelease ||
        !handState?.isPinching ||
        (requireOpen && !handState.isOpen)
      ) {
        return false;
      }
    }

    active = true;
    persistent = wantPersistent;
    justOpened = true;
    holderHandedness =
      forcedHandedness ?? handState?.hand?.userData?.handedness ?? null;
    // Start hidden; the animation loop will place + reveal it once it has a
    // valid xrCamera and holder hand.
    panelRoot.visible = false;
    return true;
  }

  function updatePose(handState, xrCamera) {
    if (!active || !handState || !xrCamera) {
      return;
    }

    const handedness = handState.hand.userData.handedness;
    const side = handedness === "left" ? -1 : 1;
    // rayDirection ~ wrist -> index-finger-tip (forward along the hand)
    tempVector2.copy(handState.rayDirection).normalize();
    // horizontal "outward" axis relative to the ray, kept level with the ground
    tempVector3.set(tempVector2.z, 0, -tempVector2.x).normalize();

    // Anchor over the palm (wrist is more stable than the pinch point)
    panelRoot.position.copy(handState.wristWorld);
    panelRoot.position.addScaledVector(tempVector3, side * 0.09);
    panelRoot.position.addScaledVector(tempVector2, 0.08);
    panelRoot.position.y += 0.05;

    xrCamera.getWorldPosition(tempVector);
    panelRoot.lookAt(tempVector);

    panelRoot.visible = true;
  }

  function close() {
    active = false;
    persistent = false;
    justOpened = false;
    holderHandedness = null;
    panelRoot.visible = false;
  }

  function finish() {
    const wasPersistent = persistent;
    close();
    // Only block the pinch-hold gesture from immediately re-triggering.
    if (!wasPersistent) {
      suspendedUntilRelease = true;
    }
  }

  function onHolderPinchReleased() {
    suspendedUntilRelease = false;
    if (active && !persistent) {
      close();
    }
  }

  function handleSelect(object) {
    if (!object || !panelRoot.visible || justOpened) {
      return false;
    }

    if (object.userData.kind === "toggle") {
      object.userData.active = !object.userData.active;
      updateToggleVisual(object);
      return true;
    }

    if (object.userData.kind === "finish") {
      finish();
      return true;
    }

    return false;
  }

  function endOpenGuard() {
    justOpened = false;
  }

  return {
    beginHold,
    updatePose,
    close,
    onHolderPinchReleased,
    handleSelect,
    endOpenGuard,
    isActive: () => active,
    isPersistent: () => persistent,
    getHolderHandedness: () => holderHandedness,
    getInteractables: () => (panelRoot.visible ? [...toggleButtons, finishButton] : []),
  };
}

function createPanelButton(label, height, textColor, fillColor) {
  const width = label === "Painel" ? 0.3 : label === "Finalizar" ? 0.26 : 0.075;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshStandardMaterial({
      map: makeButtonTexture(label, textColor, fillColor),
      color: "#ffffff",
      emissive: fillColor,
      emissiveIntensity: 0.62,
      metalness: 0.05,
      roughness: 0.55,
      transparent: true,
    }),
  );

  return mesh;
}

function updateToggleVisual(button) {
  const active = button.userData.active;
  const fillColor = active ? "#12693c" : "#1b3150";
  const textColor = active ? "#f4fff8" : "#f2f7ff";
  button.material.map = makeButtonTexture(
    `T${String(button.userData.index + 1).padStart(2, "0")}`,
    textColor,
    fillColor,
  );
  button.material.emissive.set(fillColor);
  button.material.needsUpdate = true;
}

function makeButtonTexture(label, textColor, fillColor) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = fillColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "rgba(190, 220, 255, 0.75)";
  ctx.lineWidth = 8;
  ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);

  ctx.fillStyle = textColor;
  ctx.font =
    label === "Finalizar"
      ? "700 48px Segoe UI"
      : label === "Painel"
        ? "700 52px Segoe UI"
        : "700 44px Segoe UI";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}
