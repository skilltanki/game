// Parser for the map XML <ctf-flags> section.
//
// The flag pedestal positions live in the map XML itself, not in any server
// data: every CTF-capable map carries a <ctf-flags> block with one position
// per team. 48 of the 53 bundled maps have one; the rest are DM/TDM only.
import { Vector3 } from '../math/Vector3';
import { firstChild, readVector3 } from './xmlUtils';

export interface CtfFlagPositions {
  red: Vector3;
  blue: Vector3;
}

/** Null when the map has no <ctf-flags> block, i.e. CTF cannot be played on it. */
export function parseCtfFlags(mapXml: Document): CtfFlagPositions | null {
  const root = firstChild(mapXml.documentElement, 'ctf-flags');
  if (root == null) {
    return null;
  }
  const red = new Vector3();
  const blue = new Vector3();
  // readVector3 wants the PARENT and the child tag name; here each team's
  // position is the content of <flag-red>/<flag-blue> itself.
  readVector3(root, 'flag-red', red);
  readVector3(root, 'flag-blue', blue);
  return { red, blue };
}
