// Visual-structure checks for the minimal interface. Run on a fresh homepage.
export function checkMinimalUI() {
  const checks = [];
  const check = (name, ok) => { if (!ok) throw new Error(name); checks.push(name); };
  check('dark graphite theme is applied', getComputedStyle(document.body).backgroundColor === 'rgb(18, 19, 21)');
  check('heading is a concise Library label', document.querySelector('h1').textContent.trim() === 'Library');
  check('brand uses the chosen name without a tagline', document.querySelector('.brand').textContent.trim() === 'watchbible');
  check('navigation has no numbered labels', !document.querySelector('.nav-label') && !document.querySelector('.brand-caption'));
  check('icon-only layout controls have accessible names', ['grid', 'list'].every(view => {
    const button = document.querySelector(`#view-${view}`);
    return button.querySelector('svg') && button.getAttribute('aria-label') && button.getAttribute('title');
  }));
  check('temporary storage warning remains visible', document.querySelector('.session-notice').textContent.includes('Session only'));
  check('no duplicate status dropdown is shown', document.querySelector('#status-filter').type === 'hidden');
  check('page fits the viewport', document.documentElement.scrollWidth <= innerWidth);
  return { passed: checks.length, checks, visibleWords: document.body.innerText.trim().split(/\s+/).length };
}
