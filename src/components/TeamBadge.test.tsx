import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import TeamBadge from './TeamBadge';

function framePath(teamId: string): string {
  const markup = renderToStaticMarkup(
    <TeamBadge teamId={teamId} shortName={teamId.slice(0, 2)} color="#247f50" />,
  );
  return markup.match(/<path d="([^"]+)" fill="rgb/)?.[1] ?? markup.match(/<path d="([^"]+)" fill="#/)?.[1] ?? '';
}

describe('TeamBadge', () => {
  it('keeps the same club on a stable frame while varying the league identity set', () => {
    expect(framePath('guangzhou')).toBe(framePath('guangzhou'));
    const frames = new Set(Array.from({ length: 24 }, (_, index) => framePath(`club-${index}`)));
    expect(frames.size).toBeGreaterThanOrEqual(5);
  });

  it('renders an accessible full crest with a visible abbreviation', () => {
    const markup = renderToStaticMarkup(
      <TeamBadge teamId="guangzhou" shortName="恒大" color="#d71920" title="广州恒大队徽" />,
    );
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="广州恒大队徽"');
    expect(markup).toContain('>恒大</text>');
  });
});
