// Tiny DOM helpers: no framework, no virtual DOM, just elements and classes
// from theme.css. Good enough for a handful of screens and far lighter than
// a UI library on a phone's main thread.

export type Child = Node | string | null | undefined | false | Child[];

export interface Props {
  class?: string;
  id?: string;
  text?: string;
  html?: string;
  style?: Partial<CSSStyleDeclaration>;
  attrs?: Record<string, string>;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (event: HTMLElementEventMap[K]) => void }>;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class != null) el.className = props.class;
  if (props.id != null) el.id = props.id;
  if (props.text != null) el.textContent = props.text;
  if (props.html != null) el.innerHTML = props.html;
  if (props.style != null) Object.assign(el.style, props.style);
  if (props.attrs != null) {
    for (const [name, value] of Object.entries(props.attrs)) {
      el.setAttribute(name, value);
    }
  }
  if (props.on != null) {
    for (const [name, handler] of Object.entries(props.on)) {
      el.addEventListener(name, handler as EventListener);
    }
  }
  append(el, children);
  return el;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) {
      append(parent, child);
    } else if (typeof child === 'string') {
      parent.appendChild(document.createTextNode(child));
    } else {
      parent.appendChild(child);
    }
  }
}

export function clear(el: Element): void {
  el.replaceChildren();
}

/** Lazy image: the URL is fetched only once the element scrolls into view. */
let observer: IntersectionObserver | null = null;
/** How long a failed thumbnail waits before its one retry. */
const IMAGE_RETRY_MS = 1500;
export function lazyImage(url: string, cls = ''): HTMLImageElement {
  const img = h('img', { class: cls, attrs: { loading: 'lazy', decoding: 'async', alt: '' } });
  img.dataset.src = url;
  // One retry: a dev server mid-sync, a flaky mobile link — a thumbnail that
  // failed once is usually there a moment later; a second failure stays blank.
  let retried = false;
  img.addEventListener('error', () => {
    if (retried) {
      img.removeAttribute('src');
      return;
    }
    retried = true;
    setTimeout(() => {
      img.src = `${url}${url.includes('?') ? '&' : '?'}retry=1`;
    }, IMAGE_RETRY_MS);
  });
  observer ??= new IntersectionObserver(
    (entries, io) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const target = entry.target as HTMLImageElement;
        if (target.dataset.src != null) {
          target.src = target.dataset.src;
          delete target.dataset.src;
        }
        io.unobserve(target);
      }
    },
    { rootMargin: '200px' },
  );
  observer.observe(img);
  return img;
}

/** Escapes text for the few places innerHTML is unavoidable (tables). */
export function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Team colour, matching the engine's name tags. */
export function teamColor(team: string): string {
  return team === 'red' ? '#ff7a5a' : team === 'blue' ? '#6aa8ff' : '#cfcf8a';
}

export function ordinal(place: number): string {
  const mod100 = place % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${place}th`;
  return `${place}${['th', 'st', 'nd', 'rd'][place % 10] ?? 'th'}`;
}

/** Pointer helpers for held buttons (touch + mouse, no ghost clicks). */
export function holdable(el: HTMLElement, onChange: (held: boolean) => void): void {
  let held = false;
  const set = (next: boolean): void => {
    if (held !== next) {
      held = next;
      el.classList.toggle('is-held', next);
      onChange(next);
    }
  };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events carry no active pointer; the hold still works.
    }
    set(true);
  });
  const release = (): void => set(false);
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('lostpointercapture', release);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

/** Tap handler that fires once per touch and ignores the synthetic click. */
export function tappable(el: HTMLElement, onTap: () => void): void {
  el.addEventListener('pointerup', (e) => {
    e.preventDefault();
    onTap();
  });
  el.addEventListener('pointerdown', (e) => e.preventDefault());
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
