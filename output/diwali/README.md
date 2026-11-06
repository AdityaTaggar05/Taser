# Diwali art selection

Generated with the built-in image_gen tool, using Modern Gray as the edit target and the approved Diwali directional model as costume reference. Original image bytes and alpha channels are preserved.

Final runtime assets: `public/themes/diwali/sheets/`. The pack retains the original 556 semantic frames and 74 animations. All 384 player animation cells were checked for nonempty content and clipped cell edges; all passed. Exit and UI atlas frames use measured alpha bounds with two-pixel padding.

Selected variants: `p2-idle-v5`, `p2-walk-v5`, and `directional-model-v3`; the other selected sheets use their unversioned action IDs. The two P2 v5 sheets replace rejected backgrounds/poses from prior drafts. The green character has two facial eyes, a dark navy kurta with gold trim, and no chest identity bars or Roman numerals.

`prompts.json` records the built-in generation/edit prompts and refinement history. Exit brief: preserve all 18 neutral/P1/P2 gate states and the approved hard-edged pixel style; add tiny warm fairy lights along the lintel and posts plus restrained marigold toran, with no labels and a transparent background. Directional-model brief: preserve the four orthogonal facings and original helmets; dress both operators in kurtas with gold trim and ivory pajama trousers, P1 burgundy and P2 navy; remove P2 chest bars, preserving the two facial eyes.

Generation drafts remain in the ignored `generated/` directory for local reference. They are not part of the runtime pack or the Swarm allowlist. The base Modern Gray pack is unchanged.
