import type { StoredLevel } from './types';
import { publicationProgress, type PublicationStage } from './publicationProgress';
import { networkScene, verificationNetwork } from './verificationNetwork';
import './publication.css';

/** Modal publication feedback, independent of the grid and its rendering loop. */
export class PublicationOverlay {
  private dialog = document.createElement('dialog');
  private stage: PublicationStage = 'saving';
  private stored?: StoredLevel;
  private error?: string;
  private recoverable = false;
  private freezeTimer?: number;

  constructor(
    parent: HTMLElement,
    private actions: { refresh: () => void; published: () => void },
  ) {
    this.dialog.className = 'publication-overlay';
    this.dialog.setAttribute('aria-labelledby', 'publication-title');
    this.dialog.setAttribute('aria-describedby', 'publication-status');
    this.dialog.innerHTML = /* HTML */ `
      <div class="publication-content">
        <header class="publication-header">
          <span>WELDPOINT / PUBLISH</span>
          <button type="button" data-publication="close" aria-label="Close publication progress">
            ×
          </button>
        </header>
        <section class="publication-workflow" aria-label="Publication progress">
          <div class="publication-heading">
            <p class="publication-destination"></p>
            <h2 id="publication-title">Building your publication</h2>
            <p class="publication-name"></p>
          </div>
          <div class="publication-graph-stage">${verificationNetwork()}</div>
          <div class="publication-result" role="status" aria-live="polite" aria-atomic="true">
            <div class="publication-seal" aria-hidden="true">
              <svg viewBox="0 0 80 80">
                <circle cx="40" cy="40" r="35" />
                <path d="m23 40 12 12 23-25" />
              </svg>
            </div>
            <div>
              <strong class="publication-verdict"></strong>
              <p id="publication-status"></p>
            </div>
          </div>
          <footer class="publication-footer">
            <button type="button" data-publication="close">Continue in editor</button>
            <button type="button" data-publication="refresh" hidden>Refresh verification ↻</button>
            <button type="button" data-publication="published" hidden>
              View published level ↗
            </button>
          </footer>
          <ol class="publication-pipeline" aria-label="Publication workflow">
            <li>
              <span class="publication-number">01</span>
              <div>
                <strong>Save the chamber</strong>
                <small>Level + encrypted solution</small>
              </div>
              <span class="publication-block-state"></span>
            </li>
            <li>
              <span class="publication-number">02</span>
              <div>
                <strong>Freeze the submission</strong>
                <small>Pin this design and its solution</small>
              </div>
              <span class="publication-block-state"></span>
            </li>
            <li>
              <span class="publication-number">03</span>
              <div>
                <strong>Verify the solution</strong>
                <small class="publication-verifier">Awaiting the configured verifier</small>
              </div>
              <span class="publication-block-state"></span>
            </li>
            <li>
              <span class="publication-number">04</span>
              <div>
                <strong>Publish on Arkiv</strong>
                <small>Make the chamber available to play</small>
              </div>
              <span class="publication-block-state"></span>
            </li>
          </ol>
        </section>
      </div>
    `;
    this.dialog.addEventListener('click', (event) => {
      const action = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-publication]')
        ?.dataset.publication;
      if (action === 'close') this.hide();
      if (action === 'refresh') this.actions.refresh();
      if (action === 'published') {
        this.hide();
        this.actions.published();
      }
    });
    this.dialog.addEventListener('cancel', () => this.clearFreeze());
    parent.append(this.dialog);
  }

  start(name: string, target: 'community' | 'campaign', stored?: StoredLevel) {
    this.hide();
    this.stage = 'saving';
    this.stored = stored;
    this.error = undefined;
    this.recoverable = !!stored;
    this.el('.publication-name').textContent = name;
    this.el('.publication-destination').textContent = `${target} chamber`;
    this.dialog.querySelectorAll<HTMLElement>('.publication-pipeline li').forEach((block) => {
      delete block.dataset.entered;
    });
    this.render();
    this.dialog.showModal();
  }

  submitting() {
    this.stage = 'submitting';
    this.recoverable = true;
    this.clearFreeze();
    // Presentation dwell only: the request and verification continue immediately.
    this.freezeTimer = window.setTimeout(() => {
      this.freezeTimer = undefined;
      this.render();
    }, 2500);
    this.render();
  }

  update(stored: StoredLevel) {
    this.stored = stored;
    if (stored.certification?.status === 'rejected') this.clearFreeze();
    this.recoverable = true;
    this.error = undefined;
    this.render();
  }

  fail(message: string) {
    this.clearFreeze();
    this.error = message;
    this.render();
  }

  hide() {
    this.clearFreeze();
    if (this.dialog.open) this.dialog.close();
  }

  destroy() {
    this.clearFreeze();
    this.dialog.remove();
  }

  private clearFreeze() {
    if (this.freezeTimer !== undefined) window.clearTimeout(this.freezeTimer);
    this.freezeTimer = undefined;
  }

  private el<T extends HTMLElement = HTMLElement>(selector: string) {
    return this.dialog.querySelector<T>(selector)!;
  }

  private render() {
    const progress = publicationProgress(
      this.stage,
      this.freezeTimer === undefined ? this.stored : undefined,
      this.error,
    );
    this.dialog.dataset.verified = String(progress.verified);
    this.dialog.dataset.published = String(progress.published);
    this.dialog.dataset.issue = String(progress.rejected || !!this.error);
    this.el('#publication-title').textContent = progress.title;
    this.el('#publication-status').textContent = progress.message;
    this.el('.publication-verdict').textContent =
      progress.label || (progress.rejected ? 'VERIFICATION REJECTED' : 'PUBLICATION IN PROGRESS');
    const mode = this.stored?.certification?.mode;
    const phase = progress.networkPhase;
    if (this.dialog.dataset.network !== phase) {
      this.dialog.dataset.network = phase;
      const scene = networkScene(phase);
      const host = this.el('.publication-graph-stage');
      host.querySelectorAll('.network-leaving').forEach((node) => node.remove());
      const previous = host.querySelector<HTMLElement>('.publication-network');
      const template = document.createElement('template');
      template.innerHTML = verificationNetwork();
      const next = template.content.firstElementChild as HTMLElement;
      next.dataset.phase = phase;
      next.querySelector('h3')!.textContent = scene.title;
      next.querySelector('.publication-network-state')!.textContent = scene.state;
      // Only fixed local diagram data enters SVG; polling the same phase preserves motion.
      next.querySelector('svg')!.innerHTML = scene.svg;
      if (previous) {
        if (this.dialog.open && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          previous.classList.remove('network-entering');
          previous.classList.add('network-leaving');
          previous.setAttribute('aria-hidden', 'true');
          previous.addEventListener('animationend', (event) => {
            if (event.target === previous) previous.remove();
          });
          next.classList.add('network-entering');
        } else previous.remove();
      }
      host.append(next);
    }
    this.el('.publication-network:not(.network-leaving) .publication-network-caption').textContent =
      mode === 'cli-simulation'
        ? 'Network illustration · local CRE CLI simulation'
        : mode === 'simulation'
          ? 'Network illustration · CRE simulation with Sepolia'
          : mode === 'don'
            ? 'Network illustration · DON verification mode'
            : mode === 'test'
              ? 'Network illustration · isolated test verifier'
              : 'Network illustration · awaiting verifier';
    this.el('.publication-verifier').textContent =
      mode === 'cli-simulation'
        ? 'CRE CLI · replay the submitted solution'
        : mode === 'simulation'
          ? 'CRE simulation · Sepolia certificate'
          : mode === 'don'
            ? 'Chainlink DON · verify the submitted solution'
            : mode === 'test'
              ? 'Isolated test verifier'
              : mode === 'unconfigured'
                ? 'Waiting for verifier setup'
                : 'Awaiting the configured verifier';
    this.dialog.querySelectorAll<HTMLElement>('.publication-pipeline li').forEach((block, i) => {
      const state = progress.blocks[i];
      block.dataset.state = state;
      if (state !== 'waiting' && !block.dataset.entered) {
        block.dataset.entered = 'true';
        if (this.dialog.open && window.matchMedia('(max-width: 760px)').matches) {
          const pipeline = this.el('.publication-pipeline');
          pipeline.scrollTo({
            left: block.offsetLeft - pipeline.offsetLeft,
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
              ? 'instant'
              : 'smooth',
          });
        }
      }
      if (state === 'active') block.setAttribute('aria-current', 'step');
      else block.removeAttribute('aria-current');
      block.querySelector('.publication-block-state')!.textContent = {
        waiting: 'Queued',
        active: 'Running',
        done: 'Done',
        error: 'Paused',
      }[state];
    });
    this.el<HTMLButtonElement>('[data-publication="refresh"]').hidden =
      (!this.stored?.certification && !(this.error && this.recoverable)) ||
      progress.published ||
      progress.rejected;
    this.el<HTMLButtonElement>('[data-publication="published"]').hidden = !progress.published;
  }
}
