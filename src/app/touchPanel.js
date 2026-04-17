import * as THREE from "three";

export function createTouchPanel(worldRoot) {
  const panelRoot = new THREE.Group();
  panelRoot.position.set(0, 0, 2.95);
  worldRoot.add(panelRoot);

  const background = new THREE.Mesh(
    new THREE.PlaneGeometry(0.22, 0.34),
    new THREE.MeshStandardMaterial({
      color: "#102033",
      emissive: "#08111c",
      emissiveIntensity: 0.8,
      metalness: 0.08,
      roughness: 0.42,
      transparent: true,
      opacity: 0.92,
    }),
  );
  panelRoot.add(background);

  const title = makeLabel("Toque", 0.22, 0.04, "#cfe3ff", "#173256");
  title.position.set(0, 0.13, 0.005);
  panelRoot.add(title);

  const columns = 3;
  const rows = 3;
  const btnSize = 0.05;
  const gap = 0.012;
  const gridWidth = columns * btnSize + (columns - 1) * gap;
  const gridHeight = rows * btnSize + (rows - 1) * gap;
  const xStart = -gridWidth / 2 + btnSize / 2;
  const yStart = 0.06;

  const toggleButtons = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const index = row * columns + col;
      const button = new THREE.Mesh(
        new THREE.PlaneGeometry(btnSize, btnSize),
        new THREE.MeshStandardMaterial({
          map: makeButtonTexture(
            `T${String(index + 1).padStart(2, "0")}`,
            "#f2f7ff",
            "#1b3150",
          ),
          color: "#ffffff",
          emissive: "#1b3150",
          emissiveIntensity: 0.62,
          metalness: 0.05,
          roughness: 0.55,
          transparent: true,
        }),
      );
      button.position.set(
        xStart + col * (btnSize + gap),
        yStart - row * (btnSize + gap),
        0.005,
      );
      button.userData = { kind: "toggle", index, active: false };
      toggleButtons.push(button);
      panelRoot.add(button);
    }
  }

  const resetButton = new THREE.Mesh(
    new THREE.PlaneGeometry(0.14, 0.04),
    new THREE.MeshStandardMaterial({
      map: makeButtonTexture("Reset", "#fff2f2", "#7d1717"),
      color: "#ffffff",
      emissive: "#7d1717",
      emissiveIntensity: 0.62,
      metalness: 0.05,
      roughness: 0.55,
      transparent: true,
    }),
  );
  resetButton.position.set(0, -0.14, 0.005);
  resetButton.userData = { kind: "reset" };
  panelRoot.add(resetButton);

  const touchRadius = 0.03;
  const tempVec = new THREE.Vector3();
  // Track "was touching" per hand (indexed by hand.userData.index) per button
  // to debounce — only toggle on the frame the finger first enters the radius.
  const wasTouching = new Map();

  function checkTouch(trackedHands) {
    const allButtons = [...toggleButtons, resetButton];

    for (const handState of trackedHands) {
      const handIndex = handState.hand.userData.index;
      if (!wasTouching.has(handIndex)) {
        wasTouching.set(handIndex, new Array(allButtons.length).fill(false));
      }
      const prev = wasTouching.get(handIndex);

      for (let i = 0; i < allButtons.length; i += 1) {
        const button = allButtons[i];
        button.getWorldPosition(tempVec);
        const dist = handState.indexWorld.distanceTo(tempVec);
        const isTouching = dist < touchRadius;

        if (isTouching && !prev[i]) {
          activateButton(button);
        }
        prev[i] = isTouching;
      }
    }
  }

  function activateButton(button) {
    if (button.userData.kind === "toggle") {
      button.userData.active = !button.userData.active;
      updateToggleVisual(button);
    } else if (button.userData.kind === "reset") {
      for (const btn of toggleButtons) {
        btn.userData.active = false;
        updateToggleVisual(btn);
      }
    }
  }

  function updateToggleVisual(button) {
    const active = button.userData.active;
    const fillColor = active ? "#12693c" : "#1b3150";
    const textColor = active ? "#f4fff8" : "#f2f7ff";
    const label = `T${String(button.userData.index + 1).padStart(2, "0")}`;
    button.material.map = makeButtonTexture(label, textColor, fillColor);
    button.material.emissive.set(fillColor);
    button.material.needsUpdate = true;
  }

  return {
    checkTouch,
    getButtons: () => [...toggleButtons, resetButton],
  };
}

function makeLabel(text, width, height, textColor, fillColor) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshStandardMaterial({
      map: makeButtonTexture(text, textColor, fillColor),
      color: "#ffffff",
      emissive: fillColor,
      emissiveIntensity: 0.55,
      metalness: 0.05,
      roughness: 0.55,
      transparent: true,
    }),
  );
  return mesh;
}

function makeButtonTexture(label, textColor, fillColor) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = fillColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "rgba(190, 220, 255, 0.75)";
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);

  ctx.fillStyle = textColor;
  ctx.font = label.length <= 3 ? "700 72px Segoe UI" : "700 52px Segoe UI";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}
