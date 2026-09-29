import type { Request } from 'express';

export interface SessionUser {
  id: number;
  login: string;
  displayName: string;
  profile: string;
  permissions: string[];
}

export interface AuthenticatedRequest extends Request {
  user?: SessionUser;
}

export interface ProfileRow {
  id: number;
  name: string;
  permissions: string[] | string;
  is_system: number;
}

export interface AppUserRow {
  id: number;
  username: string;
  display_name: string;
  password_hash: string;
  profile_id: number;
  active: number;
  legacy_id: number | null;
}