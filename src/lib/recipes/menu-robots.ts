export type RobotsRule = { kind: 'allow' | 'disallow'; path: string };

export type RobotsGroup = {
  agents: string[];
  rules: RobotsRule[];
};

export function parseRobotsTxt(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) {
      current = null;
      continue;
    }
    const sep = line.indexOf(':');
    if (sep < 0) continue;
    const field = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();
    if (field === 'user-agent') {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (field !== 'allow' && field !== 'disallow') continue;
    if (!current) {
      current = { agents: ['*'], rules: [] };
      groups.push(current);
    }
    current.rules.push({ kind: field, path: value });
  }
  return groups;
}

function pathMatches(path: string, pattern: string): boolean {
  if (!pattern) return false;
  if (pattern.endsWith('$')) return path === pattern.slice(0, -1);
  if (pattern.endsWith('*')) return path.startsWith(pattern.slice(0, -1));
  return path.startsWith(pattern);
}

/**
 * Longest matching Allow/Disallow wins. An equal length Allow wins.
 * A group that names this user agent replaces the `*` group.
 * An empty Disallow does not block the path.
 */
export function robotsAllowsPath(text: string, path: string, userAgent: string): boolean {
  const groups = parseRobotsTxt(text);
  const ua = userAgent.toLowerCase();
  const specific = groups.filter((group) =>
    group.agents.some((agent) => agent !== '*' && agent.length >= 3 && ua.includes(agent)),
  );
  const chosen = specific.length > 0 ? specific : groups.filter((group) => group.agents.includes('*'));
  const rules = chosen.flatMap((group) => group.rules);
  let best: { kind: 'allow' | 'disallow'; length: number } | null = null;
  for (const rule of rules) {
    if (!pathMatches(path, rule.path)) continue;
    const length = rule.path.length;
    if (!best || length > best.length || (length === best.length && rule.kind === 'allow')) {
      best = { kind: rule.kind, length };
    }
  }
  if (!best) return true;
  return best.kind === 'allow';
}
