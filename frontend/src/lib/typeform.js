// Path A: opens the Typeform in Chat mode as a popup. Typeform sends answers to the
// backend's signed webhook itself (docs/integrations.md), so this page only shows it.

import { config } from '../config.js';

const EMBED_SCRIPT = 'https://embed.typeform.com/next/embed.js';
const EMBED_STYLES = 'https://embed.typeform.com/next/css/popup.css';

let embedPromise;

function loadEmbed() {
  if (window.tf?.createPopup) return Promise.resolve(window.tf);
  embedPromise ??= new Promise((resolve, reject) => {
    const styles = document.createElement('link');
    styles.rel = 'stylesheet';
    styles.href = EMBED_STYLES;
    document.head.append(styles);

    const script = document.createElement('script');
    script.src = EMBED_SCRIPT;
    script.async = true;
    script.onload = () => (window.tf?.createPopup ? resolve(window.tf) : reject(new Error('Typeform embed loaded without window.tf')));
    script.onerror = () => {
      embedPromise = undefined;
      reject(new Error('Could not load the Typeform embed'));
    };
    document.head.append(script);
  });
  return embedPromise;
}

export const isTypeformConfigured = () => Boolean(config.typeform.formId);

export async function openTypeformChat({ onSubmit } = {}) {
  const tf = await loadEmbed();
  const popup = tf.createPopup(config.typeform.formId, {
    chat: true,
    enableSandbox: config.typeform.sandbox,
    autoClose: 3000,
    onSubmit: () => onSubmit?.(),
    onClose: () => setTimeout(() => popup.unmount?.(), 600),
  });
  popup.open();
}
