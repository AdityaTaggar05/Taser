# WeldPoint UI polish

The existing editorial identity remains: warm paper, graphite, serif headings, teal actions and vermilion accents. The supplied `public/brand/weldpoint-logo.svg` is authoritative; game environment packs cannot replace it.

## Composition and shared controls

- Welcome: one sign-in action beneath the two-timeline convergence illustration.
- Home: Play and Create flank the central illustration on desktop; the illustration sits above the paired actions on phones. Invite entry and secondary navigation form one quieter row.
- Setup: three groups for players, collection and role on desktop, compact aligned rows on phones. Existing character sprites illustrate the two operators and role controls.
- Archive: searchable records remain the main content, with launch options beside them on desktop and within the same viewport on phones. Mobile rows show the creator beneath the title. Missing rankings are reported once rather than repeated on every row.
- Controls share action sizing, drawn SVG icons, focus treatment and selected-state colours. Locally bundled Libre Baskerville and Roboto Mono retain their upstream OFL licenses.

Development sign-in offers Atlas/Nova directly. Manual credentials remain available in a native disclosure. Production wallet sign-in and the existing authentication checks are unchanged.

## Design and validation evidence

Impeccable informed consistency, content reduction and the bounded desktop/mobile verification. 12ui produced four root proposals; candidate D was selected, converted, and expanded into five app states. The generated prototype completed its runtime checks. Existing application routes, accounts, level data, archive states and certifications remain authoritative; generated sample levels, durations, persistent error messages and extra marketing copy were not introduced.

The implementation carries the generated paper and timeline illustration assets. The supplied SVG replaces the generated logo. Two extracted illustrations contained stray text or damaged cutouts; the entry illustration and existing operator sprites replace those artefacts. These are intentional departures from the generated targets, alongside the requested shorter copy and responsive layouts.

12ui's URL-capture adapter rejected its managed browser on this host despite a successful prototype runtime check. Final target kits for welcome and home instead used CUA screenshots and the unchanged source LayerDocs. These are unanchored plans, not an automated fidelity score. Manual comparison and browser checks confirmed the composition and actual interactions.

Checks cover sign-in, development account entry, setup role selection, archive search and level selection, visible mobile Play controls, shared logo loading, existing sprite reuse, and absence of horizontal/window overflow on the checked 1280×720 and 390×844 entry/archive layouts. The isolated preview uses explicit mock data and performs no wallet signing, CRE execution or Arkiv writes. Build, formatting and the 214-test suite accompany the change.
