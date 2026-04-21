import * as THREE from "three";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const PDF_PATH = "pdf/863946927-Robert-Hand-Essays-on-Astrology-Schiffer-1982.pdf";
const RENDER_SCALE = 2; // Safari/visionOS has canvas size limits; 4 may hang

export function createPdfPanel(worldRoot, dbg = null) {
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
      dbg?.log(`PDF load: ${url}`);
      pdfDoc = await pdfjsLib.getDocument(url).promise;
      totalPages = pdfDoc.numPages;
      dbg?.log(`PDF ok: ${totalPages} pages`);
      await renderPage(currentPage);
      // Pre-cache a few pages while still outside XR
      for (let i = 2; i <= Math.min(6, totalPages); i++) prerenderPage(i);
      startAutoPlay();
    } catch (err) {
      dbg?.log(`PDF ERRO: ${err.message}`);
      console.error("[pdfPanel] failed to load PDF:", err);
    }
  }

  const RENDER_TIMEOUT_MS = 6000;
  const pageCache = new Map(); // pageNum -> ImageBitmap

  async function renderPage(pageNum) {
    if (!pdfDoc) { dbg?.log("no doc"); return; }
    if (rendering) { dbg?.log("busy"); return; }
    rendering = true;
    try {
      currentPage = Math.max(1, Math.min(pageNum, totalPages));
      dbg?.log(`pg ${currentPage}`);

      // Use cached image if available
      if (pageCache.has(currentPage)) {
        dbg?.log("from cache");
        applyImage(pageCache.get(currentPage));
        updateCounter();
        // Pre-render next page in background
        prerenderPage(currentPage + 1);
        return;
      }

      await renderPageToTexture(currentPage);
      updateCounter();
      // Pre-render next page in background
      prerenderPage(currentPage + 1);
    } catch (err) {
      dbg?.log(`ERR: ${err.message}`);
    } finally {
      rendering = false;
    }
  }

  async function renderPageToTexture(pageNum) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    dbg?.log(`${viewport.width|0}x${viewport.height|0}`);

    // Fresh canvas each time (visionOS may break reused canvases)
    const cv = document.createElement("canvas");
    cv.width = viewport.width;
    cv.height = viewport.height;
    const cx = cv.getContext("2d");
    cx.fillStyle = "#ffffff";
    cx.fillRect(0, 0, cv.width, cv.height);

    const renderTask = page.render({ canvasContext: cx, viewport });

    // Timeout: cancel if render hangs (visionOS Safari issue)
    const timer = setTimeout(() => {
      dbg?.log("TIMEOUT cancel");
      renderTask.cancel();
    }, RENDER_TIMEOUT_MS);

    try {
      await renderTask.promise;
      clearTimeout(timer);
      dbg?.log("done");
    } catch (err) {
      clearTimeout(timer);
      if (err.name === "RenderingCancelledException") {
        dbg?.log("cancelled (timeout)");
      }
      throw err;
    }

    // Cache as ImageBitmap for fast future use
    try {
      const bmp = await createImageBitmap(cv);
      pageCache.set(pageNum, bmp);
      applyImage(bmp);
    } catch (_) {
      // Fallback: use canvas directly
      applyCanvas(cv);
    }
  }

  function applyImage(bmpOrCanvas) {
    if (pageMat.map) pageMat.map.dispose();
    const tex = new THREE.CanvasTexture(bmpOrCanvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    pageMat.map = tex;
    pageMat.needsUpdate = true;
  }
  const applyCanvas = applyImage; // same API

  // Pre-render next page in background (non-blocking)
  function prerenderPage(pageNum) {
    if (pageNum < 1 || pageNum > totalPages || pageCache.has(pageNum)) return;
    (async () => {
      try {
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: RENDER_SCALE });
        const cv = document.createElement("canvas");
        cv.width = viewport.width;
        cv.height = viewport.height;
        const cx = cv.getContext("2d");
        cx.fillStyle = "#ffffff";
        cx.fillRect(0, 0, cv.width, cv.height);
        const renderTask = page.render({ canvasContext: cx, viewport });
        const timer = setTimeout(() => renderTask.cancel(), RENDER_TIMEOUT_MS);
        await renderTask.promise;
        clearTimeout(timer);
        const bmp = await createImageBitmap(cv);
        pageCache.set(pageNum, bmp);
        dbg?.log(`pre-cached pg ${pageNum}`);
      } catch (_) {
        // Silent fail for pre-render
      }
    })();
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
    dbg?.log(`nextPage() cur=${currentPage} tot=${totalPages} rend=${rendering}`);
    if (currentPage < totalPages) await renderPage(currentPage + 1);
    else if (autoPlay) stopAutoPlay();
  }

  async function prevPage() {
    dbg?.log(`prevPage() cur=${currentPage}`);
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

  // --- VR pinch interaction ---
  const pinchRadius = 0.2;
  const tempVec = new THREE.Vector3();
  const wasPinching = new Map();
  const navButtons = [prevBtn, pauseBtn, nextBtn];

  function checkTouch(trackedHands) {
    for (const handState of trackedHands) {
      const handIndex = handState.hand.userData.index;
      const wasPinch = wasPinching.get(handIndex) ?? false;

      // Detect pinch start (transition from not pinching to pinching)
      if (handState.isPinching && !wasPinch) {
        for (const btn of navButtons) {
          btn.getWorldPosition(tempVec);
          const dist = handState.pinchWorld.distanceTo(tempVec);
          if (dist < pinchRadius) {
            if (btn.userData.kind === "pdf-prev") prevPage();
            else if (btn.userData.kind === "pdf-next") nextPage();
            else if (btn.userData.kind === "pdf-pause") toggleAutoPlay();
            break;
          }
        }
      }

      wasPinching.set(handIndex, handState.isPinching);
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
