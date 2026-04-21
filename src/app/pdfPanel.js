import * as THREE from "three";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const PDF_PATH = "pdf/863946927-Robert-Hand-Essays-on-Astrology-Schiffer-1982.pdf";
const RENDER_SCALE = 4; // higher = sharper text on the 3D plane

export function createPdfPanel(worldRoot) {
  const panelRoot = new THREE.Group();
  panelRoot.position.set(-3.5, 0.6, 1.5);
  panelRoot.rotation.y = Math.PI * 0.25;
  worldRoot.add(panelRoot);

  // Page canvas — will be reused for every page render
  const pageCanvas = document.createElement("canvas");
  const pageCtx = pageCanvas.getContext("2d");

  // 3D plane to display the PDF page
  const planeWidth = 1.6;
  const planeHeight = 2.1; // roughly A4/letter proportions
  const planeGeo = new THREE.PlaneGeometry(planeWidth, planeHeight);

  const pageMat = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    roughness: 0.65,
    metalness: 0.0,
  });
  const pageMesh = new THREE.Mesh(planeGeo, pageMat);
  pageMesh.position.set(0, 0, 0);
  panelRoot.add(pageMesh);

  // Thin frame behind the page for visual depth
  const frame = new THREE.Mesh(
    new THREE.PlaneGeometry(planeWidth + 0.06, planeHeight + 0.06),
    new THREE.MeshStandardMaterial({
      color: "#0e1a2e",
      emissive: "#08111c",
      emissiveIntensity: 0.6,
      metalness: 0.1,
      roughness: 0.5,
    }),
  );
  frame.position.set(0, 0, -0.005);
  panelRoot.add(frame);

  // --- Navigation buttons ---
  const btnWidth = 0.35;
  const btnHeight = 0.12;
  const btnY = -(planeHeight / 2) - 0.12;

  const prevBtn = makeNavButton("<  Anterior", btnWidth, btnHeight);
  prevBtn.position.set(-0.45, btnY, 0.01);
  prevBtn.userData = { kind: "pdf-prev" };
  panelRoot.add(prevBtn);

  const pauseBtn = makeNavButton("|| Pausa", btnWidth, btnHeight);
  pauseBtn.position.set(0, btnY, 0.01);
  pauseBtn.userData = { kind: "pdf-pause" };
  panelRoot.add(pauseBtn);

  const nextBtn = makeNavButton("Proximo  >", btnWidth, btnHeight);
  nextBtn.position.set(0.45, btnY, 0.01);
  nextBtn.userData = { kind: "pdf-next" };
  panelRoot.add(nextBtn);

  // Page counter label
  const counterCanvas = document.createElement("canvas");
  counterCanvas.width = 256;
  counterCanvas.height = 64;
  const counterTex = new THREE.CanvasTexture(counterCanvas);
  const counterMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.4, 0.08),
    new THREE.MeshStandardMaterial({
      map: counterTex,
      transparent: true,
      color: "#ffffff",
      emissive: "#1a3050",
      emissiveIntensity: 0.5,
      roughness: 0.6,
      metalness: 0.0,
    }),
  );
  counterMesh.position.set(0, btnY - 0.1, 0.01);
  panelRoot.add(counterMesh);

  // --- PDF state ---
  let pdfDoc = null;
  let currentPage = 1;
  let totalPages = 0;
  let rendering = false;
  let autoPlay = true;
  const AUTO_INTERVAL_MS = 10000;
  let autoTimer = null;

  async function loadPdf() {
    try {
      const base = import.meta.env.BASE_URL ?? "/";
      const url = `${base}${PDF_PATH}`;
      console.log("[pdfPanel] loading:", url);
      pdfDoc = await pdfjsLib.getDocument(url).promise;
      totalPages = pdfDoc.numPages;
      console.log("[pdfPanel] loaded, pages:", totalPages);
      await renderPage(currentPage);
      startAutoPlay();
    } catch (err) {
      console.error("[pdfPanel] failed to load PDF:", err);
    }
  }

  async function renderPage(pageNum) {
    if (!pdfDoc || rendering) return;
    rendering = true;
    currentPage = Math.max(1, Math.min(pageNum, totalPages));

    const page = await pdfDoc.getPage(currentPage);
    const viewport = page.getViewport({ scale: RENDER_SCALE });

    pageCanvas.width = viewport.width;
    pageCanvas.height = viewport.height;

    // White background (some PDFs have transparent backgrounds)
    pageCtx.fillStyle = "#ffffff";
    pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);

    await page.render({ canvasContext: pageCtx, viewport }).promise;

    if (pageMat.map) pageMat.map.dispose();
    const tex = new THREE.CanvasTexture(pageCanvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    pageMat.map = tex;
    pageMat.needsUpdate = true;
    updateCounter();
    rendering = false;
  }

  function updateCounter() {
    const ctx = counterCanvas.getContext("2d");
    ctx.clearRect(0, 0, counterCanvas.width, counterCanvas.height);
    ctx.fillStyle = "#0e1a2e";
    ctx.fillRect(0, 0, counterCanvas.width, counterCanvas.height);
    ctx.fillStyle = "#cfe3ff";
    ctx.font = "700 28px Segoe UI";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const status = autoPlay ? "AUTO" : "PAUSA";
    ctx.fillText(
      `${currentPage} / ${totalPages}  [${status}]`,
      counterCanvas.width / 2,
      counterCanvas.height / 2,
    );
    counterTex.needsUpdate = true;
  }

  async function nextPage() {
    if (currentPage < totalPages) await renderPage(currentPage + 1);
    else if (autoPlay) stopAutoPlay(); // stop at last page
  }

  async function prevPage() {
    if (currentPage > 1) await renderPage(currentPage - 1);
  }

  function startAutoPlay() {
    stopAutoPlay();
    autoPlay = true;
    autoTimer = setInterval(() => nextPage(), AUTO_INTERVAL_MS);
    updatePauseButton();
    updateCounter();
  }

  function stopAutoPlay() {
    autoPlay = false;
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    updatePauseButton();
    updateCounter();
  }

  function toggleAutoPlay() {
    if (autoPlay) stopAutoPlay();
    else startAutoPlay();
  }

  function updatePauseButton() {
    const label = autoPlay ? "|| Pausa" : ">  Play";
    const fillColor = autoPlay ? "#173256" : "#12693c";
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = fillColor;
    ctx.fillRect(0, 0, 256, 64);
    ctx.strokeStyle = "rgba(190, 220, 255, 0.7)";
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, 248, 56);
    ctx.fillStyle = "#cfe3ff";
    ctx.font = "700 30px Segoe UI";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 128, 32);
    if (pauseBtn.material.map) pauseBtn.material.map.dispose();
    pauseBtn.material.map = new THREE.CanvasTexture(canvas);
    pauseBtn.material.emissive.set(fillColor);
    pauseBtn.material.needsUpdate = true;
  }

  // --- Keyboard handler (desktop) ---
  function onKeyDown(event) {
    if (event.key === "n") {
      event.preventDefault();
      prevPage();
    } else if (event.key === "m") {
      event.preventDefault();
      nextPage();
    } else if (event.key === "p") {
      event.preventDefault();
      toggleAutoPlay();
    }
  }

  // --- VR touch interaction ---
  const touchRadius = 0.12;
  const tempVec = new THREE.Vector3();
  const wasTouching = new Map();
  const navButtons = [prevBtn, pauseBtn, nextBtn];

  function checkTouch(trackedHands) {
    for (const handState of trackedHands) {
      const handIndex = handState.hand.userData.index;
      if (!wasTouching.has(handIndex)) {
        wasTouching.set(handIndex, new Array(navButtons.length).fill(false));
      }
      const prev = wasTouching.get(handIndex);

      for (let i = 0; i < navButtons.length; i++) {
        const btn = navButtons[i];
        btn.getWorldPosition(tempVec);
        const dist = handState.indexWorld.distanceTo(tempVec);
        const isTouching = dist < touchRadius;

        if (isTouching && !prev[i]) {
          if (btn.userData.kind === "pdf-prev") prevPage();
          else if (btn.userData.kind === "pdf-next") nextPage();
          else if (btn.userData.kind === "pdf-pause") toggleAutoPlay();
        }
        prev[i] = isTouching;
      }
    }
  }

  // Start loading
  loadPdf();

  return {
    onKeyDown,
    checkTouch,
    nextPage,
    prevPage,
    getButtons: () => navButtons,
  };
}

// --- helpers ---

function makeNavButton(label, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#173256";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(190, 220, 255, 0.7)";
  ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
  ctx.fillStyle = "#cfe3ff";
  ctx.font = "700 30px Segoe UI";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, canvas.width / 2, canvas.height / 2);

  const tex = new THREE.CanvasTexture(canvas);
  return new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshStandardMaterial({
      map: tex,
      color: "#ffffff",
      emissive: "#173256",
      emissiveIntensity: 0.6,
      metalness: 0.05,
      roughness: 0.55,
    }),
  );
}
