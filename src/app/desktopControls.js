import * as THREE from "three";

export function createDesktopControls(camera) {
  const pressedKeys = new Set();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const upAxis = new THREE.Vector3(0, 1, 0);

  const state = {
    position: new THREE.Vector3(0, 2.4, 6.6),
    yaw: 0,
    pitch: -0.28,
  };

  const movementSpeed = 3.4;
  const rotationSpeed = 1.45;
  const pitchLimit = Math.PI * 0.42;

  function updateCameraTransform() {
    direction.set(0, 0, -1);
    direction.applyEuler(new THREE.Euler(state.pitch, state.yaw, 0, "YXZ"));
    camera.position.copy(state.position);
    camera.lookAt(state.position.clone().add(direction));
  }

  function onKeyChange(event, isPressed) {
    const key = event.key;

    if (
      [
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "w",
        "a",
        "s",
        "d",
        "q",
        "e",
        "PageUp",
        "PageDown",
        "Shift",
      ].includes(key)
    ) {
      event.preventDefault();
    }

    if (isPressed) {
      pressedKeys.add(key);
    } else {
      pressedKeys.delete(key);
    }
  }

  function update(delta) {
    const shiftPressed = pressedKeys.has("Shift");

    if (shiftPressed) {
      if (pressedKeys.has("ArrowLeft")) {
        state.yaw += rotationSpeed * delta;
      }
      if (pressedKeys.has("ArrowRight")) {
        state.yaw -= rotationSpeed * delta;
      }
      if (pressedKeys.has("ArrowUp")) {
        state.pitch = Math.min(pitchLimit, state.pitch + rotationSpeed * delta);
      }
      if (pressedKeys.has("ArrowDown")) {
        state.pitch = Math.max(
          -pitchLimit,
          state.pitch - rotationSpeed * delta,
        );
      }
    } else {
      camera.getWorldDirection(forward);
      forward.y = 0;

      if (forward.lengthSq() > 0) {
        forward.normalize();
      } else {
        forward.set(0, 0, -1);
      }

      right.crossVectors(forward, upAxis).normalize();

      if (pressedKeys.has("ArrowUp") || pressedKeys.has("w")) {
        state.position.addScaledVector(forward, movementSpeed * delta);
      }
      if (pressedKeys.has("ArrowDown") || pressedKeys.has("s")) {
        state.position.addScaledVector(forward, -movementSpeed * delta);
      }
      if (pressedKeys.has("ArrowLeft") || pressedKeys.has("a")) {
        state.position.addScaledVector(right, -movementSpeed * delta);
      }
      if (pressedKeys.has("ArrowRight") || pressedKeys.has("d")) {
        state.position.addScaledVector(right, movementSpeed * delta);
      }
    }

    if (pressedKeys.has("e") || pressedKeys.has("PageUp")) {
      state.position.y += movementSpeed * delta;
    }
    if (pressedKeys.has("q") || pressedKeys.has("PageDown")) {
      state.position.y -= movementSpeed * delta;
    }

    updateCameraTransform();
  }

  updateCameraTransform();

  return {
    update,
    onKeyDown: (event) => onKeyChange(event, true),
    onKeyUp: (event) => onKeyChange(event, false),
  };
}

