/* global document */
// Classic blocking script: sets the theme before first paint. The storage key must match THEME_KEY in src/web/app/theme.ts.
(function () {
  var light = false;
  try {
    light = localStorage.getItem("kensaku.theme.v1") === "light";
  } catch {
    // Storage is unavailable: dark.
  }
  var root = document.documentElement;
  root.classList.toggle("dark", !light);
  root.style.colorScheme = light ? "light" : "dark";
})();
