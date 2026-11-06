import type { NetworkPhase } from './publicationProgress';

/** Conceptual diagrams, not identities, endpoints or live DON telemetry. */
const scenes = {
  saving: {
    title: 'Protect the chamber',
    hub: 'ENCRYPT',
    glyph: 'lock',
    state: 'Saving the encrypted draft',
    nodes: [
      [95, 110, 'LAYOUT', 'grid'],
      [95, 270, 'SOLUTION', 'route'],
      [450, 190, 'ARKIV DRAFT', 'archive'],
    ],
    links: [
      [0, -1],
      [1, -1],
      [-1, 2],
    ],
  },
  freezing: {
    title: 'Bind the submission',
    hub: 'COMMIT',
    glyph: 'lock',
    state: 'Freezing this exact design and solution',
    nodes: [
      [105, 100, 'LEVEL HASH', 'grid'],
      [455, 100, 'SOLUTION HASH', 'route'],
      [105, 285, 'RULES HASH', 'document'],
      [455, 285, 'REQUEST ID', 'document'],
    ],
    links: [
      [0, -1],
      [1, -1],
      [2, -1],
      [3, -1],
    ],
  },
  verifying: {
    title: 'Replay and verify',
    hub: 'CRE',
    glyph: 'route',
    state: 'Checking the submitted winning solution',
    nodes: [
      [110, 100, 'SUBMISSION', 'document'],
      [280, 55, 'COMMITMENTS', 'lock'],
      [450, 100, 'GAME RULES', 'grid'],
      [450, 270, 'REPLAY', 'route'],
      [280, 315, 'VERDICT', 'document'],
      [110, 270, 'SOLUTION', 'route'],
    ],
    links: [
      [0, -1],
      [1, -1],
      [2, -1],
      [3, -1],
      [4, -1],
      [5, -1],
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 0],
    ],
  },
  publishing: {
    title: 'Archive the approval',
    hub: 'ARKIV',
    glyph: 'archive',
    state: 'Verified · waiting for publication confirmation',
    nodes: [
      [90, 110, 'VERIFIED', 'check'],
      [90, 270, 'ENCRYPTED LEVEL', 'lock'],
      [460, 190, 'PUBLIC ENTITY', 'document'],
    ],
    links: [
      [0, -1],
      [1, -1],
      [-1, 2],
    ],
  },
  published: {
    title: 'Ready to be played',
    hub: 'LIVE',
    glyph: 'check',
    state: 'Publication confirmed on Arkiv',
    nodes: [
      [100, 100, 'VERIFICATION', 'check'],
      [460, 100, 'DISCOVER', 'grid'],
      [100, 280, 'PLAY AS P1', 'route'],
      [460, 280, 'PLAY AS P2', 'route'],
    ],
    links: [
      [0, -1],
      [-1, 1],
      [-1, 2],
      [-1, 3],
    ],
  },
  rejected: {
    title: 'Correct the solution',
    hub: 'REJECTED',
    glyph: 'cross',
    state: 'Verification rejected · return to the editor',
    nodes: [
      [105, 190, 'SUBMISSION', 'document'],
      [455, 190, 'CORRECTION', 'route'],
    ],
    links: [
      [0, -1],
      [-1, 1],
    ],
  },
  paused: {
    title: 'Awaiting confirmation',
    hub: 'PAUSED',
    glyph: 'pause',
    state: 'Processing paused · check the publication status',
    nodes: [
      [105, 190, 'LAST KNOWN STATE', 'document'],
      [455, 190, 'CONFIRMATION', 'pause'],
    ],
    links: [
      [0, -1],
      [-1, 1],
    ],
  },
} satisfies Record<
  NetworkPhase,
  {
    title: string;
    hub: string;
    glyph: string;
    state: string;
    nodes: [number, number, string, string][];
    links: [number, number][];
  }
>;

const glyphs: Record<string, string> = {
  lock: 'M-7-1v-6a7 7 0 0 1 14 0v6M-10-1h20v17h-20zM0 5v5',
  grid: 'M-11-11h22v22h-22zM-11-3h22M-11 4h22M-3-11v22M4-11v22',
  route: 'M-11 9h8V-7h14M5-13l6 6-6 6',
  archive: 'M-12-10h24v7h-24zM-10-3v17h20V-3M-4 3h8',
  document: 'M-9-13H3l7 7v20H-9zM3-13v7h7M-4 0h8M-4 6h8',
  check: 'M-11 0l7 8 16-18',
  cross: 'M-9-9 9 9M9-9-9 9',
  pause: 'M-5-10v20M5-10v20',
};

export function networkScene(phase: NetworkPhase) {
  const scene = scenes[phase];
  const points = [...scene.nodes.map(([x, y]) => [x, y]), [280, 190]];
  const edges = scene.links.map(([a, b]) => {
    const [x, y] = points[a < 0 ? scene.nodes.length : a];
    const [nx, ny] = points[b < 0 ? scene.nodes.length : b];
    return `M${x} ${y}L${nx} ${ny}`;
  });
  const icon = (glyph: string) => `<path class="network-glyph" d="${glyphs[glyph]}" />`;
  return {
    title: scene.title,
    state: scene.state,
    svg: `<circle class="network-orbit" cx="280" cy="190" r="150" />
      <g class="network-edges">${edges.map((d) => `<path d="${d}" />`).join('')}</g>
      <g class="network-signals">${edges.map((d, i) => `<path d="${d}" pathLength="100" style="--signal-delay:${-i * 0.37}s;--signal-direction:normal" />`).join('')}</g>
      ${scene.nodes
        .map(
          (
            [x, y, label, glyph],
            i,
          ) => `<g class="network-node" transform="translate(${x} ${y})" style="--node-delay:${-i * 0.43}s">
        <circle class="network-node-halo" r="33" />
        <rect class="network-node-body" x="-24" y="-24" width="48" height="48" rx="${phase === 'verifying' ? 24 : 9}" />
        ${icon(glyph)}<text class="network-node-label" y="48" text-anchor="middle">${label}</text></g>`,
        )
        .join('')}
      <g class="network-center" transform="translate(280 190)">
        <rect class="network-hub-outline" x="-49" y="-49" width="98" height="98" rx="${phase === 'freezing' ? 4 : 25}" />
        <rect class="network-hub" x="-39" y="-39" width="78" height="78" rx="18" />
        <g transform="translate(0 -8)">${icon(scene.glyph)}</g>
        <text class="network-hub-label" y="25" text-anchor="middle">${scene.hub}</text>
      </g>`,
  };
}

export function verificationNetwork() {
  return `<figure class="publication-network" aria-label="Publication process illustration">
    <div class="publication-network-heading"><span>WELDPOINT / PUBLICATION</span><h3></h3></div>
    <svg viewBox="0 0 560 380" aria-hidden="true" focusable="false"></svg>
    <figcaption><span class="publication-network-state"></span><p class="publication-network-caption"></p></figcaption>
  </figure>`;
}
