import { describe, expect, it } from 'vitest';
import { getTaskDockerBadgeLabel, getTaskDockerOverlayLabel } from './docker';

describe('docker display labels', () => {
  it('renders project labels from explicit docker source metadata', () => {
    expect(getTaskDockerBadgeLabel('project')).toBe('Docker (project)');
    expect(getTaskDockerOverlayLabel('project')).toBe('project dockerfile');
  });

  it('keeps generic labels for default and custom sources', () => {
    expect(getTaskDockerBadgeLabel('default')).toBe('Docker');
    expect(getTaskDockerBadgeLabel('custom')).toBe('Docker');
    expect(getTaskDockerOverlayLabel('default')).toBe('docker');
    expect(getTaskDockerOverlayLabel('custom')).toBe('docker');
  });
});
