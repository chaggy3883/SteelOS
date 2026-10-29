// Active-nav resolution, kept free of React/router imports so it can be
// unit-checked from a plain node script.
//
// Rules:
// - '/' (Home) is active only on exactly '/'.
// - A plain item matches its own path and any sub-path ('/projects' matches
//   '/projects/123', but not '/projects-archive'; '/intelligence' does not
//   match '/intelligence-signals').
// - An item with a query ('/admin?tab=crm') matches only on that exact path
//   AND when every param in its query has the same value in the URL. A
//   matching query item always beats the bare page item.
// - Among all matches the longest path wins, so '/projects/change-orders'
//   resolves to Change Orders rather than Projects. Exact ties keep the first
//   item in nav order.

const QUERY_MATCH_BONUS = 10000;

export function navMatchScore(item, pathname, search = '') {
  const path = item.path;
  if (item.query) {
    if (pathname !== path && pathname !== `${path}/`) return -1;
    const wanted = new URLSearchParams(item.query);
    const actual = new URLSearchParams(search || '');
    for (const [key, value] of wanted.entries()) {
      if (actual.get(key) !== value) return -1;
    }
    return path.length + QUERY_MATCH_BONUS;
  }
  if (path === '/') return pathname === '/' ? 1 : -1;
  if (pathname === path || pathname.startsWith(`${path}/`)) return path.length;
  return -1;
}

// entries: [{ key, item }] in nav order. Returns the winning key, or null.
export function resolveActiveKey(entries, pathname, search = '') {
  let bestKey = null;
  let bestScore = -1;
  for (const { key, item } of entries) {
    const score = navMatchScore(item, pathname, search);
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }
  return bestKey;
}
