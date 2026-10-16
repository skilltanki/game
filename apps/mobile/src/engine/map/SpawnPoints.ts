// Parser for the map XML <spawn-points> section.
import { Vector3 } from '../math/Vector3';
import { childElements, firstChild, readVector3, childNumber } from './xmlUtils';

export interface SpawnPoint {
  type: string; // "red" | "blue" | "dm"
  position: Vector3;
  rotationZ: number;
}

export function parseSpawnPoints(mapXml: Document): SpawnPoint[] {
  const result: SpawnPoint[] = [];
  const root = firstChild(mapXml.documentElement, 'spawn-points');
  if (root == null) {
    return result;
  }
  const position = new Vector3();
  for (const node of childElements(root, 'spawn-point')) {
    readVector3(node, 'position', position);
    const rotationNode = firstChild(node, 'rotation');
    const rotationZ = rotationNode != null ? childNumber(rotationNode, 'z') : 0;
    result.push({
      type: node.getAttribute('type') ?? 'dm',
      position: position.clone(),
      rotationZ,
    });
  }
  return result;
}
