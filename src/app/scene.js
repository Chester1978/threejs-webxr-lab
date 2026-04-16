import * as THREE from "three";

export function createSceneWorld() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#07111f");

  const worldRoot = new THREE.Group();
  scene.add(worldRoot);

  const ambientLight = new THREE.HemisphereLight("#b7d0ff", "#1b2538", 1.8);
  scene.add(ambientLight);

  const keyLight = new THREE.DirectionalLight("#ffffff", 2.4);
  keyLight.position.set(4, 7, 5);
  scene.add(keyLight);

  const fillLight = new THREE.PointLight("#8db6ff", 18, 18, 2);
  fillLight.position.set(-3.5, 2.8, 3);
  scene.add(fillLight);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(14, 80),
    new THREE.MeshStandardMaterial({
      color: "#0f1b2e",
      metalness: 0.15,
      roughness: 0.88,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.15;
  worldRoot.add(floor);

  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(2.6, 2.9, 0.35, 48),
    new THREE.MeshStandardMaterial({
      color: "#13233d",
      metalness: 0.3,
      roughness: 0.55,
    }),
  );
  pedestal.position.y = -0.98;
  worldRoot.add(pedestal);

  const pyramid = new THREE.Mesh(
    new THREE.ConeGeometry(0.75, 1.3, 4),
    new THREE.MeshStandardMaterial({
      color: "#fca5a5",
      emissive: "#4b1616",
      metalness: 0.25,
      roughness: 0.35,
    }),
  );
  pyramid.position.set(-1.35, -0.15, 0.2);
  pyramid.rotation.y = Math.PI * 0.25;
  worldRoot.add(pyramid);

  const square = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 1.2, 0.18),
    new THREE.MeshStandardMaterial({
      color: "#fde68a",
      emissive: "#493d0e",
      metalness: 0.2,
      roughness: 0.45,
    }),
  );
  square.position.set(0, -0.1, 0);
  worldRoot.add(square);

  const cylinder = new THREE.Mesh(
    new THREE.CylinderGeometry(0.52, 0.52, 1.45, 40),
    new THREE.MeshStandardMaterial({
      color: "#7dd3fc",
      emissive: "#143445",
      metalness: 0.32,
      roughness: 0.3,
    }),
  );
  cylinder.position.set(1.35, 0.02, -0.18);
  worldRoot.add(cylinder);

  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(8.5, 4.2),
    new THREE.MeshStandardMaterial({
      color: "#142238",
      metalness: 0.22,
      roughness: 0.7,
    }),
  );
  wall.position.set(0, 1.2, -4.4);
  worldRoot.add(wall);

  const palette = [
    "#fca5a5",
    "#fde68a",
    "#7dd3fc",
    "#86efac",
    "#c4b5fd",
    "#f9a8d4",
  ];

  const objects = [pyramid, square, cylinder];

  // Spawn the VR user behind the podium and above the virtual floor so they
  // see the shapes and wall in front of them instead of standing on top of
  // the shapes. worldRoot.y = 1.15 lines the scene floor up with the real
  // floor (local-floor reference); z = -3.5 pushes the podium forward.
  worldRoot.position.set(0, 1.15, -3.5);

  return {
    scene,
    worldRoot,
    floor,
    objects,
    shapes: { pyramid, square, cylinder },
    palette,
  };
}

export function animateObjects(objects, elapsed) {
  const [pyramid, square, cylinder] = objects;
  pyramid.rotation.y += 0.006;
  square.rotation.y += 0.009;
  cylinder.rotation.y += 0.008;

  objects.forEach((mesh, index) => {
    mesh.position.y += Math.sin(elapsed * 1.6 + index * 0.8) * 0.0018;
  });
}

