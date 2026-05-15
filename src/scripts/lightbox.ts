export function initLightbox(): void {
  const imgs = Array.from(
    document.querySelectorAll<HTMLImageElement>('.entry-content img')
  ).filter(img => img.src && !img.closest('a'));

  if (imgs.length === 0) return;

  // Build overlay DOM
  const overlay = document.createElement('div');
  overlay.id = 'lightbox-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', '画像を拡大表示');
  overlay.innerHTML = `
    <button class="lb-close" aria-label="閉じる (Esc)">&#x2715;</button>
    <div class="lb-stage">
      <div class="lb-spinner" aria-hidden="true"></div>
      <img class="lb-img" src="" alt="" />
    </div>
    <div class="lb-caption"></div>
  `;
  document.body.appendChild(overlay);

  const lbImg     = overlay.querySelector<HTMLImageElement>('.lb-img')!;
  const lbCaption = overlay.querySelector<HTMLElement>('.lb-caption')!;
  const lbSpinner = overlay.querySelector<HTMLElement>('.lb-spinner')!;
  const lbClose   = overlay.querySelector<HTMLButtonElement>('.lb-close')!;

  let currentIndex = 0;

  function open(index: number): void {
    currentIndex = index;
    const src = imgs[index].dataset.original || imgs[index].src;
    const alt = imgs[index].alt;

    lbImg.classList.remove('lb-img--loaded');
    lbSpinner.hidden = false;
    lbImg.src = src;
    lbImg.alt = alt;
    lbCaption.textContent = alt || '';
    lbCaption.hidden = !alt;

    overlay.classList.add('lb-open');
    document.body.style.overflow = 'hidden';
    lbClose.focus();
  }

  function close(): void {
    overlay.classList.remove('lb-open');
    document.body.style.overflow = '';
    lbImg.src = '';
  }

  function prev(): void {
    open((currentIndex - 1 + imgs.length) % imgs.length);
  }

  function next(): void {
    open((currentIndex + 1) % imgs.length);
  }

  // Image loaded
  lbImg.addEventListener('load', () => {
    lbSpinner.hidden = true;
    lbImg.classList.add('lb-img--loaded');
  });

  // Register thumbnail click
  imgs.forEach((img, i) => {
    img.classList.add('lb-thumb');
    img.addEventListener('click', () => open(i));
  });

  // Show prev/next buttons only when there are multiple images
  if (imgs.length > 1) {
    const prevBtn = document.createElement('button');
    prevBtn.className = 'lb-nav lb-prev';
    prevBtn.setAttribute('aria-label', '前の画像');
    prevBtn.textContent = '‹';
    const nextBtn = document.createElement('button');
    nextBtn.className = 'lb-nav lb-next';
    nextBtn.setAttribute('aria-label', '次の画像');
    nextBtn.textContent = '›';
    overlay.appendChild(prevBtn);
    overlay.appendChild(nextBtn);
    prevBtn.addEventListener('click', (e) => { e.stopPropagation(); prev(); });
    nextBtn.addEventListener('click', (e) => { e.stopPropagation(); next(); });
  }

  // Close triggers
  lbClose.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', (e) => {
    if (!overlay.classList.contains('lb-open')) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft')  prev();
    if (e.key === 'ArrowRight') next();
  });
}
