import { describe, expect, it } from 'vitest';
import {
  chatRequestSchema,
  citationSchema,
  historyRequestSchema,
  streamEventSchema,
} from '../src/index.js';

describe('Shared API contracts', () => {
  it('validates chat input without permitting caller-supplied identity or permissions', () => {
    expect(chatRequestSchema.parse({ conversationId: 'conv-1', message: ' E102 ' }).message).toBe(
      'E102',
    );
    expect(
      chatRequestSchema.safeParse({
        conversationId: 'conv-1',
        message: 'E102',
        permissions: ['WRITE'],
      }).success,
    ).toBe(false);
    expect(historyRequestSchema.safeParse({ conversationId: '../outside' }).success).toBe(false);
    expect(
      chatRequestSchema.safeParse({ conversationId: 'conv-1', message: 'x'.repeat(2001) }).success,
    ).toBe(false);
  });
  it('keeps citations strict and checks completed SSE answers', () => {
    expect(
      citationSchema.safeParse({ documentId: 'd', chunkId: 'c', title: 'SOP', reasoning: 'hidden' })
        .success,
    ).toBe(false);
    expect(
      streamEventSchema.safeParse({
        type: 'answer.completed',
        data: { runId: 'r', answer: 'ok', citations: [], status: 'completed' },
      }).success,
    ).toBe(true);
    expect(
      streamEventSchema.safeParse({ type: 'answer.completed', data: { answer: 'incomplete' } })
        .success,
    ).toBe(false);
  });
});
