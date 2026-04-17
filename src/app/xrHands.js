import * as THREE from "three";
import { XRHandModelFactory } from "three/examples/jsm/webxr/XRHandModelFactory.js";

export function createXRHandGestures({
  renderer,
  scene,
  worldRoot,
  onFrame = () => {},
}) {
  const handModelFactory = new XRHandModelFactory();
  const tempVectorA = new THREE.Vector3();
  const tempVectorB = new THREE.Vector3();

  const pinchThreshold = 0.028;
  const minWorldScale = 0.02;
  const maxWorldScale = 50;

  const hands = [0, 1].map((index) => {
    const hand = renderer.xr.getHand(index);
    hand.userData.index = index;
    hand.userData.handedness = null;
    hand.addEventListener("connected", (event) => {
      hand.userData.handedness = event.data?.handedness ?? null;
    });
    hand.addEventListener("disconnected", () => {
      hand.userData.handedness = null;
    });
    hand.add(handModelFactory.createHandModel(hand, "spheres"));
    scene.add(hand);

    return {
      hand,
      pinchWorld: new THREE.Vector3(),
      thumbWorld: new THREE.Vector3(),
      indexWorld: new THREE.Vector3(),
      wristWorld: new THREE.Vector3(),
      middleMetacarpalWorld: new THREE.Vector3(),
      pinkyMetacarpalWorld: new THREE.Vector3(),
      isPinching: false,
      wasPinching: false,
      isOpen: false,
    };
  });

  const twoHandLine = createTwoHandLine();
  scene.add(twoHandLine);

  const twoHandGesture = {
    active: false,
    pivotLocal: new THREE.Vector3(),
    startWorldPosition: new THREE.Vector3(),
    startWorldScale: 1,
    startWorldYaw: 0,
    startMidpoint: new THREE.Vector3(),
    startDistance: 0,
    startAngle: 0,
  };

  function updateHandJoints(handState) {
    const thumb = handState.hand.joints?.["thumb-tip"];
    const indexTip = handState.hand.joints?.["index-finger-tip"];
    const middleMetacarpal = handState.hand.joints?.["middle-finger-metacarpal"];
    const pinkyMetacarpal = handState.hand.joints?.["pinky-finger-metacarpal"];
    const wrist = handState.hand.joints?.wrist;

    if (
      !thumb ||
      !indexTip ||
      !middleMetacarpal ||
      !pinkyMetacarpal ||
      !wrist ||
      !thumb.visible ||
      !indexTip.visible ||
      !middleMetacarpal.visible ||
      !pinkyMetacarpal.visible ||
      !wrist.visible
    ) {
      handState.isPinching = false;
      return false;
    }

    thumb.getWorldPosition(handState.thumbWorld);
    indexTip.getWorldPosition(handState.indexWorld);
    wrist.getWorldPosition(handState.wristWorld);
    middleMetacarpal.getWorldPosition(handState.middleMetacarpalWorld);
    pinkyMetacarpal.getWorldPosition(handState.pinkyMetacarpalWorld);

    handState.pinchWorld
      .copy(handState.thumbWorld)
      .add(handState.indexWorld)
      .multiplyScalar(0.5);

    handState.isPinching =
      handState.thumbWorld.distanceTo(handState.indexWorld) < pinchThreshold;
    handState.isOpen = getIsOpenHand(handState);

    return true;
  }

  // Heuristic: when palms face each other, each hand's thumb is closer to
  // the opposite wrist than its pinky metacarpal.
  function arePalmsFacing(hand0, hand1) {
    const thumbLToR = hand0.thumbWorld.distanceTo(hand1.wristWorld);
    const pinkyLToR = hand0.pinkyMetacarpalWorld.distanceTo(hand1.wristWorld);
    const thumbRToL = hand1.thumbWorld.distanceTo(hand0.wristWorld);
    const pinkyRToL = hand1.pinkyMetacarpalWorld.distanceTo(hand0.wristWorld);
    return thumbLToR < pinkyLToR && thumbRToL < pinkyRToL;
  }

  function updateTwoHandLine(hand0, hand1) {
    const positions = twoHandLine.geometry.attributes.position.array;
    positions[0] = hand0.pinchWorld.x;
    positions[1] = hand0.pinchWorld.y;
    positions[2] = hand0.pinchWorld.z;
    positions[3] = hand1.pinchWorld.x;
    positions[4] = hand1.pinchWorld.y;
    positions[5] = hand1.pinchWorld.z;
    twoHandLine.geometry.attributes.position.needsUpdate = true;
    twoHandLine.visible = true;
  }

  function startTwoHandGesture(hand0, hand1) {
    twoHandGesture.active = true;
    twoHandGesture.startWorldPosition.copy(worldRoot.position);
    twoHandGesture.startWorldScale = worldRoot.scale.x;
    twoHandGesture.startWorldYaw = worldRoot.rotation.y;
    twoHandGesture.startMidpoint
      .copy(hand0.pinchWorld)
      .add(hand1.pinchWorld)
      .multiplyScalar(0.5);
    twoHandGesture.startDistance = Math.max(
      hand0.pinchWorld.distanceTo(hand1.pinchWorld),
      0.001,
    );
    twoHandGesture.startAngle = Math.atan2(
      hand1.pinchWorld.x - hand0.pinchWorld.x,
      hand1.pinchWorld.z - hand0.pinchWorld.z,
    );

    worldRoot.updateMatrixWorld(true);
    twoHandGesture.pivotLocal.copy(twoHandGesture.startMidpoint);
    worldRoot.worldToLocal(twoHandGesture.pivotLocal);
  }

  function updateTwoHandGesture(hand0, hand1) {
    const currentMidpoint = tempVectorA
      .copy(hand0.pinchWorld)
      .add(hand1.pinchWorld)
      .multiplyScalar(0.5);
    const currentDistance = Math.max(
      hand0.pinchWorld.distanceTo(hand1.pinchWorld),
      0.001,
    );
    const currentAngle = Math.atan2(
      hand1.pinchWorld.x - hand0.pinchWorld.x,
      hand1.pinchWorld.z - hand0.pinchWorld.z,
    );

    const nextScale = THREE.MathUtils.clamp(
      twoHandGesture.startWorldScale *
        (currentDistance / twoHandGesture.startDistance),
      minWorldScale,
      maxWorldScale,
    );

    worldRoot.scale.setScalar(nextScale);
    worldRoot.rotation.y =
      twoHandGesture.startWorldYaw +
      (currentAngle - twoHandGesture.startAngle);
    worldRoot.position.copy(twoHandGesture.startWorldPosition);
    worldRoot.updateMatrixWorld(true);

    tempVectorB.copy(twoHandGesture.pivotLocal).applyMatrix4(worldRoot.matrixWorld);
    worldRoot.position.add(currentMidpoint.sub(tempVectorB));
  }

  function update() {
    const trackedHands = hands.filter((handState) => {
      handState.wasPinching = handState.isPinching;
      return updateHandJoints(handState);
    });
    onFrame(trackedHands);

    // Sort so index 0 is always the left hand when both are tracked.
    const pinchingHands = trackedHands
      .filter((handState) => handState.isPinching)
      .sort((a, b) => {
        const ah = a.hand.userData.handedness;
        const bh = b.hand.userData.handedness;
        if (ah === bh) return 0;
        if (ah === "left") return -1;
        if (bh === "left") return 1;
        return 0;
      });

    // Two-hand gesture: both hands must be pinching AND the palms must face
    // each other (thumbs closer to opposite hand than pinkies).
    if (
      pinchingHands.length >= 2 &&
      arePalmsFacing(pinchingHands[0], pinchingHands[1])
    ) {
      updateTwoHandLine(pinchingHands[0], pinchingHands[1]);
      if (!twoHandGesture.active) {
        startTwoHandGesture(pinchingHands[0], pinchingHands[1]);
      }
      updateTwoHandGesture(pinchingHands[0], pinchingHands[1]);
      hands.forEach((handState) => {
        handState.wasPinching = handState.isPinching;
      });
      return;
    }

    if (twoHandGesture.active) {
      twoHandGesture.active = false;
    }
    twoHandLine.visible = false;
    hands.forEach((handState) => {
      handState.wasPinching = handState.isPinching;
    });
  }

  function clear() {
    hands.forEach((handState) => {
      handState.wasPinching = false;
      handState.isOpen = false;
    });
    twoHandLine.visible = false;
    twoHandGesture.active = false;
  }

  renderer.xr.addEventListener("sessionend", clear);

  return { update, clear };
}

function getIsOpenHand(handState) {
  const hand = handState.hand;
  const wrist = hand.joints?.wrist;
  const tipNames = [
    "index-finger-tip",
    "middle-finger-tip",
    "ring-finger-tip",
    "pinky-finger-tip",
  ];

  if (!wrist || !wrist.visible) {
    return false;
  }

  const wristWorld = handState.wristWorld;
  let extendedCount = 0;

  for (const tipName of tipNames) {
    const tip = hand.joints?.[tipName];
    if (!tip || !tip.visible) {
      return false;
    }

    const tipWorld = new THREE.Vector3();
    tip.getWorldPosition(tipWorld);

    if (tipWorld.distanceTo(wristWorld) > 0.1) {
      extendedCount += 1;
    }
  }

  return extendedCount === tipNames.length && !handState.isPinching;
}

function createTwoHandLine() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3),
  );

  const material = new THREE.LineBasicMaterial({
    color: "#ffd166",
    transparent: true,
    opacity: 0.95,
  });

  const line = new THREE.Line(geometry, material);
  line.visible = false;
  return line;
}
