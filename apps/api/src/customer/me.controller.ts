import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Authenticated, CurrentPrincipal, PolicyDecorator, type AuthenticatedPrincipal } from '../common/policy.js';
import { ApiZodBody } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { passwordChangeSchema, profileUpdateSchema } from './customer.schemas.js';
import { FavouritesService } from './favourites.service.js';
import { MeService } from './me.service.js';

@ApiTags('customer')
@ApiBearerAuth('access-token')
@Controller('me')
export class MeController {
  constructor(
    @Inject(MeService) private readonly me: MeService,
    @Inject(FavouritesService) private readonly favourites: FavouritesService
  ) {}

  @Get()
  @Authenticated()
  @ApiOperation({ summary: 'Get your own profile', description: 'Your name, contact details, locale, roles and — for a provider — approval status. The account-owner view of the same data `GET /auth/me` returns.' })
  async get(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return { user: await this.me.get(principal) };
  }

  @Patch()
  @Authenticated()
  @ApiOperation({ summary: 'Update your own profile', description: 'Changes the fields you own: first name, last name and language. Your phone number and email are login identifiers and change through the OTP flow, not here.' })
  @ApiZodBody(profileUpdateSchema, { default: { summary: 'Rename yourself', value: { firstName: 'Ayesha', lastName: 'Khan', locale: 'en' } } })
  async update(@Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return { user: await this.me.update(principal, parseWith(profileUpdateSchema, body)) };
  }

  @Patch('password')
  @Authenticated()
  @ApiOperation({ summary: 'Change your password', description: 'Requires your current password and revokes every other session, so a password changed after a compromise signs the other party out.' })
  @ApiZodBody(passwordChangeSchema, { default: { summary: 'Change it', value: { currentPassword: 'CorrectHorse9Battery', newPassword: 'BrandNewPass9' } } })
  async changePassword(@Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.me.changePassword(principal, parseWith(passwordChangeSchema, body));
  }

  @Post('deactivate')
  @HttpCode(200)
  @Authenticated()
  @ApiOperation({ summary: 'Deactivate your account', description: 'Anonymises your name, phone and email and revokes every session. Bookings and ledger entries are financial records and are kept.' })
  async deactivate(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.me.deactivate(principal);
  }

  @Get('favourites')
  @PolicyDecorator({ roles: ['CUSTOMER'] })
  @ApiOperation({ summary: 'List your favourite providers', description: 'The approved providers you have shortlisted, most recently added first.' })
  async listFavourites(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return { items: await this.favourites.list(principal.userId) };
  }

  @Post('favourites/:providerId')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['CUSTOMER'] })
  @ApiOperation({ summary: 'Add a provider to your favourites', description: 'Idempotent: adding one you already shortlisted is a no-op. Only approved providers can be favourited.' })
  async addFavourite(@Param('providerId', ParseUUIDPipe) providerId: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.favourites.add(principal.userId, providerId);
  }

  @Delete('favourites/:providerId')
  @HttpCode(204)
  @PolicyDecorator({ roles: ['CUSTOMER'] })
  @ApiOperation({ summary: 'Remove a provider from your favourites', description: 'Removes the shortlist entry. Removing one that was not shortlisted is rejected as a bad request rather than silently ignored.' })
  async removeFavourite(@Param('providerId', ParseUUIDPipe) providerId: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    await this.favourites.remove(principal.userId, providerId);
  }
}
