import { expect, test } from 'vitest';
import * as engine from '../../src/engine/index';

test('smoke: engine entry point loads', () => {
  expect(engine).toBeDefined();
});
