/** Apple keyboards use ⌘ where everyone else uses Ctrl. */
export const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
export const MOD_KEY = isMac ? "⌘" : "Ctrl";
