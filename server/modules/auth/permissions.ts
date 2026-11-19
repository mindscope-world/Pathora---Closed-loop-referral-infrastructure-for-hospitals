// The matrix lives in shared/ so the UI can use the same source of truth to hide controls.
// The server remains the only enforcement point (see middleware/auth.ts requirePermission).
export { PERMISSIONS, can, type Permission } from '../../../shared/permissions';
