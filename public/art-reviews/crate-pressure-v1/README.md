# Crate and pressure plate study 01

Approved and published as Modern Gray 1.1.0 and Diwali 1.1.0. Both releases passed exact Swarm readback and Arkiv pointer verification. See `publication.json` for asset URLs and proofs. The original 1.0.0 release metadata is retained in `docs/themes/history/`.

- `design-sheet.png`: nine sprites, 3 columns by 3 rows. Columns: crate, unoccupied plate, loaded interaction reference. Rows: neutral, P1 rose, P2 teal.
- `pressure-states.png`: eighteen separate plate frames, 6 columns by 3 rows. Columns: up, press1, press2, held, release1, release2. No crate is baked into these frames.
- `review-manifest.json`: original PNG dimensions/hashes, cell rectangles and measured content bounds. All 27 cells were checked for empty content and cell-edge clipping. Transparent corners are verified. Original PNG pixels and alpha are preserved.
- `index.html`: local side-by-side comparison, interactive placement/removal and 48/64/96-pixel size checks. It layers the separate crate and plate sprites, rather than using the baked interaction reference. Neutral/P1/P2 variants were visually checked in the browser with no console errors.
- `review-preview.png`: browser screenshot of the teal loaded comparison.
- `prompts.json` and `pressure-state-prompt.txt`: exact built-in ImageGen prompts. The word "approved" inside the second generation prompt identifies its visual reference only; the user later approved publication.

Design changes: deeper crate front, X reinforcement, straight sides, narrow lid seam and inset grip; low pressure bed with a wider exposed rim and a small held indicator. Both retain the approved muted modern pixel style and orthogonal camera.

Serve the repository's `public/` directory locally and open `/art-reviews/crate-pressure-v1/`. The review requires no app backend, wallet, Arkiv access or Swarm connection.
