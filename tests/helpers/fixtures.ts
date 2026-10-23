import { loadDataset } from '../../src/data/dataset.ts';

/** Fixed "now" all fixture dates are written relative to. */
export const FIXED_NOW = new Date('2026-10-23T12:00:00Z');
export const fixedClock = () => FIXED_NOW;

export function fixtureRepository() {
  return loadDataset('fixtures/data').repository;
}
