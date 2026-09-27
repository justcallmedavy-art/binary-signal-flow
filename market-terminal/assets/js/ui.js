/* ============================================================================
   Small UI primitives shared by every view: toasts and modals.
   ========================================================================== */
import { h } from './builder.js';

const host = () => document.getElementById('toastHost');
const modalHost = () => document.getElementById('modalHost');

export function toast(title, body = '', kind = 'info', ms = 4200) {
  const node = h('div', { class: 'toast ' + (kind === 'info' ? '' : kind) },
    h('b', {}, title), body ? h('span', {}, body) : null);
  host().append(node);
  setTimeout(() => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 320);
  }, ms);
  return node;
}

export function closeModal() {
  const hostEl = modalHost();
  hostEl.hidden = true;
  hostEl.innerHTML = '';
}

/* modal({ title, subtitle, body, actions:[{label, primary, keepOpen, onClick(root)}] }) */
export function modal({ title, subtitle, body, actions = [], width }) {
  const hostEl = modalHost();
  hostEl.innerHTML = '';
  hostEl.hidden = false;

  const content = h('div', { class: 'modal' });
  if (width) content.style.width = `min(${width}px, 100%)`;

  const head = h('div', { class: 'modal-head' },
    h('div', {}, h('h3', {}, title), subtitle ? h('p', {}, subtitle) : null),
    h('button', { class: 'x', html: '<svg><use href="#i-close"/></svg>', onclick: closeModal }));

  const bodyEl = h('div', { class: 'modal-body' });
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.append(body);

  const foot = h('div', { class: 'modal-foot' });
  actions.forEach((a) => {
    foot.append(h('button', {
      class: 'btn ' + (a.primary ? 'primary' : 'plain'),
      onclick: () => {
        if (a.onClick) a.onClick(content, bodyEl);
        if (!a.keepOpen) closeModal();
      }
    }, a.label));
  });

  content.append(head, bodyEl);
  if (actions.length) content.append(foot);
  hostEl.append(content);

  hostEl.onclick = (e) => { if (e.target === hostEl) closeModal(); };
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', esc); }
  });
  return content;
}

export function confirmModal(title, message, confirmLabel = 'Confirm') {
  return new Promise((resolve) => {
    modal({
      title,
      subtitle: message,
      actions: [
        { label: 'Cancel', onClick: () => resolve(false) },
        { label: confirmLabel, primary: true, onClick: () => resolve(true) }
      ]
    });
  });
}

export function loadingInline(label = 'Working…') {
  return h('span', { style: 'display:inline-flex;align-items:center;gap:9px' },
    h('span', { class: 'spin dark' }), label);
}
