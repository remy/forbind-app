/**
 * The forbind mark.
 *
 * The same four shapes as `assets/favicon.svg`: a ring split down its vertical
 * axis, the leading half in the brand pink and the trailing half in the brand
 * grey, hairlines tracing the ring's two edges. Shape is set here as
 * presentation attributes; colour comes from `--mark-*` in `css/tokens.css`, so
 * the two halves stay the brand's colours in either theme and only the hairline
 * follows the ink. It is decoration: the word beside it is the name, so the SVG
 * is hidden from assistive technology and carries no title of its own.
 *
 * Built with `createElementNS`, because `el()` in dom.js uses
 * `createElement` and an SVG in the HTML namespace does not render.
 */

const NS = 'http://www.w3.org/2000/svg';

/** The two halves of the ring: same arc, swept the two ways round. */
const HALVES = [
  ['M 50 12.5 A 37.5 37.5 0 0 0 50 87.5', 'brand__mark-half--accent'],
  ['M 50 12.5 A 37.5 37.5 0 0 1 50 87.5', 'brand__mark-half--mute'],
];

/** Outer and inner edge of the band, as radii. */
const EDGES = [49.25, 25];

/**
 * @param {string} [className]
 * @returns {SVGElement} the mark, sized in `em` by the stylesheet.
 */
export function logoMark(className = 'brand__mark') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  for (const [d, half] of HALVES) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('class', `brand__mark-half ${half}`);
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-width', '25');
    svg.appendChild(path);
  }

  for (const r of EDGES) {
    const circle = document.createElementNS(NS, 'circle');
    circle.setAttribute('class', 'brand__mark-rule');
    circle.setAttribute('cx', '50');
    circle.setAttribute('cy', '50');
    circle.setAttribute('r', String(r));
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke-width', '1.5');
    svg.appendChild(circle);
  }

  return svg;
}
