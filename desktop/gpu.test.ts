import { expect, it } from 'vitest';
import { adviseAi, parseGpus } from './gpu';

it('reads the card with the most graphics memory from nvidia-smi', () => {
  expect(parseGpus('NVIDIA GeForce RTX 3070, 8192\r\n')).toEqual({
    name: 'NVIDIA GeForce RTX 3070',
    memoryGb: 8,
  });
  expect(parseGpus('NVIDIA GeForce GTX 1650, 4096\nNVIDIA GeForce RTX 4080, 16376\n')).toEqual({
    name: 'NVIDIA GeForce RTX 4080',
    memoryGb: 16,
  });
  // Names with commas keep everything before the last one.
  expect(parseGpus('Quadro, Special Edition, 12288')?.name).toBe('Quadro, Special Edition');
});

it('finds no card in empty, broken or unreadable output', () => {
  expect(parseGpus('')).toBeNull();
  expect(parseGpus('NVIDIA-SMI has failed because it could not communicate')).toBeNull();
  expect(parseGpus('NVIDIA GeForce RTX 3070, [N/A]')).toBeNull();
  expect(parseGpus(', 8192')).toBeNull();
});

it('suggests AI only from 6 GB, and the larger model from 10 GB', () => {
  expect(adviseAi(null).model).toBeNull();
  expect(adviseAi({ name: 'GTX 1650', memoryGb: 4 }).model).toBeNull();
  expect(adviseAi({ name: 'RTX 2060', memoryGb: 6 }).model).toBe('qwen3.5:4b');
  expect(adviseAi({ name: 'RTX 3080', memoryGb: 10 }).model).toBe('qwen3.5:9b');
  expect(adviseAi({ name: 'RTX 3070', memoryGb: 8 })).toEqual({
    gpu: { name: 'RTX 3070', memoryGb: 8 },
    model: 'qwen3.5:4b',
  });
});
