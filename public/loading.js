const active = new WeakMap();

/** Show feedback on the actual control, restoring it after success, failure or cancellation. */
export function buttonLoading(button, label = 'Loading…', { disable = true } = {}) {
  if (!button || active.has(button)) return () => {};
  const original = {
    html: button.innerHTML, text: button.textContent, disabled: button.disabled,
    busy: button.getAttribute?.('aria-busy'), unavailable: button.getAttribute?.('aria-disabled'),
  };
  const finish = () => {
    if (active.get(button) !== finish) return;
    active.delete(button);
    if (original.html !== undefined) button.innerHTML = original.html;
    else button.textContent = original.text;
    if (disable && original.disabled !== undefined) button.disabled = original.disabled;
    for (const [name, value] of [['aria-busy', original.busy], ['aria-disabled', original.unavailable]]) {
      if (value == null) button.removeAttribute?.(name);
      else button.setAttribute?.(name, value);
    }
  };
  active.set(button, finish);
  button.textContent = label;
  button.setAttribute?.('aria-busy', 'true');
  if (disable) {
    if ('disabled' in button) button.disabled = true;
    button.setAttribute?.('aria-disabled', 'true');
  }
  return finish;
}

export const buttonIsLoading = button => Boolean(button && active.has(button));
export const busyButtonAttributes = busy => busy ? 'disabled aria-busy="true"' : '';
