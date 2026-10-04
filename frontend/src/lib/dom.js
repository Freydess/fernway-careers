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

// 24×24 stroke icons in one style (2px, round caps).
const ICON_PATHS = {
  send: 'M5 12h13M12 5l7 7-7 7',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  back: 'M19 12H6M12 18l-6-6 6-6',
  restart: 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4',
  search: 'M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14zM20 20l-4-4',
  bell: 'M6 9a6 6 0 0 1 12 0c0 6.5 2.5 8 2.5 8h-17S6 15.5 6 9zM10.3 20.5a2 2 0 0 0 3.4 0',
  briefcase: 'M3.5 7.5h17v12h-17zM8.5 7.5V5.5a1.5 1.5 0 0 1 1.5-1.5h4a1.5 1.5 0 0 1 1.5 1.5v2M3.5 13h17',
  pin: 'M12 21s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0c0 5.2-6.5 11-6.5 11zM12 12.3a2.3 2.3 0 1 0 0-4.6a2.3 2.3 0 0 0 0 4.6z',
  clock: 'M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 0 0 0-17zM12 7.5V12l3 2',
  user: 'M19.5 20.5a7.5 7.5 0 0 0-15 0M12 12a4 4 0 1 0 0-8a4 4 0 0 0 0 8z',
  building: 'M4.5 20.5v-15a1.5 1.5 0 0 1 1.5-1.5h7.5a1.5 1.5 0 0 1 1.5 1.5v15M15 9h3a1.5 1.5 0 0 1 1.5 1.5v10M2.5 20.5h19M8 8h3.5M8 12h3.5M8 16h3.5',
  money: 'M3.5 6.5h17v11h-17zM12 14.5a2.5 2.5 0 1 0 0-5a2.5 2.5 0 0 0 0 5zM6.5 9.5v5M17.5 9.5v5',
  eye: 'M2.5 12s3.5-6.5 9.5-6.5s9.5 6.5 9.5 6.5s-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM12 14.8a2.8 2.8 0 1 0 0-5.6a2.8 2.8 0 0 0 0 5.6z',
  checkCircle: 'M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 0 0 0-17zM8.3 12.3l2.5 2.5l4.9-5.1',
  xCircle: 'M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 0 0 0-17zM9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6',
  undo: 'M9 14.5L4.5 10L9 5.5M4.5 10h10a5 5 0 0 1 0 10H11',
  star: 'M12 3.8l2.5 5.1l5.6.8l-4 3.9l1 5.6L12 16.6l-5.1 2.6l1-5.6l-4-3.9l5.6-.8z',
  award: 'M12 14.5a5.5 5.5 0 1 0 0-11a5.5 5.5 0 0 0 0 11zM8.8 13.4L7.5 20.5l4.5-2.5l4.5 2.5l-1.3-7.1',
  menu: 'M4 7h16M4 12h16M4 17h16',
  plus: 'M12 5v14M5 12h14',
  edit: 'M4.5 19.5h4l10.3-10.3a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4.5 15.5v4zM13.5 6.5l4 4',
  logout: 'M14.5 4h4a1.5 1.5 0 0 1 1.5 1.5v13a1.5 1.5 0 0 1-1.5 1.5h-4M9.5 16.5L14 12L9.5 7.5M14 12H3.5',
  external: 'M14 4.5h5.5V10M19.5 4.5l-8.5 8.5M17.5 13.5v5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1h5',
  sparkle: 'M12 3.5l1.9 4.9l4.9 1.9l-4.9 1.9L12 17.1l-1.9-4.9l-4.9-1.9l4.9-1.9zM18.5 15.5l.8 2.2l2.2.8l-2.2.8l-.8 2.2l-.8-2.2l-2.2-.8l2.2-.8z',
  leaf: 'M5 19.5C5 11 10 5 19.5 4.5C19.5 14 14 19.5 5 19.5zM5 19.5l8-8',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  file: 'M14 3.5H6.5a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V8zM14 3.5V8h4.5M9 13h6M9 16.5h6',
  inbox: 'M3.5 13l2.8-7.5h11.4l2.8 7.5v6h-17zM3.5 13h5l1 2.5h5l1-2.5h5',
  chevronDown: 'M6 9.5l6 6l6-6',
  chevronRight: 'M9.5 6l6 6l-6 6',
  mail: 'M3.5 6h17v12h-17zM3.5 7l8.5 6.5L20.5 7',
  phone: 'M8 3.5H5.5a1.5 1.5 0 0 0-1.5 1.6C4.5 13.2 10.8 19.5 18.9 20a1.5 1.5 0 0 0 1.6-1.5V16l-4-1.5l-2 2a12 12 0 0 1-5.5-5.5l2-2z',
  trash: 'M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5',
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
