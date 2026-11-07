/** Decorative timeline geometry; characters and objects use the active game sprite pack. */
export function timelineArt(className = '') {
  const left = [
    [80, 140],
    [130, 115],
    [180, 140],
    [230, 115],
    [280, 140],
    [330, 165],
  ];
  const right = left.map(([x, y]) => [720 - x, y]);
  const tiles = [...left, ...right, [180, 100], [230, 155], [540, 100], [490, 155]];
  const route = (points: number[][]) =>
    points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
  const sprite = (id: string, x: number, y: number, extra = '') =>
    `<span class="timeline-sprite ${extra}" data-art-sprite="${id}" style="left:${x}%;top:${y}%"></span>`;
  return `<figure class="timeline-art ${className}" aria-hidden="true">
    <svg viewBox="0 0 720 250" focusable="false">
      <g class="timeline-tiles">${tiles.map(([x, y]) => `<path class="timeline-tile-edge" d="M${x - 40} ${y}v8l40 20 40-20v-8l-40 20Z"/><path class="timeline-tile" d="m${x} ${y - 20} 40 20-40 20-40-20Z"/>`).join('')}</g>
      <path class="timeline-route timeline-forward" d="${route(left)} L360 150" />
      <path class="timeline-route timeline-reverse" d="${route(right)} L360 150" />
      <path class="timeline-weld-base" d="m360 120 55 28v10l-55 28-55-28v-10Z"/>
      <path class="timeline-weld" d="m360 120 55 28-55 28-55-28Z"/>
      <path class="timeline-spark" d="M360 132v-12m0 44v12m-16-28h-12m44 0h12m-35-7-9-7m25 25 9 7m-9-25 9-7m-25 25-9 7"/>
      <g class="timeline-clock timeline-forward"><circle cx="80" cy="28" r="13"/><path d="M80 19v9h8m-8 18v12"/></g>
      <g class="timeline-clock timeline-reverse"><circle cx="640" cy="28" r="13"/><path d="M640 19v9h-8m8 18v12"/></g>
      <path class="timeline-arrow timeline-forward" d="m205 126 9 4-9 4m-2-4h11"/>
      <path class="timeline-arrow timeline-reverse" d="m515 126-9 4 9 4m2-4h-11"/>
    </svg>
    ${sprite('switch.p1.up', 25, 59, 'timeline-object')}
    ${sprite('switch.p2.up', 75, 59, 'timeline-object')}
    ${sprite('crate.p1', 39, 56, 'timeline-object')}
    ${sprite('crate.p2', 61, 56, 'timeline-object')}
    ${sprite('player.p1.idle.south.0', 11.11, 56, 'timeline-operator')}
    ${sprite('player.p2.idle.south.0', 88.89, 56, 'timeline-operator')}
  </figure>`;
}
