import * as THREE from "three";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const PDF_PATH = "pdf/863946927-Robert-Hand-Essays-on-Astrology-Schiffer-1982.pdf";
const RENDER_SCALE = 2;

export function createPdfPanel(worldRoot, dbg = null) {
  const panelRoot = new THREE.Group();
  panelRoot.position.set(-3.5, 0.6, 1.5);
  panelRoot.rotation.y = Math.PI * 0.25;
  worldRoot.add(panelRoot);

  // 3D plane to display the PDF page
  const planeWidth = 1.6;
  const planeHeight = 2.1;
  const planeGeo = new THREE.PlaneGeometry(planeWidth, planeHeight);

  const pageMat = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    roughness: 0.65,
    metalness: 0.0,
  });
  const pageMesh = new THREE.Mesh(planeGeo, pageMat);
  panelRoot.add(pageMesh);

  // Frame
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

  // Page counter
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
  let autoPlay = true;
  const AUTO_INTERVAL_MS = 10000;
  let autoTimer = null;

  // All pages pre-rendered as Blob URLs (JPEG) — works in XR without canvas 2d
  const pageBlobUrls = []; // index 0 = page 1
  let pagesReady = 0;

  async function loadPdf() {
    try {
      const base = import.meta.env.BASE_URL ?? "/";
      const url = `${base}${PDF_PATH}`;
      dbg?.log(`PDF load...`);
      pdfDoc = await pdfjsLib.getDocument(url).promise;
      totalPages = pdfDoc.numPages;
      dbg?.log(`${totalPages} pages, pre-rendering`);

      // Pre-render ALL pages sequentially as JPEG blob URLs
      for (let i = 1; i <= totalPages; i++) {
        try {
          const blobUrl = await renderPageToBlob(i);
          pageBlobUrls[i - 1] = blobUrl;
          pagesReady = i;

          // Show first page immediately
          if (i === 1) {
            await showPage(1);
            startAutoPlay();
          }

          // Progress log every 10 pages
          if (i % 10 === 0) dbg?.log(`cached ${i}/${totalPages}`);
        } catch (err) {
          dbg?.log(`pg ${i} fail: ${err.message}`);
          pageBlobUrls[i - 1] = null;
          pagesReady = i;
        }
      }

      dbg?.log(`all ${totalPages} cached`);
    } catch (err) {
      dbg?.log(`PDF ERRO: ${err.message}`);
    }
  }

  async function renderPageToBlob(pageNum) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: RENDER_SCALE });

    const cv = document.createElement("canvas");
    cv.width = viewport.width;
    cv.height = viewport.height;
    const cx = cv.getContext("2d");
    cx.fillStyle = "#ffffff";
    cx.fillRect(0, 0, cv.width, cv.height);

    await page.render({ canvasContext: cx, viewport }).promise;

    // Convert to JPEG blob URL (~100-200KB per page vs ~8MB raw)
    const blob = await new Promise((resolve) =>
      cv.toBlob(resolve, "image/jpeg", 0.85),
    );
    return URL.createObjectURL(blob);
  }

  // Show a page from the pre-rendered blob cache
  async function showPage(pageNum) {
    currentPage = Math.max(1, Math.min(pageNum, totalPages));
    const blobUrl = pageBlobUrls[currentPage - 1];

    if (!blobUrl) {
      dbg?.log(`pg ${currentPage} not cached`);
      updateCounter();
      return;
    }

    // Load blob URL as an Image, then apply as texture
    const img = new Image();
    img.src = blobUrl;
    await img.decode();

    if (pageMat.map) pageMat.map.dispose();
    const tex = new THREE.Texture(img);
    tex.flipY = true;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    pageMat.map = tex;
    pageMat.needsUpdate = true;
    updateCounter();
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
    const cached = pagesReady < totalPages ? ` cache:${pagesReady}` : "";
    ctx.fillText(
      `${currentPage} / ${totalPages}  [${status}]${cached}`,
      counterCanvas.width / 2,
      counterCanvas.height / 2,
    );
    counterTex.needsUpdate = true;
  }

  async function nextPage() {
    if (currentPage < Math.min(totalPages, pagesReady)) {
      await showPage(currentPage + 1);
    } else if (autoPlay) {
      stopAutoPlay();
    }
  }

  async function prevPage() {
    if (currentPage > 1) await showPage(currentPage - 1);
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

  // Start loading and pre-rendering
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
