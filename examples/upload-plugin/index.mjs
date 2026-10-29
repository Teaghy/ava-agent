export default {
  name: 'uploaded-decision-example',
  provide: ['decision'],
  apply(ctx, config = {}) {
    ctx.provide('decision', {
      async decide() {
        return { type: 'ask_user', question: config.question || '上传插件已生效，请提供订单号。' };
      },
    });
  },
};
