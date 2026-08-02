import { useState } from 'react';
import {
  readVisualAssetEnvironment,
  shouldSuppressDecorativeArtwork,
} from './visual-asset-policy';

interface Props {
  src: string;
  className?: string;
  eager?: boolean;
  testId?: string;
}

export function DecorativeImage({
  src,
  className = '',
  eager = false,
  testId,
}: Props) {
  const [available, setAvailable] = useState(
    () => !shouldSuppressDecorativeArtwork(readVisualAssetEnvironment()),
  );

  if (!available) return null;

  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      width={eager ? 1440 : undefined}
      height={eager ? 960 : undefined}
      loading={eager ? 'eager' : 'lazy'}
      fetchPriority={eager ? 'high' : 'auto'}
      decoding="async"
      draggable={false}
      data-testid={testId}
      className={`decorative-artwork ${className}`}
      onError={() => setAvailable(false)}
    />
  );
}
