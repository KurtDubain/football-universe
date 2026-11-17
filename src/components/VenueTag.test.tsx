// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VenueTag } from './VenueTag';
import { venueLabel } from './venue-label';

describe('venueLabel', () => {
  it('says nothing about a club ground', () => {
    expect(venueLabel(false)).toBeNull();
    expect(venueLabel(undefined)).toBeNull();
  });

  it('names a neutral venue', () => {
    expect(venueLabel(true)).toBe('中立场');
  });

  it('only credits the host to the club that is hosting', () => {
    expect(venueLabel(true, 't-host', 't-host')).toBe('东道主 · 中立场');
    expect(venueLabel(true, 't-host', 't-other')).toBe('中立场');
  });

  it('does not credit a host when the tag is not beside a club', () => {
    expect(venueLabel(true, 't-host')).toBe('中立场');
  });
});

describe('VenueTag', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  it('renders nothing on a club ground', () => {
    const root = createRoot(host);
    act(() => root.render(<VenueTag isNeutralVenue={false} />));
    expect(host.querySelector('[data-testid="venue-tag"]')).toBeNull();
  });

  it('falls back to the side label when the ground is not neutral', () => {
    const root = createRoot(host);
    act(() => root.render(<VenueTag isNeutralVenue={false} fallback="主队" />));
    expect(host.textContent).toBe('主队');
  });

  it('names a neutral venue in place of the side label', () => {
    const root = createRoot(host);
    act(() => root.render(<VenueTag isNeutralVenue fallback="客队" />));
    expect(host.textContent).toBe('中立场');
  });

  it('adds the stadium mark only when asked', () => {
    const root = createRoot(host);
    act(() => root.render(<VenueTag isNeutralVenue icon />));
    expect(host.querySelector('svg')).not.toBeNull();
    act(() => root.render(<VenueTag isNeutralVenue />));
    expect(host.querySelector('svg')).toBeNull();
  });
});
