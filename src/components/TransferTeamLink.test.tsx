import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { FREE_MARKET_TEAM_ID } from '../engine/transfers/transfer-application';
import TransferTeamLink from './TransferTeamLink';

describe('TransferTeamLink', () => {
  it('renders the free market as a non-interactive endpoint', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <TransferTeamLink teamId={FREE_MARKET_TEAM_ID} teamName="自由球员市场" />
      </MemoryRouter>,
    );

    expect(html).toContain('自由市场');
    expect(html).toContain('data-testid="free-market-endpoint"');
    expect(html).not.toContain('href=');
  });

  it('keeps real teams navigable', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <TransferTeamLink teamId="alpha" teamName="阿尔法队" shortName="阿尔法" />
      </MemoryRouter>,
    );

    expect(html).toContain('href="/team/alpha"');
    expect(html).toContain('阿尔法');
  });
});
