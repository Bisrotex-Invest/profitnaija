import type { UserProfile } from '@/context/ProfileContext';

/**
 * A profile counts as "complete" (allowed into the app) once the user has
 * filled the essentials and accepted the Terms & Conditions.
 */
export function isProfileComplete(p: UserProfile): boolean {
  return !!(
    p.fullName.trim() &&
    p.phone.trim() &&
    p.businessName.trim() &&
    p.natureOfBusiness.trim() &&
    p.termsAccepted
  );
}
