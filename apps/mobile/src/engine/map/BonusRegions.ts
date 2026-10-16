// Parser for the map XML <bonus-regions> section (drop zones for bonus boxes).
import { Vector3 } from '../math/Vector3';
import { childElements, firstChild, readVector3 } from './xmlUtils';

export interface BonusRegion {
  name: string;
  /** nitro | damageup | armorup | medkit | crystal | crystal_100 */
  type: string;
  position: Vector3;
  min: Vector3;
  max: Vector3;
}

export function parseBonusRegions(mapXml: Document): BonusRegion[] {
  const result: BonusRegion[] = [];
  const root = firstChild(mapXml.documentElement, 'bonus-regions');
  if (root == null) {
    return result;
  }
  const position = new Vector3();
  const min = new Vector3();
  const max = new Vector3();
  for (const node of childElements(root, 'bonus-region')) {
    readVector3(node, 'position', position);
    readVector3(node, 'min', min);
    readVector3(node, 'max', max);
    result.push({
      name: node.getAttribute('name') ?? '',
      type: firstChild(node, 'bonus-type')?.textContent?.trim() ?? 'medkit',
      position: position.clone(),
      min: min.clone(),
      max: max.clone(),
    });
  }
  return result;
}
