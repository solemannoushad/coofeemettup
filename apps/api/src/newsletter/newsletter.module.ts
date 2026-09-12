import { Module } from '@nestjs/common';
import {
  NewsletterAdminController,
  NewsletterController,
} from './newsletter.controller';
import { NewsletterService } from './newsletter.service';

@Module({
  controllers: [NewsletterController, NewsletterAdminController],
  providers: [NewsletterService],
})
export class NewsletterModule {}
