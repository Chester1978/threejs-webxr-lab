import * as THREE from "three";

const MAX_LINES = 14;
const CANVAS_W = 512;
const CANVAS_H = 512;

export function createDebugPanel(worldRoot) {
  const panelRoot = new THREE.Group();
  panelRoot.position.set(3.5, 0.6, 1.5);
  panelRoot.rotation.y = -Math.PI * 0.25;
  worldRoot.add(panelRoot);

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext("2d");

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 1.2),
    new THREE.MeshStandardMaterial({
      map: tex,
      color: "#ffffff",
      roughness: 0.7,
      metalness: 0.0,
    }),
  );
  panelRoot.add(mesh);

  // Frame
  const frame = new THREE.Mesh(
    new THREE.PlaneGeometry(1.26, 1.26),
    new THREE.MeshStandardMaterial({
      color: "#0e1a2e",
      emissive: "#08111c",
      emissiveIntensity: 0.6,
    }),
  );
  frame.position.z = -0.005;
  panelRoot.add(frame);

  const lines = [];
  let dirty = false;

  function log(msg) {
    const now = new Date();
    const ts = `${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
    lines.push(`[${ts}] ${msg}`);
    if (lines.length > MAX_LINES) lines.shift();
    dirty = true;
  }

  function render() {
    if (!dirty) return;
    dirty = false;

    ctx.fillStyle = "#0a1220";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Title
    ctx.fillStyle = "#ffd166";
    ctx.font = "bold 22px monospace";
    ctx.fillText("DEBUG", 16, 30);

    // Lines
    ctx.fillStyle = "#cfe3ff";
    ctx.font = "16px monospace";
    const lineH = 32;
    const startY = 60;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], 12, startY + i * lineH);
    }

    tex.needsUpdate = true;
  }

  return { log, render };
}
