import * as THREE from "three";
import { XRHandModelFactory } from "three/examples/jsm/webxr/XRHandModelFactory.js";

export function createXRHandGestures({
  renderer,
  scene,
  worldRoot,
  interactables = [],
  onHoverChange = () => {},
  onSelect = () => {},
  onFrame = () => {},
}) {
  const handModelFactory = new XRHandModelFactory();
  const tempVectorA = new THREE.Vector3();
  const tempVectorB = new THREE.Vector3();
  const tempVectorC = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();

  const pinchThreshold = 0.028;
  const maxRayDistance = 12;
  const minWorldScale = 0.2;
  const maxWorldScale = 5;

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

    const ray = createHandRay();
    scene.add(ray);

    return {
      hand,
      ray,
      pinchWorld: new THREE.Vector3(),
      thumbWorld: new THREE.Vector3(),
      indexWorld: new THREE.Vector3(),
      wristWorld: new THREE.Vector3(),
      metacarpalWorld: new THREE.Vector3(),
      rayOrigin: new THREE.Vector3(),
      rayDirection: new THREE.Vector3(),
      hoveredObject: null,
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
    const metacarpal = handState.hand.joints?.["index-finger-metacarpal"];
    const wrist = handState.hand.joints?.wrist;

    if (
      !thumb ||
      !indexTip ||
      !metacarpal ||
      !wrist ||
      !thumb.visible ||
      !indexTip.visible ||
      !metacarpal.visible ||
      !wrist.visible
    ) {
      handState.isPinching = false;
      handState.ray.visible = false;
      setHandHover(handState, null);
      return false;
    }

    thumb.getWorldPosition(handState.thumbWorld);
    indexTip.getWorldPosition(handState.indexWorld);
    wrist.getWorldPosition(handState.wristWorld);
    metacarpal.getWorldPosition(handState.metacarpalWorld);

    handState.pinchWorld
      .copy(handState.thumbWorld)
      .add(handState.indexWorld)
      .multiplyScalar(0.5);

    handState.isPinching =
      handState.thumbWorld.distanceTo(handState.indexWorld) < pinchThreshold;
    handState.isOpen = getIsOpenHand(handState);

    // Stable ray: origin at the palm center (midpoint of wrist and the
    // index-finger metacarpal joint), direction along the hand's forward
    // axis (wrist -> metacarpal). Neither point moves much while the user
    // pinches, so the aim doesn't drift as the finger curls.
    handState.rayOrigin
      .copy(handState.wristWorld)
      .add(handState.metacarpalWorld)
      .multiplyScalar(0.5);

    handState.rayDirection
      .copy(handState.metacarpalWorld)
      .sub(handState.wristWorld)
      .normalize();

    return true;
  }

  function setHandHover(handState, object) {
    if (handState.hoveredObject === object) {
      return;
    }
    handState.hoveredObject = object;
    onHoverChange(hands.map((entry) => entry.hoveredObject).filter(Boolean));
  }

  function refreshHandRay(handState) {
    const hit = getRayHit(handState);
    const targetPoint = hit
      ? hit.point
      : tempVectorC
          .copy(handState.rayOrigin)
          .addScaledVector(handState.rayDirection, maxRayDistance);

    const positions = handState.ray.geometry.attributes.position.array;
    positions[0] = handState.rayOrigin.x;
    positions[1] = handState.rayOrigin.y;
    positions[2] = handState.rayOrigin.z;
    positions[3] = targetPoint.x;
    positions[4] = targetPoint.y;
    positions[5] = targetPoint.z;
    handState.ray.geometry.attributes.position.needsUpdate = true;
    handState.ray.visible = true;

    setHandHover(handState, hit?.object ?? null);
  }

  function getRayHit(handState) {
    const targets =
      typeof interactables === "function" ? interactables() : interactables;
    raycaster.set(handState.rayOrigin, handState.rayDirection);
    raycaster.far = maxRayDistance;
    return raycaster.intersectObjects(targets)[0] ?? null;
  }

  function detectSelections(trackedHands) {
    trackedHands.forEach((handState) => {
      if (
        handState.isPinching &&
        !handState.wasPinching &&
        handState.hoveredObject
      ) {
        onSelect(handState.hoveredObject, handState);
      }
    });
    hands.forEach((handState) => {
      handState.wasPinching = handState.isPinching;
    });
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

    // Sort so index 0 is always the left hand when both are tracked. Keeps
    // two-hand gesture math stable across frames regardless of iteration
    // order.
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

    if (pinchingHands.length >= 2) {
      updateTwoHandLine(pinchingHands[0], pinchingHands[1]);
      // Suppress rays + hover so button UI doesn't flicker while the user
      // is manipulating the scene with both hands.
      hands.forEach((handState) => {
        handState.ray.visible = false;
        setHandHover(handState, null);
      });
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

    trackedHands.forEach(refreshHandRay);
    detectSelections(trackedHands);
  }

  function clear() {
    hands.forEach((handState) => {
      handState.wasPinching = false;
      handState.isOpen = false;
      handState.ray.visible = false;
      setHandHover(handState, null);
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

function createHandRay() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, -1], 3),
  );

  const material = new THREE.LineBasicMaterial({
    color: "#8db6ff",
    transparent: true,
    opacity: 0.85,
  });

  const ray = new THREE.Line(geometry, material);
  ray.visible = false;
  return ray;
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
