import * as THREE from "three";
import { USDZExporter } from "three/examples/jsm/exporters/USDZExporter.js";

/**
 * Exports the pedestal + geometric shapes as a USDZ file for Apple Vision Pro.
 * Background, floor, wall, panels, and merkabah wireframes are excluded.
 *
 * Note: Three.js USDZExporter (v0.176) does not support keyframe animations,
 * so shapes are exported in their current pose (static).
 */
export async function exportSceneAsUSDZ(shapes) {
  const { pyramid, square, cylinder } = shapes;

  // Build a self-contained scene for export
  const exportScene = new THREE.Scene();

  // Pedestal (matches scene.js dimensions)
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(2.6, 2.9, 0.35, 48),
    new THREE.MeshStandardMaterial({
      color: "#13233d",
      metalness: 0.3,
      roughness: 0.55,
    }),
  );
  pedestal.position.y = 0;
  pedestal.name = "Pedestal";
  exportScene.add(pedestal);

  // Clone shapes — use exact offsets from pedestal center in original scene.
  // Original scene (scene.js): pedestal Y=-0.98, so shape offset = shape.y - (-0.98)
  // Here pedestal is at Y=0, so shapes go at their offset directly.
  const PEDESTAL_ORIG_Y = -0.98;

  const pyramidClone = pyramid.clone();
  pyramidClone.name = "Pyramid";
  pyramidClone.position.set(-1.35, -0.15 - PEDESTAL_ORIG_Y, 0.2);
  pyramidClone.rotation.copy(pyramid.rotation);
  exportScene.add(pyramidClone);

  const squareClone = square.clone();
  squareClone.name = "Square";
  squareClone.position.set(0, -0.1 - PEDESTAL_ORIG_Y, 0);
  squareClone.rotation.copy(square.rotation);
  exportScene.add(squareClone);

  const cylinderClone = cylinder.clone();
  cylinderClone.name = "Cylinder";
  cylinderClone.position.set(1.35, 0.02 - PEDESTAL_ORIG_Y, -0.18);
  cylinderClone.rotation.copy(cylinder.rotation);
  exportScene.add(cylinderClone);

  // Ensure world matrices are computed before export
  exportScene.updateMatrixWorld(true);

  // Export
  const exporter = new USDZExporter();
  const arraybuffer = await exporter.parseAsync(exportScene);

  // Trigger download
  const blob = new Blob([arraybuffer], { type: "model/vnd.usdz+zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "threejs-lab-stage.usdz";
  a.click();
  URL.revokeObjectURL(url);
}
