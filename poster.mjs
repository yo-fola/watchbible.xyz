// Display only a supplied image path. This does not search or guess a cover.
export function createPoster({ title, posterUrl = null }, { loading = 'lazy' } = {}) {
  const frame = document.createElement('div');
  frame.className = 'poster-frame';
  const showFallback = () => {
    const fallback = document.createElement('div');
    fallback.className = 'poster-fallback';
    const mark = document.createElement('span');
    mark.className = 'poster-outline';
    mark.setAttribute('aria-hidden', 'true');
    const message = document.createElement('span');
    message.textContent = 'Cover unavailable';
    fallback.append(mark, message);
    frame.replaceChildren(fallback);
  };
  showFallback();
  if (posterUrl) {
    const url = new URL(posterUrl, location.href);
    // Local test assets and the proposed poster provider, never arbitrary hosts.
    if (url.origin !== location.origin && !(url.protocol === 'https:' && url.hostname === 'image.tmdb.org')) return frame;
    const image = document.createElement('img');
    image.alt = `Cover for ${title}`;
    image.decoding = 'async';
    image.loading = loading;
    image.addEventListener('error', showFallback, { once: true });
    image.src = url.href;
    frame.replaceChildren(image);
  }
  return frame;
}
