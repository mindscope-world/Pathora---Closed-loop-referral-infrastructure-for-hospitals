import 'express-serve-static-core';
import type { Role } from './db/generated/client';

export interface AuthContext {
  userId: string;
  orgId: string;
  role: Role;
  /** Set for FACILITY_FOCAL users: the only facility whose referrals they may see or act on. */
  facilityId: string | null;
  name: string;
  email: string;
  /** Set when the caller is a facility's system using an API key rather than a signed-in person. */
  via?: 'integration';
}

declare module 'express-serve-static-core' {
  interface Request {
    id: string;
    /** Populated by `authenticate`. */
    auth?: AuthContext;
  }
}
