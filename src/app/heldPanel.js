import * as THREE from "three";

export function createHeldPanel(scene) {
  const panelRoot = new THREE.Group();
  panelRoot.visible = false;
  scene.add(panelRoot);

  const panelBackground = new THREE.Mesh(
    new THREE.PlaneGeometry(1.3, 1.65),
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

  const title = createPanelButton("Painel", 0.95, "#cfe3ff", "#173256");
  title.userData = { kind: "label" };
  panelRoot.add(title);

  const toggleButtons = [];
  const columns = 4;
  const rows = 5;
  const xStart = -0.45;
  const yStart = 0.52;
  const xGap = 0.3;
  const yGap = 0.24;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const index = row * columns + col;
      const button = createPanelButton(
        `T${String(index + 1).padStart(2, "0")}`,
        0.22,
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

  const finishButton = createPanelButton("Finalizar", 0.3, "#fff2f2", "#7d1717");
  finishButton.position.set(0, -0.68, 0.01);
  finishButton.userData = { kind: "finish" };
  panelRoot.add(finishButton);

  const tempVector = new THREE.Vector3();
  let active = false;
  let suspendedUntilRelease = false;

  function beginHold(leftHandState) {
    if (suspendedUntilRelease || !leftHandState.isOpen || !leftHandState.isPinching) {
      return false;
    }

    active = true;
    panelRoot.visible = true;
    updatePose(leftHandState);
    return true;
  }

  function updatePose(leftHandState, xrCamera) {
    if (!active || !leftHandState) {
      return;
    }

    panelRoot.position.copy(leftHandState.pinchWorld);
    panelRoot.position.addScaledVector(leftHandState.rayDirection, 0.18);
    panelRoot.position.y += 0.02;

    xrCamera.getWorldPosition(tempVector);
    panelRoot.lookAt(tempVector);
  }

  function releaseHold() {
    active = false;
    panelRoot.visible = false;
  }

  function finish() {
    active = false;
    panelRoot.visible = false;
    suspendedUntilRelease = true;
  }

  function onLeftPinchReleased() {
    suspendedUntilRelease = false;
    if (active) {
      releaseHold();
    }
  }

  function handleSelect(object) {
    if (!object || !panelRoot.visible) {
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

  return {
    beginHold,
    updatePose,
    releaseHold,
    onLeftPinchReleased,
    handleSelect,
    isActive: () => active,
    getInteractables: () => (panelRoot.visible ? [...toggleButtons, finishButton] : []),
  };
}

function createPanelButton(label, height, textColor, fillColor) {
  const width = label === "Painel" ? 0.92 : label === "Finalizar" ? 0.86 : 0.24;
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
  ctx.font = "700 54px Segoe UI";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}
