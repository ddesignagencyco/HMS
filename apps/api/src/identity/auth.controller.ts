import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Ip, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiZodBody } from '../common/swagger.js';
import { DomainError } from '../common/domain-error.js';
import { Authenticated, CurrentPrincipal, Public, type AuthenticatedPrincipal } from '../common/policy.js';
import { parseWith } from '../common/validation.js';
import { EnvironmentService } from '../config/environment.service.js';
import { AuthService, type AuthResult } from './auth.service.js';
import { loginSchema, otpRequestSchema, otpVerifySchema, passwordForgotSchema, passwordResetSchema, refreshSchema, registerSchema, logoutSchema, totpVerifySchema } from './auth.schemas.js';

export const REFRESH_COOKIE = 'shm_rt';
const REFRESH_COOKIE_PATH = '/api/v1/auth';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly secureCookies: boolean;

  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(EnvironmentService) private readonly environment: EnvironmentService
  ) {
    this.secureCookies = this.environment.isProduction;
  }

  @Post('register')
  @Public()
  @ApiOperation({
    summary: 'Sign up for a new account',
    description:
      'Creates a customer or service-provider account and immediately sends a one-time verification code (OTP) to the phone number you provided. Finish signing up by calling POST /auth/otp/verify with purpose "REGISTER" and that code.\n\n**Testing locally:** since no real SMS provider is configured, read the code back from `GET /dev/inbox` instead of a real phone.'
  })
  @ApiZodBody(registerSchema, {
    customer: { summary: 'Customer', value: { role: 'CUSTOMER', phoneE164: '+923001234567', password: 'CorrectHorse9Battery', firstName: 'Ayesha', lastName: 'Khan' } },
    provider: { summary: 'Service provider', value: { role: 'PROVIDER', phoneE164: '+923001234568', password: 'CorrectHorse9Battery', firstName: 'Bilal', lastName: 'Ahmed' } }
  })
  async register(@Body() body: unknown) {
    const input = parseWith(registerSchema, body);
    return this.auth.register(input);
  }

  @Post('otp/request')
  @HttpCode(202)
  @Public()
  @ApiOperation({
    summary: 'Send a one-time verification code',
    description:
      'Sends a short-lived numeric code by SMS or email to the given phone number or email address. Used to verify a new account, to log in without a password, or to start a password reset — the "purpose" field tells the server which of these you are doing.'
  })
  @ApiZodBody(otpRequestSchema, { login: { summary: 'Request a login code', value: { target: '+923001234567', purpose: 'LOGIN' } } })
  async requestOtp(@Body() body: unknown, @Headers('accept-language') acceptLanguage?: string) {
    const { target, purpose } = parseWith(otpRequestSchema, body);
    const result = await this.auth.requestOtp(target, purpose, this.localeOf(acceptLanguage));
    return { sent: true, purpose, expiresAt: result.expiresAt, resendAfterSeconds: result.resendAfterSeconds };
  }

  @Post('otp/verify')
  @Public()
  @ApiOperation({
    summary: 'Verify a one-time code',
    description:
      'Submits the code you received by SMS or email. For the REGISTER and LOGIN purposes, a correct code logs you in and returns an access token; for other purposes it just confirms the code matches.\n\n**Testing locally:** find the 6-digit code in `GET /dev/inbox`.'
  })
  @ApiZodBody(otpVerifySchema, { register: { summary: 'Confirm registration', value: { target: '+923001234567', purpose: 'REGISTER', code: '123456' } } })
  async verifyOtp(@Body() body: unknown, @Req() request: Request, @Ip() ip: string, @Res({ passthrough: true }) response: Response) {
    const { target, purpose, code } = parseWith(otpVerifySchema, body);
    const result = await this.auth.verifyOtp(target, purpose, code, this.metaOf(request, ip));
    return this.issue(result, response);
  }

  @Post('login')
  @Public()
  @ApiOperation({
    summary: 'Log in with a password',
    description: 'Signs in using a phone number or email plus a password. Staff accounts (admin, finance, agent) must also supply a valid two-factor (TOTP) code — see the 401 response below.'
  })
  @ApiResponse({ status: 401, description: 'Either the email/phone and password did not match, or (for staff accounts) a two-factor authentication code is required to finish logging in.' })
  @ApiZodBody(loginSchema, {
    customer: { summary: 'Customer or provider', value: { identifier: '+923001234567', password: 'CorrectHorse9Battery' } },
    staff: { summary: 'Seeded admin (dev)', value: { identifier: 'admin@smart-home.local', password: 'DevPassword!2026', totpCode: '123456' } }
  })
  async login(@Body() body: unknown, @Req() request: Request, @Ip() ip: string, @Res({ passthrough: true }) response: Response) {
    const input = parseWith(loginSchema, body);
    return this.issue(await this.auth.login(input, this.metaOf(request, ip)), response);
  }

  @Post('refresh')
  @Public()
  @ApiOperation({
    summary: 'Get a new access token',
    description:
      'Uses the httpOnly refresh cookie set at login to issue a fresh access token without asking the user to log in again. Each refresh token can only be used once, and using it issues a new one.'
  })
  @ApiResponse({
    status: 401,
    description:
      'The refresh token had already been used once before. That looks like the token was stolen and replayed, so every session descended from it has been signed out as a precaution — the user needs to log in again.'
  })
  @ApiZodBody(refreshSchema, { default: { summary: 'Non-browser client holding the token itself', value: { refreshToken: 'a-refresh-token-from-a-previous-login' } } })
  async refresh(@Body() body: unknown, @Req() request: Request, @Ip() ip: string, @Res({ passthrough: true }) response: Response) {
    // The cookie is the browser transport and the body is the fallback for
    // clients that cannot hold an httpOnly cookie. An empty body is valid, so a
    // browser that sends no content type is not rejected for it.
    const fromBody = parseWith(refreshSchema, body ?? {}).refreshToken;
    const presented = this.cookieOf(request) ?? fromBody;
    if (presented === undefined) throw new DomainError('UNAUTHENTICATED', 'A refresh token is required');
    return this.issue(await this.auth.refresh(presented, this.metaOf(request, ip)), response);
  }

  @Post('logout')
  @HttpCode(204)
  @Public()
  @ApiOperation({
    summary: 'Log out',
    description: 'Ends the current session by invalidating the refresh cookie. The access token you were holding will simply expire on its own shortly after (it is not individually revoked).'
  })
  @ApiZodBody(logoutSchema, { default: { summary: 'Non-browser client holding the token itself', value: { refreshToken: 'a-refresh-token-from-a-previous-login' } } })
  async logout(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const presented = this.cookieOf(request) ?? parseWith(logoutSchema, body ?? {}).refreshToken;
    if (presented !== undefined) await this.auth.logout(presented);
    this.clearCookie(response);
  }

  @Post('password/forgot')
  @HttpCode(202)
  @Public()
  @ApiOperation({
    summary: 'Request a password reset code',
    description:
      'Sends a reset code to the given phone number or email if an account exists for it. To stop attackers from being able to guess which accounts exist, this endpoint always returns the same response whether or not a matching account was found.'
  })
  @ApiZodBody(passwordForgotSchema, { default: { summary: 'By phone', value: { identifier: '+923001234567' } } })
  async forgot(@Body() body: unknown, @Headers('accept-language') acceptLanguage?: string) {
    const { identifier } = parseWith(passwordForgotSchema, body);
    return this.auth.requestPasswordReset(identifier, this.localeOf(acceptLanguage));
  }

  @Post('password/reset')
  @Public()
  @ApiOperation({
    summary: 'Reset your password',
    description:
      'Submits the reset code from POST /auth/password/forgot along with a new password. On success, every other active session on the account is signed out for safety, and this response logs you in with a fresh session.'
  })
  @ApiZodBody(passwordResetSchema, { default: { summary: 'Reset with the emailed/texted code', value: { identifier: '+923001234567', code: '123456', newPassword: 'BrandNewPass9' } } })
  async reset(@Body() body: unknown, @Req() request: Request, @Ip() ip: string, @Res({ passthrough: true }) response: Response) {
    const input = parseWith(passwordResetSchema, body);
    return this.issue(await this.auth.resetPassword(input, this.metaOf(request, ip)), response);
  }

  @Get('me')
  @Authenticated()
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get your own profile',
    description:
      "Returns the currently logged-in user's details, including their roles (e.g. CUSTOMER, PROVIDER, ADMIN) and, for providers, their approval status. Useful right after login to know what the user is allowed to do."
  })
  async me(@CurrentPrincipal() principal: AuthenticatedPrincipal | undefined) {
    return { user: await this.auth.describe(this.requirePrincipal(principal)) };
  }

  /**
   * "Is this browser signed in?", answerable from the httpOnly refresh cookie
   * alone and never a 401.
   *
   * A page reload destroys the in-memory access token, so the only evidence a
   * session survived is the cookie — and `GET /auth/me` cannot read it, because
   * it needs a bearer token. A client therefore has to call /auth/me, get a 401,
   * then call /auth/refresh to rebuild a session it already has, which logs two
   * errors on every public page for every signed-out visitor and makes the
   * signed-in and signed-out states indistinguishable at the first question.
   *
   * This reads the cookie without rotating it (see `SessionService.identify`), so
   * the token is still usable for the real refresh afterwards, and answers 200
   * either way: `{ authenticated: false }` with no user for a signed-out
   * visitor, or the same `user` object `GET /auth/me` returns.
   */
  @Get('session')
  @Public()
  @ApiOperation({
    summary: 'Ask whether there is a session, without failing when there is not',
    description:
      'A cheap, never-401 check for public pages. Answers `{ authenticated: false }` for a signed-out visitor, or `{ authenticated: true, user }` when the httpOnly refresh cookie is still valid — which is the only way a browser can know it is signed in after a reload, since the access token is held in memory only. Reading the cookie here does not rotate or consume it. Returns `user: null` rather than a 401 so a public page does not have to treat "nobody is signed in" as an error.'
  })
  async session(@Req() request: Request) {
    const presented = this.cookieOf(request);
    if (presented === undefined) return { authenticated: false, user: null };
    const userId = await this.auth.userIdOfRefresh(presented);
    if (userId === null) return { authenticated: false, user: null };
    return { authenticated: true, user: await this.auth.describe(userId) };
  }

  @Post('totp/setup')
  @Authenticated()
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Start setting up two-factor authentication',
    description:
      'Generates a new secret key and QR-code link for an authenticator app (e.g. Google Authenticator, Authy). This is shown only this one time, so save it — then confirm it works with POST /auth/totp/verify before it is treated as active.'
  })
  async totpSetup(@CurrentPrincipal() principal: AuthenticatedPrincipal | undefined) {
    return this.auth.beginTotpSetup(this.requirePrincipal(principal));
  }

  @Post('totp/verify')
  @Authenticated()
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Confirm and turn on two-factor authentication',
    description: 'Verifies the 6-digit code currently showing in your authenticator app. If it matches, two-factor authentication is switched on for the account from now on.'
  })
  @ApiZodBody(totpVerifySchema, { default: { summary: 'Authenticator code', value: { code: '123456' } } })
  async totpVerify(@CurrentPrincipal() principal: AuthenticatedPrincipal | undefined, @Body() body: unknown) {
    return this.auth.confirmTotpSetup(this.requirePrincipal(principal), parseWith(totpVerifySchema, body));
  }

  @Delete('totp')
  @Authenticated()
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Turn off two-factor authentication',
    description: 'Disables two-factor authentication for the account. Sessions that are already logged in keep working, but will be asked to set TOTP up again the next time they log in as staff.'
  })
  async totpDisable(@CurrentPrincipal() principal: AuthenticatedPrincipal | undefined) {
    return this.auth.disableTotp(this.requirePrincipal(principal));
  }

  /**
   * The refresh token is delivered as an httpOnly cookie scoped to the auth
   * routes (TRD §16) so script cannot read it. The access token stays in the
   * response body for the client to hold in memory only.
   */
  private issue(result: AuthResult, response: Response) {
    response.cookie(REFRESH_COOKIE, result.refreshToken, {
      httpOnly: true,
      secure: this.secureCookies,
      sameSite: 'lax',
      path: REFRESH_COOKIE_PATH,
      expires: new Date(result.refreshExpiresAt)
    });
    return {
      user: result.user,
      accessToken: result.accessToken,
      expiresInSeconds: result.expiresInSeconds,
      totpRequired: result.totpRequired
    };
  }

  private clearCookie(response: Response): void {
    response.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: this.secureCookies, sameSite: 'lax', path: REFRESH_COOKIE_PATH });
  }

  private requirePrincipal(principal: AuthenticatedPrincipal | undefined): string {
    if (principal === undefined) throw new DomainError('UNAUTHENTICATED', 'Authentication is required');
    return principal.userId;
  }

  private metaOf(request: Request, ip: string): { userAgent?: string | undefined; ip?: string | undefined } {
    const agent = request.headers['user-agent'];
    return { userAgent: agent, ip: ip === '' ? undefined : ip };
  }

  private localeOf(acceptLanguage: string | undefined): string {
    return acceptLanguage?.toLowerCase().startsWith('ur') ? 'ur' : 'en';
  }

  private cookieOf(request: Request): string | undefined {
    const raw = request.headers.cookie;
    if (raw === undefined) return undefined;
    for (const part of raw.split(';')) {
      const separator = part.indexOf('=');
      if (separator === -1) continue;
      if (part.slice(0, separator).trim() === REFRESH_COOKIE) return decodeURIComponent(part.slice(separator + 1));
    }
    return undefined;
  }
}
