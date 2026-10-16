// Small helpers replicating the originals' E4X access patterns on DOMParser output.
import { Vector3 } from '../math/Vector3';

export function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, 'text/xml');
}

export function childElements(parent: Element | Document, tagName: string): Element[] {
  const result: Element[] = [];
  const root = parent instanceof Document ? parent.documentElement : parent;
  for (const child of Array.from(root.children)) {
    if (child.tagName === tagName) {
      result.push(child);
    }
  }
  return result;
}

export function firstChild(parent: Element, tagName: string): Element | null {
  for (const child of Array.from(parent.children)) {
    if (child.tagName === tagName) {
      return child;
    }
  }
  return null;
}

export function childText(parent: Element, tagName: string): string {
  const child = firstChild(parent, tagName);
  return child != null ? (child.textContent ?? '') : '';
}

export function childNumber(parent: Element, tagName: string): number {
  const value = parseFloat(childText(parent, tagName));
  return isNaN(value) ? 0 : value;
}

/** Original CollisionGeometryParser.readVector3: absent node -> (0,0,0); absent axis -> 0. */
export function readVector3(parent: Element, tagName: string, out: Vector3): void {
  const node = firstChild(parent, tagName);
  if (node != null) {
    out.x = childNumber(node, 'x');
    out.y = childNumber(node, 'y');
    out.z = childNumber(node, 'z');
  } else {
    out.reset(0, 0, 0);
  }
}
