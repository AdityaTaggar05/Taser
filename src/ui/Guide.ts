const lessons = [
  [
    'Opposite ends. One timeline.',
    'Forward and reverse operators start at opposite ends of time. Each sees their own chamber. In solo, a recorded partner plays alongside you.',
    '→',
    '←',
  ],
  [
    'Two inputs make a turn.',
    'Move or wait. A turn commits when both operators have chosen. Push a stationary box without stepping into its tile.',
    '◇ →',
    '□ →',
  ],
  [
    'Meet at the midpoint.',
    'Matching boxes must have the same identity and position at halfway. Follow any chamber-specific target or switch requirements.',
    '□ →',
    '← □',
  ],
  [
    'History takes over.',
    'After halfway, boxes replay your partner’s earlier positions in reverse, including pauses. You can no longer push them manually.',
    '□ ←',
    '· ←',
  ],
  [
    'Find your way home.',
    'Use boxes on switches, keep clear of lasers and moving boxes, and reach both open exits on the final turn. Undo or retry to experiment.',
    '◇ →',
    '▥',
  ],
];
export class Guide {
  readonly root = document.createElement('dialog');
  private step = 0;
  constructor() {
    this.root.className = 'field-guide paper-dialog';
    this.root.setAttribute('aria-labelledby', 'field-guide-title');
    document.body.append(this.root);
    this.root.addEventListener('keydown', (e) => e.stopPropagation());
    this.render();
  }
  show() {
    this.step = 0;
    this.render();
    this.root.showModal();
  }
  private render() {
    const [title, copy, left, right] = lessons[this.step];
    this.root.innerHTML = `<button class="dialog-close" aria-label="Close guide">×</button>
      <p class="folio">FIELD GUIDE / ${String(this.step + 1).padStart(2, '0')}</p>
      <div class="guide-animation lesson-${this.step}" aria-hidden="true"><span>${left}</span><i>⌁</i><span>${right}</span></div>
      <h2 id="field-guide-title">${title}</h2><p>${copy}</p>
      <div class="guide-pagination"><button data-guide="prev" ${this.step === 0 ? 'disabled' : ''} aria-label="Previous rule">←</button>
      <nav aria-label="Guide pages">${lessons.map((_, i) => `<button data-page="${i}" aria-label="Rule ${i + 1}" aria-current="${i === this.step}">${i === this.step ? '●' : '○'}</button>`).join('')}</nav>
      <button data-guide="next">${this.step === lessons.length - 1 ? 'Got it ✓' : 'Next →'}</button></div>
      <p class="guide-shortcuts">ARROWS / WASD · MOVE &nbsp; SPACE · WAIT &nbsp; Z · UNDO</p>`;
    this.root.querySelector('.dialog-close')!.addEventListener('click', () => this.root.close());
    this.root.querySelector('[data-guide=prev]')!.addEventListener('click', () => {
      this.step--;
      this.render();
    });
    this.root.querySelector('[data-guide=next]')!.addEventListener('click', () => {
      if (this.step === lessons.length - 1) this.root.close();
      else {
        this.step++;
        this.render();
      }
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-page]').forEach(
      (b) =>
        (b.onclick = () => {
          this.step = Number(b.dataset.page);
          this.render();
        }),
    );
  }
  destroy() {
    this.root.remove();
  }
}
