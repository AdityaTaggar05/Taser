const records = [
  {
    category: 'move',
    title: 'Paired moves',
    icon: '⌁',
    note: 'Both committed inputs, turn and sequence. Encrypted; retained for two days.',
    detail:
      'One record per committed pair. Queued inputs are never exposed. The game reads and decrypts moves only for session participants.',
  },
  {
    category: 'run',
    title: 'Winning echoes',
    icon: '↶',
    note: 'Completed runs become replay sources for solo play. Retained for two days.',
    detail:
      'Encrypted winning runs preserve the level, both timelines, source chamber, role and play mode so another operator can follow an echo.',
  },
  {
    category: 'campaign',
    title: 'Campaign chambers',
    icon: '◇',
    note: 'Versioned campaign layouts and solutions. Encrypted publications.',
    detail:
      'Campaign entities hold chamber configuration, creator solutions and certification data. Publications start with a two-hour lifetime.',
  },
  {
    category: 'community',
    title: 'Community chambers',
    icon: '⊞',
    note: 'Published player levels, revisions and certification data. Encrypted.',
    detail:
      'Community publications start with a two-hour lifetime. A heart extends the entity lifetime by one hour; it does not create another chamber.',
  },
  {
    category: 'draft',
    title: 'Creator drafts',
    icon: '✎',
    note: 'Private, versioned level saves. Encrypted; maximum supported lifetime.',
    detail:
      'Each archived revision preserves the author’s level configuration and solutions. Drafts stay behind the creator’s authenticated access.',
  },
  {
    category: 'theme',
    title: 'Worlds & artwork',
    icon: '✦',
    note: 'Public theme versions, Swarm pointers and integrity hashes.',
    detail:
      'Arkiv stores the release pointer and hashes; Swarm serves the artwork bytes. The client resolves the theme entity and checks the pinned release.',
  },
] as const;

/** Home-only documentation. Examples read Arkiv directly; they never execute in the game. */
export class ArchiveGuide {
  readonly root = document.createElement('section');

  constructor() {
    this.root.className = 'arkiv-guide';
    this.root.setAttribute('aria-label', 'What Arkiv stores and how to query it');
    this.root.innerHTML = `
      <div class="arkiv-guide-heading"><span class="arkiv-eyebrow">01 / WHAT THE GAME LEAVES BEHIND</span><h3>Six kinds of memory.</h3><p>Select a record to see what it holds and how to read it on chain.</p></div>
      <div class="arkiv-memory-grid"></div>
      <details class="arkiv-chain-query">
        <summary>02 / Read directly from Arkiv <span aria-hidden="true">↗</span></summary>
        <div class="arkiv-query-body">
          <h4></h4><p class="arkiv-query-description"></p>
          <div class="arkiv-code-heading"><span>READ-ONLY · TYPESCRIPT SDK</span><button type="button" class="arkiv-copy">Copy query</button></div>
          <pre tabindex="0" aria-label="Direct Arkiv query example"><code></code></pre>
          <p class="arkiv-query-hint">Use the app publisher from an entity’s creator field and its indexed namespace (default: <code>weldpoint</code>). The publisher is the server signer, not your player wallet.</p>
          <details class="arkiv-query-setup"><summary>Client & schema setup</summary><pre tabindex="0" aria-label="Arkiv client and schema setup"><code></code></pre></details>
          <p class="arkiv-query-hint">Queries return unexpired entities and public attributes. Level and move contents stay encrypted; their decryption key stays on the server. Filter by <code>record_id</code> and <code>revision</code> to narrow a level record; theme records use <code>theme_id</code> and <code>version</code>.</p>
          <a href="https://docs.arkiv.network/querying/filter/" target="_blank" rel="noopener noreferrer">Arkiv query documentation ↗</a>
        </div>
      </details>
      <div class="arkiv-proof-note"><span aria-hidden="true">◈</span><p><strong>A transaction is the write. An entity is the record.</strong>Open either from a verified receipt below. Hearts extend publication lifetimes; expired entities leave the query results.</p></div>`;
    const grid = this.root.querySelector('.arkiv-memory-grid')!;
    const details = this.root.querySelector<HTMLDetailsElement>('.arkiv-chain-query')!;
    const code = this.root.querySelector<HTMLElement>('.arkiv-chain-query pre code')!;
    const copy = this.root.querySelector<HTMLButtonElement>('.arkiv-copy')!;
    const select = (record: (typeof records)[number], open = true) => {
      grid
        .querySelectorAll('button')
        .forEach((button) =>
          button.setAttribute('aria-pressed', String(button.dataset.category === record.category)),
        );
      this.root.querySelector('h4')!.textContent = record.title;
      this.root.querySelector('.arkiv-query-description')!.textContent = record.detail;
      const theme = record.category === 'theme';
      code.textContent = `// After the client & schema setup below\nconst { entities } = await client\n  .select('*')\n  .from(${theme ? 'ThemeEntities' : 'LevelEntities'})\n  .createdBy(publisher)\n  .where(${theme ? "eq('namespace', namespace)" : `and(\n    eq('namespace', namespace),\n    eq('category', '${record.category}')\n  )`})\n  .limit(20)\n  .fetch();\n\n// ${theme ? 'Public release pointer and integrity hash' : 'Public metadata; ciphertext stays encrypted'}\nfor (const row of entities) {\n  console.log(row.$key,\n    ${theme ? 'row.swarm_reference.value' : 'row.category.value'},\n    row.$expiresAt);\n}`;
      this.root.querySelector<HTMLElement>('.arkiv-query-setup code')!.textContent =
        `import { createPublicClient } from '@arkiv-network/sdk';\nimport { rabdi } from '@arkiv-network/sdk/chains';\nimport { and, eq } from '@arkiv-network/sdk/query';\nimport { defineSchema, str, u64, bytes }\n  from '@arkiv-network/sdk/schema';\nimport { http, type Address } from 'viem';\n\n// Run locally. Supply your own RPC access key.\nconst client = createPublicClient({\n  chain: rabdi({ accessKey: process.env.ARKIV_ACCESS_KEY! }),\n  transport: http(),\n});\n// Replace with the app entity's creator and namespace.\nconst publisher = process.env.ARKIV_PUBLISHER as Address;\nconst namespace = process.env.ARKIV_NAMESPACE ?? 'weldpoint';\n\n${theme ? `const ThemeEntities = defineSchema('taser_themes_v1', {\n  namespace: str().indexed(),\n  theme_id: str().indexed(),\n  version: str().indexed(),\n  swarm_reference: str(),\n  manifest_sha256: str(),\n  release_sha256: str(),\n  content_type: str(),\n  payload: bytes(),\n});` : `const LevelEntities = defineSchema('weldpoint_levels_v1', {\n  namespace: str().indexed(),\n  record_id: str().indexed(),\n  revision: u64().indexed(),\n  category: str().indexed(),\n  content_type: str(),\n  ciphertext: bytes(),\n});`}`;
      copy.textContent = 'Copy query';
      if (open) details.open = true;
    };
    for (const [index, record] of records.entries()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.category = record.category;
      button.setAttribute('aria-controls', 'arkiv-query-body');
      button.innerHTML = `<span class="arkiv-memory-number">0${index + 1} <i aria-hidden="true">${record.icon}</i></span><strong>${record.title}</strong><span class="arkiv-memory-note">${record.note}</span><span class="arkiv-memory-read">View chain query <span aria-hidden="true">↗</span></span>`;
      button.addEventListener('click', () => select(record));
      grid.append(button);
    }
    this.root.querySelector('.arkiv-query-body')!.id = 'arkiv-query-body';
    select(records[0], false);
    copy.addEventListener('click', async () => {
      const setup = this.root.querySelector('.arkiv-query-setup code')!.textContent;
      try {
        await navigator.clipboard.writeText(`${setup}\n\n${code.textContent}`);
        copy.textContent = 'Copied ✓';
      } catch {
        copy.textContent = 'Select the code to copy';
      }
    });
  }
}
