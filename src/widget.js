// Widget mode (?widget): the page as it runs inside the desktop widget.
// Compact look (body.widget in style.css), its own quality preset
// (quality.js), and it refreshes itself straight away when anything
// changes (liveness.js).
export const isWidget = new URLSearchParams(location.search).has('widget');
