import * as THREE from "three";
import { XRHandModelFactory } from "three/examples/jsm/webxr/XRHandModelFactory.js";

export function createXRHandGestures({
  renderer,
  scene,
  worldRoot,
  floor,
  interactables = [],
  onHoverChange = () => {},
  onSelect = () => {},
}) {
  const handModelFactory = new XRHandModelFactory();
  const tempVectorA = new THREE.Vector3();
  const tempVectorB = new THREE.Vector3();
  const tempVectorC = new THREE.Vector3();
  const tempVectorD = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const pinchThreshold = 0.028;
  const minWorldScale = 0.45;
  const maxWorldScale = 1.9;
  const maxRayDistance = 12;

  const hands = [0, 1].map((index) => {
    const hand = renderer.xr.getHand(index);
    hand.userData.index = index;
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
    };
  });

  const gesture = {
    mode: null,
    handIndex: -1,
    pivotLocal: new THREE.Vector3(),
    startWorldPosition: new THREE.Vector3(),
    startWorldScale: 1,
    startWorldYaw: 0,
    startHandWorld: new THREE.Vector3(),
    startMidpoint: new THREE.Vector3(),
    startDistance: 0,
    startAngle: 0,
  };

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

    handState.rayDirection
      .copy(handState.indexWorld)
      .sub(handState.wristWorld)
      .normalize();

    updateHandRay(handState);

    return true;
  }

  function isNearFloor(worldPoint) {
    floor.getWorldPosition(tempVectorA);
    return Math.abs(worldPoint.y - tempVectorA.y) < 0.38 * worldRoot.scale.x;
  }

  function clear() {
    gesture.mode = null;
    gesture.handIndex = -1;
    hands.forEach((handState) => {
      handState.wasPinching = false;
      handState.ray.visible = false;
      setHandHover(handState, null);
    });
  }

  function startSingleHandGesture(handState) {
    gesture.mode = "drag";
    gesture.handIndex = handState.hand.userData.index;
    gesture.startHandWorld.copy(handState.pinchWorld);
    gesture.startWorldPosition.copy(worldRoot.position);
  }

  function updateSingleHandGesture(handState) {
    tempVectorA.copy(handState.pinchWorld).sub(gesture.startHandWorld);
    worldRoot.position.copy(gesture.startWorldPosition).add(tempVectorA);
  }

  function startTwoHandGesture(activeHands) {
    const left = activeHands[0];
    const right = activeHands[1];

    gesture.mode = "two-hand";
    gesture.handIndex = -1;
    gesture.startWorldPosition.copy(worldRoot.position);
    gesture.startWorldScale = worldRoot.scale.x;
    gesture.startWorldYaw = worldRoot.rotation.y;
    gesture.startMidpoint.copy(left.pinchWorld).add(right.pinchWorld).multiplyScalar(0.5);
    gesture.startDistance = Math.max(left.pinchWorld.distanceTo(right.pinchWorld), 0.001);
    gesture.startAngle = Math.atan2(
      right.pinchWorld.x - left.pinchWorld.x,
      right.pinchWorld.z - left.pinchWorld.z,
    );

    worldRoot.updateMatrixWorld(true);
    gesture.pivotLocal.copy(gesture.startMidpoint);
    worldRoot.worldToLocal(gesture.pivotLocal);
  }

  function updateTwoHandGesture(activeHands) {
    const left = activeHands[0];
    const right = activeHands[1];
    const currentMidpoint = tempVectorA
      .copy(left.pinchWorld)
      .add(right.pinchWorld)
      .multiplyScalar(0.5);
    const currentDistance = Math.max(left.pinchWorld.distanceTo(right.pinchWorld), 0.001);
    const currentAngle = Math.atan2(
      right.pinchWorld.x - left.pinchWorld.x,
      right.pinchWorld.z - left.pinchWorld.z,
    );

    const nextScale = THREE.MathUtils.clamp(
      gesture.startWorldScale * (currentDistance / gesture.startDistance),
      minWorldScale,
      maxWorldScale,
    );

    worldRoot.scale.setScalar(nextScale);
    worldRoot.rotation.y = gesture.startWorldYaw + (currentAngle - gesture.startAngle);
    worldRoot.position.copy(gesture.startWorldPosition);
    worldRoot.updateMatrixWorld(true);

    tempVectorB.copy(gesture.pivotLocal).applyMatrix4(worldRoot.matrixWorld);
    worldRoot.position.add(currentMidpoint.sub(tempVectorB));
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
    raycaster.set(handState.pinchWorld, handState.rayDirection);
    raycaster.far = maxRayDistance;
    return raycaster.intersectObjects(interactables)[0] ?? null;
  }

  function updateRayInteractions(activeHands) {
    hands.forEach((handState) => {
      if (!handState.ray.visible) {
        setHandHover(handState, null);
      }
    });

    activeHands.forEach((handState) => {
      if (!isNearFloor(handState.pinchWorld)) {
        const hit = getRayHit(handState);
        setHandHover(handState, hit?.object ?? null);

        if (handState.isPinching && !handState.wasPinching && hit) {
          onSelect(hit.object);
        }
      } else {
        setHandHover(handState, null);
      }
    });

    hands.forEach((handState) => {
      handState.wasPinching = handState.isPinching;
    });
  }

  function update() {
    const trackedHands = hands.filter((handState) => {
      handState.wasPinching = handState.isPinching;
      return updateHandState(handState);
    });
    const activeHands = trackedHands.filter((handState) => handState.isPinching);

    if (activeHands.length === 2) {
      onHoverChange([]);
      if (gesture.mode !== "two-hand") {
        startTwoHandGesture(activeHands);
      }

      updateTwoHandGesture(activeHands);
      return;
    }

    if (activeHands.length === 1 && isNearFloor(activeHands[0].pinchWorld)) {
      onHoverChange([]);
      if (
        gesture.mode !== "drag" ||
        gesture.handIndex !== activeHands[0].hand.userData.index
      ) {
        startSingleHandGesture(activeHands[0]);
      }

      updateSingleHandGesture(activeHands[0]);
      return;
    }

    gesture.mode = null;
    gesture.handIndex = -1;
    updateRayInteractions(trackedHands);
  }

  renderer.xr.addEventListener("sessionend", clear);

  return { update, clear };
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
