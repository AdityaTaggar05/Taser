/** Decorative timeline geometry; characters use the active game sprite pack. */
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
    ${sprite('player.p1.idle.south.0', 11.11, 56, 'timeline-operator')}
    ${sprite('player.p2.idle.south.0', 88.89, 56, 'timeline-operator')}
  </figure>`;
}

/** A collection is a set of chambers, shown as distinct map sheets. */
export function collectionArt() {
  return `<figure class="timeline-art configuration-timeline collection-art" aria-hidden="true">
    <svg viewBox="0 0 720 250" focusable="false">
      ${[170, 127, 84]
        .map(
          (y, i) => `<g transform="translate(340 ${y})">
        <path class="timeline-tile-edge" d="m0-55 125 55v9L0 64-125 9V0Z"/>
        <path class="timeline-tile" d="m0-55 125 55L0 55-125 0Z"/>
        <path class="collection-grid" d="M-83-18 42 37M-42-37 83 18M-83 18 42-37M-42 37 83-18"/>
        ${i === 2 ? '<path class="timeline-route timeline-forward" d="M-83 0-42 18 0 0 42-18 83 0"/><circle class="collection-start" cx="-83" cy="0" r="5"/><circle class="collection-end" cx="83" cy="0" r="5"/>' : ''}
      </g>`,
        )
        .join('')}
      <path class="collection-grid" d="M525 62v125"/>
      ${[70, 126, 182].map((y, i) => `<path class="${i === 0 ? 'timeline-weld' : 'timeline-tile'}" d="m525 ${y - 10} 10 10-10 10-10-10Z"/>`).join('')}
    </svg>
  </figure>`;
}

/** Forward and reverse share a clock but move in opposite directions. */
export function roleArt() {
  return `<figure class="timeline-art configuration-timeline role-art" aria-hidden="true">
    <svg viewBox="0 0 720 250" focusable="false">
      <path class="timeline-tile" d="m150 160 55 24-55 24-55-24Zm420 0 55 24-55 24-55-24Z"/>
      <g class="role-clock"><circle cx="360" cy="117" r="58"/><circle cx="360" cy="117" r="48"/>
        <path d="M360 59v9m0 98v9m-58-58h9m98 0h9"/>
      </g>
      <path class="role-hand timeline-forward" d="M360 117V80"/>
      <path class="role-hand timeline-reverse" d="M360 117h31"/>
      <path class="role-route timeline-forward" d="M180 88Q325-15 535 81m-16-18 16 18-24 4"/>
      <path class="role-route timeline-reverse" d="M540 171Q395 263 185 177m16 18-16-18 24-4"/>
      <circle class="role-clock-center" cx="360" cy="117" r="4"/>
    </svg>
    <span class="timeline-sprite role-operator" data-art-sprite="player.p1.idle.south.0" style="left:20.83%;top:73.6%"></span>
    <span class="timeline-sprite role-operator" data-art-sprite="player.p2.idle.south.0" style="left:79.17%;top:73.6%"></span>
  </figure>`;
}
