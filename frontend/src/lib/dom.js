// Tiny DOM helpers, so the chat can be built without a framework.

const PROPERTIES = new Set(['value', 'checked', 'selected', 'disabled']);

/**
 * Creates an element: h('button', { class: 'btn', onclick: send }, 'Send').
 * Strings are always inserted as text, never as HTML, so user input is safe to pass in.
 */
export function h(tag, props, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') element.className = value;
    else if (key === 'dataset') Object.assign(element.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2), value);
    else if (PROPERTIES.has(key)) element[key] = value;
    else element.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    element.append(child instanceof Node ? child : String(child));
  }
  return element;
}

const ICON_PATHS = {
  send: 'M5 12h13M12 5l7 7-7 7',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  back: 'M19 12H6M12 18l-6-6 6-6',
  restart: 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4',
};

export function icon(name, className = 'size-5') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  const attributes = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    class: className,
  };
  for (const [key, value] of Object.entries(attributes)) svg.setAttribute(key, value);
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', ICON_PATHS[name]);
  svg.append(path);
  return svg;
}

let counter = 0;
export const uid = (prefix = 'id') => `${prefix}-${++counter}`;

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
