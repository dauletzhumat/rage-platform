import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ApiFoundResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { auditContextOf, AuditService } from '../audit/audit.service.js';
import { ApiErrorDto } from '../common/errors/api-error.js';
import { StrictAuthThrottle } from '../common/http/throttler.js';
import type { RequestWithIds } from '../common/http/request-id.js';
import { ENV } from '../config/config.module.js';
import { type Env } from '../config/env.js';
import { errorSummary } from '../infra/prisma/prisma.service.js';
import { LoginError, OIDC_STATE_COOKIE, SESSION_COOKIE } from './auth.constants.js';
import { Authenticated } from './auth.decorators.js';
import { CsrfTokenDto } from './auth.dto.js';
import {
  clearOidcStateCookie,
  clearSessionCookies,
  oidcStateCookieOptions,
  readCookie,
  setSessionCookies,
} from './cookies.js';
import { randomToken } from './crypto.js';
import { type AuthedRequest, CurrentUser, OptionalSession } from './guards.js';
import { LoginService } from './login.service.js';
import {
  buildLoginErrorRedirect,
  buildWebRedirect,
  sanitizeReturnTo,
  signOidcState,
  verifyOidcState,
} from './oidc-state.js';
import { type AuthContext, SessionService } from './session.service.js';
import {
  extractOpenIdParams,
  STEAM_OPENID,
  type SteamOpenIdService,
} from './steam-openid.service.js';

type Req_ = Request & RequestWithIds & AuthedRequest;

function rawQuery(req: Request): string {
  const url = req.originalUrl ?? req.url ?? '';
  const idx = url.indexOf('?');
  return idx === -1 ? '' : url.slice(idx + 1);
}

@ApiTags('auth')
@StrictAuthThrottle()
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(STEAM_OPENID) private readonly openid: SteamOpenIdService | null,
    private readonly logins: LoginService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  @Get('steam')
  @ApiOperation({
    summary: 'Start Steam sign-in (top-level navigation). 302 to steamcommunity.com',
    description:
      'Sets the short-lived signed `rage_oidc` state cookie. `returnTo` must be a relative ' +
      'path (`/…`, no `//`, no backslash, max 512); anything else falls back to `/`.',
  })
  @ApiQuery({ name: 'returnTo', required: false, type: String, example: '/me' })
  @ApiFoundResponse({ description: 'Redirect to the Steam OpenID provider' })
  @ApiServiceUnavailableResponse({ type: ApiErrorDto, description: 'Steam sign-in unconfigured' })
  @ApiTooManyRequestsResponse({ type: ApiErrorDto })
  start(@Req() req: Req_, @Res() res: Response): void {
    const steam = this.env.steamAuth;
    if (!steam || !this.openid)
      throw new ServiceUnavailableException('Steam sign-in is not configured');
    const query = new URLSearchParams(rawQuery(req));
    const returnTo = query.getAll('returnTo').length === 1 ? query.get('returnTo') : null;
    const state = randomToken();
    res.setHeader('Cache-Control', 'no-store');
    res.cookie(
      OIDC_STATE_COOKIE,
      signOidcState(steam.sessionSecret, state, sanitizeReturnTo(returnTo)),
      oidcStateCookieOptions(this.env),
    );
    res.redirect(HttpStatus.FOUND, this.openid.buildAuthRedirectUrl(state));
  }

  @Get('steam/callback')
  @ApiOperation({
    summary: 'Steam OpenID callback. Always 302 to the web app',
    description:
      'Success: sets `rage_session` (httpOnly) + `rage_csrf` cookies and redirects to ' +
      '`WEB_PUBLIC_URL + returnTo`. Failure: redirects to `WEB_PUBLIC_URL/login?error=<code>` ' +
      'with code in state_mismatch | cancelled | invalid_assertion | replay | ' +
      'unsupported_account | account_suspended | provider_unavailable | not_configured.',
  })
  @ApiFoundResponse({ description: 'Redirect to the web app (success or /login?error=…)' })
  @ApiServiceUnavailableResponse({ type: ApiErrorDto, description: 'Steam sign-in unconfigured' })
  @ApiTooManyRequestsResponse({ type: ApiErrorDto })
  async callback(@Req() req: Req_, @Res() res: Response): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    const steam = this.env.steamAuth;
    if (!steam || !this.openid) {
      if (this.env.WEB_PUBLIC_URL) {
        res.redirect(
          HttpStatus.FOUND,
          buildLoginErrorRedirect(this.env.WEB_PUBLIC_URL, 'not_configured'),
        );
        return;
      }
      throw new ServiceUnavailableException('Steam sign-in is not configured');
    }
    const ctx = auditContextOf(req);
    // The state cookie is single-use: cleared on every outcome.
    clearOidcStateCookie(res, this.env);

    try {
      const query = new URLSearchParams(rawQuery(req));
      const states = query.getAll('state');
      const verified =
        states.length === 1
          ? verifyOidcState(steam.sessionSecret, readCookie(req, OIDC_STATE_COOKIE), states[0])
          : undefined;
      if (!verified) throw new LoginError('state_mismatch');

      const params = extractOpenIdParams(rawQuery(req));
      const steamId64 = await this.openid.verifyAssertion(params, verified.state);

      const ua = req.headers['user-agent'];
      const result = await this.logins.login(
        steamId64,
        typeof ua === 'string' ? ua : undefined,
        ctx,
      );
      const csrf = this.sessions.csrfTokenFor(result.session.id);
      if (!csrf) throw new LoginError('not_configured');
      // Rotation: a session the browser held before this login is revoked, not kept alive.
      await this.sessions.revokeByToken(readCookie(req, SESSION_COOKIE));
      setSessionCookies(res, this.env, result.session.token, csrf);
      res.redirect(HttpStatus.FOUND, buildWebRedirect(steam.webPublicUrl, verified.returnTo));
    } catch (err) {
      let code: LoginError['code'] = 'provider_unavailable';
      if (err instanceof LoginError) {
        code = err.code;
        // Rejections raised inside the login transaction are audited by LoginService.
        if (!err.audited) await this.logins.recordRejection(code, err.verifiedSteamId64, ctx);
      } else {
        this.logger.error({ err: errorSummary(err) }, 'steam login failed unexpectedly');
      }
      res.redirect(HttpStatus.FOUND, buildLoginErrorRedirect(steam.webPublicUrl, code));
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @OptionalSession()
  @Authenticated({ unsafe: true })
  @ApiOperation({
    summary: 'Sign out: revoke the current session and clear cookies (idempotent)',
    description:
      'With a valid session, requires `x-csrf-token` and an allowlisted Origin. Without a ' +
      'session it only clears cookies and still returns 204.',
  })
  @ApiNoContentResponse({ description: 'Signed out' })
  async logout(
    @Req() req: Req_,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() auth: AuthContext | undefined,
  ): Promise<void> {
    if (auth) {
      const revoked = await this.sessions.revoke(auth.sessionId);
      if (revoked) {
        await this.audit.write(
          {
            action: 'auth.logout',
            actorUserId: auth.userId,
            resourceType: 'auth_session',
            resourceId: auth.sessionId,
          },
          auditContextOf(req),
        );
      }
    }
    clearSessionCookies(res, this.env);
  }

  @Get('csrf')
  @Authenticated()
  @ApiOperation({
    summary: 'CSRF token for the current session (for clients that cannot read the cookie)',
  })
  @ApiOkResponse({ type: CsrfTokenDto })
  csrf(@CurrentUser() auth: AuthContext): CsrfTokenDto {
    const token = this.sessions.csrfTokenFor(auth.sessionId);
    if (!token) throw new ServiceUnavailableException('Steam sign-in is not configured');
    return { csrfToken: token };
  }
}
