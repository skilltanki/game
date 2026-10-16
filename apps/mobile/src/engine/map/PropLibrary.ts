// Parser for assets/Props/<lib>/library.xml (original: PropLibrary).
// A prop is either a mesh (.3ds + named diffuse texture variants) or a sprite (billboard png).
import { childElements, firstChild } from './xmlUtils';

export const DEFAULT_TEXTURE = '$$$_DEFAULT_TEXTURE_$$$'; // PropMesh.DEFAULT_TEXTURE

export interface PropMeshDef {
  kind: 'mesh';
  libraryFolder: string;
  meshFile: string;
  /** texture variant name -> diffuse jpg file name */
  textures: Map<string, string>;
}

export interface PropSpriteDef {
  kind: 'sprite';
  libraryFolder: string;
  file: string;
  originY: number;
  scale: number;
}

export type PropDef = PropMeshDef | PropSpriteDef;

export class PropLibrary {
  name: string;
  folder: string;
  /** key: `${groupName} ${propName}` */
  private props = new Map<string, PropDef>();
  /** Same entries in document order, group and name kept separate. */
  private index: { group: string; name: string; def: PropDef }[] = [];

  constructor(name: string, folder: string) {
    this.name = name;
    this.folder = folder;
  }

  static parse(xml: Document, folder: string): PropLibrary {
    const root = xml.documentElement;
    const library = new PropLibrary(root.getAttribute('name') ?? folder, folder);
    for (const group of childElements(root, 'prop-group')) {
      const groupName = group.getAttribute('name') ?? '';
      for (const prop of childElements(group, 'prop')) {
        const propName = prop.getAttribute('name') ?? '';
        const mesh = firstChild(prop, 'mesh');
        const sprite = firstChild(prop, 'sprite');
        let def: PropDef | null = null;
        if (mesh != null) {
          const textures = new Map<string, string>();
          for (const texture of childElements(mesh, 'texture')) {
            const name = texture.getAttribute('name');
            const diffuse = texture.getAttribute('diffuse-map');
            if (name != null && diffuse != null) {
              textures.set(name, diffuse);
            }
          }
          def = {
            kind: 'mesh',
            libraryFolder: folder,
            meshFile: mesh.getAttribute('file') ?? '',
            textures,
          };
        } else if (sprite != null) {
          def = {
            kind: 'sprite',
            libraryFolder: folder,
            file: sprite.getAttribute('file') ?? '',
            originY: parseFloat(sprite.getAttribute('origin-y') ?? '0.5'),
            scale: parseFloat(sprite.getAttribute('scale') ?? '1'),
          };
        }
        if (def != null) {
          library.props.set(`${groupName} ${propName}`, def);
          library.index.push({ group: groupName, name: propName, def });
        }
      }
    }
    return library;
  }

  getProp(groupName: string, propName: string): PropDef | null {
    return this.props.get(`${groupName} ${propName}`) ?? null;
  }

  /** Every prop, in library.xml document order. */
  entries(): { group: string; name: string; def: PropDef }[] {
    return this.index;
  }
}

/** "Landscape Old" -> "landscape_old" (verified against every library.xml in assets/Props). */
export function libraryNameToFolder(name: string): string {
  return name.toLowerCase().replace(/ /g, '_');
}

export class PropLibRegistry {
  private libraries = new Map<string, PropLibrary>();

  add(library: PropLibrary): void {
    this.libraries.set(library.name, library);
  }

  getLibrary(name: string): PropLibrary | null {
    return this.libraries.get(name) ?? null;
  }

  has(name: string): boolean {
    return this.libraries.has(name);
  }
}
