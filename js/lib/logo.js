/**
 * The forbind mark.
 *
 * The same three paths as `assets/favicon.svg`, drawn in `currentColor` so the
 * mark follows the ink of whatever it sits in — light, dark and forced-colours
 * alike — rather than shipping a second copy per theme. It is decoration: the
 * word beside it is the name, so the SVG is hidden from assistive technology
 * and carries no title of its own.
 *
 * Built with `createElementNS`, because `el()` in dom.js uses
 * `createElement` and an SVG in the HTML namespace does not render.
 */

const NS = 'http://www.w3.org/2000/svg';

const PATHS = [
  'M344 217.1c-1.4.6-4 2.4-5.8 4.2-3.3 3.2-3.2 2.9-24.8 58.2-14.5 37.2-31.5 80.2-33 83.4-.8 1.8-1.3 3.6-1 3.8.3.3 4.9-2.2 10.3-5.5 12.9-7.9 20.3-11.6 34.7-17.3l12-4.7 6.8-17.8c3.8-9.9 10.3-27 14.5-38.2 4.2-11.1 8.1-20.2 8.7-20.2.7 0 4.1 7.5 7.5 16.7 9.4 24.8 15 39.4 16.5 42.8l1.4 3.1 11.8-1.7c6.6-1 16.2-2.1 21.4-2.5 5.2-.3 9.8-.8 10.1-1 .4-.2-1.1-4.8-3.4-10.1-2.2-5.4-10.6-26.8-18.8-47.7-15.3-39.4-16.9-42.3-23.6-45.2-3.9-1.7-41.3-1.9-45.3-.3',
  'M470.6 309.6c-1.9 1.9-2 4.9-.1 13.4 2.6 11.6 4 10.6-15.2 11.4-56.6 2.4-105.1 12.7-140.8 30-22.6 11-38.7 23.6-47.5 37.1-4 6.1-25.4 58.4-28.2 68.8-1.5 5.8.1 10.1 4.4 11.6 1.7.6 9.6 1.1 17.5 1.1 20.8 0 21.1-.2 29.9-22.8 16.3-42 18.7-47.8 20.2-49.6 3.1-3.4 13.3-9.8 23.6-14.7 29.1-13.9 69.8-22 127.5-25.4l10.4-.6-.6 3.8c-.3 2.1-1.1 7.1-1.8 11.1-1.3 7-1.2 7.3.9 9.4s2.3 2.1 5.4.5c1.8-.9 8-5.1 13.8-9.2 5.8-4.2 17.5-12.4 26-18.4 8.6-6 16.1-11.6 16.9-12.4 3.1-3.8 1.2-5.7-21.4-21.5-39.9-27.8-37.9-26.6-40.9-23.6',
  'M445 386.5c-.8.2-7.5.9-14.8 1.5-7.3.7-13.5 1.6-13.8 2.1-.7 1.2 2.2 9 22.3 61.4 6.8 17.7 10.7 25.7 13.7 28.5 2.7 2.5 3 2.5 20.3 2.5h17.5l2.4-2.8c1.3-1.5 2.4-4 2.4-5.4 0-2.2-5.2-16.4-19.8-53.8-2.2-5.4-4.3-10-4.8-10.1s-2.1-.5-3.6-.8c-3.7-.8-9.8-6.3-11.4-10.3-.8-1.8-1.4-5.5-1.4-8.3v-5l-3.7.1c-2.1.1-4.5.3-5.3.4',
];

/**
 * @param {string} [className]
 * @returns {SVGElement} the mark, sized in `em` by the stylesheet.
 */
export function logoMark(className = 'brand__mark') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', '222.25 200.005 327.805 298.995');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of PATHS) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}
