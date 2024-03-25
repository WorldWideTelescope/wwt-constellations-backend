import type { JwtPayload } from "jsonwebtoken";
import type { KeycloakTokenParsed } from "keycloak-js";
import { Request as JwtRequest } from "express-jwt";
import { NextFunction, RequestHandler, Response } from "express";

import { State } from "./globals.js";

export type KeycloakJwtRequest = JwtRequest<JwtPayload & KeycloakTokenParsed>;

export type ConstellationsRole = 'update-home-timeline' | 'update-global-tessellation' |
                                 'manage-handles' | 'manage-features';

export function amISuperuser(req: JwtRequest, state: State): boolean {
  return req.auth !== undefined && req.auth.sub === state.config.superuserAccountId;
}

export function hasRole(req: KeycloakJwtRequest, role: ConstellationsRole): boolean {
  return req.auth !== undefined && !!req.auth.realm_access?.roles.includes(role);
}

export function makeRequireRoleMiddleware(role: ConstellationsRole): RequestHandler {
  return (req: KeycloakJwtRequest, res: Response, next: NextFunction) => {
    if (!hasRole(req, role)) {
      res.status(403).json({
        error: true,
        message: "Forbidden",
      });
    } else {
      next();
    }
  };
}

export function makeRequireSuperuserMiddleware(state: State): RequestHandler {
  return (req: JwtRequest, res: Response, next: NextFunction) => {
    if (!amISuperuser(req, state)) {
      res.status(403).json({
        error: true,
        message: "Forbidden",
      });
    } else {
      console.warn("executing superuser API call:", req.path);
      next();
    }
  };
}

export function makeRequireSuperuserOrRoleMiddleware(state: State, role: ConstellationsRole): RequestHandler {
  return (req: KeycloakJwtRequest, res: Response, next: NextFunction) => {
    const allowed = amISuperuser(req, state) || hasRole(req, role);
    if (!allowed) {
      res.status(403).json({
        error: true,
        message: "Forbidden",
      });
    } else {
      next();
    }
  };
}
