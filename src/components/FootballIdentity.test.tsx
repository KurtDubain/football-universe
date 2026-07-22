import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CompetitionMark, OutcomeMark, StoryStamp, TrophyMark } from './FootballIdentity';

describe('football identity visuals', () => {
  it('gives each competition a stable code and accessible mark', () => {
    const league = renderToStaticMarkup(<CompetitionMark type="league1" title="顶级联赛徽记" />);
    const cup = renderToStaticMarkup(<CompetitionMark type="world_cup" title="环球冠军杯徽记" />);
    expect(league).toContain('aria-label="顶级联赛徽记"');
    expect(league).toContain('>L1</text>');
    expect(cup).toContain('>WC</text>');
    expect(cup).not.toBe(league);
  });

  it('renders story stamps without emoji-only semantics', () => {
    const markup = renderToStaticMarkup(<StoryStamp kind="late-winner" />);
    expect(markup).toContain('绝杀');
    expect(markup).toContain('story-stamp');
    expect(markup).not.toContain('🔥');
  });

  it('uses distinct honor shapes and outcome marks rather than color-only identity', () => {
    const leagueTrophy = renderToStaticMarkup(<TrophyMark type="league1" />);
    const worldTrophy = renderToStaticMarkup(<TrophyMark type="world_cup" />);
    expect(worldTrophy).not.toBe(leagueTrophy);
    expect(renderToStaticMarkup(<OutcomeMark kind="promotion" />)).not.toBe(
      renderToStaticMarkup(<OutcomeMark kind="relegation" />),
    );
  });
});
