export const PROJECT_DOCKER_IMAGE_PREFIX = 'parallel-code-project:';

export function isProjectDockerImage(image?: string): boolean {
  return Boolean(image?.startsWith(PROJECT_DOCKER_IMAGE_PREFIX));
}

export function getTaskDockerBadgeLabel(image?: string): string {
  return isProjectDockerImage(image) ? 'Docker (project)' : 'Docker';
}

export function getTaskDockerOverlayLabel(image?: string): string {
  return isProjectDockerImage(image) ? 'project dockerfile' : 'docker';
}
