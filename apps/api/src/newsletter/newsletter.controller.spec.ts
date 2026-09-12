import { NewsletterController } from './newsletter.controller';
import type { NewsletterService } from './newsletter.service';

describe('NewsletterController', () => {
  it('subscribes through the public handler', async () => {
    const newsletter = {
      subscribe: jest.fn().mockResolvedValue({
        ok: true,
        alreadySubscribed: false,
        emailSent: true,
      }),
    } as unknown as NewsletterService;
    const controller = new NewsletterController(newsletter);
    const res = await controller.subscribe({ email: 'guest@example.com' });
    expect(newsletter.subscribe).toHaveBeenCalledWith('guest@example.com');
    expect(res.ok).toBe(true);
  });
});
