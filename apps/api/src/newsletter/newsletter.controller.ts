import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { NewsletterService } from './newsletter.service';
import { SubscribeNewsletterDto } from './dto/subscribe.dto';
import { ListNewsletterSubscribersDto } from './dto/list-subscribers.dto';
import { Public } from '../auth/decorators/public.decorator';
import { SkipCsrf } from '../auth/decorators/skip-csrf.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('newsletter')
export class NewsletterController {
  constructor(private readonly newsletter: NewsletterService) {}

  @Public()
  @SkipCsrf()
  @Post('subscribe')
  @HttpCode(200)
  subscribe(@Body() dto: SubscribeNewsletterDto) {
    return this.newsletter.subscribe(dto.email);
  }
}

@Controller('admin/newsletter')
export class NewsletterAdminController {
  constructor(private readonly newsletter: NewsletterService) {}

  @Roles('ADMIN', 'ORGANIZER')
  @Get('subscribers')
  list(@Query() dto: ListNewsletterSubscribersDto) {
    return this.newsletter.listSubscribers(
      dto.limit ?? 50,
      dto.offset ?? 0,
      dto.q,
    );
  }
}
