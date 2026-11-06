/** Decorative topology only. No endpoints, identities or live node telemetry. */
export function verificationNetwork() {
  const nodes = [
    [112, 96],
    [280, 56],
    [448, 96],
    [448, 284],
    [280, 324],
    [112, 284],
  ];
  const edges = nodes.flatMap(([x, y], i) => {
    const [nextX, nextY] = nodes[(i + 1) % nodes.length];
    return [`M${x} ${y}L280 190`, `M${x} ${y}L${nextX} ${nextY}`];
  });
  return /* HTML */ `
    <figure class="publication-network" aria-label="Oracle network illustration">
      <div class="publication-network-heading">
        <span>CHAINLINK / CRE</span>
        <h3>Verification network</h3>
      </div>
      <svg viewBox="0 0 560 380" aria-hidden="true" focusable="false">
        <circle class="network-orbit" cx="280" cy="190" r="158" />
        <circle class="network-orbit network-orbit-inner" cx="280" cy="190" r="100" />
        <g class="network-edges">${edges.map((d) => `<path d="${d}" />`).join('')}</g>
        <g class="network-signals">
          ${edges.map((d, i) => `<path d="${d}" pathLength="100" style="--signal-delay: ${-i * 0.37}s; --signal-direction: ${i % 3 === 0 ? 'reverse' : 'normal'}" />`).join('')}
        </g>
        ${nodes
          .map(
            ([x, y], i) => `
          <g class="network-node" style="--node-delay: ${-i * 0.43}s">
            <circle class="network-node-halo" cx="${x}" cy="${y}" r="29" />
            <circle class="network-node-body" cx="${x}" cy="${y}" r="19" />
            <circle class="network-node-core" cx="${x}" cy="${y}" r="5" />
          </g>`,
          )
          .join('')}
        <rect class="network-hub-outline" x="240" y="150" width="80" height="80" rx="19" />
        <rect class="network-hub" x="248" y="158" width="64" height="64" rx="14" />
        <text class="network-hub-label" x="280" y="195" text-anchor="middle">CRE</text>
      </svg>
      <figcaption>
        <span class="publication-network-state">Preparing the submission</span>
        <p class="publication-network-caption">Network illustration · awaiting verifier</p>
      </figcaption>
    </figure>
  `;
}
