// Parse text only. Searching a catalogue and saving a library come later.
export function parseTitleList(text) {
  const entries = [];
  const lines = text.split(/\r\n|\n|\r/);

  for (const originalLine of lines) {
    const line = originalLine.trim();
    if (line === '') continue;

    // Recognise a checkbox at the beginning, with an optional list bullet.
    const checkbox = line.match(/^(?:[-*•]\s+)?\[([ xX])\]\s*(.*)$/);
    let title;
    let status = null; // No checkbox means the user still needs to choose.

    if (checkbox) {
      title = checkbox[2].trim();
      status = checkbox[1].toLowerCase() === 'x' ? 'watched' : 'plan_to_watch';
    } else {
      title = line.replace(/^[-*•]\s+/, '').trim();
    }

    if (title === '') continue;
    entries.push({ originalLine, title, status });
  }

  return entries;
}
