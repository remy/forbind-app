/* Applies the saved theme and density before the first paint.
   A classic script, not a module, so it runs synchronously in <head> and there
   is no flash of the wrong palette for someone who chose dark or light. */
(function () {
  try {
    var raw = localStorage.getItem('allyway:prefs');
    if (!raw) return;
    var prefs = JSON.parse(raw);
    if (prefs.theme === 'light' || prefs.theme === 'dark') {
      document.documentElement.setAttribute('data-theme', prefs.theme);
    }
    if (prefs.density === 'roomy' || prefs.density === 'dense') {
      document.documentElement.setAttribute('data-density', prefs.density);
    }
  } catch (error) {
    /* Storage can be unavailable or corrupt; the defaults are fine. */
  }
})();
