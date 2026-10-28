import { AppError, checkAbort, type Principal } from '@ava/harness/plugin';
import type { RetailServices } from './retail.js';

export const demoPrincipal: Principal = {
  tenantId: 'shop',
  userId: 'alice',
  permissions: ['READ'],
};
/** Fictional fixtures only. Replace these adapters with your own services. */
export const demoRetailServices: RetailServices = {
  async lookupOrder(id, _principal, signal) {
    checkAbort(signal);
    // Deliberately return the owner fields; the tool must validate them itself.
    return id === 'A100' ? { id, tenantId: 'shop', userId: 'alice', status: '已发货' } : undefined;
  },
  async searchKnowledge(request) {
    checkAbort(request.signal);
    if (request.tenantId !== 'shop') return [];
    return [
      {
        id: 'retail:shipping:1',
        documentId: 'retail:shipping',
        tenantId: 'shop',
        title: '配送说明',
        content: '演示政策：付款后两个工作日内发货。',
        source: 'https://example.com/shipping',
        metadata: { category: 'shipping' },
        score: 1,
      },
    ];
  },
  async reviewAnswer(answer, _citations, _state, signal) {
    checkAbort(signal);
    if (answer.includes('保证退款'))
      throw new AppError('REVIEW_REQUIRED', '退款承诺需要授权人员审核。', 422);
  },
};
