import * as THREE from "three";
import { XRHandModelFactory } from "three/examples/jsm/webxr/XRHandModelFactory.js";

export function createXRHandGestures({
  renderer,
  scene,
  interactables = [],
  onHoverChange = () => {},
  onSelect = () => {},
  onFrame = () => {},
}) {
  const handModelFactory = new XRHandModelFactory();
  const tempVectorC = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const pinchThreshold = 0.028;
  const maxRayDistance = 12;

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
      rayDirection: new THREE.Vector3(),
      hoveredObject: null,
      isPinching: false,
      wasPinching: false,
      isOpen: false,
    };
  });

  const twoHandLine = createTwoHandLine();
  scene.add(twoHandLine);

  function updateHandState(handState) {
    const thumb = handState.hand.joints?.["thumb-tip"];
    const index = handState.hand.joints?.["index-finger-tip"];
    const wrist = handState.hand.joints?.wrist;

    if (!thumb || !index || !wrist || !thumb.visible || !index.visible || !wrist.visible) {
      handState.isPinching = false;
      handState.ray.visible = false;
      setHandHover(handState, null);
      return false;
    }

    thumb.getWorldPosition(handState.thumbWorld);
    index.getWorldPosition(handState.indexWorld);
    wrist.getWorldPosition(handState.wristWorld);

    handState.pinchWorld
      .copy(handState.thumbWorld)
      .add(handState.indexWorld)
      .multiplyScalar(0.5);

    handState.isPinching =
      handState.thumbWorld.distanceTo(handState.indexWorld) < pinchThreshold;
    handState.isOpen = getIsOpenHand(handState);

    handState.rayDirection
      .copy(handState.indexWorld)
      .sub(handState.wristWorld)
      .normalize();

    updateHandRay(handState);

    return true;
  }

  function clear() {
    hands.forEach((handState) => {
      handState.wasPinching = false;
      handState.isOpen = false;
      handState.ray.visible = false;
      setHandHover(handState, null);
    });
    twoHandLine.visible = false;
  }

  function setHandHover(handState, object) {
    if (handState.hoveredObject === object) {
      return;
    }

    handState.hoveredObject = object;
    onHoverChange(hands.map((entry) => entry.hoveredObject).filter(Boolean));
  }

  function updateHandRay(handState) {
    const hit = getRayHit(handState);
    const targetPoint = hit
      ? hit.point
      : tempVectorC
          .copy(handState.pinchWorld)
          .addScaledVector(handState.rayDirection, maxRayDistance);

    const positions = handState.ray.geometry.attributes.position.array;
    positions[0] = handState.pinchWorld.x;
    positions[1] = handState.pinchWorld.y;
    positions[2] = handState.pinchWorld.z;
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

    raycaster.set(handState.pinchWorld, handState.rayDirection);
    raycaster.far = maxRayDistance;
    return raycaster.intersectObjects(targets)[0] ?? null;
  }

  function updateRayInteractions(trackedHands) {
    hands.forEach((handState) => {
      if (!handState.ray.visible) {
        setHandHover(handState, null);
      }
    });

    trackedHands.forEach((handState) => {
      const hit = getRayHit(handState);
      setHandHover(handState, hit?.object ?? null);

      if (handState.isPinching && !handState.wasPinching && hit) {
        onSelect(hit.object, handState);
      }
    });

    hands.forEach((handState) => {
      handState.wasPinching = handState.isPinching;
    });
  }

  function updateTwoHandLine(pinchingHands) {
    const positions = twoHandLine.geometry.attributes.position.array;
    positions[0] = pinchingHands[0].pinchWorld.x;
    positions[1] = pinchingHands[0].pinchWorld.y;
    positions[2] = pinchingHands[0].pinchWorld.z;
    positions[3] = pinchingHands[1].pinchWorld.x;
    positions[4] = pinchingHands[1].pinchWorld.y;
    positions[5] = pinchingHands[1].pinchWorld.z;
    twoHandLine.geometry.attributes.position.needsUpdate = true;
    twoHandLine.visible = true;
  }

  function update() {
    const trackedHands = hands.filter((handState) => {
      handState.wasPinching = handState.isPinching;
      return updateHandState(handState);
    });
    onFrame(trackedHands);

    const pinchingHands = trackedHands.filter((handState) => handState.isPinching);

    // When both hands pinch at the same time, show the link line and
    // suppress button selection so the gesture can't accidentally trigger
    // panel interactions. World locomotion is intentionally disabled for
    // now; control of the line itself will be wired up later.
    if (pinchingHands.length >= 2) {
      updateTwoHandLine(pinchingHands);
      hands.forEach((handState) => setHandHover(handState, null));
      hands.forEach((handState) => {
        handState.wasPinching = handState.isPinching;
      });
      return;
    }

    twoHandLine.visible = false;
    updateRayInteractions(trackedHands);
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
