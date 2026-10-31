// Unknown totals remain unknown: only provider-reported pages are numbered.
export function pageBounds(page, total) {
  total = Number.isInteger(total) && total > 0 ? Math.min(500, total) : null;
  page = Number.isInteger(page) ? Math.max(1, Math.min(total ?? 500, page)) : 1;
  return { page, total, previous: page > 1 ? page - 1 : null, next: total !== null && page < total ? page + 1 : null };
}
export function pageWindow(page, total) {
  ({ page, total } = pageBounds(page, total));
  if (total === null) return [page];
  const start = Math.max(1, Math.min(page - 2, total - 4));
  const end = Math.min(total, start + 4);
  const numbers = Array.from({ length: end - start + 1 }, (_, index) => start + index);
  if (start > 1) numbers.unshift(...(start === 2 ? [1] : [1, 'ellipsis']));
  if (end < total) numbers.push(...(end === total - 1 ? [total] : ['ellipsis', total]));
  return numbers;
}
